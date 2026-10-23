/**
 * BIM resources (Storey, Grid, Material, Type): identity, names, ordering,
 * reference resolution and dependency (usage) inspection — in one place.
 *
 * Identity: every resource has a stable, immutable id (L-0001, G-0001, M-0001,
 * WT-0001, ...). Elements reference storeys and types by id; layered and
 * profile types reference materials by id. Names are mutable display labels.
 *
 * Usage is found by a linear scan of the model (O(elements + types)); every
 * caller (delete protection, usage query, validation) goes through
 * resourceUsage(), so it can be indexed later without touching callers.
 */
import { handlersOf } from "./engines/handlers.js";
import { DomainError, ErrorDetails } from "@insa/core";
import { isLayeredType } from "./model.js";
import type { BimState, LayeredType, ProfileType, Element, MepSegment } from "./model.js";
import { LEGACY_KIND_V3 } from "./model.js";
import { topologyIndex, wallsOf } from "./topology.js";

export type ResourceKind = "storey" | "grid" | "material" | "type" | "family" | "mep_system" | "spatial_unit";
export const RESOURCE_KINDS: ResourceKind[] = ["storey", "grid", "material", "type", "family"];

/** Name rules: 1-100 characters, no leading/trailing whitespace, no control characters. */
export const MAX_NAME_LENGTH = 100;
export function nameProblem(name: unknown): string | null {
  if (typeof name !== "string") return "must be a string";
  if (!name.trim()) return "must not be empty";
  if (name !== name.trim()) return "must not start or end with whitespace";
  if (name.length > MAX_NAME_LENGTH) return `must be at most ${MAX_NAME_LENGTH} characters`;
  if (/[\u0000-\u001f\u007f]/.test(name)) return "must not contain control characters";
  return null;
}
/** Tools normalise names before they reach events (trimmed); the domain then checks the rule. */
export const normalizeName = (name: string) => name.trim();

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);              // code-point order: locale independent

/** Deterministic orderings for queries. */
export const ORDER = {
  storey: (a: { elevation: number; id: string }, b: { elevation: number; id: string }) => a.elevation - b.elevation || cmp(a.id, b.id),
  grid: (a: { id: string }, b: { id: string }) => cmp(a.id, b.id),                                       // creation order
  material: (a: { name: string; id: string }, b: { name: string; id: string }) => cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.id, b.id),
  type: (a: { kind: string; name: string; id: string }, b: { kind: string; name: string; id: string }) =>
    cmp(a.kind, b.kind) || cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.id, b.id),
  family: (a: { category: string; name: string; id: string }, b: { category: string; name: string; id: string }) =>
    cmp(a.category, b.category) || cmp(a.name.toLowerCase(), b.name.toLowerCase()) || cmp(a.id, b.id),
};

/**
 * Uniqueness scope (case-insensitive): storeys, grids and materials — within their resource kind;
 * types — within their type kind (a wall type and a slab type may share a name); component types —
 * within their family; families — within their category.
 */
export function duplicateOf(s: BimState, kind: ResourceKind, r: { id: string; name: string; kind?: string; family?: string; category?: string }): string | null {
  const pool: { id: string; name: string }[] =
    kind === "storey" ? Object.values(s.storeys) : kind === "grid" ? Object.values(s.grids)
    : kind === "material" ? Object.values(s.materials)
    : kind === "mep_system" ? Object.values(s.mepSystems ?? {})
    : kind === "spatial_unit" ? Object.values(s.spatialUnits ?? {}).filter((u) => u.parent === ((s.spatialUnits ?? {})[r.id]?.parent ?? (r as { parent?: string | null }).parent ?? null))
    : kind === "family" ? Object.values(s.families ?? {}).filter((f) => f.category === r.category)
    : r.kind === "component" ? Object.values(s.types).filter((t) => t.kind === "component" && (t as { family: string }).family === r.family)
    : Object.values(s.types).filter((t) => t.kind === r.kind);
  return pool.find((x) => x.id !== r.id && sameName(x.name, r.name))?.id ?? null;
}

