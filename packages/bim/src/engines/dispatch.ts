/**
 * Engine dispatch (Phase 9): the ONE path from an element to its behaviour.
 *   element -> categoryIdOfElement -> category -> engine
 * plus the centralised Category -> Engine -> Type -> Placement chain check, the normalised placement,
 * the derived representation and the normalised relationships. Static maps only (cheap, deterministic).
 */
import type { ErrorDetails } from "@insa/core";
import type { BimState, Element, Wall, Opening, Component, SpatialElement, ProfileMember, Boundary, HostedComponent, WallJoin } from "../model.js";
import { findEngine, engineOfKind, EngineDefinition, TYPE_FAMILY_OF_KIND, PlacementKind } from "./registry.js";
import { findCategory, categoryIdOfElement, categoryIdOfType, listCategories, CategoryDefinition } from "../taxonomy.js";
import { fail } from "./kit.js";
import { handlersOf } from "./handlers.js";
import type { mepPlacement, mepRepresentation } from "../mep.js";
import type { fittingPlacement, fittingRepresentation } from "./mep-fitting.js";
import type { rebarPlacement, rebarRepresentation } from "./reinforcement.js";
import type { memberPlacement, memberRepresentation } from "./profile-member.js";
import type { boundaryPlacement, boundaryRepresentation } from "./boundary.js";
import type { hostedPlacement, hostedRepresentation } from "./hosted.js";
import type { stairPlacement, stairRepresentation } from "./stair.js";
import type { pathPlacement, pathRepresentation } from "./path.js";
import { SpatialContext, resolveSpatialElement } from "../spatial.js";
import { topologyIndex, wallsOf } from "../topology.js";

/** The union of the built-in engines' derived placements / representations (extension engines add their own shapes; consumers read the kinds they know). */
export type BuiltinPlacement = ReturnType<typeof memberPlacement> | ReturnType<typeof boundaryPlacement> | ReturnType<typeof stairPlacement> | ReturnType<typeof pathPlacement> | ReturnType<typeof mepPlacement> | ReturnType<typeof fittingPlacement> | ReturnType<typeof rebarPlacement>
  | ReturnType<typeof hostedPlacement> | { kind: "wall_axis"; storey: string; start: [number, number]; end: [number, number]; baseOffset: number } | { kind: "aggregate"; storey: string; children: string[] }
  | { kind: "host"; storey: string; host: string; along: number; sill: number } | { kind: "level_point"; storey: string; [k: string]: unknown } | { kind: "spatial_point"; storey: string; point: [number, number] };
export type BuiltinRepresentation = ReturnType<typeof memberRepresentation> | ReturnType<typeof boundaryRepresentation> | ReturnType<typeof stairRepresentation> | ReturnType<typeof pathRepresentation> | ReturnType<typeof mepRepresentation> | ReturnType<typeof fittingRepresentation>
  | ReturnType<typeof rebarRepresentation> | ReturnType<typeof hostedRepresentation> | { kind: "wall_extrusion"; footprint: [number, number][]; bottom: number; height: number; thickness: number; ends: { start: unknown; end: unknown } }
  | { kind: "aggregate"; children: string[] } | { kind: "host_cut"; host: string; along: number; sill: number; width: number; height: number } | { kind: "box"; width: number; depth: number; height: number } | { kind: "spatial_prism"; outer: [number, number][]; holes: [number, number][][]; bottom: number; height: number } | null;

/** Category of the element and its engine — unknown ids fail explicitly. */
export function categoryOfElement(s: BimState, el: Element): CategoryDefinition {
  const id = categoryIdOfElement(s, el);
  const c = id ? findCategory(id) : undefined;
  if (!c) fail("INVALID_CATEGORY", `${el.id}: unknown category '${id ?? "?"}'.`, { elementId: el.id, categoryId: String(id) });
  return c!;
}
export function engineOfElement(s: BimState, el: Element): EngineDefinition {
  const c = categoryOfElement(s, el);
  const e = findEngine(c.engine);
  if (!e) fail("UNKNOWN_ENGINE", `${el.id}: category ${c.id} names an unknown engine '${c.engine}'.`, { elementId: el.id, categoryId: c.id });
  return e!;
}
export const engineIdOfElement = (s: BimState, el: Element) => engineOfElement(s, el).id;

/** The placement an element uses: its engine's handler decides (members say it explicitly; every other engine has exactly one). */
export function placementKindOf(el: Element): PlacementKind { return handlersOf(el).placementKind(el); }

/**
 * Category -> Engine -> Type -> Placement, for every element: the category is registered, its engine is the one
 * that owns this storage variant and is implemented (or the internal void), the placement is one the category
 * allows, and the type belongs to a family the engine accepts and to a kind the category accepts.
 */