function pool(s: BimState, kind: ResourceKind, typeKind?: string): Record<string, { id: string; name: string }> {
  if (kind === "mep_system") return s.mepSystems ?? {};
  if (kind === "spatial_unit") return s.spatialUnits ?? {};
  if (kind === "storey") return s.storeys;
  if (kind === "grid") return s.grids;
  if (kind === "material") return s.materials;
  if (kind === "family") return s.families ?? {};
  return typeKind ? Object.fromEntries(Object.entries(s.types).filter(([, t]) => t.kind === typeKind)) : s.types;
}

/** Resolves an id or a (case-insensitive) name. Types can be scoped to a type kind. */
export function findResource(s: BimState, kind: ResourceKind, ref: string, typeKind?: string): { id: string; name: string } {
  const rec = pool(s, kind, typeKind);
  if (rec[ref]) return rec[ref];
  const hits = Object.values(rec).filter((x) => sameName(x.name, ref.trim()));
  const what = typeKind ? `${typeKind} type` : kind;
  if (hits.length === 1) return hits[0];
  if (hits.length > 1)
    throw new DomainError(`${what} name '${ref}' is ambiguous (${hits.map((h) => h.id).join(", ")}); use the id.`, "AMBIGUOUS_RESOURCE_REFERENCE",
      { resourceKind: kind, ref });
  throw new DomainError(`${what} '${ref}' not found.`, "RESOURCE_NOT_FOUND", { resourceKind: kind, ref });
}

export const SAMPLE_LIMIT = 10;
export type Usage =
  | { kind: "element"; elementKind: string; count: number; sampleIds: string[] }
  /** elements whose vertical constraint targets the storey (Phase 5) */
  | { kind: "constraint"; elementKind: string; count: number; sampleIds: string[] }
  | { kind: "type"; typeId: string; typeName: string; typeKind: string; via: "layer" | "profile" | "component" | "family"; layerIndexes?: number[] }
  /** informative only (Phase 7): instances reached indirectly (family -> types -> components); not counted */
  | { kind: "instance"; elementKind: string; count: number; sampleIds: string[] };
export interface ResourceUsage { resourceKind: ResourceKind; resourceId: string; usageCount: number; usages: Usage[]; }

/**
 * Everything in the model that references a resource. Grids are reference
 * lines only: nothing in the current model depends on them.
 */
/**
 * Public label of an element for usage reports: the well-known name of a built-in category (column, beam,
 * slab, door, window — the words these reports always used), else the storage variant for single-category
 * variants (wall, opening, component, spatial), else the category id. Never the engine variant name alone.
 */
const CATEGORY_LABEL: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
  Object.entries(LEGACY_KIND_V3).map(([word, m]) => [m.category, word])));
export function elementLabel(s: BimState, el: Element): string {
  const h = handlersOf(el);
  // an engine that names its elements by SEMANTIC category (ceiling, roof, stair, railing, structure.brace ...) never exposes its storage variant
  if (h.semanticLabel) { const c = (el as unknown as { category: string }).category; return CATEGORY_LABEL[c] ?? c.replace(/^architecture\./, ""); }
  return h.label?.(s, el) ?? el.kind;
}

/**
 * Model-tree group of an element: its SEMANTIC category (floor / ceiling / roof / stair / railing / room / space ...), never its engine or storage
 * variant. Usage reports keep elementLabel (a room is still "spatial" there: Phase 8 output is unchanged).
 */
export function elementGroup(s: BimState, el: Element): string {
  return el.kind === "spatial" ? el.category.split(".").pop()! : elementLabel(s, el);
}

export function resourceUsage(s: BimState, kind: ResourceKind, id: string): ResourceUsage {
  const usages: Usage[] = [];
  if (kind === "storey" || kind === "type") {
    const byKind = new Map<string, string[]>();
    for (const el of Object.values(s.elements)) {
      const refs = kind === "storey" ? [el.storey, ...(el.kind === "profile_member" && el.placement === "member_spatial_axis" ? [el.end.storey] : []), ...(el.kind === "mep_segment" ? el.route.map((p) => p.storey) : [])]
        : "type" in el ? [(el as { type: string }).type] : [];
      if (!refs.includes(id)) continue;
      const label = elementLabel(s, el);                      // grouped by what elements ARE (category), not by storage variant
      if (!byKind.has(label)) byKind.set(label, []);
      byKind.get(label)!.push(el.id);
    }
    for (const [elementKind, ids] of [...byKind].sort((a, b) => cmp(a[0], b[0])))
      usages.push({ kind: "element", elementKind, count: ids.length, sampleIds: ids.sort(cmp).slice(0, SAMPLE_LIMIT) });
  }
  if (kind === "storey") {                                   // a storey can also be the target of vertical constraints
    const byKind = new Map<string, string[]>();
    for (const el of Object.values(s.elements)) {
      const v = (el as { vertical?: { mode: string; storey?: string } }).vertical;
      if (v?.mode !== "storey" || v.storey !== id) continue;
      const label = elementLabel(s, el);                      // grouped by what elements ARE (category), not by storage variant
      if (!byKind.has(label)) byKind.set(label, []);
      byKind.get(label)!.push(el.id);
    }
    for (const [elementKind, ids] of [...byKind].sort((a, b) => cmp(a[0], b[0])))
      usages.push({ kind: "constraint", elementKind, count: ids.length, sampleIds: ids.sort(cmp).slice(0, SAMPLE_LIMIT) });
  }
  if (kind === "material") {
    for (const t of Object.values(s.types).sort(ORDER.type)) {
      if("finishMaterial" in t && t.finishMaterial === id) usages.push({kind:"type",typeId:t.id,typeName:t.name,typeKind:t.kind,via:"component"});
      if (isLayeredType(t)) {
        const idx = (t as LayeredType).layers.flatMap((l, i) => (l.material === id ? [i] : []));
        if (idx.length) usages.push({ kind: "type", typeId: t.id, typeName: t.name, typeKind: t.kind, via: "layer", layerIndexes: idx });
      } else if ((t.kind === "column" || t.kind === "beam") && (t as ProfileType).material === id)
        usages.push({ kind: "type", typeId: t.id, typeName: t.name, typeKind: t.kind, via: "profile" });
      else if ((t.kind === "stair" || t.kind === "railing" || t.kind === "pipe" || t.kind === "duct" || t.kind === "cable_tray" || t.kind === "conduit" || t.kind === "cable") && (t as { material?: string }).material === id)
        usages.push({ kind: "type", typeId: t.id, typeName: t.name, typeKind: t.kind, via: "profile" });
      else if ((t.kind === "component" || t.kind === "door" || t.kind === "window") && (t as { material?: string }).material === id)
        usages.push({ kind: "type", typeId: t.id, typeName: t.name, typeKind: t.kind, via: "component" });
    }
  }
  if (kind === "spatial_unit") {                            // a unit is used by its child units and by the infrastructure elements contained in it (blocking)
    const kids = Object.values(s.spatialUnits ?? {}).filter((u) => u.parent === id).map((u) => u.id).sort(cmp);
    if (kids.length) usages.push({ kind: "element", elementKind: "child spatial unit", count: kids.length, sampleIds: kids.slice(0, SAMPLE_LIMIT) });
    const byLabel = new Map<string, string[]>();
    for (const e of Object.values(s.elements)) if (handlersOf(e).container?.(e)?.id === id) { const l = elementLabel(s, e); (byLabel.get(l) ?? byLabel.set(l, []).get(l)!).push(e.id); }
    for (const [elementKind, ids] of [...byLabel].sort((a, b) => cmp(a[0], b[0]))) usages.push({ kind: "element", elementKind, count: ids.length, sampleIds: ids.sort(cmp).slice(0, SAMPLE_LIMIT) });
  }
  if (kind === "mep_system") {                              // a system is used by its route elements (blocking); connected equipment is informative
    // a system is used by every element that belongs to it: routes AND fittings (a fitting-only system must not be deletable)
    const segs = Object.values(s.elements).filter((e): e is MepSegment => (e.kind === "mep_segment" || e.kind === "mep_fitting") && (e as MepSegment).system === id);
    const byLabel = new Map<string, string[]>();
    for (const e of segs) { const l = elementLabel(s, e); (byLabel.get(l) ?? byLabel.set(l, []).get(l)!).push(e.id); }
    for (const [elementKind, ids] of [...byLabel].sort((a, b) => cmp(a[0], b[0]))) usages.push({ kind: "element", elementKind, count: ids.length, sampleIds: ids.sort(cmp).slice(0, SAMPLE_LIMIT) });
    const eq = new Set<string>();
    for (const j of Object.values(s.mepJunctions ?? {})) if (j.members.some((m) => segs.some((e) => e.id === m.element))) for (const m of j.members) if (s.elements[m.element]?.kind === "component") eq.add(m.element);
    if (eq.size) usages.push({ kind: "instance", elementKind: "component (connected)", count: eq.size, sampleIds: [...eq].sort(cmp).slice(0, SAMPLE_LIMIT) });
  }
  if (kind === "family") {                                  // family -> component types (blocking) -> components (informative)
    const types = Object.values(s.types).filter((t) => t.kind === "component" && (t as { family: string }).family === id).sort(ORDER.type);
    for (const t of types) usages.push({ kind: "type", typeId: t.id, typeName: t.name, typeKind: t.kind, via: "family" });
    const tids = new Set(types.map((t) => t.id));
    const inst = Object.values(s.elements).filter((e) => e.kind === "component" && tids.has(e.type)).map((e) => e.id).sort(cmp);
    if (inst.length) usages.push({ kind: "instance", elementKind: "component", count: inst.length, sampleIds: inst.slice(0, SAMPLE_LIMIT) });
  }
  const usageCount = usages.reduce((n, u) => n + (u.kind === "instance" ? 0 : u.kind === "element" || u.kind === "constraint" ? u.count : 1), 0);
  return { resourceKind: kind, resourceId: id, usageCount, usages };
}