export function checkEngineChain(s: BimState, el: Element, d: ErrorDetails) {
  const c = categoryOfElement(s, el);
  const owner = engineOfKind(el.kind);
  if (!owner || owner.id !== c.engine)
    fail("CATEGORY_ENGINE_MISMATCH", `${el.id}: category ${c.id} uses the ${c.engine} engine, not ${owner?.id ?? el.kind}.`, { ...d, categoryId: c.id, engineId: c.engine });
  const eng = findEngine(c.engine)!;
  if (eng.status === "reserved") fail("ENGINE_NOT_IMPLEMENTED", `${el.id}: engine ${eng.id} is not implemented.`, { ...d, engineId: eng.id });
  const pk = placementKindOf(el);
  if (!c.placements.includes(pk) || !eng.placements.includes(pk))
    fail("INVALID_ENGINE_PLACEMENT", `${el.id}: category ${c.id} does not use '${pk}' placement.`, { ...d, categoryId: c.id, field: "placement" });
  if (!("type" in el)) return;
  const t = s.types[(el as { type: string }).type];
  if (!t) fail("INVALID_REFERENCE", `${el.id}: type ${(el as { type: string }).type} does not exist.`, { ...d, field: "type" });
  const why = typeFitProblem(t!, c);
  if (why === "ENGINE_TYPE_MISMATCH")
    fail("ENGINE_TYPE_MISMATCH", `${el.id}: a ${t!.kind} type (${t!.name}) cannot be used by the ${eng.id} engine.`, { ...d, typeId: t!.id, engineId: eng.id, field: "type" });
  if (why === "INVALID_REFERENCE")
    fail("INVALID_REFERENCE", `${el.id}: type ${t!.name} is a ${t!.kind} type, not ${c.typeKinds!.join("/")}.`, { ...d, typeId: t!.id, categoryId: c.id, field: "type" });
}

/**
 * THE type <-> category compatibility rule (engine accepts the type family; the category accepts the type kind). checkEngineChain and the
 * compatibility discovery both read it: nothing else encodes it.
 */
export function typeFitProblem(t: { kind: string }, c: CategoryDefinition): "ENGINE_TYPE_MISMATCH" | "INVALID_REFERENCE" | null {
  const eng = findEngine(c.engine)!;
  if (!eng.typeFamilies.includes(TYPE_FAMILY_OF_KIND[t.kind as keyof typeof TYPE_FAMILY_OF_KIND])) return "ENGINE_TYPE_MISMATCH";
  if (c.typeKinds && !c.typeKinds.includes(t.kind)) return "INVALID_REFERENCE";
  return null;
}
/** DERIVED (never persisted): every implemented category this type can be used by. A component type is only ever usable by its family's category. */
export function compatibleCategories(s: BimState, typeId: string): string[] {
  const t = s.types[typeId];
  if (!t) return [];
  const home = categoryIdOfType(s, typeId);
  return listCategories().filter((c) => findEngine(c.engine)?.status !== "reserved" && typeFitProblem(t, c) === null && (t.kind !== "component" || c.id === home)).map((c) => c.id);
}

/** Normalised (derived) placement: where / how the element is positioned: never what it is. The engine's handler derives it. */
export function placementOf(s: BimState, el: Element) { return handlersOf(el).placement(s, el) as BuiltinPlacement; }

/**
 * The derived representation contract every consumer (plan, IFC, queries) reads. Storey-local; never persisted.
 * `ctx` lets a caller reuse one spatial context for many spatial elements.
 */
export function resolveElementRepresentation(s: BimState, el: Element, ctx?: SpatialContext) { return handlersOf(el).representation(s, el, ctx) as BuiltinRepresentation; }

/**
 * Generic "same physical thing twice" key for bim_validate, derived from what each engine actually STORES (its handler's `signature`).
 * null = this variant has no stored geometry of its own, so a geometry comparison is meaningless (hosted components, spatial elements).
 * Category is part of the key (a chair and a cabinet at one point are different things). Deterministic; coordinates compared exactly as stored.
 */
export function duplicateSignature(s: BimState, el: Element): string | null { return handlersOf(el).signature(s, el, categoryIdOfElement(s, el) ?? el.kind); }

export type Relationship = { type: "HOSTS" | "HOSTED_BY" | "FILLS" | "FILLED_BY" | "JOINED_TO" | "BOUNDED_BY" | "DEPENDS_ON"; elementId: string; via?: string };
/**
 * Normalised relationships, read from where each one actually lives (wall fields, opening fields, topology
 * joins, the derived spatial boundary). Nothing is persisted here; output is sorted.
 */
export function relationshipsOf(s: BimState, el: Element, ctx?: SpatialContext): Relationship[] {
  const out: Relationship[] = [];
  if (el.kind === "wall") {
    if (el.topRoof) out.push({ type: 'DEPENDS_ON', elementId: el.topRoof });
    for (const o of Object.values(s.elements)) if (o.kind === "opening" && o.host === el.id) out.push({ type: "HOSTS", elementId: o.id });
    for (const j of topologyIndex(s).byWall.get(el.id) ?? []) for (const w of wallsOf(j as WallJoin)) if (w !== el.id) out.push({ type: "JOINED_TO", elementId: w, via: j.id });
  }
  if (el.kind === "opening") { out.push({ type: "HOSTED_BY", elementId: el.host }); if (el.filledBy) out.push({ type: "FILLED_BY", elementId: el.filledBy }); }
  if (el.kind === "hosted_component") { out.push({ type: "FILLS", elementId: el.opening }); out.push({ type: "HOSTED_BY", elementId: el.host }); }
  if (el.kind === "spatial") for (const w of resolveSpatialElement(ctx ?? new SpatialContext(s), el).boundaryWalls) out.push({ type: "BOUNDED_BY", elementId: w });
  return out.sort((a, b) => (a.type + a.elementId + (a.via ?? "") < b.type + b.elementId + (b.via ?? "") ? -1 : 1));
}
export type { Wall, Opening, Component, SpatialElement, ProfileMember, Boundary, HostedComponent };