export function usageSummary(u: ResourceUsage): string {
  return u.usages.map((x) => (x.kind === "element" ? `${x.count} ${x.elementKind}`
    : x.kind === "constraint" ? `${x.count} ${x.elementKind} constrained to it`
    : x.kind === "instance" ? `${x.count} ${x.elementKind} instances through those types`
    : `${x.typeKind} type ${x.typeName}${x.layerIndexes ? ` layer ${x.layerIndexes.join(",")}` : ""}`)).join("; ");
}

/** RESOURCE_IN_USE with bounded, safe details. */
export function inUseError(u: ResourceUsage, name: string): DomainError {
  const details: ErrorDetails = { resourceKind: u.resourceKind, resourceId: u.resourceId, usageCount: u.usageCount, usageSummary: usageSummary(u) };
  const sample = u.usages.filter((x) => x.kind !== "instance").flatMap((x) => (x.kind === "type" ? [x.typeId] : x.sampleIds)).slice(0, SAMPLE_LIMIT);
  if (sample.length) details.sampleIds = sample.join(",");
  return new DomainError(`${u.resourceKind} '${name}' (${u.resourceId}) is in use: ${usageSummary(u)}. Nothing was deleted.`, "RESOURCE_IN_USE", details);
}


// ================================================================== element relationships (Phase 6)
export type ElementReference =
  | { kind: 'roof_attachment'; id: string }
  | { kind: "mep_junction"; id: string; connector: string }
  | { kind: "reinforcement"; id: string }
  | { kind: "assembly_member"; id: string }
  | { kind: "dependent"; id: string }                       // generic: an element (of an extension engine) that references another
 
  | { kind: "hosted_opening"; id: string }      // an opening hosted by the wall
  | { kind: "fill"; id: string }                // the door / window filling the opening
  | { kind: "filled_opening"; id: string }      // the opening a door / window fills (back-reference)
  | { kind: "join"; id: string; joinKind: string; walls: string[] };

/**
 * Everything that references element `id` and would dangle if it were deleted. The single
 * relationship scan used by delete protection, bim_get_element_usage and future features.
 */
export function elementReferences(s: BimState, id: string): ElementReference[] {
  const el = s.elements[id];
  const out: ElementReference[] = [];
  for (const o of Object.values(s.elements).sort((a, b) => cmp(a.id, b.id)))                // what each element HOLDS is declared by its engine
    for (const e of handlersOf(o).references?.(o) ?? []) if (e.target === id) out.push(e.ref);
  for (const j of Object.values(s.mepJunctions ?? {}).sort((a, b) => cmp(a.id, b.id))) for (const m of j.members) if (m.element === id) out.push({ kind: "mep_junction", id: j.id, connector: m.connector });
  if (!el || el.kind === "wall")
    for (const j of topologyIndex(s).byWall.get(id) ?? []) out.push({ kind: "join", id: j.id, joinKind: j.kind, walls: wallsOf(j) });
  return out;
}

/** Structured usage of an element: what references it, what it references, and its directly joined walls. */
export function elementUsage(s: BimState, id: string) {
  const el = s.elements[id];
  const refs = elementReferences(s, id);
  const joins = refs.filter((x): x is Extract<ElementReference, { kind: "join" }> => x.kind === "join");
  const connected = [...new Set(joins.flatMap((j) => j.walls))].filter((w) => w !== id).sort(cmp);
  return {
    elementId: id, elementKind: el ? elementLabel(s, el) : null,           // the public label (column, door, ...), not the engine variant
    ...(el && "category" in el ? { category: (el as { category: string }).category } : {}),
    usageCount: refs.filter((x) => x.kind !== "filled_opening").length,
    hostedOpenings: refs.filter((x) => x.kind === "hosted_opening").map((x) => x.id),
    fills: refs.filter((x) => x.kind === "fill").map((x) => x.id),
    joins: joins.map((j) => ({ joinId: j.id, kind: j.joinKind, walls: j.walls })),
    connectedWalls: connected,
    references: {
      ...(el && "host" in el ? { host: (el as { host: string }).host } : {}),
      ...(el && el.kind === "hosted_component" ? { opening: el.opening } : {}),
      ...(el?.kind === "opening" && el.filledBy ? { filledBy: el.filledBy } : {}),
    },
  };
}

/** ELEMENT_IN_USE with bounded, safe details. */
export function elementInUseError(s: BimState, id: string, kind: string, refs: ElementReference[]): DomainError {
  const summary = ["hosted_opening", "fill", "filled_opening", "join", "mep_junction", "reinforcement", "assembly_member"].map((k) => [k, refs.filter((r) => r.kind === k).length] as const)
    .filter(([, n]) => n).map(([k, n]) => `${n} ${k.replace("_", " ")}${n > 1 ? "s" : ""}`).join("; ");
  return new DomainError(`${kind} ${id} is still referenced (${summary}); remove those relations first (disconnect MEP connectors with bim_disconnect_mep; or delete hosted elements with cascade_hosted). Nothing was deleted.`,
    "ELEMENT_IN_USE", { elementId: id, elementKind: kind, usageCount: refs.length, usageSummary: summary,
      dependentIds: [...new Set(refs.map((r) => r.id))].slice(0, SAMPLE_LIMIT).join(",") });
}
