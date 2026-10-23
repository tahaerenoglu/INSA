/** BIM module tools (registered in the manager MCP through the platform). */
import { z } from "zod";
import { AppearanceSchema } from "./appearance.js";
import {regenerateColumnRebar} from './column-rebar-layout.js';
import { healWallCorners, modellingIssues, reconcileRedundantWalls } from './modelling-policy.js';
import { isLayeredType } from "./model.js";
import  { ErrorDetails, DomainError } from "@insa/core";
import type { CommandTool, QueryTool, Decision, ToolDef } from "@insa/core";
import {
  BimState, Element, Wall, Opening, Insert, LayeredType, ProfileType, OpeningType, Storey,
  nextId, thickness, quantities, wallFrame, apply,
} from "./model.js";
import { P2, unit, sub, offsetPolyline, signedArea, r } from "./geo.js";
import { GEOMETRY_EPSILON, normalizeRing, distance } from "./geometry.js";
import { modelIssues, checkElement } from "./invariants.js";
import { findResource, ORDER, normalizeName, resourceUsage, ResourceKind, usageSummary } from "./resources.js";
import { FIXED, derivedValue, derivedField, isVerticalElement, syncVertical, verticallyAffected, reassignStorey, VerticalElement } from "./vertical.js";
import { synchronizeTopology, createJoin, removeJoin, detectConnections, connectedComponent, wallsOf, membersOf, pointOf, JOIN_TOLERANCE, NEAR_MISS_DISTANCE } from "./topology.js";
import { elementUsage } from "./resources.js";
import { normalizeAzimuth } from "./arch.js";
import { memberWorldEnds, memberLength } from "./engines/profile-member.js";
import { structuralConnectivity } from "./connectivity.js";
import { IFC_CLASS_DATA } from "./ifc-schema-data.js";
import { handlersOf } from "./engines/handlers.js";
import { unitPath, unitAncestors, unitChildren, rootFacility, georefProblem, georefRotationDegrees, toMap, toLocal, LENGTH_UNIT, ANGLE_UNIT } from "./spatial-units.js";
import { assemblyDescendants } from "./engines/assembly.js";
import { routeWorld, routeLength, MEP_DOMAINS, junctionProblem, junctionOf, junctionKind, sortRefs, refKey, sameRef, mepNetwork, connectorsOf, systemSummary, resolveConnector } from "./mep.js";
import { runAuthoring, splitWall, mergeWalls, trimExtendWall, rehostOpening as rehostOpeningEdit } from "./authoring.js";
import { LEGACY_KIND_V3 } from "./model.js";
import { listDisciplines, listCategories, getCategory, findCategory, hasCapability, categoryIdOfElement, categoryIdOfType, CAPABILITIES, Capability, DISCIPLINES, CategoryDefinition } from "./taxonomy.js";
import { EngineId, engineOfKind, engineFilter, findEngine, listEngines } from "./engines/registry.js";
import { engineOfElement, placementOf, resolveElementRepresentation, relationshipsOf, duplicateSignature, compatibleCategories } from "./engines/dispatch.js";
import { componentBox, normalizeRotation } from "./family.js";
import { SpatialContext, resolvePoint, resolveSpatialElement, storeyRegions, occupancy, spatialAdjacency, isRoomBounding, BOUNDARY_LOCATION } from "./spatial.js";
import type { SpatialElement } from "./model.js";
import type { ComponentType, Component, Family } from "./model.js";
import type { Vertical, Column, Beam, ProfileMember, HostedComponent, StairElement, PathElement, StairType, RampType, SpatialUnit, Georeference, RailingType, SpatialAxisMember, MemberEnd, AxisMember, VerticalMember, MepSegment, ConnectorRef } from "./model.js";

/**
 * Creation intent (Phase 5): an explicit value is fixed; an explicit top / target storey, or the
 * automatically used next storey, becomes a storey constraint (by id); with no storey above, the
 * 3.0 m fallback is fixed — it never silently attaches to a storey created later.
 */
function creationVertical(s: BimState, base: Storey, explicit: number | undefined, topRef: string | undefined, what: string): Vertical {
  if (explicit !== undefined && topRef)
    throw new DomainError(`Give either an explicit ${what} (fixed) or a top storey (storey-constrained), not both.`, "INVALID_VERTICAL_CONSTRAINT", { field: what });
  if (explicit !== undefined) return FIXED;
  const top = topRef ? storeyOf(s, topRef) : storeyAbove(s, base);
  return top ? { mode: "storey", storey: top.id } : FIXED;
}
/** For a new constrained element: its stored value is the derived one. */
const withDerived = <T extends VerticalElement>(s: BimState, el: T): T => {
  const v = derivedValue(s, el);
  if (v !== null) (el as any)[derivedField(el)] = v;
  return el;
};

// ------------------------------------------------------------------ zod helpers
const P2s = z.tuple([z.number(), z.number()]).describe("[x, y] in metres");
const Ref = z.string().describe("id or name");

// ------------------------------------------------------------------ resolvers
function byRef<T extends { id: string; name: string }>(rec: Record<string, T>, ref: string, what: string): T {
  if (rec[ref]) return rec[ref];
  const low = ref.trim().toLowerCase();
  const hits = Object.values(rec).filter((x) => x.name.toLowerCase() === low);
  if (hits.length === 1) return hits[0];
  const avail = Object.values(rec).map((x) => `${x.id} ${x.name}`).slice(0, 30).join("; ");
  throw new DomainError(hits.length > 1 ? `Ambiguous ${what} '${ref}'; use the id.` : `${what} '${ref}' not found. Available: ${avail || "none"}`,
    hits.length > 1 ? "AMBIGUOUS_RESOURCE_REFERENCE" : "RESOURCE_NOT_FOUND", { ref });
}
const storeyOf = (s: BimState, ref: string) => byRef(s.storeys, ref, "Storey");
function typeOf<K extends string>(s: BimState, ref: string, kind: K): any {
  try { return s.types[findResource(s, "type", ref, kind).id]; }
  catch (e) {
    const other = Object.values(s.types).find((t) => t.id === ref || t.name.toLowerCase() === ref.trim().toLowerCase());
    if (other && other.kind !== kind) throw new DomainError(`'${ref}' is a ${other.kind} type, not ${kind}.`, "INVALID_REFERENCE", { field: "type" });
    throw e;
  }
}
// ---------------- Phase 9: canonical engine commands (the ONLY creation logic; former tools are adapters)
/** A creation request's category: registered and handled by the expected engine. */
function engineCategory(id: string, engine: EngineId): CategoryDefinition {
  const c = findCategory(id);
  if (!c) throw new DomainError(`Unknown category '${id}'.`, "INVALID_CATEGORY", { categoryId: id });
  if (c.engine !== engine) throw new DomainError(`Category ${id} uses the ${c.engine} engine, not ${engine}.`, "CATEGORY_ENGINE_MISMATCH", { categoryId: id, engineId: c.engine });
  return c;
}
/** Resolves a type reference within the kinds the category accepts (registry data). */
function typeForCategory(s: BimState, c: CategoryDefinition, ref: string): any {
  const kinds = c.typeKinds ?? [];
  let first: unknown;
  for (const k of kinds) { try { return typeOf(s, ref, k); } catch (e) { first ??= e; } }
  throw first ?? new DomainError(`Category ${c.id} takes no type.`, "ENGINE_TYPE_MISMATCH", { categoryId: c.id });
}
/** The type kind an element's type must have (for type changes): its category's accepted kind. */
const typeKindOf = (s: BimState, el: Element): string => findCategory(categoryIdOfElement(s, el) ?? "")?.typeKinds?.[0] ?? el.kind;
const ENGINE_ID_KEY: Record<string, string> = { profile_member: "member", boundary: "boundary", hosted_component: "hosted", stair: "stair", path: "path" };
const idKeyOf = (c: CategoryDefinition) => (c.idKey ?? ENGINE_ID_KEY[c.engine]) as any;

const MemberIn = z.object({ category: z.string().describe("e.g. structure.framing (beam), structure.column"), storey: z.string(), type: z.string(), name: z.string().optional(),
  start: z.tuple([z.number(), z.number()]).optional(), end: z.tuple([z.number(), z.number()]).optional(), z: z.number().optional().describe("axis members: top level above the storey (fixed)"),
  target_storey: z.string().optional().describe("axis members: storey whose level the top follows"),
  at: z.tuple([z.number(), z.number()]).optional(), points: z.array(z.tuple([z.number(), z.number()])).optional(), height: z.number().positive().optional().describe("vertical members: fixed height"),
  top_storey: z.string().optional().describe("vertical members: storey the top follows"), base_offset: z.number().default(0), rotation: z.number().default(0).describe("degrees: section rotation about Z (vertical members) or roll about the axis (braces)"),
  length: z.number().positive().optional().describe("members that hang DOWN (piles): their length, m"),
  start_offset: z.number().default(0).describe("braces: elevation of the start above the start storey (= `storey`), m"), end_storey: z.string().optional().describe("braces: storey of the end point (default: `storey`)"),
  end_offset: z.number().default(0).describe("braces: elevation of the end above ITS storey, m") });
type MemberInput = z.infer<typeof MemberIn>;
/** profile_member: the category decides the placement (axis or vertical); one path for every member category. */
function createMembers(s: BimState, items: MemberInput[]): Decision {
  const events: Decision["events"] = [];
  for (const it of items) {
    const c = engineCategory(it.category, "profile_member");
    const st = storeyOf(s, it.storey), type = typeForCategory(s, c, it.type);
    const base = { kind: "profile_member" as const, category: c.id, storey: st.id, type: type.id, ...(it.name ? { name: it.name } : {}) };
    if (c.placements[0] === "member_axis") {
      if (!it.start || !it.end) throw new DomainError(`${c.id} members are placed on an axis: give start and end.`, "INVALID_ENGINE_PLACEMENT", { categoryId: c.id });
      const vertical = creationVertical(s, st, it.z, it.target_storey, "z");
      events.push({ type: "ElementCreated", payload: withDerived(s, { id: nextId(s, idKeyOf(c)), ...base, placement: "member_axis",
        start: it.start, end: it.end, z: it.z ?? 3.0, vertical } as AxisMember) });
    } else if (c.placements[0] === "member_spatial_axis") {
      if (!it.start || !it.end) throw new DomainError(`${c.id} members run between two 3D endpoints: give start and end ([x, y]) with start_offset / end_storey / end_offset.`, "INVALID_ENGINE_PLACEMENT", { categoryId: c.id });
      const es = it.end_storey ? storeyOf(s, it.end_storey) : st;
      events.push({ type: "ElementCreated", payload: { id: nextId(s, idKeyOf(c)), ...base, placement: "member_spatial_axis",
        start: { storey: st.id, at: it.start, offset: it.start_offset }, end: { storey: es.id, at: it.end, offset: it.end_offset }, rotation: it.rotation } as ProfileMember });
    } else {
      const pts = it.points ?? (it.at ? [it.at] : []);
      if (!pts.length) throw new DomainError("Give at or points.", "INVALID_ENGINE_PLACEMENT", { categoryId: c.id });
      const down = c.memberDirection === "down";
      if (down && it.length === undefined) throw new DomainError(`${c.id} members hang DOWN: give length (m).`, "INVALID_ENGINE_PLACEMENT", { categoryId: c.id });
      const vertical = down ? FIXED : creationVertical(s, st, it.height, it.top_storey, "height");
      for (const p of pts) events.push({ type: "ElementCreated", payload: withDerived(s, { id: nextId(s, idKeyOf(c)), ...base, placement: "member_vertical",
        at: p, height: down ? it.length! : it.height ?? 3.0, baseOffset: it.base_offset, rotation: it.rotation, vertical, ...(down ? { direction: "down" } : {}) } as VerticalMember) });
    }
  }
  events.push(counters(s));
  return { events, summary: { created: events.filter((e) => e.type === "ElementCreated").map((e: any) => e.payload.id) } };
}
const StairIn = z.object({ category: z.string().default("architecture.stair"), storey: z.string().describe("base storey"), type: z.string(), name: z.string().optional(),
  start: z.tuple([z.number(), z.number()]).describe("walking line start = the first (bottom) riser"), end: z.tuple([z.number(), z.number()]).describe("walking line end = the last (top) riser"),
  width: z.number().optional().describe("default: the type's defaultWidth"), riser_count: z.number().int().describe("N risers = N - 1 treads"), base_offset: z.number().default(0),
  height: z.number().optional().describe("explicit total rise: FIXED"), top_storey: z.string().optional().describe("storey the top follows: STOREY-CONSTRAINED (default: the next storey above)") });
type StairInput = z.infer<typeof StairIn>;
/** stair engine: the total rise follows the storeys like a column's height (Phase 5 vertical intent). */
function createStairs(s: BimState, items: StairInput[]): Decision {
  const events: Decision["events"] = [];
  for (const it of items) {
    const c = engineCategory(it.category, "stair");
    const st = storeyOf(s, it.storey), type = typeForCategory(s, c, it.type) as StairType;
    const width = it.width ?? type.defaultWidth;
    if (width === undefined) throw new DomainError(`Give a width: type ${type.name} has no default width.`, "INVALID_STAIR_GEOMETRY", { field: "width" });
    const vertical = creationVertical(s, st, it.height, it.top_storey, "height");
    events.push({ type: "ElementCreated", payload: withDerived(s, { id: nextId(s, idKeyOf(c)), kind: "stair", category: c.id, storey: st.id, type: type.id, ...(it.name ? { name: it.name } : {}),
      start: it.start, end: it.end, width, riserCount: it.riser_count, baseOffset: it.base_offset, height: it.height ?? 3.0, vertical } as StairElement) });
  }
  events.push(counters(s));
  return { events, summary: { created: events.filter((e) => e.type === "ElementCreated").map((e: any) => e.payload.id) } };
}
const PathIn = z.object({ category: z.string().describe("e.g. architecture.railing"), storey: z.string(), type: z.string(), name: z.string().optional(),
  path: z.array(z.tuple([z.number(), z.number()])).min(2).describe("polyline vertices in order; consecutive duplicates are refused"), closed: z.boolean().default(false),
  offset: z.number().default(0).describe("base elevation above the storey"), height: z.number().optional().describe("default: the type's height") });
type PathInput = z.infer<typeof PathIn>;
function createPathElements(s: BimState, items: PathInput[]): Decision {
  const events: Decision["events"] = [];
  for (const it of items) {
    const c = engineCategory(it.category, "path");
    const st = storeyOf(s, it.storey), type = typeForCategory(s, c, it.type) as RailingType;
    events.push({ type: "ElementCreated", payload: { id: nextId(s, idKeyOf(c)), kind: "path", category: c.id, storey: st.id, type: type.id, ...(it.name ? { name: it.name } : {}),
      path: it.path, closed: it.closed, offset: it.offset, height: it.height ?? type.height } as PathElement });
  }
  events.push(counters(s));
  return { events, summary: { created: events.filter((e) => e.type === "ElementCreated").map((e: any) => e.payload.id) } };
}
const BoundaryIn = z.object({ category: z.string().describe("e.g. architecture.floor"), storey: z.string(), type: z.string(), outline: z.array(z.tuple([z.number(), z.number()])).min(3),
  holes: z.array(z.array(z.tuple([z.number(), z.number()])).min(3)).default([]), offset: z.number().default(0).describe("reference level above the storey (floors / ceilings / flat roofs); for a sloped roof the top surface elevation at the eave"),
  slope: z.object({ azimuth: z.number().describe("degrees CCW from +X: the direction the plane RISES"), pitch: z.number().describe("degrees, 0 < pitch <= 80") }).optional().describe("single-plane roof (architecture.roof only)"),
  name: z.string().optional() });
type BoundaryInput = z.infer<typeof BoundaryIn>;
/** boundary: outline + holes, normalised rings; one path for every boundary category. */
function createBoundaries(s: BimState, items: BoundaryInput[]): Decision {
  const events: Decision["events"] = [];
  for (const it of items) {
    const c = engineCategory(it.category, "boundary");
    const st = storeyOf(s, it.storey), type = typeForCategory(s, c, it.type);
    events.push({ type: "ElementCreated", payload: { id: nextId(s, idKeyOf(c)), kind: "boundary", category: c.id, storey: st.id, type: type.id,
      outline: normalizeRing(it.outline), holes: it.holes.map((h) => normalizeRing(h)), offset: it.offset, name: it.name,
      ...(it.slope ? { slope: { azimuth: normalizeAzimuth(it.slope.azimuth), pitch: r(it.slope.pitch, 6) } } : {}) } });
  }
  events.push(counters(s));
  return { events, summary: { created: events.filter((e) => e.type === "ElementCreated").map((e: any) => e.payload.id) } };
}
/** hosted_component: the element filling an opening (the void is created by the caller). */
function hostedElement(s: BimState, categoryId: string, typeId: string, host: Wall, opening: string, name?: string): HostedComponent {
  const c = engineCategory(categoryId, "hosted_component");
  return { id: nextId(s, idKeyOf(c)), kind: "hosted_component", category: c.id, storey: host.storey, type: typeId, host: host.id, opening, name } as HostedComponent;
}

function storeyAbove(s: BimState, st: Storey): Storey | undefined {
  return Object.values(s.storeys).filter((x) => x.elevation > st.elevation + GEOMETRY_EPSILON).sort((a, b) => a.elevation - b.elevation)[0];
}
function materialId(s: BimState, events: Decision["events"], name: string, color?: string): string {
  const hit = Object.values(s.materials).find((m) => m.id === name || m.name.toLowerCase() === name.trim().toLowerCase());
  if (hit) return hit.id;
  const m = { id: nextId(s, "material"), name: normalizeName(name), ...(color !== undefined ? { color } : {}) };
  s.materials[m.id] = m; // visible to later lookups in the same decision
  events.push({ type: "MaterialCreated", payload: m });
  return m.id;
}
const counters = (s: BimState) => ({ type: "CountersSet", payload: { ...s.counters } });

// ------------------------------------------------------------------ tool factories
const cmd = <I>(t: Omit<CommandTool<BimState, I>, "kind" | "module" | "effect"> & { effect?: "write" | "destructive" }): CommandTool<BimState, I> =>
  ({ kind: "command", module: "bim", effect: t.effect ?? "write", ...t, decide: (s, i, ...rest) => {
    const beforePolicy = structuredClone(s);
    const result = t.decide(s, i, ...rest);
    const candidate = structuredClone(s);
    for (const event of result.events) apply(candidate, event as any);
    const walls = Object.values(candidate.elements).filter(el => el.kind === "wall" || (el.kind === "profile_member" && el.placement === "member_vertical" && el.category === "structure.column")).map(el => el.id);
    for (const change of syncVertical(candidate, walls)) result.events.push({ type: "ElementUpdated", payload: change });
    // Joining belongs to the authoring transaction, not a second proposal per junction.
    const changedWalls = result.events.filter(e => ["ElementCreated", "ElementUpdated"].includes(e.type)).map(e => (e.payload as any).id).filter(id => candidate.elements[id]?.kind === "wall");
    for (const id of new Set(changedWalls)) checkElement(candidate,candidate.elements[id]);
    if (changedWalls.length && !["bim_join_walls", "bim_join_walls_batch", "bim_unjoin_walls"].includes(t.name)) {
      for (const change of healWallCorners(candidate, new Set(changedWalls))) {
        result.events.push({ type: 'ElementUpdated', payload: change });
        changedWalls.push(change.id);
      }
      const connections = detectConnections(candidate, { walls: changedWalls, maxResults: 1000 });
      const oldCrossings = new Set(detectConnections(beforePolicy, { walls: changedWalls, maxResults: 1000 }).crossings.map(c => `${c.wallA}|${c.wallB}|${c.point.join(",")}`));
      const crossing = connections.crossings.find(c => !oldCrossings.has(`${c.wallA}|${c.wallB}|${c.point.join(",")}`));
      if (crossing) throw new DomainError(`Walls ${crossing.wallA} and ${crossing.wallB} cross inside their segments. Split them into endpoint junctions before creating this geometry.`, "WALL_INTERSECTION", { wallA: crossing.wallA, wallB: crossing.wallB, point: crossing.point.join(",") });
      for (const connection of connections.candidates) {
        if(connection.type==='endpoint_endpoint' && Object.values(candidate.joins).some(j=>j.kind==='endpoint_endpoint'&&j.members.some(m=>m.wall===connection.wallA&&m.endpoint===connection.endpointA)&&j.members.some(m=>m.wall===connection.wallB&&m.endpoint===connection.endpointB)))continue;
        if(connection.type==='endpoint_segment' && Object.values(candidate.joins).some(j=>j.kind==='endpoint_segment'?j.endpoint.wall===connection.wall&&j.endpoint.endpoint===connection.endpoint:j.members.some(m=>m.wall===connection.wall&&m.endpoint===connection.endpoint)))continue;
        const input = connection.type === "endpoint_endpoint"
          ? { kind: connection.type, endpoints: [{ wall: connection.wallA, endpoint: connection.endpointA }, { wall: connection.wallB, endpoint: connection.endpointB }] }
          : { kind: connection.type, endpoint: { wall: connection.wall, endpoint: connection.endpoint }, host: connection.hostWall, t: connection.hostT };
        const joined = createJoin(candidate, input, () => nextId(candidate, "join"));
        result.events.push(...joined.joinEvents, ...joined.wallChanges.map(c => ({ type: "ElementUpdated", payload: c })));
      }
      if (connections.candidates.length) result.events.push(counters(candidate));
    }
    for(const change of regenerateColumnRebar(candidate,beforePolicy))result.events.push({type:'ElementUpdated',payload:change});
    return result;
  } });
const qry = <I>(t: Omit<QueryTool<BimState, I>, "kind" | "module" | "effect">): QueryTool<BimState, I> =>
  ({ kind: "query", module: "bim", effect: "read", ...t });

// ------------------------------------------------------------------ commands
const setProject = cmd({
  name: "bim_set_project", title: "Set project info", permission: "bim.write",
  description: "Set project name/number and building/site names (IFC project, site and building).",
  input: z.object({ name: z.string().optional(), number: z.string().optional(), building: z.string().optional(),
                    site: z.string().optional(), description: z.string().optional(), project_type: z.enum(["infrastructure", "superstructure"]).optional() }),
  decide: (_s, i) => {
    if (i.project_type && _s.project.projectType && i.project_type !== _s.project.projectType) throw new DomainError("Project type is fixed when the project is created.", "INVALID_INPUT");
    const { project_type, ...project } = i;
    const payload = { ...project, ...(project_type ? { projectType: project_type } : {}) };
    return { events: [{ type: "ProjectUpdated", payload }], summary: payload };
  },
});

const createStoreys = cmd({
  name: "bim_create_storeys", title: "Create storeys", permission: "bim.write",
  description: "Create building storeys (levels) at absolute elevations in metres.",
  input: z.object({ storeys: z.array(z.object({ name: z.string(), elevation: z.number() })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const st of i.storeys) {
      const p = { id: nextId(s, "storey"), ...st, name: normalizeName(st.name) };      // uniqueness: checked centrally
      s.storeys[p.id] = p;
      events.push({ type: "StoreyCreated", payload: p });
    }
    events.push(counters(s));
    return { events, summary: { created: events.filter((e) => e.type === "StoreyCreated").map((e: any) => e.payload.id) } };
  },
});

const createGrids = cmd({
  name: "bim_create_grids", title: "Create grids", permission: "bim.write",
  description: "Create grid lines (axes) with names like 'A' or '1'.",
  input: z.object({ grids: z.array(z.object({ name: z.string(), start: P2s, end: P2s })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = i.grids.map((g) => ({ type: "GridCreated", payload: { id: nextId(s, "grid"), ...g, name: normalizeName(g.name) } }));
    events.push(counters(s));
    return { events, summary: { created: i.grids.length } };
  },
});

const Layer = z.object({
  material: z.string().describe("material name (created if missing)"),
  thickness: z.number().min(0).max(3).describe("m"),
  function: z.enum(["finish", "substrate", "insulation", "structure", "membrane"]).default("structure"),
  color: z.string().optional().describe("'#RRGGBB' for a new material"),
});
const SECTION = z.union([z.object({ shape: z.literal("rect"), b: z.number().positive(), h: z.number().positive() }), z.object({ shape: z.literal("circle"), d: z.number().positive() }),
  z.object({ shape: z.literal("rhs"), b: z.number().positive(), h: z.number().positive(), t: z.number().positive() }), z.object({ shape: z.literal("chs"), d: z.number().positive(), t: z.number().positive() }),
  z.object({ shape: z.literal("i_section"), h: z.number().positive(), b: z.number().positive(), tw: z.number().positive(), tf: z.number().positive() })]);
const ConnectorSpec = z.object({
  key: z.string().min(1), domain: z.enum(MEP_DOMAINS), position: z.tuple([z.number(), z.number(), z.number()]).describe("local [x, y, z] from the component origin (z above its offset), m"),
  direction: z.tuple([z.number(), z.number(), z.number()]).describe("local outward direction (non-zero; need not be unit)"), flow: z.enum(["in", "out", "bidirectional"]).default("bidirectional"),
  shape: z.enum(["round", "rectangular"]), diameter: z.number().positive().optional(), width: z.number().positive().optional(), height: z.number().positive().optional(), classification: z.string().optional() });
const FittingSectionIn = z.union([z.object({ shape: z.literal("round"), diameter: z.number().positive() }), z.object({ shape: z.literal("rectangular"), width: z.number().positive(), height: z.number().positive() })]);
const TypeSpec = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("wall"), name: z.string(), layers: z.array(Layer).min(1).describe("EXTERIOR -> INTERIOR") }),
  z.object({ kind: z.literal("slab"), name: z.string(), layers: z.array(Layer).min(1).describe("TOP -> BOTTOM") }),
  z.object({ kind: z.literal("footing"), name: z.string(), footing_kind: z.enum(["pad", "strip"]).describe("pad = isolated, strip = continuous: type semantics (never inferred from the polygon)"), layers: z.array(Layer).min(1).describe("TOP -> BOTTOM") }),
  z.object({ kind: z.literal("foundation_slab"), name: z.string(), layers: z.array(Layer).min(1).describe("TOP -> BOTTOM") }),
  z.object({ kind: z.literal("ceiling"), name: z.string(), layers: z.array(Layer).min(1).describe("TOP -> BOTTOM (the exposed soffit last)") }),
  z.object({ kind: z.literal("roof"), name: z.string(), layers: z.array(Layer).min(1).describe("EXTERIOR (top) -> INTERIOR (bottom); the thickness is measured perpendicular to the roof plane") }),
  z.object({ kind: z.literal("stair"), name: z.string(), max_riser: z.number().positive().describe("m: the largest riser height this type allows"), min_tread: z.number().positive().describe("m: the smallest tread depth"),
             default_width: z.number().positive().optional(), material: z.string().optional() }),
  z.object({ kind: z.literal("railing"), name: z.string(), height: z.number().positive().describe("default railing height, m"),
             top_rail: z.object({ width: z.number().positive(), depth: z.number().positive() }), post: z.object({ size: z.number().positive() }),
             max_post_spacing: z.number().positive().describe("m: posts are equalised so no spacing exceeds it"), material: z.string().optional() }),
  z.object({ kind: z.literal("column"), name: z.string(), material: z.string().optional(),
             profile: SECTION.describe("rect {b, h} | circle {d} | rhs {b, h, t} | chs {d, t} | i_section {h, b, tw, tf}: metres") }),
  z.object({ kind: z.literal("beam"), name: z.string(), material: z.string().optional(),
             profile: SECTION.describe("any section: rect {b, h} | circle {d} | rhs {b, h, t} | chs {d, t} | i_section {h, b, tw, tf}") }),
  z.object({ kind: z.literal("door"), name: z.string(), width: z.number().positive(), height: z.number().positive(), material: z.string().optional() }),
  z.object({ kind: z.literal("window"), name: z.string(), width: z.number().positive(), height: z.number().positive(), material: z.string().optional() }),
  z.object({ kind: z.literal("pipe"), name: z.string(), diameter: z.number().positive().describe("outside diameter, m"), wall_thickness: z.number().positive().optional(), insulation_thickness: z.number().min(0).optional(), material: z.string().optional() }),
  z.object({ kind: z.literal("duct"), name: z.string(), shape: z.enum(["round", "rectangular"]), diameter: z.number().positive().optional().describe("round ducts, m"), width: z.number().positive().optional().describe("rectangular, m"),
             height: z.number().positive().optional().describe("rectangular, m"), insulation_thickness: z.number().min(0).optional(), material: z.string().optional() }),
  z.object({ kind: z.literal("cable_tray"), name: z.string(), width: z.number().positive(), height: z.number().positive(), material: z.string().optional() }),
  z.object({ kind: z.literal("conduit"), name: z.string(), diameter: z.number().positive(), material: z.string().optional() }),
  z.object({ kind: z.literal("cable"), name: z.string(), diameter: z.number().positive().describe("outside diameter, m"), material: z.string().optional() }),
  z.object({ kind: z.literal("curtain_wall"), name: z.string(), max_panel_width: z.number().positive().describe("largest cell width, m: columns = ceil(length / this)"), max_panel_height: z.number().positive().describe("largest cell height, m: rows = ceil(height / this)"),
             panel_thickness: z.number().positive(), mullion: z.object({ width: z.number().positive(), depth: z.number().positive() }).describe("vertical members: face width (along the wall) and depth (out of plane), m"),
             transom: z.object({ width: z.number().positive(), depth: z.number().positive() }).describe("horizontal members: face height and depth, m"), material: z.string().optional().describe("frame material") }),
  z.object({ kind: z.literal("ramp"), name: z.string(), max_slope: z.number().positive().describe("maximum slope as rise / run, e.g. 0.0833 for 1:12"), thickness: z.number().positive().describe("slab thickness perpendicular to the slope, m"),
             default_width: z.number().positive().optional(), material: z.string().optional() }),
  z.object({ kind: z.literal("rebar"), name: z.string(), diameter: z.number().positive().describe("nominal bar / strand / duct outside diameter, m"), steel_grade: z.string().optional().describe("e.g. B500B"),
             wall_thickness: z.number().positive().optional().describe("tendon conduits only: the duct wall, m"), material: z.string().optional() }),
  z.object({ kind: z.literal("mep_fitting"), name: z.string(), fitting: z.enum(["elbow", "tee", "cross", "reducer", "transition", "coupling"]), domain: z.enum(MEP_DOMAINS),
             run: FittingSectionIn.describe("run / inlet section: { shape: round, diameter } | { shape: rectangular, width, height }, m"), outlet: FittingSectionIn.optional().describe("reducer / transition: the outlet section; tee / cross: the BRANCH section (default: the run section)"),
             angle: z.number().optional().describe("elbow turn angle or tee / cross branch angle, degrees (elbow default 90 is NOT assumed: give it; branch default 90)"), radius: z.number().positive().optional().describe("elbow centre-line radius, m"),
             length: z.number().positive().optional().describe("run length, m (coupling, reducer, transition, tee, cross)"), branch_length: z.number().positive().optional().describe("branch stub length, m (tee, cross)"), material: z.string().optional() }),
  z.object({ kind: z.literal("component"), name: z.string(), family: z.string().describe("family id or name (decides the category)"),
             parameters: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}).describe("type-scope parameter values"),
             material: z.string().optional(), predefined_type: z.string().optional().describe("IFC PredefinedType of the category's class (bim_get_category_capabilities lists the valid values); default NOTDEFINED"),
             connectors: z.array(ConnectorSpec).optional().describe("optional MEP connector definitions: local to the component; world position / direction are derived from its placement") }),
]);

/** every engine id of the registry plus the two documented compatibility aliases: derived, so a new engine is filterable without touching tools */
const ENGINE_FILTER = z.enum([...listEngines().map((e) => e.id), "component", "native"] as unknown as [string, ...string[]]);

const createTypes = cmd({
  name: "bim_create_types", title: "Create types", permission: "bim.write",
  description: "Create element types: layered wall/slab types (materials created automatically), column/beam profile types, door/window types, and component types (kind component: a family + its type-scope parameter values; the family decides the category).",
  input: z.object({ types: z.array(TypeSpec).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    const created: string[] = [];
    for (const t0 of i.types) {
      const t = { ...t0, name: normalizeName(t0.name) };                                 // uniqueness (within the type kind): checked centrally
      let p: any;
      if (t.kind === "wall" || t.kind === "slab" || t.kind === "ceiling" || t.kind === "roof" || t.kind === "footing" || t.kind === "foundation_slab") {         // schema-level literals (the registry's layered family)
        p = { id: nextId(s, `${t.kind}_type` as any), kind: t.kind, name: t.name, ...(t.kind === "footing" ? { footingKind: t.footing_kind } : {}),
              layers: t.layers.map((l) => ({ material: materialId(s, events, l.material, l.color), thickness: l.thickness, function: l.function })) };
      } else if (t.kind === "column" || t.kind === "beam") {
        p = { id: nextId(s, `${t.kind}_type` as any), kind: t.kind, name: t.name, profile: t.profile,
              ...(t.material ? { material: materialId(s, events, t.material) } : {}) };
      } else if (t.kind === "stair") {
        p = { id: nextId(s, "stair_type"), kind: "stair", name: t.name, maxRiser: t.max_riser, minTread: t.min_tread,
              ...(t.default_width ? { defaultWidth: t.default_width } : {}), ...(t.material ? { material: materialId(s, events, t.material) } : {}) };
      } else if (t.kind === "railing") {
        p = { id: nextId(s, "railing_type"), kind: "railing", name: t.name, height: t.height, topRail: t.top_rail, post: t.post, maxPostSpacing: t.max_post_spacing,
              ...(t.material ? { material: materialId(s, events, t.material) } : {}) };
      } else if (t.kind === "curtain_wall") {
        p = { id: nextId(s, "curtain_wall_type" as any), kind: "curtain_wall", name: t.name, maxPanelWidth: t.max_panel_width, maxPanelHeight: t.max_panel_height, panelThickness: t.panel_thickness, mullion: t.mullion, transom: t.transom, ...(t.material ? { material: materialId(s, events, t.material) } : {}) };
      } else if (t.kind === "ramp") {
        p = { id: nextId(s, "ramp_type" as any), kind: "ramp", name: t.name, maxSlope: t.max_slope, thickness: t.thickness, ...(t.default_width ? { defaultWidth: t.default_width } : {}), ...(t.material ? { material: materialId(s, events, t.material) } : {}) };
      } else if (t.kind === "rebar") {
        p = { id: nextId(s, "rebar_type" as any), kind: "rebar", name: t.name, diameter: t.diameter, ...(t.steel_grade ? { steelGrade: t.steel_grade } : {}), ...(t.wall_thickness ? { wallThickness: t.wall_thickness } : {}), ...(t.material ? { material: materialId(s, events, t.material) } : {}) };
      } else if (t.kind === "mep_fitting") {
        const { kind: _k, branch_length, material, ...rest } = t as any;
        p = { id: nextId(s, "mep_fitting_type" as any), kind: "mep_fitting", ...rest, ...(branch_length !== undefined ? { branchLength: branch_length } : {}), ...(material ? { material: materialId(s, events, material) } : {}) };
      } else if (t.kind === "pipe" || t.kind === "duct" || t.kind === "cable_tray" || t.kind === "conduit" || t.kind === "cable") {
        const { kind: k, name, material, insulation_thickness, wall_thickness, ...dims } = t as any;
        p = { id: nextId(s, `${k}_type` as any), kind: k, name, ...dims, ...(insulation_thickness !== undefined ? { insulationThickness: insulation_thickness } : {}),
              ...(wall_thickness !== undefined ? { wallThickness: wall_thickness } : {}), ...(material ? { material: materialId(s, events, material) } : {}) };
      } else if (t.kind === "component") {
        const fam = findResource(s, "family", t.family);
        p = { id: nextId(s, "component_type"), kind: "component", name: t.name, family: fam.id, parameters: t.parameters,
              ...(t.material ? { material: materialId(s, events, t.material) } : {}), ...(t.connectors ? { connectors: t.connectors } : {}), ...(t.predefined_type ? { predefinedType: t.predefined_type } : {}) };
      } else {
        p = { id: nextId(s, `${t.kind}_type` as any), kind: t.kind, name: t.name, width: t.width, height: t.height, ...(t.material ? { material: materialId(s, events, t.material) } : {}) };
      }
      s.types[p.id] = p;
      events.push({ type: "TypeCreated", payload: p });
      created.push(`${p.id} ${p.name}`);
    }
    events.push(counters(s));
    return { events, summary: { created } };
  },
});

const WallSpec = z.object({
  category: z.string().default("architecture.wall").describe("wall-engine category: architecture.wall (default) or structure.shear_wall"),
  storey: Ref, type: Ref,
  start: P2s.optional(), end: P2s.optional(),
  points: z.array(P2s).min(2).optional().describe("polyline instead of start/end; one wall per segment, mitred corners"),
  closed: z.boolean().default(false).describe("closed perimeter: exterior side faces outward automatically"),
  location_line: z.enum(["center", "exterior_face", "interior_face"]).default("center")
    .describe("which face the given line is. Use exterior_face for outer building dimensions"),
  exterior_side: z.enum(["left", "right"]).optional().describe("open lines: exterior side relative to drawing direction"),
  height: z.number().positive().optional().describe("m; default up to the next storey, else 3.0"),
  top_storey: Ref.optional(),
  base_offset: z.number().default(0),
  room_bounding: z.boolean().optional().describe("false: the wall does not bound rooms / spaces (default true)"),
  name: z.string().optional(),
});

const createWalls = cmd({
  name: "bim_create_walls", title: "Create walls", permission: "bim.write",
  description: "Create walls from lines or polylines with mitred corners. Layered types keep their exterior layer on the exterior side.",
  input: z.object({ walls: z.array(WallSpec).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    const created: string[] = [];
    for (const w of i.walls) {
      const wc = engineCategory(w.category, "wall");
      const st = storeyOf(s, w.storey);
      const type = typeForCategory(s, wc, w.type) as LayeredType;
      const t = thickness(type);
      let pts: P2[];
      const closed = !!w.points && w.closed;
      if (w.points) {
        pts = w.points as P2[];
        // the polyline itself: coincident consecutive vertices would make a zero-length segment and broken corner joins
        const nseg = w.closed ? pts.length : pts.length - 1;
        for (let k = 0; k < nseg; k++)
          if (distance(pts[k], pts[(k + 1) % pts.length]) <= GEOMETRY_EPSILON)
            throw new DomainError(`Wall polyline vertices ${k} and ${(k + 1) % pts.length} coincide (zero-length segment).`, "DEGENERATE_GEOMETRY", { index: k });
      }
      else if (w.start && w.end) pts = [w.start as P2, w.end as P2];
      else throw new DomainError("Give start+end or points.");
      let ext: "left" | "right" | null = closed ? (signedArea(pts) < 0 ? "left" : "right") : (w.exterior_side ?? null);
      if (w.location_line !== "center") {
        if (!ext) throw new DomainError(`location_line '${w.location_line}' needs closed=true or exterior_side.`);
        const inward = w.location_line === "exterior_face";
        pts = closed ? offsetPolyline(pts, (inward ? 1 : -1) * t / 2, true)
                     : offsetPolyline(pts, t / 2, false, inward ? ext === "right" : ext === "left");
      }
      const vertical = creationVertical(s, st, w.height, w.top_storey, "height");
      const height = w.height ?? 3.0;                       // replaced by the derived value when constrained
      const n = pts.length, m = closed ? n : n - 1;
      const dirs = Array.from({ length: m }, (_, k) => unit(sub(pts[(k + 1) % n], pts[k])));
      for (let k = 0; k < m; k++) {
        const el: Wall = {
          id: nextId(s, "wall"), kind: "wall", ...(wc.id !== "architecture.wall" ? { category: wc.id } : {}), storey: st.id, type: type.id, name: w.name,
          start: pts[k].map((v) => r(v)) as P2, end: pts[(k + 1) % n].map((v) => r(v)) as P2,
          height: r(height), baseOffset: w.base_offset,
          prevDir: closed || k > 0 ? dirs[(k - 1 + m) % m] : null,
          nextDir: closed || k < m - 1 ? dirs[(k + 1) % m] : null,
          exterior: ext, vertical, ...(w.room_bounding === false ? { roomBounding: false } : {}),
        };
        withDerived(s, el);
        events.push({ type: "ElementCreated", payload: el });
        created.push(el.id);
      }
    }
    events.push(counters(s));
    return { events, summary: { created } };
  },
});

const createSlabs = cmd({
  name: "bim_create_slabs", title: "Create slabs", permission: "bim.write",
  description: "Create floor slabs from boundary polygons with optional holes (shafts, stairs). Slab top sits at storey elevation + offset.",
  input: z.object({ slabs: z.array(z.object({
    storey: Ref, type: Ref, outline: z.array(P2s).min(3), holes: z.array(z.array(P2s).min(3)).default([]),
    offset: z.number().default(0), name: z.string().optional() })).min(1) }),
  decide: (s, i) => createBoundaries(s, i.slabs.map((x) => ({ ...x, category: "architecture.floor" }))),   // adapter: boundary engine
});

const createColumns = cmd({
  name: "bim_create_columns", title: "Create columns", permission: "bim.write",
  description: "Place columns at points. Height defaults to the next storey (or 3.0 m).",
  input: z.object({ columns: z.array(z.object({
    storey: Ref, type: Ref, at: P2s.optional(), points: z.array(P2s).optional(),
    height: z.number().positive().optional(), top_storey: Ref.optional(), base_offset: z.number().default(0),
    rotation: z.number().default(0).describe("degrees") })).min(1) }),
  decide: (s, i) => createMembers(s, i.columns.map((x) => ({ ...x, category: "structure.column" })) as unknown as MemberInput[]),   // adapter: profile_member engine
});

const createBeams = cmd({
  name: "bim_create_beams", title: "Create beams", permission: "bim.write",
  description: "Create beams between points. z = beam top relative to the storey. Explicit z is fixed; otherwise z follows target_storey (default: the next storey; with no storey above, a fixed 3.0).",
  input: z.object({ beams: z.array(z.object({ storey: Ref, type: Ref, start: P2s, end: P2s, z: z.number().optional(),
    target_storey: Ref.optional().describe("storey whose level the beam top follows (storey-constrained)") })).min(1) }),
  decide: (s, i) => createMembers(s, i.beams.map((x) => ({ ...x, category: "structure.framing", base_offset: 0, rotation: 0 })) as unknown as MemberInput[]),   // adapter: profile_member engine
});

const placeOpenings = cmd({
  name: "bim_place_openings", title: "Place doors, windows and openings", permission: "bim.write",
  description: "Place doors/windows (with their opening) or plain rectangular openings in walls, by distance along the wall or by a point projected onto it.",
  input: z.object({ items: z.array(z.object({
    kind: z.enum(["door", "window", "opening"]), host: z.string().describe("wall id"),
    along: z.number().optional().describe("centre distance from wall start, m"), at: P2s.optional(),
    type: Ref.optional().describe("door/window type"), width: z.number().positive().optional(), height: z.number().positive().optional(),
    sill: z.number().min(0).optional().describe("default 0 for doors and openings, 0.9 for windows"),
    name: z.string().optional() })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    const created: string[] = [];
    for (const it of i.items) {
      const w = s.elements[it.host];
      if (!w || w.kind !== "wall") throw new DomainError(`Host '${it.host}' is not an existing wall.`, "INVALID_HOST_RELATION", { hostId: it.host });
      const f = wallFrame(s, w);
      const along = it.along ?? (it.at ? (it.at[0] - w.start[0]) * f.dir[0] + (it.at[1] - w.start[1]) * f.dir[1] : undefined);
      if (along === undefined) throw new DomainError("Give along or at.");
      let width = it.width, height = it.height, type: OpeningType | undefined;
      if (it.kind !== "opening") {
        if (!it.type) throw new DomainError(`${it.kind} needs a type.`);
        type = typeForCategory(s, engineCategory(`architecture.${it.kind}`, "hosted_component"), it.type) as OpeningType;
        width = type.width; height = type.height;
      }
      if (!width || !height) throw new DomainError("Opening needs width and height.");
      const op: Opening = { id: nextId(s, "opening"), kind: "opening", storey: w.storey, host: w.id, along: r(along),
                            width, height, sill: it.sill ?? (it.kind === "window" ? 0.9 : 0) };
      if (type) {
        const ins = hostedElement(s, `architecture.${it.kind}`, type.id, w, op.id, it.name);
        op.filledBy = ins.id;
        events.push({ type: "ElementCreated", payload: op }, { type: "ElementCreated", payload: ins });
        created.push(ins.id);
      } else {
        events.push({ type: "ElementCreated", payload: op });
        created.push(op.id);
      }
    }
    events.push(counters(s));
    return { events, summary: { created } };
  },
});

/** Movable in plan: the engines whose registry entry lists the "move" operation (one source of truth). */
const movable = (el: Element) => !!engineOfKind(el.kind)?.operations.includes("move");
const moveElements = cmd({
  name: "bim_move_elements", title: "Move elements", permission: "bim.write",
  description: "Translate walls, slabs, columns, beams, components (any category) and rooms / spaces (their location point) in plan by [dx, dy] (openings, doors and windows move with their wall).",
  input: z.object({ ids: z.array(z.string()).min(1), vector: P2s }),
  decide: (s, i) => {
    const before = structuredClone(s);
    const [dx, dy] = i.vector;
        // reinforcement follows its HOST: moved together with it; it never moves alone (it would leave its host)
    // an assembly moves its members (they keep their own identity); the assembly itself has no geometry
    const expanded = [...new Set([...i.ids, ...i.ids.flatMap((id) => assemblyDescendants(s, id))])].filter((id) => i.ids.includes(id) || s.elements[id]?.kind !== "reinforcement");
    const hostedBars = Object.values(s.elements).filter((e) => e.kind === "reinforcement" && expanded.includes(e.host) && !expanded.includes(e.id)).map((e) => e.id);
    const allIds = [...expanded, ...hostedBars];
    const events: Decision["events"] = allIds.filter((id) => s.elements[id]?.kind !== "assembly").map((id) => {
      const el = s.elements[id];
      if (!el) throw new DomainError(`Element ${id} not found.`, "ELEMENT_NOT_FOUND", { elementId: id });
      if (el.kind === "reinforcement" && !hostedBars.includes(id)) throw new DomainError(`${id} (reinforcement) moves with its host ${el.host}; move the host instead.`, "INVALID_HOST_RELATION", { elementId: id, hostId: el.host });
      if (!movable(el)) throw new DomainError(`${id} (${el.kind}) moves with its host; move the wall instead.`);
      const changes: any = handlersOf(el).translate?.(el, dx, dy, r);                       // the engine says what translating its element changes
      if (!changes) throw new DomainError(`${id} (${el.kind}) moves with its host; move the wall instead.`);
      Object.assign(s.elements[id], structuredClone(changes));
      return { type: "ElementUpdated", payload: { id, changes } };
    });
    const walls = i.ids.filter((id) => s.elements[id]?.kind === "wall");
    const propagated = walls.length ? synchronizeTopology(s, before, walls) : [];
    for (const c of propagated) events.push({ type: "ElementUpdated", payload: c });
    // a bounded room / space moved on purpose must stay bounded (moving its walls along keeps it so)
    const spatialMoved = i.ids.filter((id) => before.elements[id]?.kind === "spatial");
    if (spatialMoved.length) {
      const was = new SpatialContext(before);
      requireBounded(s, spatialMoved.filter((id) => resolvePoint(was, before.elements[id].storey, (before.elements[id] as SpatialElement).point).status === "bounded"));
    }
    return { events, summary: { moved: allIds, vector: i.vector, ...(propagated.length ? { propagated: propagated.map((c) => c.id) } : {}) } };
  },
});

// ------------------------------------------------------------------ typed element updates
// Shared primitives (also used by the creation schemas' semantics; the domain re-checks everything).
const PositiveLength = z.number().positive().describe("metres, > 0");
const Polygon = z.array(P2s).min(3).describe("open ring of [x, y] (no repeated closing point needed)");
const Name = z.string().min(1);

/**
 * Editable fields per element kind. Everything else is immutable through updates:
 * id, kind, storey, host / opening links, filledBy (identity and relations),
 * prevDir / nextDir / exterior (derived wall-join data), props (bim_set_properties).
 */
const RoutePointIn = z.object({ storey: z.string().describe("storey id or name"), at: z.tuple([z.number(), z.number()]).describe("plan [x, y], m"), offset: z.number().default(0).describe("elevation above THIS storey, m (world z = storey elevation + offset)") });
const BarLayerIn = z.object({ path: z.array(z.tuple([z.number(), z.number(), z.number()])).min(2).describe("path of the FIRST bar, storey-local [x, y, z] m (z above the storey)"), count: z.number().int().min(1).default(1).describe("number of bars (copies)"),
  spacing: z.number().positive().default(0.2).describe("distance between copies, m"), direction: z.tuple([z.number(), z.number(), z.number()]).default([0, 1, 0]).describe("direction of the copies (any non-zero vector)") });
const UpdateSets = {
  pitched_roof: z.object({ outline: z.array(z.tuple([z.number(), z.number()])).length(4), form: z.enum(["gable", "hip"]), ridge: z.enum(["long", "short"]), pitch: z.number(), overhang: z.number().min(0), offset: z.number(), type: Ref, name: Name }).partial(),
  curtain_wall: z.object({ start: z.tuple([z.number(), z.number()]), end: z.tuple([z.number(), z.number()]), height: z.number().positive(), base_offset: z.number(), u_divisions: z.number().int().min(1), v_divisions: z.number().int().min(1), type: Ref, name: Name }).partial(),
  ramp: z.object({ start: z.tuple([z.number(), z.number()]), end: z.tuple([z.number(), z.number()]), width: z.number().positive(), rise: z.number().positive(), base_offset: z.number(), type: Ref, name: Name }).partial(),
  assembly: z.object({ children: z.array(z.string()).min(1), name: Name, predefined_type: z.string() }).partial(),
  wall: z.object({ height: PositiveLength.describe("explicit height: makes the wall FIXED"), top_storey: Ref.describe("storey the wall top follows: makes it STOREY-CONSTRAINED"),
                   room_bounding: z.boolean().describe("does the wall bound rooms / spaces (re-derives them)"),
                   base_offset: z.number(), type: Ref, name: Name,
                   start: P2s.describe("moving an end point drops its corner join (square end)"), end: P2s }).partial(),
  slab: z.object({ offset: z.number(), type: Ref, name: Name, outline: Polygon, holes: z.array(Polygon),
                   slope: z.object({ azimuth: z.number(), pitch: z.number() }).describe("roofs with a sloped plane only: azimuth = the direction it RISES (degrees), pitch (degrees). A flat boundary stays flat: create a new roof to change that") }).partial(),
  stair: z.object({ start: P2s, end: P2s, width: PositiveLength, riser_count: z.number().int(), base_offset: z.number(), type: Ref, name: Name,
                    height: PositiveLength.describe("explicit total rise: makes the stair FIXED"), top_storey: Ref.describe("storey the stair top follows: makes it STOREY-CONSTRAINED") }).partial(),
  path: z.object({ path: z.array(P2s).min(2), closed: z.boolean(), offset: z.number(), height: PositiveLength, type: Ref, name: Name }).partial(),
  column: z.object({ height: PositiveLength.describe("explicit height: makes the column FIXED"), top_storey: Ref.describe("makes it STOREY-CONSTRAINED"),
                     base_offset: z.number(), rotation: z.number(), type: Ref, name: Name, at: P2s }).partial(),
  reinforcement: z.object({ layers: z.array(BarLayerIn), bend_radius: z.number().positive(), cover: z.number().min(0), type: Ref, name: Name }).partial(),
  mep_fitting: z.object({ at: z.tuple([z.number(), z.number()]), offset: z.number(), rotation: z.number(), pitch: z.number(), roll: z.number(), type: Ref, system: Ref, name: Name }).partial(),
  mep_segment: z.object({ route: z.array(RoutePointIn).describe("the whole new route (storey-aware points)"), type: Ref, system: Ref, name: Name }).partial(),
  brace: z.object({ start: P2s.describe("start plan point"), end: P2s.describe("end plan point"), start_storey: Ref, start_offset: z.number().describe("elevation above the start storey"),
                    end_storey: Ref, end_offset: z.number().describe("elevation above the end storey"), rotation: z.number(), type: Ref, name: Name }).partial(),
  pile: z.object({ at: P2s, length: PositiveLength.describe("pile length (downward), m"), base_offset: z.number().describe("top elevation above the storey"), rotation: z.number(), type: Ref, name: Name }).partial(),
  beam: z.object({ z: z.number().describe("explicit top level relative to the storey: makes the beam FIXED"),
                   target_storey: Ref.describe("storey whose level the beam top follows: makes it STOREY-CONSTRAINED"),
                   type: Ref, name: Name, start: P2s, end: P2s }).partial(),
  opening: z.object({ along: z.number(), width: PositiveLength, height: PositiveLength, sill: z.number().min(0) }).partial(),
  door: z.object({ type: Ref, name: Name, along: z.number().describe("moves its opening"), sill: z.number().min(0) }).partial(),
  window: z.object({ type: Ref, name: Name, along: z.number().describe("moves its opening"), sill: z.number().min(0) }).partial(),
  spatial: z.object({ name: Name, number: z.string().nullable().describe("unique per category; null clears"), x: z.number(), y: z.number(),
                      height: PositiveLength.describe("explicit height: FIXED"), top_storey: Ref.describe("storey the top follows: STOREY-CONSTRAINED"),
                      allow_unbounded: z.boolean().describe("accept a new point outside every bounded region") }).partial(),
  component: z.object({ name: Name, type: Ref.describe("another component type of the SAME category"), x: z.number(), y: z.number(),
                        offset: z.number().describe("above the storey, m"), rotation: z.number().describe("degrees, counter-clockwise"),
                        parameters: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])).describe("instance-scope values, merged; null removes") }).partial(),
} as const;
type UpdKind = keyof typeof UpdateSets;
/**
 * Item kinds: the canonical engine variants (profile_member, boundary, hosted_component, ...) and, for
 * compatibility, the former per-category kinds (column, beam, slab, door, window). Either way the editable
 * fields come from the ELEMENT's engine variant and placement (updateSchemaOf) — never from its category.
 */
const UPDATE_ITEM_SETS: Record<string, any> = { ...UpdateSets, profile_member: UpdateSets.beam.merge(UpdateSets.column),
  boundary: UpdateSets.slab, hosted_component: UpdateSets.door };
const UpdateItem = z.discriminatedUnion("kind", Object.keys(UPDATE_ITEM_SETS).map((k) =>
  z.object({ id: z.string(), kind: z.literal(k).describe("the element's engine variant (or its former kind)"),
             set: UPDATE_ITEM_SETS[k].catchall(z.unknown()) })) as any);
/** The update schema of an element, chosen by engine variant and placement. */
function updateSchemaOf(el: Element): UpdKind {
  if (el.kind === "mep_segment") return "mep_segment";
  if (el.kind === "mep_fitting") return "mep_fitting";
  if (el.kind === "reinforcement") return "reinforcement";
  if (el.kind === "assembly") return "assembly";
  if (el.kind === "ramp") return "ramp";
  if (el.kind === "curtain_wall") return "curtain_wall";
  if (el.kind === "pitched_roof") return "pitched_roof";
  if (el.kind === "profile_member") return el.placement === "member_axis" ? "beam" : el.placement === "member_spatial_axis" ? "brace" : el.direction === "down" ? "pile" : "column";
  if (el.kind === "boundary") return "slab";
  if (el.kind === "hosted_component") return "door";
  return el.kind as UpdKind;
}
/** Does an item kind address this element? A former kind must match the variant and its placement / category. */
function itemMatches(kind: string, el: Element): boolean {
  if (kind === el.kind) return true;
  if (kind === "brace" || kind === "pile") return el.kind === "profile_member" && updateSchemaOf(el) === kind;     // by placement / direction, not by category
  const m = LEGACY_KIND_V3[kind];
  if (!m || m.kind !== el.kind) return false;
  return el.kind === "profile_member" ? m.placement === el.placement : m.category === (el as { category: string }).category;
}

const FIELD: Record<string, string> = { base_offset: "baseOffset", room_bounding: "roomBounding", riser_count: "riserCount", length: "height" };
/** route update: the whole new route; the element's storey follows the first point. Types / systems are checked by the central chain. */
function mepSegmentChanges(s: BimState, el: MepSegment, set: Record<string, any>) {
  const ch: Record<string, unknown> = {};
  if (set.route !== undefined) { const route = (set.route as any[]).map((q) => ({ storey: storeyOf(s, String(q.storey)).id, at: q.at, offset: q.offset ?? 0 })); ch.route = route; if (route[0]) ch.storey = route[0].storey; }
  if (set.type !== undefined) ch.type = typeOf(s, String(set.type), typeKindOf(s, el)).id;
  if (set.system !== undefined) ch.system = findResource(s, "mep_system", String(set.system)).id;
  if (set.name !== undefined) ch.name = set.name;
  return ch;
}
/** brace update: endpoints are typed objects; the element's storey always follows the start storey. Missing storeys are refused (storeyOf). */
function braceChanges(s: BimState, el: SpatialAxisMember, set: Record<string, any>) {
  const ch: Record<string, unknown> = {};
  const end = (cur: MemberEnd, pre: "start" | "end") => ({ storey: set[`${pre}_storey`] !== undefined ? storeyOf(s, String(set[`${pre}_storey`])).id : cur.storey, at: set[pre] ?? cur.at, offset: set[`${pre}_offset`] ?? cur.offset });
  if (["start", "start_storey", "start_offset"].some((k) => set[k] !== undefined)) { ch.start = end(el.start, "start"); ch.storey = (ch.start as MemberEnd).storey; }
  if (["end", "end_storey", "end_offset"].some((k) => set[k] !== undefined)) ch.end = end(el.end, "end");
  if (set.rotation !== undefined) ch.rotation = set.rotation;
  if (set.type !== undefined) ch.type = typeOf(s, String(set.type), typeKindOf(s, el)).id;
  if (set.name !== undefined) ch.name = set.name;
  return ch;
}
const updErr = (msg: string, d: Record<string, string | number>) => new DomainError(msg, "INVALID_ELEMENT_UPDATE", d);

const updateElements = cmd({
  name: "bim_update_elements", title: "Update elements", permission: "bim.write",
  description: "Change element attributes with a per-kind schema (give the element's kind): component name/x/y/offset/rotation/parameters (instance scope) / type (same category only); wall height (fixed) | top_storey (constrained), base_offset/type/name/start/end; slab offset/type/name/outline/holes; column height | top_storey, base_offset/rotation/type/name/at; beam z (fixed) | target_storey (constrained), type/name/start/end; opening along/width/height/sill; door/window type/name/along/sill. Identity, storey and host links cannot be changed. The resulting element and its dependents are fully re-validated; one invalid item rejects the whole command.",
  input: z.object({ items: z.array(UpdateItem).min(1) }),
  decide: (s, i) => {
    const before = structuredClone(s);                       // topology drivers are judged against the state before the command
    const events: Decision["events"] = [];
    const pointChecks: string[] = [];                        // spatial points moved on purpose must land in a bounded region
    const emit = (id: string, changes: Record<string, unknown>) => {
      events.push({ type: "ElementUpdated", payload: { id, changes } });
      Object.assign(s.elements[id], structuredClone(changes));     // later items in the batch see earlier ones
    };
    for (const it of i.items as { id: string; kind: UpdKind; set: Record<string, unknown> }[]) {
      const el = s.elements[it.id];
      if (!el) throw new DomainError(`Element ${it.id} not found.`, "ELEMENT_NOT_FOUND", { elementId: it.id });
      const d = { elementId: el.id, elementKind: el.kind };
      if (!itemMatches(it.kind, el)) throw updErr(`${el.id} is a ${el.kind}${"category" in el ? ` (${(el as { category: string }).category})` : ""}, not a ${it.kind}.`, { ...d, field: "kind" });
      const schema = updateSchemaOf(el);
      const allowed = Object.keys(UpdateSets[schema].shape);
      const keys = Object.keys(it.set);
      if (!keys.length) throw updErr(`Nothing to update for ${el.id}.`, d);
      const bad = keys.find((k) => !allowed.includes(k));
      if (bad) throw updErr(`${el.kind} field '${bad}' cannot be changed. Editable: ${allowed.join(", ")}.`, { ...d, field: bad });
      const set = UpdateSets[schema].parse(it.set) as Record<string, any>;   // already validated at the boundary; typed here
      if (el.kind === "component") { emit(el.id, componentChanges(s, el, set, d)); continue; }
      if (el.kind === "profile_member" && el.placement === "member_spatial_axis") { emit(el.id, braceChanges(s, el, set)); continue; }
      if (el.kind === "mep_segment") { emit(el.id, mepSegmentChanges(s, el, set)); continue; }
      if (el.kind === "pitched_roof") {
        const ch: Record<string, unknown> = {};
        for (const k of ["outline", "form", "ridge", "pitch", "overhang", "offset", "name"]) if (set[k] !== undefined) ch[k] = set[k];
        if (set.type !== undefined) ch.type = typeOf(s, String(set.type), typeKindOf(s, el)).id;
        emit(el.id, ch); continue;
      }
      if (el.kind === "curtain_wall") {
        const ch: Record<string, unknown> = {};
        for (const k of ["start", "end", "height", "name"]) if (set[k] !== undefined) ch[k] = set[k];
        if (set.base_offset !== undefined) ch.baseOffset = set.base_offset;
        if (set.u_divisions !== undefined) ch.uDivisions = set.u_divisions;
        if (set.v_divisions !== undefined) ch.vDivisions = set.v_divisions;
        if (set.type !== undefined) ch.type = typeOf(s, String(set.type), typeKindOf(s, el)).id;
        emit(el.id, ch); continue;
      }
      if (el.kind === "ramp") {
        const ch: Record<string, unknown> = {};
        for (const k of ["start", "end", "width", "rise", "name"]) if (set[k] !== undefined) ch[k] = set[k];
        if (set.base_offset !== undefined) ch.baseOffset = set.base_offset;
        if (set.type !== undefined) ch.type = typeOf(s, String(set.type), typeKindOf(s, el)).id;
        emit(el.id, ch); continue;
      }
      if (el.kind === "assembly") {
        const ch: Record<string, unknown> = {};
        if (set.children !== undefined) ch.children = set.children;
        if (set.name !== undefined) ch.name = set.name;
        if (set.predefined_type !== undefined) ch.predefinedType = set.predefined_type;
        emit(el.id, ch); continue;
      }
      if (el.kind === "reinforcement") {
        const ch: Record<string, unknown> = {};
        for (const k of ["layers", "cover", "name"]) if (set[k] !== undefined) ch[k] = set[k];
        if (set.bend_radius !== undefined) ch.bendRadius = set.bend_radius;
        if (set.type !== undefined) ch.type = typeOf(s, String(set.type), typeKindOf(s, el)).id;
        emit(el.id, ch); continue;
      }
      if (el.kind === "mep_fitting") {
        const ch: Record<string, unknown> = {};
        for (const k of ["at", "offset", "rotation", "pitch", "roll", "name"]) if (set[k] !== undefined) ch[k] = set[k];
        if (set.type !== undefined) ch.type = typeOf(s, String(set.type), typeKindOf(s, el)).id;
        if (set.system !== undefined) ch.system = findResource(s, "mep_system", String(set.system)).id;
        emit(el.id, ch); continue;
      }
      if (el.kind === "spatial") {
        const ch = spatialChanges(s, el, set, d);
        emit(el.id, ch);
        if (ch.point && !set.allow_unbounded) pointChecks.push(el.id);
        continue;
      }
      const changes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(set)) {
        if (v === undefined) continue;
        if (k === "top_storey" || k === "target_storey") continue;                       // vertical intent: handled below
        if (k === "type") changes.type = typeOf(s, String(v), typeKindOf(s, el)).id;
        else if (k === "outline") changes.outline = normalizeRing(v);
        else if (k === "holes") changes.holes = (v as P2[][]).map((h) => normalizeRing(h));
        else if (k === "slope") {
          if (el.kind !== "boundary" || !el.slope) throw updErr(`${el.id} has no sloped plane: a flat boundary stays flat (create a new roof instead).`, { ...d, field: "slope" });
          changes.slope = { azimuth: normalizeAzimuth((v as any).azimuth), pitch: r((v as any).pitch, 6) };
        }
        else changes[FIELD[k] ?? k] = v;
      }
      if (isVerticalElement(el)) {                       // vertical intent: explicit value -> fixed; storey -> constrained (+ derived value)
        const axis = el.kind === "profile_member" && el.placement === "member_axis";
        const valueKey = axis ? "z" : "height", storeyKey = axis ? "target_storey" : "top_storey";
        if (set[valueKey] !== undefined && set[storeyKey] !== undefined)
          throw updErr(`Give either ${valueKey} (fixed) or ${storeyKey} (storey-constrained), not both.`, { ...d, field: storeyKey });
        if (set[valueKey] !== undefined) changes.vertical = FIXED;
        if (set[storeyKey] !== undefined) changes.vertical = { mode: "storey", storey: storeyOf(s, String(set[storeyKey])).id };
        const cand = { ...el, ...changes } as VerticalElement;
        const dv = derivedValue(s, cand);
        if (dv !== null && (cand as any)[derivedField(cand)] !== dv) changes[derivedField(cand)] = dv;
      }
      if (el.kind === "wall" && ("start" in changes || "end" in changes)) {       // derived join data is recomputed: square end
        if ("start" in changes) changes.prevDir = null;
        if ("end" in changes) changes.nextDir = null;
      }
      if (el.kind === "hosted_component") {
        const { along, sill, ...own } = changes;
        const op: Record<string, unknown> = {};
        if (along !== undefined) op.along = along;
        if (sill !== undefined) op.sill = sill;
        if (own.type) { const t = s.types[own.type as string] as OpeningType; op.width = t.width; op.height = t.height; }
        if (Object.keys(own).length) emit(el.id, own);
        if (Object.keys(op).length) emit(el.opening, op);
      } else emit(el.id, changes);
    }
    // the complete requested patch is applied: now joined endpoints / tees follow and miters are recomputed
    const moved = (i.items as { id: string; kind: string; set: Record<string, unknown> }[]).filter((x) => x.kind === "wall" && (x.set.start !== undefined || x.set.end !== undefined)).map((x) => x.id);
    const propagated = moved.length ? synchronizeTopology(s, before, moved) : [];
    for (const c of propagated) events.push({ type: "ElementUpdated", payload: c });
    if (pointChecks.length) requireBounded(s, pointChecks);
    return { events, summary: { updated: i.items.map((x: any) => x.id), ...(propagated.length ? { propagated: propagated.map((c) => c.id) } : {}) } };
  },
});

const setProperties = cmd({
  name: "bim_set_properties", title: "Set properties", permission: "bim.write",
  description: "Write property-set values on elements (exported as IFC property sets), e.g. pset 'Pset_WallCommon' {FireRating: 'EI 120', IsExternal: true}.",
  input: z.object({ items: z.array(z.object({ ids: z.array(z.string()).min(1), pset: z.string(),
    values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])) })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const it of i.items) for (const id of it.ids) {
      if (!s.elements[id]) throw new DomainError(`Element ${id} not found.`);
      events.push({ type: "PropertiesSet", payload: { id, pset: it.pset, values: it.values } });
    }
    return { events, summary: { elements: events.length } };
  },
});

function cascade(s: BimState, ids: string[]): string[] {
  const out = new Set<string>();
  const add = (id: string) => {
    if (out.has(id) || !s.elements[id]) return;
    out.add(id);
    const el = s.elements[id];
    if (el.kind === "wall") Object.values(s.elements).filter((o) => o.kind === "opening" && o.host === id).forEach((o) => add(o.id));
    if (el.kind === "opening" && el.filledBy) add(el.filledBy);
    if (el.kind === "hosted_component") add(el.opening);
  };
  ids.forEach(add);
  return [...out];
}
const deleteElements = cmd({
  name: "bim_delete_elements", title: "Delete elements", permission: "bim.delete", effect: "destructive",
  description: "Delete elements. Nothing is cascaded silently: a wall with openings, an opening with a door/window, or a wall in a join is refused (ELEMENT_IN_USE with usage). cascade_hosted: true deletes the hosted openings / doors / windows too (never joins: unjoin first). Deleting a door / window leaves its opening empty.",
  input: z.object({ ids: z.array(z.string()).min(1), cascade_hosted: z.boolean().default(false).describe("also delete hosted openings and their doors / windows") }),
  decide: (s, i) => {
    for (const id of i.ids) if (!s.elements[id]) throw new DomainError(`Element ${id} not found.`, "ELEMENT_NOT_FOUND", { elementId: id });
    const all = i.cascade_hosted ? cascade(s, i.ids) : [...new Set(i.ids)];
    const gone = new Set(all);
    const events: Decision["events"] = all.map((id) => ({ type: "ElementDeleted", payload: { id } }));
    for (const id of all) {                                   // a removed door / window leaves an empty opening (its back-reference is cleared)
      const el = s.elements[id];
      if (el.kind === "hosted_component" && !gone.has(el.opening) && s.elements[el.opening])
        events.push({ type: "ElementUpdated", payload: { id: el.opening, changes: { filledBy: null } } });
    }
    return { events, summary: { deleted: all, dependants: all.filter((x) => !i.ids.includes(x)) } };
  },
});

// ------------------------------------------------------------------ queries
function brief(s: BimState, el: Element, ctx?: SpatialContext) {
  const t = "type" in el ? s.types[el.type] : undefined;
  return { id: el.id, kind: el.kind, name: el.name, storey: s.storeys[el.storey]?.name, type: t?.name,
           ...(el.kind === "opening" || el.kind === "hosted_component" ? { host: el.host } : {}),
           ...(isVerticalElement(el) ? { vertical: verticalInfo(s, el) } : {}), ...taxonomyOf(s, el),
           ...(el.kind === "spatial" ? spatialSummary(ctx ?? new SpatialContext(s), el) : {}) };
}
/** Full derived spatial section for bim_get_element. */
function spatialDetail(s: BimState, el: SpatialElement) {
  const r = resolveSpatialElement(new SpatialContext(s), el);
  return { status: r.status, boundaryLocation: r.boundaryLocation, regionSignature: r.regionSignature, outer: r.region?.outer ?? null,
           holes: r.region?.holes ?? null, boundarySegments: r.region?.boundarySegments ?? null, boundaryWalls: r.boundaryWalls,
           area: r.area, perimeter: r.perimeter, outerPerimeter: r.outerPerimeter, height: r.height, volume: r.volume,
           representativePoint: r.region?.representativePoint ?? null };
}
/** Compact derived spatial facts for listings (detailed geometry: bim_get_element). */
function spatialSummary(ctx: SpatialContext, el: SpatialElement) {
  const r = resolveSpatialElement(ctx, el);
  return { number: el.number ?? null, status: r.status, area: r.area, perimeter: r.perimeter, height: r.height, volume: r.volume,
           regionSignature: r.regionSignature, boundaryWalls: r.boundaryWalls, boundaryLocation: r.boundaryLocation };
}
/** Spatial update: name / number, location point, vertical extent. The category never changes. */
function spatialChanges(s: BimState, el: SpatialElement, set: Record<string, any>, d: Record<string, string>) {
  const changes: Record<string, unknown> = {};
  if (set.name !== undefined) changes.name = set.name;
  if (set.number !== undefined) changes.number = set.number === null ? null : String(set.number).trim();
  if (set.x !== undefined || set.y !== undefined) changes.point = [r(set.x ?? el.point[0]), r(set.y ?? el.point[1])];
  if (set.height !== undefined && set.top_storey !== undefined) throw updErr("Give either height (fixed) or top_storey (storey-constrained), not both.", { ...d, field: "top_storey" });
  if (set.height !== undefined) { changes.height = set.height; changes.vertical = FIXED; }
  if (set.top_storey !== undefined) changes.vertical = { mode: "storey", storey: storeyOf(s, String(set.top_storey)).id };
  const dv = derivedValue(s, { ...el, ...changes } as SpatialElement);
  if (dv !== null && dv !== ({ ...el, ...changes } as SpatialElement).height) changes.height = dv;
  if (!Object.keys(changes).length && set.allow_unbounded !== undefined) throw updErr(`Nothing to update for ${el.id}.`, d);
  return changes;
}
/** Points placed on purpose must resolve into a bounded region (and never onto a boundary). */
function requireBounded(s: BimState, ids: string[]) {
  const ctx = new SpatialContext(s);
  for (const id of ids) {
    const el = s.elements[id] as SpatialElement;
    const res = resolvePoint(ctx, el.storey, el.point);
    if (res.status === "bounded") continue;
    if (res.onBoundary) throw new DomainError(`${id}: the point lies on a spatial boundary (wall ${res.wallId}).`, "SPATIAL_POINT_ON_BOUNDARY", { elementId: id, ...(res.wallId ? { wallId: res.wallId } : {}) });
    throw new DomainError(`${id}: no bounded region contains (${el.point.join(", ")}) on its storey (allow_unbounded to accept).`, "SPATIAL_REGION_NOT_FOUND",
      { elementId: id, storeyId: el.storey, x: el.point[0], y: el.point[1] });
  }
}
/** Explicit taxonomy for AI / MCP: category, discipline, engine and (components) family / type, derived — never stored. */
function taxonomyOf(s: BimState, el: Element) {
  const c = findCategory(categoryIdOfElement(s, el) ?? "");
  const base = { category: c?.id ?? null, discipline: c?.discipline ?? null, engine: c?.engine ?? null };
  if (el.kind !== "component") return base;
  const t = s.types[el.type] as ComponentType | undefined, f = t ? s.families[t.family] : undefined;
  return { ...base, family: f ? { id: f.id, name: f.name } : null, type: t ? { id: t.id, name: t.name } : null };
}
function taxonomyOfType(s: BimState, typeId: string) {
  const c = findCategory(categoryIdOfType(s, typeId) ?? "");
  const t = s.types[typeId] as ComponentType;
  return { category: c?.id ?? null, discipline: c?.discipline ?? null, engine: c?.engine ?? null,
           ...(t.kind === "component" ? { family_name: s.families[t.family]?.name ?? null } : {}) };
}
/**
 * Component update: placement fields go into the placement, instance parameters are merged; a type
 * change must stay in the same category (furniture never silently becomes equipment).
 */
function componentChanges(s: BimState, el: Component, set: Record<string, any>, d: Record<string, string>) {
  const changes: Record<string, unknown> = {};
  if (set.name !== undefined) changes.name = set.name;
  if (set.type !== undefined) {
    const t = typeOf(s, String(set.type), "component");
    const from = categoryIdOfType(s, el.type), to = categoryIdOfType(s, t.id);
    if (from !== to) throw new DomainError(`${el.id} is ${from}; type ${t.name} is ${to}. A component cannot change category.`, "INCOMPATIBLE_COMPONENT_TYPE",
      { ...d, typeId: t.id, categoryId: String(to) });
    changes.type = t.id;
  }
  if (["x", "y", "offset", "rotation"].some((k) => set[k] !== undefined))
    changes.placement = { ...el.placement, ...(set.x !== undefined ? { x: set.x } : {}), ...(set.y !== undefined ? { y: set.y } : {}),
      ...(set.offset !== undefined ? { offset: set.offset } : {}), ...(set.rotation !== undefined ? { rotation: normalizeRotation(set.rotation) } : {}) };
  if (set.parameters !== undefined) {
    const merged: Record<string, unknown> = { ...el.parameters };
    for (const [k, v] of Object.entries(set.parameters)) { if (v === null) delete merged[k]; else merged[k] = v; }
    changes.parameters = merged;
  }
  return changes;
}
/** Vertical intent for queries: mode, the target storey (id and name) and the stored value. */
function verticalInfo(s: BimState, el: VerticalElement) {
  const f = derivedField(el);
  return el.vertical?.mode === "storey"
    ? { mode: "storey", storey: el.vertical.storey, storey_name: s.storeys[el.vertical.storey]?.name, [f]: (el as any)[f] }
    : { mode: "fixed", [f]: (el as any)[f] };
}

const summaryTool = qry({
  name: "bim_model_summary", title: "Model summary", permission: "bim.read",
  description: "Project info, storeys, grids, types, materials and element counts per kind and storey. Call first.",
  input: z.object({}),
  run: ({ state: s }) => {
    const counts: Record<string, Record<string, number>> = {};
    for (const el of Object.values(s.elements)) {
      const st = s.storeys[el.storey]?.name ?? "?";
      (counts[st] ??= {})[el.kind] = ((counts[st] ??= {})[el.kind] ?? 0) + 1;
    }
    return {
      project: s.project,
      storeys: Object.values(s.storeys).sort((a, b) => a.elevation - b.elevation),
      grids: Object.values(s.grids).map((g) => ({ id: g.id, name: g.name, start: g.start, end: g.end })),
      types: Object.values(s.types).map((t) => ({ id: t.id, kind: t.kind, name: t.name,
        ...(isLayeredType(t) ? { thickness: r(thickness(t as LayeredType), 4) } : {}) })),
      materials: Object.values(s.materials).map((m) => `${m.id} ${m.name}`),
      elements: Object.keys(s.elements).length, by_storey: counts,
    };
  },
});

const listTypes = qry({
  name: "bim_get_types", title: "Get types", permission: "bim.read",
  description: "Full definition of types: layers with material names and thickness, profiles, door/window sizes.",
  input: z.object({ kind: z.enum(["wall", "slab", "ceiling", "roof", "footing", "foundation_slab", "pipe", "duct", "cable_tray", "conduit", "cable", "mep_fitting", "rebar", "ramp", "curtain_wall", "column", "beam", "door", "window", "stair", "railing"]).optional() }),
  run: ({ state: s }, i) => Object.values(s.types).filter((t) => !i.kind || t.kind === i.kind).sort(ORDER.type).map((t) =>
    isLayeredType(t)
      ? { ...t, thickness: r(thickness(t as LayeredType), 4), layers: (t as LayeredType).layers.map((l) => ({ ...l, material: s.materials[l.material]?.name })) }
      : t),
});

const queryElements = qry({
  name: "bim_query_elements", title: "Query elements", permission: "bim.read",
  description: "Find elements by kind, storey, type, host or property value. Returns compact rows with optional quantities.",
  input: z.object({
    kind: z.enum(["wall", "profile_member", "boundary", "hosted_component", "opening", "component", "spatial", "slab", "column", "beam", "door", "window"]).optional()
      .describe("storage variant; the former kinds slab / column / beam / door / window are accepted and mean their category"),
    storey: Ref.optional(), type: Ref.optional(), host: z.string().optional(), ids: z.array(z.string()).optional(),
    vertical_mode: z.enum(["fixed", "storey"]).optional().describe("walls / columns / beams: fixed or storey-constrained"),
    category: z.string().optional().describe("e.g. architecture.furniture"), discipline: z.string().optional().describe("e.g. electrical"),
    capability: z.enum(CAPABILITIES).optional().describe("e.g. pointPlaced"), engine: ENGINE_FILTER.optional().describe("engine id; also the compatible aliases component (= point_component) and native (former native group, deprecated)"),
    family: z.string().optional().describe("component family id or name"),
    constrained_to: Ref.optional().describe("storey that the element's vertical constraint targets"),
    affected_by_storey: Ref.optional().describe("storey-constrained elements whose derived height / z changes when this storey's elevation changes"),
    property: z.object({ pset: z.string(), name: z.string(), value: z.union([z.string(), z.number(), z.boolean()]).optional() }).optional(),
    with_quantities: z.boolean().default(false), limit: z.number().int().min(1).max(1000).default(200), offset: z.number().int().min(0).default(0),
  }),
  run: ({ state: s }, i) => {
    const st = i.storey ? storeyOf(s, i.storey).id : undefined;
    const ct = i.constrained_to ? storeyOf(s, i.constrained_to).id : undefined;
    const affected = i.affected_by_storey ? new Set(verticallyAffected(s, new Set([storeyOf(s, i.affected_by_storey).id]))) : undefined;
    const vert = (el: Element) => (isVerticalElement(el) ? el.vertical : undefined);
    const famId = i.family ? findResource(s, "family", i.family).id : undefined;
    const catOk = (el: Element) => {
      if (!i.category && !i.discipline && !i.capability && !i.engine && !famId) return true;
      const c = findCategory(categoryIdOfElement(s, el) ?? "");
      return !!c && (!i.category || c.id === i.category) && (!i.discipline || c.discipline === i.discipline) && (!i.engine || engineFilter(i.engine).has(c.engine))
        && (!i.capability || hasCapability(c, i.capability as Capability)) && (!famId || (el.kind === "component" && (s.types[el.type] as ComponentType)?.family === famId));
    };
    const sctx = new SpatialContext(s);                       // one spatial context for the whole query
    // sorted by id: the same model answers in the same order whether it is live or reloaded from a snapshot
    let rows = Object.values(s.elements).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).filter((el) => catOk(el) &&
      (!i.vertical_mode || vert(el)?.mode === i.vertical_mode) &&
      (!ct || (vert(el)?.mode === "storey" && (vert(el) as { storey: string }).storey === ct)) &&
      (!affected || affected.has(el.id)) &&
      (!i.kind || (LEGACY_KIND_V3[i.kind] ? categoryIdOfElement(s, el) === LEGACY_KIND_V3[i.kind].category : el.kind === i.kind)) &&
      (!st || el.storey === st) && (!i.ids || i.ids.includes(el.id)) &&
      (!i.host || ("host" in el && el.host === i.host)) &&
      (!i.type || ("type" in el && (el.type === i.type || s.types[el.type]?.name.toLowerCase() === i.type.toLowerCase()))) &&
      (!i.property || (el.props?.[i.property.pset]?.[i.property.name] !== undefined &&
        (i.property.value === undefined || el.props[i.property.pset][i.property.name] === i.property.value))));
    const total = rows.length;
    rows = rows.slice(i.offset, i.offset + i.limit);
    return { total, offset: i.offset, elements: rows.map((el) => ({ ...brief(s, el, sctx),
      ...(i.with_quantities ? { quantities: Object.fromEntries(Object.entries(quantities(s, el)).map(([k, v]) => [k, r(v, 4)])) } : {}) })) };
  },
});

const getElement = qry({
  name: "bim_get_element", title: "Get element", permission: "bim.read",
  description: "Full element data: attributes, type with layers, computed geometry (wall footprint, length, thickness), quantities, openings and properties.",
  input: z.object({ id: z.string() }),
  run: ({ state: s }, i) => {
    const el = s.elements[i.id];
    if (!el) throw new DomainError(`Element ${i.id} not found.`);
    const out: any = { ...el, storey_name: s.storeys[el.storey]?.name, quantities: quantities(s, el), taxonomy: taxonomyOf(s, el),
                       engine: engineOfElement(s, el).id, placement_info: placementOf(s, el), relationships: relationshipsOf(s, el),
                       representation: resolveElementRepresentation(s, el),
                       ...(el.kind === "profile_member" ? { world: memberWorldEnds(s, el), length: memberLength(s, el) } : {}),
                       ...(el.kind === "mep_segment" ? { system: s.mepSystems[el.system] ?? null, world_route: routeWorld(s, el), length: routeLength(s, el) } : {}),
                       ...(el.kind === "mep_fitting" ? { system: s.mepSystems[el.system] ?? null } : {}),
                       ...(el.kind === "mep_segment" || el.kind === "mep_fitting" || (el.kind === "component" && connectorsOf(s, el).length) ? { connectors: connectorsOf(s, el).map((c) => ({ ...c.ref, owner: c.owner, domain: c.domain, position: c.position, direction: c.direction, flow: c.flow, shape: c.shape, junction: junctionOf(s, c.ref)?.id ?? null })) } : {}),
                       ...(el.kind === "component" ? { geometry: componentBox(s, el) } : {}),
                       ...(el.kind === "spatial" ? { spatial: spatialDetail(s, el) } : {}),
                       ...(isVerticalElement(el) ? { vertical_info: verticalInfo(s, el) } : {}) };
    if ("type" in el) out.type_def = s.types[el.type];
    if ("type" in el) {
      const type:any=s.types[el.type];
      out.material_details=(type?.layers ?? (type?.material?[{material:type.material}]:[])).map((layer:any,index:number)=>({index,...layer,definition:s.materials[layer.material]??null}));
    }
    if (el.kind === "wall") {
      const f = wallFrame(s, el);
      out.footprint = f.footprint.map((p) => [r(p[0], 4), r(p[1], 4)]);
      out.openings = Object.values(s.elements).filter((o) => o.kind === "opening" && o.host === el.id);
    }
    return out;
  },
});

const validateTool = qry({
  name: "bim_validate", title: "Validate model", permission: "bim.read",
  description: "Model checks: referential integrity, openings inside their walls, overlapping openings, duplicate physical elements (same category, storey and stored geometry; rooms / spaces and hosted doors / windows are governed by occupancy and opening invariants instead), walls without layers.",
  input: z.object({}),
  run: ({ state: s }) => {
    const issues: { severity: string; ids: string[]; issue: string }[] = [];
    for (const m of modelIssues(s)) issues.push({ severity: "error", ids: [m.id], issue: `[${m.reason}] ${m.message}` });
    for (const m of modellingIssues(s)) issues.push({ severity: 'error', ids: m.ids, issue: `[${m.code}] ${m.message}` });
    const seen = new Map<string, string>();
    // by id: the same model reports the same pairs in the same order (live, replayed or reloaded from a snapshot)
    for (const el of Object.values(s.elements).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
      const key = duplicateSignature(s, el);                 // engine / placement aware; null = not comparable by geometry
      if (key === null) continue;
      if (seen.has(key)) issues.push({ severity: "warning", ids: [seen.get(key)!, el.id], issue: "Duplicate element (same category, storey and geometry)." });
      else seen.set(key, el.id);
    }
    for (const t of Object.values(s.types)) if ((isLayeredType(t)) && thickness(t as LayeredType) <= 0)
      issues.push({ severity: "error", ids: [t.id], issue: "Layered type with zero thickness." });
    return { ok: !issues.some((x) => x.severity === "error"), issues };
  },
});


// ================================================================== resource lifecycle (Phase 4)
// Identity: ids are immutable; names are editable labels. Every tool below only emits events:
// field rules, name uniqueness and deletion protection (RESOURCE_IN_USE) are enforced centrally by
// the BIM validator on the candidate state, so a batch is all-or-nothing and nothing cascades.
const Ref2 = z.string().min(1).describe("id or name");
const resErr = (msg: string, reason: "INVALID_RESOURCE_UPDATE" | "RESOURCE_KIND_MISMATCH", d: Record<string, string | number>) => new DomainError(msg, reason, d);
/** Unknown / immutable fields are refused by name (catchall keeps them visible to the domain). */
function patchFields(set: Record<string, unknown>, allowed: string[], d: Record<string, string>) {
  const keys = Object.keys(set);
  if (!keys.length) throw resErr("Nothing to update.", "INVALID_RESOURCE_UPDATE", d);
  const bad = keys.find((k) => !allowed.includes(k));
  if (bad) throw resErr(`Field '${bad}' cannot be changed. Editable: ${allowed.join(", ")}.`, "INVALID_RESOURCE_UPDATE", { ...d, field: bad });
}
const withUsage = (s: BimState, kind: ResourceKind, id: string) => ({ usageCount: resourceUsage(s, kind, id).usageCount });

// ---------------------------------------------------------------- queries
const queryStoreys = qry({
  name: "bim_query_storeys", title: "Query storeys", permission: "bim.read",
  description: "Storeys ordered by elevation (then id), with how many elements use each.",
  input: z.object({}),
  run: ({ state: s }) => Object.values(s.storeys).sort(ORDER.storey).map((st) => ({ ...st, ...withUsage(s, "storey", st.id) })),
});
const queryGrids = qry({
  name: "bim_query_grids", title: "Query grids", permission: "bim.read",
  description: "Grid lines in creation order (id), optionally filtered by name.",
  input: z.object({ name: z.string().optional().describe("case-insensitive substring") }),
  run: ({ state: s }, i) => Object.values(s.grids).filter((g) => !i.name || g.name.toLowerCase().includes(i.name.toLowerCase())).sort(ORDER.grid),
});
const queryMaterials = qry({
  name: "bim_query_materials", title: "Query materials", permission: "bim.read",
  description: "Materials ordered by name (then id), optionally filtered by name substring or category; with how many types use each.",
  input: z.object({ name: z.string().optional(), category: z.string().optional() }),
  run: ({ state: s }, i) => Object.values(s.materials)
    .filter((m) => (!i.name || m.name.toLowerCase().includes(i.name.toLowerCase())) && (!i.category || (m.category ?? "").toLowerCase() === i.category.toLowerCase()))
    .sort(ORDER.material).map((m) => ({ ...m, ...withUsage(s, "material", m.id) })),
});
const queryTypes = qry({
  name: "bim_query_types", title: "Query types", permission: "bim.read",
  description: "Types ordered by kind, name, id, with category / discipline / engine, derived compatible_categories and how many elements use each. Filters: kind, category (the type's HOME semantic category), compatible_category (every type that category can actually USE: e.g. beam types for structure.brace, wall types for structure.shear_wall), discipline, engine (any implemented engine id: see bim_list_engines), family.",
  input: z.object({ kind: z.enum(["wall", "slab", "ceiling", "roof", "footing", "foundation_slab", "pipe", "duct", "cable_tray", "conduit", "cable", "mep_fitting", "rebar", "ramp", "curtain_wall", "column", "beam", "door", "window", "stair", "railing", "component"]).optional(), category: z.string().optional(),
                    discipline: z.string().optional(), engine: ENGINE_FILTER.optional().describe("a concrete engine id (bim_list_engines); the old query aliases component (= point_component) and native remain accepted but are deprecated"), family: z.string().optional(),
                    compatible_category: z.string().optional().describe("a category id: only types that category can use, by the same central category -> engine -> type rule that validates elements (DERIVED, never stored). category stays the HOME category filter") }),
  run: ({ state: s }, i) => {
    const fam = i.family ? findResource(s, "family", i.family).id : undefined;
    return Object.values(s.types).filter((t) => {
      const c = findCategory(categoryIdOfType(s, t.id) ?? "");
      return (!i.kind || t.kind === i.kind) && (!i.category || c?.id === i.category) && (!i.compatible_category || compatibleCategories(s, t.id).includes(i.compatible_category)) && (!i.discipline || c?.discipline === i.discipline)
        && (!i.engine || (!!c && engineFilter(i.engine).has(c.engine))) && (!fam || (t as ComponentType).family === fam);
    }).sort(ORDER.type).map((t) => ({ ...t, ...taxonomyOfType(s, t.id), compatible_categories: compatibleCategories(s, t.id),
      ...(isLayeredType(t) ? { thickness: r(thickness(t as LayeredType), 4) } : {}), ...withUsage(s, "type", t.id) }));
  },
});
const usageTool = qry({
  name: "bim_resource_usage", title: "Resource usage", permission: "bim.read",
  description: "What uses a storey, grid, material or type: counts per element kind with sample ids, or the types (and layer indexes) using a material. Check before deleting.",
  input: z.object({ kind: z.enum(["storey", "grid", "material", "type", "family", "mep_system", "spatial_unit"]), ref: Ref2, type_kind: z.enum(["wall", "slab", "ceiling", "roof", "footing", "foundation_slab", "pipe", "duct", "cable_tray", "conduit", "cable", "mep_fitting", "rebar", "ramp", "curtain_wall", "column", "beam", "door", "window", "stair", "railing"]).optional() }),
  run: ({ state: s }, i) => {
    const r0 = findResource(s, i.kind, i.ref, i.type_kind);
    const u = resourceUsage(s, i.kind, r0.id);
    return { resource: { id: r0.id, name: r0.name }, ...u, summary: usageSummary(u) || "unused" };
  },
});

// ---------------------------------------------------------------- storeys
const updateStoreys = cmd({
  name: "bim_update_storeys", title: "Update storeys", permission: "bim.write",
  description: "Rename storeys or change their elevation. Storey-constrained walls / columns / beams follow (their derived height / z is recomputed from the final elevations, atomically, with every hosted opening re-validated); fixed elements keep their values. Editable: name, elevation.",
  input: z.object({ items: z.array(z.object({ storey: Ref2, set: z.object({ name: z.string(), elevation: z.number() }).partial().catchall(z.unknown()) })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const it of i.items) {
      const st = findResource(s, "storey", it.storey);
      patchFields(it.set, ["name", "elevation"], { resourceKind: "storey", resourceId: st.id });
      const changes: Record<string, unknown> = {};
      if (it.set.name !== undefined) changes.name = normalizeName(String(it.set.name));
      if (it.set.elevation !== undefined) changes.elevation = it.set.elevation;
      Object.assign(s.storeys[st.id], changes);
      events.push({ type: "StoreyUpdated", payload: { id: st.id, changes } });
    }
    // after ALL storey changes: storey-constrained walls / columns / beams follow (order independent)
    const touched = new Set(events.map((e: any) => e.payload.id as string));
    const propagated = syncVertical(s, verticallyAffected(s, touched));
    for (const c of propagated) events.push({ type: "ElementUpdated", payload: c });
    return { events, summary: { updated: [...touched], propagated: propagated.map((c) => c.id) } };
  },
});
const deleteStoreys = cmd({
  name: "bim_delete_storeys", title: "Delete storeys", permission: "bim.delete", effect: "destructive",
  description: "Delete storeys that no element uses. A storey in use is refused (RESOURCE_IN_USE with usage); nothing is cascaded.",
  input: z.object({ storeys: z.array(Ref2).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const ref of i.storeys) {
      const st = findResource(s, "storey", ref);
      delete s.storeys[st.id];
      events.push({ type: "StoreyDeleted", payload: { id: st.id } });
    }
    return { events, summary: { deleted: events.map((e: any) => e.payload.id) } };
  },
});

const reassignStoreys = cmd({
  name: "bim_reassign_storey", title: "Reassign elements to a storey", permission: "bim.write",
  description: "Move walls, slabs, columns or beams to another storey. Relative values (base offset, slab offset, fixed height / z) are kept, so the element moves vertically with the storey; XY is unchanged. A wall takes its openings, doors and windows along. Storey-constrained elements keep their target and are recomputed; an impossible result rejects the whole command. Hosted elements cannot be reassigned on their own.",
  input: z.object({ items: z.array(z.object({ id: z.string(), storey: Ref2 })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const it of i.items)
      for (const c of reassignStorey(s, it.id, storeyOf(s, it.storey).id)) events.push({ type: "ElementUpdated", payload: c });
    return { events, summary: { moved: [...new Set(events.map((e: any) => e.payload.id as string))] } };
  },
});


// ================================================================== wall topology (Phase 6)
const EndpointRef = z.object({ wall: z.string(), endpoint: z.enum(["start", "end"]) });
const joinWalls = cmd({
  name: "bim_join_walls", title: "Join walls", permission: "bim.write",
  description: `Create an explicit, persistent wall relation (touching is not joining). endpoint_endpoint: 2+ wall endpoints become one junction (endpoints within ${JOIN_TOLERANCE} m are snapped to one point; joining into an existing junction extends it); two-wall corners get mitred. endpoint_segment: a T-junction — an endpoint is fixed on a host wall at parameter t (computed by projection if omitted); it then follows the host. Same storey only.`,
  // a flat object (MCP tool inputs must be objects); the per-kind fields are checked below
  input: z.object({
    kind: z.enum(["endpoint_endpoint", "endpoint_segment"]),
    endpoints: z.array(EndpointRef).min(2).max(8).optional().describe("endpoint_endpoint: the endpoints to join"),
    endpoint: EndpointRef.optional().describe("endpoint_segment: the tee endpoint"),
    host: z.string().optional().describe("endpoint_segment: host wall id"),
    t: z.number().optional().describe("endpoint_segment: 0 < t < 1 along the host (default: projection)"),
  }),
  decide: (s, i) => {
    const bad = (msg: string) => new DomainError(msg, "INVALID_WALL_JOIN", { kind: i.kind });
    if (i.kind === "endpoint_endpoint" && (!i.endpoints || i.endpoint || i.host || i.t !== undefined)) throw bad("endpoint_endpoint takes `endpoints` (2-8) only.");
    if (i.kind === "endpoint_segment" && (!i.endpoint || !i.host || i.endpoints)) throw bad("endpoint_segment takes `endpoint`, `host` and optionally `t`.");
    const res = createJoin(s, i.kind === "endpoint_endpoint" ? { kind: i.kind, endpoints: i.endpoints! } : { kind: i.kind, endpoint: i.endpoint!, host: i.host!, t: i.t },
                           () => nextId(s, "join"));
    const events: Decision["events"] = [...res.joinEvents, ...res.wallChanges.map((c) => ({ type: "ElementUpdated", payload: c }))];
    if (res.joinEvents.some((e) => e.type === "WallJoinCreated")) events.push(counters(s));
    return { events, summary: res.summary };
  },
});
const joinWallsBatch = cmd({
  name: "bim_join_walls_batch", title: "Join walls in one approval", permission: "bim.write",
  description: "Apply multiple explicit wall joins atomically in ONE proposal and ONE approval. Each item uses the same arguments as bim_join_walls. If any join is invalid, the entire batch is rejected without changes.",
  input: z.object({ joins: z.array(joinWalls.input).min(1).max(1000) }),
  decide: (s, i, ctx) => {
    const events: Decision["events"] = [];
    const summaries: unknown[] = [];
    for (const join of i.joins) {
      const result = joinWalls.decide(s, join, ctx);
      events.push(...result.events); summaries.push(result.summary);
      for (const event of result.events) apply(s, event as any);
    }
    return { events, summary: { joins: summaries, count: i.joins.length } };
  },
});
const unjoinWalls = cmd({
  name: "bim_unjoin_walls", title: "Unjoin walls", permission: "bim.write",
  description: "Remove a wall relation by join id, or detach one endpoint from its junction / tee. Wall coordinates never move; miter data of the affected walls is recomputed (released endpoints get square ends).",
  input: z.object({ join: z.string().optional(), endpoint: EndpointRef.optional() }),
  decide: (s, i) => {
    if (!!i.join === !!i.endpoint) throw new DomainError("Give exactly one of join or endpoint.", "INVALID_WALL_JOIN", {});
    const res = removeJoin(s, i);
    return { events: [...res.joinEvents, ...res.wallChanges.map((c) => ({ type: "ElementUpdated", payload: c }))], summary: res.summary };
  },
});
const detectTool = qry({
  name: "bim_detect_wall_connections", title: "Detect wall connections", permission: "bim.read",
  description: `Non-mutating: lists walls that could be joined (endpoint_endpoint, endpoint_segment within ${JOIN_TOLERANCE} m), crossing walls (segment_crossing: never joined automatically) and near misses (gaps / overshoots up to near_miss_distance, default ${NEAR_MISS_DISTANCE} m). Same storey only; deterministic order; bounded by max_results.`,
  input: z.object({ storey: Ref.optional(), walls: z.array(z.string()).optional(), max_results: z.number().int().min(1).max(1000).default(100),
                    near_miss_distance: z.number().positive().max(1).optional(), include_existing: z.boolean().default(false) }),
  run: ({ state: s }, i) => detectConnections(s, { storey: i.storey ? storeyOf(s, i.storey).id : undefined, walls: i.walls, maxResults: i.max_results,
                                                   nearMissDistance: i.near_miss_distance, includeExisting: i.include_existing }),
});
const queryTopology = qry({
  name: "bim_query_wall_topology", title: "Query wall topology", permission: "bim.read",
  description: "Explicit wall relations (junctions with their endpoints and point, tees with host and t), filtered by wall, storey or kind; component_of returns the walls connected to a wall through explicit relations (BFS).",
  input: z.object({ wall: z.string().optional(), storey: Ref.optional(), kind: z.enum(["endpoint_endpoint", "endpoint_segment"]).optional(), component_of: z.string().optional() }),
  run: ({ state: s }, i) => {
    const st = i.storey ? storeyOf(s, i.storey).id : undefined;
    const joins = Object.values(s.joins).filter((j) => (!i.kind || j.kind === i.kind) && (!i.wall || wallsOf(j).includes(i.wall))
      && (!st || (s.elements[membersOf(j)[0].wall] as any)?.storey === st))
      .map((j) => ({ ...structuredClone(j), storey: s.elements[membersOf(j)[0].wall]?.storey ?? null, walls: wallsOf(j), point: pointOf(s, membersOf(j)[0]) }))
      .sort((a, b) => (String(a.storey) < String(b.storey) ? -1 : String(a.storey) > String(b.storey) ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : 1));
    const out: Record<string, unknown> = { joins };
    if (i.wall) out.connectedWalls = [...new Set(joins.flatMap((j) => j.walls))].filter((w) => w !== i.wall).sort();
    if (i.component_of) {
      if (s.elements[i.component_of]?.kind !== "wall") throw new DomainError(`${i.component_of} is not a wall.`, "ELEMENT_NOT_FOUND", { elementId: i.component_of });
      out.component = { of: i.component_of, walls: connectedComponent(s, i.component_of) };
    }
    return out;
  },
});
const usageOfElement = qry({
  name: "bim_get_element_usage", title: "Element usage", permission: "bim.read",
  description: "What references an element and what it references: a wall's hosted openings and joins (and directly joined walls), an opening's host and fill, a door/window's opening. Check before deleting.",
  input: z.object({ id: z.string() }),
  run: ({ state: s }, i) => {
    if (!s.elements[i.id]) throw new DomainError(`Element ${i.id} not found.`, "ELEMENT_NOT_FOUND", { elementId: i.id });
    return elementUsage(s, i.id);
  },
});
const rehostOpening = cmd({
  name: "bim_rehost_opening", title: "Rehost opening", permission: "bim.write", effect: "destructive",
  description: "Move an opening (with its door / window) to another wall of the same storey in one atomic edit: the opening's host and its fill's host always change together. Optional new position along the wall (along) or keep_position (the opening already lies physically on the new wall: its world position is kept) and sill. The result must fit the new wall and overlap nothing, otherwise nothing changes. Never inferred from proximity. dry_run previews the exact result.",
  input: z.object({ opening: z.string(), host: z.string(), along: z.number().optional(), sill: z.number().min(0).optional(), keep_position: z.boolean().optional() }),
  decide: (s, i) => runAuthoring(s, (before) => rehostOpeningEdit(s, before, i)),
});

// ================================================================== authoring primitives (Phase 10)
// Intent-based, topology-safe wall edits. Each one edits the candidate state and emits the canonical events that describe the result
// (ElementCreated / Updated / Deleted, WallJoin*): see authoring.ts. dry_run runs the same decision path and persists nothing.
const splitWallTool = cmd({
  name: "bim_split_wall", title: "Split wall", permission: "bim.write", effect: "destructive",
  description: "Split one wall at a normalized position t (0 < t < 1 along the wall; or a point on its axis, converted to t) into two walls: the original id keeps the START segment, the END segment gets a new id. Type, storey, vertical intent, height, base offset, room bounding and properties are kept; joins and T-junctions are transferred with their parameters renormalised (a T at the split point becomes a member of the new junction); hosted openings, doors and windows keep their physical position and ids and move to the child that contains them; the two halves stay explicitly joined. Rejects t at 0 / 1 and any split through a hosted opening (SPLIT_INTERSECTS_HOSTED_OPENING).",
  input: z.object({ wall: z.string().describe("wall id"), t: z.number().optional().describe("0 < t < 1 along the wall from its start"), point: P2s.optional().describe("alternative to t: a point on the wall axis") }),
  decide: (s, i) => runAuthoring(s, (before) => splitWall(s, before, i as any)),
});
const mergeWallsTool = cmd({
  name: "bim_merge_walls", title: "Merge walls", permission: "bim.write", effect: "destructive",
  description: "Merge two explicitly end-to-end joined, compatible, collinear walls into one: same type, storey, base offset, room bounding and vertical intent; no other wall at the junction. The survivor is `primary` (else the smaller id) and keeps its direction; the other wall is deleted. External joins, T-junctions and hosted openings / doors / windows are transferred with their physical positions and ids. Conflicting names, properties or exterior sides are refused (MERGE_PROPERTY_CONFLICT), never silently picked. Collinear and close is NOT enough: the explicit junction is required.",
  input: z.object({ walls: z.array(z.string()).length(2), primary: z.string().optional().describe("the wall id that survives") }),
  decide: (s, i) => runAuthoring(s, (before) => mergeWalls(s, before, i)),
});
const trimWallTool = cmd({
  name: "bim_trim_wall", title: "Trim wall", permission: "bim.write", effect: "destructive",
  description: "Shorten one wall endpoint to its deterministic intersection with another wall (the wall must cross the target). The endpoint moves along the wall's own axis; hosted openings and T-junctions keep their physical positions (an edit that would remove one is refused). With join (default true) the new end is explicitly joined to the target (a T-junction, or an endpoint junction when the target is crossed at its end) in the same atomic command. The endpoint must not already be joined. Rejects parallel / non-reaching targets and results shorter than the join tolerance.",
  input: z.object({ wall: z.string(), endpoint: z.enum(["start", "end"]), target: z.string().describe("the wall to trim to"), join: z.boolean().default(true) }),
  decide: (s, i) => runAuthoring(s, (before) => trimExtendWall(s, before, { ...i, mode: "trim" })),
});
const extendWallTool = cmd({
  name: "bim_extend_wall", title: "Extend wall", permission: "bim.write", effect: "destructive",
  description: "Extend one wall endpoint along its own axis until it reaches another wall, and (join, default true) explicitly join it there in the same atomic command. Rejects parallel targets, targets behind or within the wall, targets the extension would miss, and edits that would invalidate hosted content. The endpoint must not already be joined.",
  input: z.object({ wall: z.string(), endpoint: z.enum(["start", "end"]), target: z.string().describe("the wall to extend to"), join: z.boolean().default(true) }),
  decide: (s, i) => runAuthoring(s, (before) => trimExtendWall(s, before, { ...i, mode: "extend" })),
});

// ================================================================== taxonomy, families and components (Phase 7)
const listDisciplinesTool = qry({
  name: "bim_list_disciplines", title: "List disciplines", permission: "bim.read",
  description: "The BIM disciplines (application metadata, fixed order).",
  input: z.object({}),
  run: () => listDisciplines(),
});
const listCategoriesTool = qry({
  name: "bim_list_categories", title: "List categories", permission: "bim.read",
  description: "BIM categories: id, name, discipline, engine, capabilities, placements, type kinds, IFC class, valid IFC predefined types, the engine's authoring level (0-3) and the canonical creation tool. Filters: discipline, engine (a concrete engine id), capability, ifc_class (e.g. IfcBoiler), min_level (minimum authoring level). Ordered by discipline then id. bim_get_category_capabilities explains one category in full.",
  input: z.object({ discipline: z.string().optional(), engine: ENGINE_FILTER.optional().describe("a concrete engine id (bim_list_engines); the old query aliases component (= point_component) and native remain accepted but are deprecated"), capability: z.enum(CAPABILITIES).optional(),
                    ifc_class: z.string().optional().describe("exact IFC entity name"), min_level: z.number().int().min(0).max(3).optional().describe("minimum authoring level of the category's engine") }),
  run: (_c, i) => listCategories().filter((c) => (!i.discipline || c.discipline === i.discipline) && (!i.engine || engineFilter(i.engine).has(c.engine))
    && (!i.capability || hasCapability(c, i.capability as Capability)) && (!i.ifc_class || c.ifcClass === i.ifc_class) && (!i.min_level || (findEngine(c.engine)?.authoringLevel ?? 0) >= i.min_level))
    .map((c) => ({ ...c, authoring_level: findEngine(c.engine)?.authoringLevel ?? 0, creation_tool: CREATION_TOOL[c.engine] ?? null })),
});
/** the canonical (engine-backed) creation path of each engine: what an external caller should use to author a category of that engine */
const CREATION_TOOL: Record<string, string> = { wall: "bim_create_walls", boundary: "bim_create_boundaries", profile_member: "bim_create_profile_members", hosted_component: "bim_place_openings (host wall + opening type)",
  point_component: "bim_create_families -> bim_create_types (kind component) -> bim_create_components", spatial: "bim_create_spatial_elements", stair: "bim_create_stairs", path: "bim_create_path_elements", mep_network: "bim_create_mep_segments (system + route)", mep_fitting: "bim_create_mep_fittings (fitting type + system + point placement)", reinforcement: "bim_create_reinforcement (rebar type + host + bar layers)", assembly: "bim_create_assemblies (existing member ids)", ramp_flight: "bim_create_ramps (ramp type + walking line + rise)", curtain_wall: "bim_create_curtain_walls (curtain-wall type + axis + height)", pitched_roof: "bim_create_pitched_roofs (roof type + rectangular footprint + form + pitch)" };
const categoryCapabilitiesTool = qry({
  name: "bim_get_category_capabilities", title: "Get category capabilities", permission: "bim.read",
  description: "What one category GENUINELY supports: its engine (status, authoring level, operations, representations), valid placements, accepted type kinds, the IFC class with its valid PredefinedType values and the IFC schema(s) it exists in, capability flags, the canonical creation tool and what a caller must supply. Never claims more than the registry implements.",
  input: z.object({ category: z.string() }),
  run: (_c, i) => {
    const c = getCategory(i.category), e = findEngine(c.engine), d = c.ifcClass ? IFC_CLASS_DATA[c.ifcClass] : undefined;
    return { category: c.id, name: c.name, discipline: c.discipline,
      engine: { id: c.engine, status: e?.status ?? null, authoring_level: e?.authoringLevel ?? 0, operations: e?.operations ?? [], representations: e?.representations ?? [] },
      placements: c.placements, type_kinds: c.typeKinds ?? [], capabilities: c.capabilities, mep_domain: c.mepDomain ?? null,
      ifc: { class: c.ifcClass ?? null, predefined_type: c.ifcPredefined ?? null, valid_predefined_types: c.ifcPredefinedValues ?? null, schemas: d ? (d.in_ifc4 ? ["IFC4", "IFC4X3_ADD2"] : ["IFC4X3_ADD2"]) : null, written_natively: !!c.ifcClass },
      creation_tool: CREATION_TOOL[c.engine] ?? null,
      supplies: c.engine === "point_component" ? ["a Family of this category (parameters + box representation)", "a component type (optionally predefined_type" + (c.ifcPredefinedValues ? `: ${c.ifcPredefinedValues.join(" | ")}` : "") + ", connectors)", "a storey and a point placement"]
        : c.engine === "mep_network" ? ["a type of kind " + (c.typeKinds ?? []).join("/"), `an existing MEP system of domain ${c.mepDomain}`, "a storey-aware 3D route (>= 2 points)"]
        : [`a type of kind ${(c.typeKinds ?? []).join("/")}`, `a storey and a ${c.placements.join(" / ")} placement`],
      limits: [...(e?.authoringLevel === 1 ? ["Level 1: semantic authoring with a generic family box geometry (no category-specific parametric geometry)"] : []), ...(c.ifcClass ? [] : ["no IFC class is declared: exported generically"])] };
  },
});
const getCategoryTool = qry({
  name: "bim_get_category", title: "Get category", permission: "bim.read",
  description: "One category by id (e.g. architecture.furniture).",
  input: z.object({ id: z.string() }),
  run: (_c, i) => getCategory(i.id),
});
const categoryUsageTool = qry({
  name: "bim_category_usage", title: "Category usage", permission: "bim.read",
  description: "Per category: how many families, types and element instances the project has (computed, never stored). Only categories in use are listed, in registry order.",
  input: z.object({ discipline: z.string().optional() }),
  run: ({ state: s }, i) => {
    const rows = new Map<string, { category: string; discipline: string; engine: string; families: number; types: number; instances: number }>();
    const row = (id: string | undefined) => {
      const c = findCategory(id ?? "");
      if (!c || (i.discipline && c.discipline !== i.discipline)) return null;
      if (!rows.has(c.id)) rows.set(c.id, { category: c.id, discipline: c.discipline, engine: c.engine, families: 0, types: 0, instances: 0 });
      return rows.get(c.id)!;
    };
    for (const f of Object.values(s.families)) { const x = row(f.category); if (x) x.families++; }
    for (const t of Object.values(s.types)) { const x = row(categoryIdOfType(s, t.id)); if (x) x.types++; }
    for (const el of Object.values(s.elements)) { const x = row(categoryIdOfElement(s, el)); if (x) x.instances++; }
    const order = listCategories().map((c) => c.id);
    return [...rows.values()].sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category));
  },
});

const ParamDef = z.object({
  key: z.string().describe("immutable machine key, e.g. width"), name: z.string().describe("display label"),
  scope: z.enum(["type", "instance"]), dataType: z.enum(["number", "length", "angle", "string", "boolean"]).describe("length: m, angle: degrees"),
  required: z.boolean().default(false), default: z.union([z.number(), z.string(), z.boolean()]).optional(),
  min: z.number().optional(), max: z.number().optional(), unit: z.string().optional(),
});
const BoxRep = z.object({ kind: z.literal("box"), width: z.string(), depth: z.string(), height: z.string() })
  .describe("BOX: bottom-centre origin; width -> local X, depth -> local Y, height -> Z; each names a type-scope length parameter");
const createFamilies = cmd({
  name: "bim_create_families", title: "Create families", permission: "bim.write",
  description: "Create component families (furniture, equipment, fixtures, ...): a component category (immutable), level_point placement, typed parameter definitions (type / instance scope) and a BOX representation. Native categories (walls, floors, ...) need no family.",
  input: z.object({ families: z.array(z.object({ name: z.string(), category: z.string(), description: z.string().optional(),
    placement: z.literal("level_point").default("level_point"), parameters: z.array(ParamDef).default([]), representation: BoxRep })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const f0 of i.families) {
      const f = { id: nextId(s, "family"), name: normalizeName(f0.name), category: f0.category, ...(f0.description !== undefined ? { description: f0.description } : {}),
                  placement: f0.placement, parameters: f0.parameters, representation: f0.representation } as Family;
      s.families[f.id] = f;
      events.push({ type: "FamilyCreated", payload: f });
    }
    events.push(counters(s));
    return { events, summary: { created: events.filter((e) => e.type === "FamilyCreated").map((e: any) => ({ id: e.payload.id, name: e.payload.name, category: e.payload.category })) } };
  },
});
const queryFamilies = qry({
  name: "bim_query_families", title: "Query families", permission: "bim.read",
  description: "Component families ordered by category, name, id; filters: category, discipline, name (substring). Each row has its type count.",
  input: z.object({ category: z.string().optional(), discipline: z.string().optional(), name: z.string().optional() }),
  run: ({ state: s }, i) => Object.values(s.families).filter((f) => (!i.category || f.category === i.category)
      && (!i.discipline || findCategory(f.category)?.discipline === i.discipline) && (!i.name || f.name.toLowerCase().includes(i.name.toLowerCase())))
    .sort(ORDER.family).map((f) => ({ ...f, discipline: findCategory(f.category)?.discipline ?? null, ...withUsage(s, "family", f.id) })),
});
const updateFamilies = cmd({
  name: "bim_update_families", title: "Update families", permission: "bim.write",
  description: "Change a family's name, description, parameter definitions (the full list) or representation. Category and placement never change. Every type and instance of the family must stay valid, otherwise the whole command is rejected (nothing is adjusted to fit).",
  input: z.object({ items: z.array(z.object({ family: Ref2, set: z.object({ name: z.string(), description: z.string(), parameters: z.array(ParamDef), representation: BoxRep }).partial().catchall(z.unknown()) })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const it of i.items) {
      const f = findResource(s, "family", it.family);
      const d = { familyId: f.id };
      for (const k of Object.keys(it.set))
        if (!["name", "description", "parameters", "representation"].includes(k))
          throw new DomainError(`Family field '${k}' cannot be changed${k === "category" || k === "placement" ? " (create a new family instead)" : ""}.`, "INVALID_FAMILY_UPDATE", { ...d, field: k });
      if (!Object.keys(it.set).length) throw new DomainError("Nothing to update.", "INVALID_FAMILY_UPDATE", d);
      const changes: Record<string, unknown> = { ...it.set };
      if (typeof changes.name === "string") changes.name = normalizeName(changes.name);
      Object.assign(s.families[f.id], structuredClone(changes));
      events.push({ type: "FamilyUpdated", payload: { id: f.id, changes } });
    }
    return { events, summary: { updated: events.map((e: any) => e.payload.id) } };
  },
});
const deleteFamilies = cmd({
  name: "bim_delete_families", title: "Delete families", permission: "bim.delete", effect: "destructive",
  description: "Delete families no type uses. A family with types is refused (RESOURCE_IN_USE with type counts and samples); nothing is cascaded.",
  input: z.object({ families: z.array(Ref2).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const ref of i.families) {
      const f = findResource(s, "family", ref);
      delete s.families[f.id];
      events.push({ type: "FamilyDeleted", payload: { id: f.id } });
    }
    return { events, summary: { deleted: events.map((e: any) => e.payload.id) } };
  },
});
const createComponents = cmd({
  name: "bim_create_components", title: "Create components", permission: "bim.write",
  description: "Place generic components of ANY component category (furniture, casework, equipment, fixtures, site, generic models). The category, family, capabilities and geometry come from the type — never from input. Level-point placement: (x, y) in plan, offset above the storey, rotation in degrees.",
  input: z.object({ components: z.array(z.object({ type: Ref.describe("component type id or name"), storey: Ref, x: z.number(), y: z.number(),
    offset: z.number().default(0), rotation: z.number().default(0).describe("degrees, counter-clockwise"), name: Name.optional(),
    parameters: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}).describe("instance-scope values only") })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const c of i.components) {
      const t = typeOf(s, c.type, "component");
      const el: Component = { id: nextId(s, "component"), kind: "component", storey: storeyOf(s, c.storey).id, type: t.id,
        placement: { kind: "level_point", x: r(c.x), y: r(c.y), offset: r(c.offset), rotation: normalizeRotation(c.rotation) },
        parameters: c.parameters, ...(c.name ? { name: c.name } : {}) } as Component;
      s.elements[el.id] = el;
      events.push({ type: "ElementCreated", payload: el });
    }
    events.push(counters(s));
    return { events, summary: { created: events.filter((e) => e.type === "ElementCreated").map((e: any) => ({ id: e.payload.id, ...taxonomyOf(s, s.elements[e.payload.id]) })) } };
  },
});


// ================================================================== spatial elements (Phase 8)
const createSpatial = cmd({
  name: "bim_create_spatial_elements", title: "Create rooms / spaces", permission: "bim.write",
  description: "Create spatial elements of ANY spatial category (architecture.room, mechanical.space, ...): a storey and a location point (x, y) inside a region closed by EXPLICITLY JOINED room-bounding walls. The boundary, area, perimeter and volume are derived from the walls and follow them. Number: unique per category. Height: explicit (fixed) or top_storey / next storey (constrained). A point outside every bounded region is refused unless allow_unbounded.",
  input: z.object({ items: z.array(z.object({ category: z.string().describe("e.g. architecture.room"), storey: Ref, x: z.number(), y: z.number(),
    number: z.string().optional(), name: Name.optional(), height: PositiveLength.optional(), top_storey: Ref.optional(),
    allow_unbounded: z.boolean().default(false) })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [], check: string[] = [];
    for (const it of i.items) {
      const c = findCategory(it.category);
      if (!c || c.engine !== "spatial") throw new DomainError(`'${it.category}' is not a spatial category.`, "INVALID_SPATIAL_CATEGORY", { categoryId: it.category });
      const st = storeyOf(s, it.storey);
      const vertical = creationVertical(s, st, it.height, it.top_storey, "height");
      const el = withDerived(s, { id: nextId(s, "spatial"), kind: "spatial", category: c.id, storey: st.id, point: [r(it.x), r(it.y)],
        ...(it.number !== undefined ? { number: it.number.trim() } : {}), ...(it.name ? { name: it.name } : {}), height: it.height ?? 3.0, vertical } as SpatialElement);
      s.elements[el.id] = el;
      events.push({ type: "ElementCreated", payload: el });
      if (!it.allow_unbounded) check.push(el.id);
    }
    requireBounded(s, check);
    events.push(counters(s));
    const ctx = new SpatialContext(s);
    return { events, summary: { created: events.filter((e) => e.type === "ElementCreated").map((e: any) => ({ id: e.payload.id, category: e.payload.category,
      ...spatialSummary(ctx, s.elements[e.payload.id] as SpatialElement) })) } };
  },
});
const detectRegions = qry({
  name: "bim_detect_spatial_regions", title: "Detect spatial regions", permission: "bim.read",
  description: "Non-mutating: the bounded regions closed by explicitly joined room-bounding walls (wall centerlines), per storey, with boundary (wall references with parameter intervals), area, perimeter, a representative interior point and which spatial elements occupy each. Detection never creates rooms.",
  input: z.object({ storey: Ref.optional(), category: z.string().optional().describe("occupancy of this category only"), include_occupied: z.boolean().default(true),
                    max_results: z.number().int().min(1).max(1000).default(100) }),
  run: ({ state: s }, i) => {
    const ctx = new SpatialContext(s);
    const storeys = (i.storey ? [storeyOf(s, i.storey)] : Object.values(s.storeys).sort((a, b) => a.elevation - b.elevation || (a.id < b.id ? -1 : 1)));
    const out: any[] = [];
    for (const st of storeys) {
      const occ = occupancy(ctx, st.id);
      for (const g of ctx.storey(st.id)) {
        const by = (occ.get(g.signature) ?? []).filter((e) => !i.category || e.category === i.category).map((e) => ({ id: e.id, category: e.category, number: e.number ?? null, name: e.name ?? null }));
        if (!i.include_occupied && by.length) continue;
        out.push({ regionSignature: g.signature, storey: st.id, storey_name: st.name, boundaryLocation: BOUNDARY_LOCATION, area: g.area, perimeter: g.perimeter,
          outerPerimeter: g.outerPerimeter, representativePoint: g.representativePoint, outer: g.outer, holes: g.holes, boundarySegments: g.boundarySegments,
          boundaryWalls: g.boundaryWalls, occupiedBy: by });
      }
    }
    return { regions: out.slice(0, i.max_results), total: out.length, truncated: out.length > i.max_results };
  },
});
const spatialAdjacencyTool = qry({
  name: "bim_query_spatial_adjacency", title: "Spatial adjacency", permission: "bim.read",
  description: "Derived: which rooms / spaces (same category) share wall boundary segments (with the wall parameter intervals), which spatial elements each door connects (exteriorSide when only one side is bounded) and the regions on each side of windows (boundary only, not navigation).",
  input: z.object({ storey: Ref.optional(), element: z.string().optional().describe("only relations of this spatial element") }),
  run: ({ state: s }, i) => {
    const ctx = new SpatialContext(s);
    const storeys = i.storey ? [storeyOf(s, i.storey).id] : Object.keys(s.storeys).sort();
    const res = storeys.map((st) => ({ storey: st, ...spatialAdjacency(ctx, st) }));
    if (!i.element) return res;
    const has = (x: any) => JSON.stringify(x).includes(`"${i.element}"`);
    return res.map((r) => ({ storey: r.storey, adjacency: r.adjacency.filter(has), doors: r.doors.filter(has), windows: r.windows.filter(has) }));
  },
});


// ================================================================== universal engines (Phase 9)
const createProfileMembers = cmd({
  name: "bim_create_profile_members", title: "Create profile members", permission: "bim.write",
  description: "Create members of ANY profile_member category (structure.framing = beams, structure.column = columns, ...). The category decides the placement: axis categories take start / end and z or target_storey (top follows a storey); vertical categories take at / points, height or top_storey, base_offset, rotation. Same engine, same validation and geometry for every member category.",
  input: z.object({ members: z.array(MemberIn).min(1) }),
  decide: (s, i) => createMembers(s, i.members),
});
const queryStructuralConnectivityTool = qry({
  name: "bim_query_structural_connectivity", title: "Query structural connectivity", permission: "bim.read",
  description: "DERIVED geometric contacts between structural elements, computed now from the current geometry: member endpoint touches another member's endpoint (endpoint_contact) or its axis (endpoint_on_member), a member endpoint lies inside a structural wall (endpoint_in_wall) or inside a structural slab / footing / foundation slab solid (endpoint_in_boundary). Heights come from the storeys. It is NOT a stored joint and NOT an engineering connection design: it never changes the model, and moving an element changes the answer with no event of its own. Optional ids limit the result to relations involving them.",
  input: z.object({ ids: z.array(z.string()).optional(), relation: z.enum(["endpoint_contact", "endpoint_on_member", "endpoint_in_wall", "endpoint_in_boundary"]).optional() }),
  run: ({ state: s }, i) => structuralConnectivity(s, i),
});
// ================================================================ MEP core (Phase 13)
const SystemIn = z.object({ name: z.string().min(1), domain: z.enum(MEP_DOMAINS).describe("piping | hvac | electrical: strict, immutable; decides which categories the system may contain"),
  classification: z.string().min(1).describe("stable semantic string, e.g. domestic_cold_water, sanitary, hydronic_supply, supply_air, return_air, power, data"), description: z.string().optional(), properties: z.record(z.string(), z.unknown()).optional() });
// ================================================================ spatial units (facilities / facility parts) and the coordinate system (Phase 14, Milestone C)
const UnitIn = z.object({ name: z.string().min(1), kind: z.enum(["facility", "facility_part"]),
  ifc_class: z.string().optional().describe("facility: IfcFacility (default) | IfcRoad | IfcRailway | IfcBridge | IfcMarineFacility; part: IfcFacilityPartCommon (default) | IfcRoadPart | IfcRailwayPart | IfcBridgePart | IfcMarinePart"),
  parent: z.string().optional().describe("id or unique name of the parent unit; omit = directly under the site (facilities only)"), long_name: z.string().optional(),
  composition: z.enum(["ELEMENT", "COMPLEX", "PARTIAL"]).default("ELEMENT"), usage: z.string().optional().describe("facility parts: LATERAL | LONGITUDINAL | REGION | VERTICAL | USERDEFINED | NOTDEFINED (default NOTDEFINED)"),
  predefined_type: z.string().optional().describe("a value of the class's IFC enumeration (rejected otherwise; classes without one refuse it)") });
function resolveUnit(s: BimState, ref: string): SpatialUnit {
  const all = Object.values(s.spatialUnits ?? {}), byId = all.find((u) => u.id === ref);
  if (byId) return byId;
  const named = all.filter((u) => u.name.trim().toLowerCase() === ref.trim().toLowerCase());
  if (named.length === 1) return named[0];
  if (named.length > 1) throw new DomainError(`'${ref}' names ${named.length} spatial units (${named.map((u) => `${u.id}: ${unitPath(s, u.id)}`).join("; ")}): use the id.`, "INVALID_INPUT", { field: "parent" });
  throw new DomainError(`Spatial unit '${ref}' not found.`, "RESOURCE_NOT_FOUND", { resourceKind: "spatial_unit", ref });
}
const createSpatialUnitsTool = cmd({
  name: "bim_create_spatial_units", title: "Create spatial units", permission: "bim.write",
  description: "Create the IFC4.3 spatial structure of infrastructure (resources, not elements): facilities (IfcRoad, IfcRailway, IfcBridge, IfcMarineFacility, IfcFacility) directly under the site, and facility parts (IfcRoadPart, IfcRailwayPart, IfcBridgePart, IfcMarinePart, IfcFacilityPartCommon) inside a facility or another part. Infrastructure products are CONTAINED in a unit, never in a building storey. Rules: parents exist, no cycles, parts never directly under the site, a typed part belongs inside its facility class (IfcRoadPart in an IfcRoad ...), names unique among siblings, PredefinedType / usage from the schema enumerations. IFC4.3 only: an export holding units is written as IFC4X3_ADD2.",
  input: z.object({ units: z.array(UnitIn).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const x of i.units) {
      const parent = x.parent === undefined ? null : resolveUnit(s, x.parent).id;
      const u: SpatialUnit = { id: nextId(s, "spatial_unit" as any), name: x.name.trim(), kind: x.kind, ifcClass: x.ifc_class ?? (x.kind === "facility" ? "IfcFacility" : "IfcFacilityPartCommon"), parent, composition: x.composition,
        ...(x.long_name ? { longName: x.long_name } : {}), ...(x.kind === "facility_part" ? { usage: x.usage ?? "NOTDEFINED" } : x.usage !== undefined ? { usage: x.usage } : {}), ...(x.predefined_type ? { predefinedType: x.predefined_type } : {}) };
      (s.spatialUnits ??= {})[u.id] = u; events.push({ type: "SpatialUnitCreated", payload: u });
    }
    events.push(counters(s));
    return { events, summary: { created: events.filter((e) => e.type === "SpatialUnitCreated").map((e: any) => ({ id: e.payload.id, name: e.payload.name, ifcClass: e.payload.ifcClass, parent: e.payload.parent })) } };
  },
});
const unitRow = (s: BimState, u: SpatialUnit) => ({ ...u, path: unitPath(s, u.id), depth: unitAncestors(s, u.id).length, child_ids: unitChildren(s, u.id).map((c) => c.id), root_facility: rootFacility(s, u)?.id ?? null,
  element_ids: Object.values(s.elements).filter((e) => handlersOf(e).container?.(e)?.id === u.id).map((e) => e.id).sort() });
const querySpatialUnitsTool = qry({
  name: "bim_query_spatial_units", title: "Query spatial units", permission: "bim.read",
  description: "Facilities and facility parts with their DERIVED path, depth, children and the infrastructure elements contained in them, ordered by path then id. Filters: kind, ifc_class, parent (id or name: its direct children).",
  input: z.object({ kind: z.enum(["facility", "facility_part"]).optional(), ifc_class: z.string().optional(), parent: z.string().optional() }),
  run: ({ state: s }, i) => { const pid = i.parent === undefined ? undefined : resolveUnit(s, i.parent).id;
    return Object.values(s.spatialUnits ?? {}).filter((u) => (!i.kind || u.kind === i.kind) && (!i.ifc_class || u.ifcClass === i.ifc_class) && (pid === undefined || u.parent === pid)).map((u) => unitRow(s, u)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.id < b.id ? -1 : 1)); },
});
const updateSpatialUnitsTool = cmd({
  name: "bim_update_spatial_units", title: "Update spatial units", permission: "bim.write",
  description: "Edit a unit's name, long_name, composition, usage, predefined_type or parent (null = directly under the site, facilities only). The IFC class and the kind are immutable. Re-parenting is validated against the same hierarchy rules (no cycles, typed parts stay inside their facility class).",
  input: z.object({ items: z.array(z.object({ unit: z.string(), set: z.object({ name: z.string().min(1), long_name: z.string(), composition: z.enum(["ELEMENT", "COMPLEX", "PARTIAL"]), usage: z.string(), predefined_type: z.string(), parent: z.string().nullable() }).partial().strict() })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const it of i.items) {
      const u = resolveUnit(s, it.unit), ch: Record<string, unknown> = {}, set = it.set;
      if (set.name !== undefined) ch.name = set.name.trim();
      if (set.long_name !== undefined) ch.longName = set.long_name;
      if (set.composition !== undefined) ch.composition = set.composition;
      if (set.usage !== undefined) ch.usage = set.usage;
      if (set.predefined_type !== undefined) ch.predefinedType = set.predefined_type;
      if (set.parent !== undefined) ch.parent = set.parent === null ? null : resolveUnit(s, set.parent).id;
      Object.assign(s.spatialUnits[u.id], ch); events.push({ type: "SpatialUnitUpdated", payload: { id: u.id, changes: ch } });
    }
    return { events, summary: { updated: events.map((e: any) => e.payload.id) } };
  },
});
const deleteSpatialUnitsTool = cmd({
  name: "bim_delete_spatial_units", title: "Delete spatial units", permission: "bim.delete", effect: "destructive",
  description: "Delete units that have no child unit and contain no element. A unit in use is refused (RESOURCE_IN_USE); nothing is cascaded.",
  input: z.object({ units: z.array(z.string()).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const ref of i.units) { const u = resolveUnit(s, ref); delete s.spatialUnits[u.id]; events.push({ type: "SpatialUnitDeleted", payload: { id: u.id } }); }
    return { events, summary: { deleted: events.map((e: any) => e.payload.id) } };
  },
});
const CrsIn = z.object({ name: z.string().min(1).describe("e.g. 'EPSG:5254'"), description: z.string().optional(), geodetic_datum: z.string().optional(), vertical_datum: z.string().optional(), map_projection: z.string().optional(), map_zone: z.string().optional() });
const setGeoreferenceTool = cmd({
  name: "bim_set_georeference", title: "Set georeference", permission: "bim.write",
  description: "Place the local project coordinate system (units: metres, radians) in a projected CRS: IfcMapConversion + IfcProjectedCRS. map = scale * R(rotation) * local + (eastings, northings, orthogonal_height); rotation_degrees = the angle of the local X axis counter-clockwise from map East (IfcMapConversion's XAxisAbscissa / XAxisOrdinate are derived: cos / sin). Nothing is looked up or transformed: the CRS is a NAME the file carries; elements keep their local coordinates. Replaces any earlier georeference.",
  input: z.object({ crs: CrsIn, eastings: z.number(), northings: z.number(), orthogonal_height: z.number().default(0), rotation_degrees: z.number().default(0), scale: z.number().default(1) }),
  decide: (_s, i) => {
    const th = (i.rotation_degrees * Math.PI) / 180, rd = (v: number) => Math.round(v * 1e12) / 1e12 + 0;
    const georef: Georeference = { crs: { name: i.crs.name.trim(), ...(i.crs.description ? { description: i.crs.description } : {}), ...(i.crs.geodetic_datum ? { geodeticDatum: i.crs.geodetic_datum } : {}), ...(i.crs.vertical_datum ? { verticalDatum: i.crs.vertical_datum } : {}),
      ...(i.crs.map_projection ? { mapProjection: i.crs.map_projection } : {}), ...(i.crs.map_zone ? { mapZone: i.crs.map_zone } : {}) }, eastings: i.eastings, northings: i.northings, orthogonalHeight: i.orthogonal_height, xAxisAbscissa: rd(Math.cos(th)), xAxisOrdinate: rd(Math.sin(th)), scale: i.scale };
    const why = georefProblem(georef);
    if (why) throw new DomainError(`Georeference: ${why}`, "INVALID_GEOREFERENCE", {});
    return { events: [{ type: "ProjectUpdated", payload: { georef } }], summary: { georef } };
  },
});
const clearGeoreferenceTool = cmd({
  name: "bim_clear_georeference", title: "Clear georeference", permission: "bim.write",
  description: "Remove the project's georeference (the local coordinates stay as they are). GEOREFERENCE_NOT_SET when none exists.",
  input: z.object({}),
  decide: (s) => { if (!s.project.georef) throw new DomainError("The project has no georeference.", "GEOREFERENCE_NOT_SET", {}); return { events: [{ type: "ProjectUpdated", payload: { georef: null } }], summary: { cleared: true } }; },
});
const getCoordinateSystemTool = qry({
  name: "bim_get_coordinate_system", title: "Get coordinate system", permission: "bim.read",
  description: "The project's coordinate semantics: units (metres, radians), the local origin, the georeference with its DERIVED rotation (or null), and the site / spatial structure names.",
  input: z.object({}),
  run: ({ state: s }) => ({ units: { length: LENGTH_UNIT, plane_angle: ANGLE_UNIT }, local_origin: "the project origin (0, 0, 0): storey elevations are z, plan coordinates x / y", georeference: s.project.georef ? { ...s.project.georef, rotation_degrees: georefRotationDegrees(s.project.georef) } : null,
    site: s.project.site, building: s.project.building, spatial_unit_count: Object.keys(s.spatialUnits ?? {}).length }),
});
const convertCoordinatesTool = qry({
  name: "bim_convert_coordinates", title: "Convert coordinates", permission: "bim.read",
  description: "Convert points between the LOCAL project coordinates and the projected map coordinates through the georeference (map = scale * R * local + (E, N, H); z = height). Derived: nothing is stored. GEOREFERENCE_NOT_SET when there is none.",
  input: z.object({ points: z.array(z.tuple([z.number(), z.number()]).or(z.tuple([z.number(), z.number(), z.number()]))).min(1), direction: z.enum(["local_to_map", "map_to_local"]) }),
  run: ({ state: s }, i) => {
    const g = s.project.georef;
    if (!g) throw new DomainError("The project has no georeference.", "GEOREFERENCE_NOT_SET", {});
    return { direction: i.direction, crs: g.crs.name, points: i.points.map((p) => { const q: [number, number, number] = [p[0], p[1], p[2] ?? 0]; return i.direction === "local_to_map" ? toMap(g, q) : toLocal(g, q); }) };
  },
});
const createMepSystemsTool = cmd({
  name: "bim_create_mep_systems", title: "Create MEP systems", permission: "bim.write",
  description: "Create MEP systems (first-class resources, not elements): name, domain (piping | hvac | electrical) and a classification string. Every route element must belong to a system of its category's domain (pipe -> piping, duct -> hvac, cable tray / conduit -> electrical).",
  input: z.object({ systems: z.array(SystemIn).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const x of i.systems) { const sys = { id: nextId(s, "mep_system" as any), name: x.name, domain: x.domain, classification: x.classification, ...(x.description ? { description: x.description } : {}), ...(x.properties ? { properties: x.properties } : {}) };
      s.mepSystems[sys.id] = sys as any; events.push({ type: "MepSystemCreated", payload: sys }); }
    events.push(counters(s));
    return { events, summary: { created: events.filter((e) => e.type === "MepSystemCreated").map((e: any) => ({ id: e.payload.id, name: e.payload.name, domain: e.payload.domain })) } };
  },
});
const querySystemsTool = qry({
  name: "bim_query_mep_systems", title: "Query MEP systems", permission: "bim.read",
  description: "MEP systems ordered by name, id, with DERIVED summaries (element count, total route length, junction count, open connector count, connected components). Filter: domain.",
  input: z.object({ domain: z.enum(MEP_DOMAINS).optional() }),
  run: ({ state: s }, i) => Object.values(s.mepSystems ?? {}).filter((x) => !i.domain || x.domain === i.domain).sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1)).map((x) => ({ ...x, ...systemSummary(s, x.id) })),
});
const getSystemsTool = qry({
  name: "bim_get_mep_systems", title: "Get MEP systems", permission: "bim.read",
  description: "Details of MEP systems by id or name: the system, derived summary and what uses it (resource usage).",
  input: z.object({ systems: z.array(Ref2).min(1) }),
  run: ({ state: s }, i) => i.systems.map((ref) => { const x = s.mepSystems[findResource(s, "mep_system", ref).id]; return { ...x, ...systemSummary(s, x.id), usage: resourceUsage(s, "mep_system", x.id) }; }),
});
const updateSystemsTool = cmd({
  name: "bim_update_mep_systems", title: "Update MEP systems", permission: "bim.write",
  description: "Edit a system's name, classification, description or properties. The domain is immutable.",
  input: z.object({ items: z.array(z.object({ system: Ref2, set: z.object({ name: z.string().min(1), classification: z.string().min(1), description: z.string(), properties: z.record(z.string(), z.unknown()) }).partial().strict() })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const it of i.items) { const x = findResource(s, "mep_system", it.system); Object.assign(s.mepSystems[x.id], structuredClone(it.set)); events.push({ type: "MepSystemUpdated", payload: { id: x.id, changes: it.set } }); }
    return { events, summary: { updated: events.map((e: any) => e.payload.id) } };
  },
});
const deleteSystemsTool = cmd({
  name: "bim_delete_mep_systems", title: "Delete MEP systems", permission: "bim.delete", effect: "destructive",
  description: "Delete systems no route element uses. A system in use is refused (RESOURCE_IN_USE); nothing is cascaded.",
  input: z.object({ systems: z.array(Ref2).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const ref of i.systems) { const x = findResource(s, "mep_system", ref); delete s.mepSystems[x.id]; events.push({ type: "MepSystemDeleted", payload: { id: x.id } }); }
    return { events, summary: { deleted: events.map((e: any) => e.payload.id) } };
  },
});
const SegmentIn = z.object({ category: z.string().describe("plumbing.pipe | mechanical.duct | electrical.cable_tray | electrical.conduit"), type: Ref, system: Ref.describe("an existing MEP system of the category's domain (required)"),
  route: z.array(RoutePointIn).describe("storey-aware 3D polyline, >= 2 points; each point { storey, at: [x, y], offset } (world z = storey elevation + offset); cross-storey routes are valid"), name: z.string().optional() });
type SegmentInput = z.infer<typeof SegmentIn>;
function createMepSegments(s: BimState, items: SegmentInput[]): Decision {
  const events: Decision["events"] = [];
  for (const it of items) {
    const c = engineCategory(it.category, "mep_network"), type = typeForCategory(s, c, it.type), sys = findResource(s, "mep_system", it.system);
    const route = (it.route ?? []).map((q) => ({ storey: storeyOf(s, q.storey).id, at: q.at, offset: q.offset ?? 0 }));
    const el = { id: nextId(s, idKeyOf(c)), kind: "mep_segment" as const, category: c.id, storey: route[0]?.storey, type: type.id, system: sys.id, route, ...(it.name ? { name: it.name } : {}) };
    events.push({ type: "ElementCreated", payload: el });
    s.elements[el.id] = el as any;
  }
  events.push(counters(s));
  return { events, summary: { created: events.filter((e) => e.type === "ElementCreated").map((e: any) => ({ id: e.payload.id, category: e.payload.category })) } };
}
const createMepSegmentsTool = cmd({
  name: "bim_create_mep_segments", title: "Create MEP route elements", permission: "bim.write",
  description: "Canonical creation of MEP route elements on the mep_network engine: category (plumbing.pipe | mechanical.duct | electrical.cable_tray | electrical.conduit), a type of that category, an existing system of the category's domain, and a storey-aware 3D route (>= 2 points { storey, at: [x, y], offset }; world z = storey elevation + offset; horizontal, sloped, vertical risers and cross-storey routes). Each route exposes the connectors 'start' and 'end'. Creating a route connects nothing: touching ends are NOT connected (bim_connect_mep).",
  input: z.object({ segments: z.array(SegmentIn).min(1) }),
  decide: (s, i) => createMepSegments(s, i.segments),
});
const FittingIn = z.object({ category: z.string().describe("plumbing.pipe_fitting | mechanical.duct_fitting | electrical.cable_carrier_fitting | electrical.cable_fitting"), type: Ref.describe("a fitting type (bim_create_types kind mep_fitting) of the category's domain"),
  system: Ref.describe("an existing MEP system of that domain (required)"), storey: Ref, at: z.tuple([z.number(), z.number()]).describe("origin [x, y], m"), offset: z.number().default(0).describe("elevation of the origin above the storey, m"),
  rotation: z.number().default(0).describe("yaw about Z, degrees (the run points along +X at 0)"), pitch: z.number().default(0).describe("pitch about the local Y, degrees"), roll: z.number().default(0).describe("roll about the run axis, degrees"), name: z.string().optional() });
function createMepFittings(s: BimState, items: z.infer<typeof FittingIn>[]): Decision {
  const events: Decision["events"] = [];
  for (const it of items) {
    const c = engineCategory(it.category, "mep_fitting"), type = typeForCategory(s, c, it.type), sys = findResource(s, "mep_system", it.system), st = storeyOf(s, it.storey);
    const el = { id: nextId(s, idKeyOf(c)), kind: "mep_fitting" as const, category: c.id, storey: st.id, type: type.id, system: sys.id, at: it.at, offset: it.offset, rotation: it.rotation, pitch: it.pitch, roll: it.roll, ...(it.name ? { name: it.name } : {}) };
    events.push({ type: "ElementCreated", payload: el });
    s.elements[el.id] = el as any;
  }
  events.push(counters(s));
  return { events, summary: { created: events.filter((e) => e.type === "ElementCreated").map((e: any) => ({ id: e.payload.id, category: e.payload.category })) } };
}
const createMepFittingsTool = cmd({
  name: "bim_create_mep_fittings", title: "Create MEP fittings", permission: "bim.write",
  description: "Create fitting PRODUCTS (elbow, tee, cross, reducer, transition, coupling) on the mep_fitting engine: a category (pipe / duct / cable carrier / cable fitting), a fitting type, an existing system of the same domain, and a point placement (storey, at, offset, yaw / pitch / roll). The connectors (inlet, outlet, branch / branch_a / branch_b) and the geometry (swept, revolved, tapered solids) are DERIVED from the type's parameters; query them with bim_query_mep_connectors and join them to routes with bim_connect_mep (junctions stay the explicit connectivity: a fitting is a product, a junction is the relationship). Local frame: the run is along +X, the inlet at the origin facing -X.",
  input: z.object({ fittings: z.array(FittingIn).min(1) }),
  decide: (s, i) => createMepFittings(s, i.fittings),
});
const RebarIn = z.object({ category: z.string().default("structure.rebar_set").describe("structure.rebar_set (bars) | structure.rebar_mesh (exactly two crossing layers) | structure.tendon | structure.tendon_conduit (one path, count 1)"),
  layout:z.object({kind:z.literal('rectangular_column'),role:z.enum(['longitudinal','stirrups']),mainType:z.string(),tieType:z.string(),spacing:z.number().positive()}).strict().optional(),
  geometry_validation: z.literal('rectangular_column').optional().describe('Enforce bar-surface cover containment in an upright rectangular column on creation and every dependent edit'),
  type: Ref.describe("a reinforcement type (bim_create_types kind rebar)"), host: z.string().describe("the HOST element id: a column, beam, shear wall, structural slab, footing or foundation slab (explicit: never inferred); the storey is the host's"),
  layers: z.array(BarLayerIn).min(1), bend_radius: z.number().positive().optional().describe("rounds every interior corner of the path with this radius, m"), cover: z.number().min(0).default(0.025).describe("concrete cover, m (a recorded intent: not checked against the host)"), name: z.string().optional() });
const createReinforcementTool = cmd({
  name: "bim_create_reinforcement", title: "Create reinforcement", permission: "bim.write",
  description: "Create reinforcement bound to an explicit HOST: bar sets (IfcReinforcingBar: a bar path + count / spacing / direction), meshes (two crossing layers), tendons and tendon conduits (one path). Bars, their lengths and volumes are DERIVED; coordinates are storey-local [x, y, z] (m). Reinforcement follows its host when the host moves and keeps it from being deleted (ELEMENT_IN_USE). No code checks or reinforcement design.",
  input: z.object({ items: z.array(RebarIn).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const it of i.items) {
      const c = engineCategory(it.category, "reinforcement"), type = typeForCategory(s, c, it.type), host = s.elements[it.host];
      if (!host) throw new DomainError(`Host ${it.host} not found.`, "ELEMENT_NOT_FOUND", { elementId: it.host });
      const el = { id: nextId(s, idKeyOf(c)), kind: "reinforcement" as const, category: c.id, storey: host.storey, type: type.id, host: host.id, layers: it.layers, ...(it.bend_radius ? { bendRadius: it.bend_radius } : {}), cover: it.cover, ...(it.geometry_validation ? { geometryValidation: it.geometry_validation } : {}), ...(it.name ? { name: it.name } : {}) };
      if(it.layout)Object.assign(el,{layout:it.layout});
      events.push({ type: "ElementCreated", payload: el }); s.elements[el.id] = el as any;
    }
    events.push(counters(s));
    return { events, summary: { created: events.filter((e) => e.type === "ElementCreated").map((e: any) => ({ id: e.payload.id, category: e.payload.category, host: e.payload.host })) } };
  },
});
const createAssembliesTool = cmd({
  name: "bim_create_assemblies", title: "Create assemblies", permission: "bim.write",
  description: "Aggregate EXISTING elements into an assembly (IfcElementAssembly: truss, frame, prefabricated / precast unit, facade module, reinforcement cage ...). The members keep their own identity, category, type and lifecycle; the assembly adds only the relation. Rules: >= 1 member, all on one storey (the assembly's), at most ONE parent per member, acyclic, no openings / hosted components / spaces as members. An assembly moves its members; deleting a member is refused while it is in an assembly (ELEMENT_IN_USE); deleting the assembly releases them. predefined_type is checked against the IFC enumeration (bim_get_category_capabilities).",
  input: z.object({ items: z.array(z.object({ category: z.string().default("generic.element_assembly"), children: z.array(z.string()).min(1), primary:z.string().optional(), name: z.string().optional(), predefined_type: z.string().optional() })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const it of i.items) {
      const c = engineCategory(it.category, "assembly"), first = s.elements[it.children[0]];
      if (!first) throw new DomainError(`Member ${it.children[0]} not found.`, "ELEMENT_NOT_FOUND", { elementId: it.children[0] });
      const el = { id: nextId(s, idKeyOf(c)), kind: "assembly" as const, category: c.id, storey: first.storey, children: it.children, ...(it.primary?{primary:it.primary}:{}), ...(it.name ? { name: it.name } : {}), ...(it.predefined_type ? { predefinedType: it.predefined_type } : {}) };
      events.push({ type: "ElementCreated", payload: el }); s.elements[el.id] = el as any;
    }
    events.push(counters(s));
    return { events, summary: { created: events.filter((e) => e.type === "ElementCreated").map((e: any) => ({ id: e.payload.id, members: e.payload.children })) } };
  },
});
const mepWrapper = (name: string, title: string, category: string, key: string, extra: string) => cmd({
  name, title, permission: "bim.write",
  description: `Create ${title.toLowerCase().replace("create ", "")} (${category}): thin adapter of bim_create_mep_segments. ${extra} Needs a type of that kind and an existing system of the right domain; storey-aware 3D route { storey, at: [x, y], offset }.`,
  input: z.object({ [key]: z.array(SegmentIn.omit({ category: true })).min(1) } as Record<string, z.ZodTypeAny>),
  decide: (s, i: any) => createMepSegments(s, (i[key] as any[]).map((x) => ({ ...x, category }))),
});
const mepWrappers = [mepWrapper("bim_create_pipes", "Create pipes", "plumbing.pipe", "pipes", "Piping domain."), mepWrapper("bim_create_ducts", "Create ducts", "mechanical.duct", "ducts", "HVAC domain."),
  mepWrapper("bim_create_cable_trays", "Create cable trays", "electrical.cable_tray", "cable_trays", "Electrical domain."), mepWrapper("bim_create_conduits", "Create conduits", "electrical.conduit", "conduits", "Electrical domain.")];
const ConnectorRefIn = z.object({ element: z.string().describe("element id"), connector: z.string().describe("'start' | 'end' for route elements; the definition key for components") });
const queryConnectorsTool = qry({
  name: "bim_query_mep_connectors", title: "Query MEP connectors", permission: "bim.read",
  description: "Connectors of route elements (start / end) and of components with connector definitions: DERIVED world position and outward direction, domain, flow, shape / size, the system (routes), the junction they belong to and what they are connected to. Filters: element, system, open_only (unconnected connectors). Positions are never stored: they follow storeys, routes and component placements.",
  input: z.object({ element: z.string().optional(), system: Ref.optional(), open_only: z.boolean().default(false) }),
  run: ({ state: s }, i) => {
    const sys = i.system ? findResource(s, "mep_system", i.system).id : undefined;
    return Object.values(s.elements).sort((a, b) => (a.id < b.id ? -1 : 1)).filter((e) => (!i.element || e.id === i.element) && (!sys || (e.kind === "mep_segment" && e.system === sys))).flatMap((e) => connectorsOf(s, e).map((c) => {
      const j = junctionOf(s, c.ref);
      return { ...c.ref, category: (e as { category?: string }).category ?? null, owner: c.owner, domain: c.domain, position: c.position, direction: c.direction, flow: c.flow, shape: c.shape,
        ...(c.shape === "round" ? { diameter: c.diameter } : { width: c.width, height: c.height }), ...(c.system ? { system: c.system } : {}), junction: j?.id ?? null,
        connected_to: j ? sortRefs(j.members.filter((m) => !(m.element === c.ref.element && m.connector === c.ref.connector))) : [] };
    })).filter((c) => !i.open_only || c.junction === null);
  },
});
const connectMepTool = cmd({
  name: "bim_connect_mep", title: "Connect MEP connectors", permission: "bim.write",
  description: "Explicitly connect >= 2 connectors at one physical point into a junction (2 = coupling / elbow-like, 3 = tee, 4 = cross). Touching is never connected. They must share the domain, shape and size, the same system (route elements) and not be strictly out -> out; all must lie within the join tolerance of each other (nothing is snapped or moved). A connector belongs to at most one junction: adding to an existing junction extends it; joining two existing junctions is refused (MEP_JUNCTION_MERGE_UNSUPPORTED). A junction is semantic connectivity, not a fitting product.",
  input: z.object({ connectors: z.array(ConnectorRefIn).min(2) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    const given = i.connectors as ConnectorRef[];
    const existing = [...new Set(given.map((m) => junctionOf(s, m)?.id).filter((x): x is string => !!x))].sort();
    if (existing.length > 1) throw new DomainError(`these connectors already belong to different junctions (${existing.join(", ")}); merging junctions is not supported: disconnect first.`, "MEP_JUNCTION_MERGE_UNSUPPORTED", { junctionIds: existing.join(",") });
    const base = existing[0] ? s.mepJunctions[existing[0]].members : [];
    const members = sortRefs([...base, ...given.filter((m) => !base.some((b) => sameRef(b, m)))]);
    if (existing[0] && members.length === base.length) throw new DomainError(`all these connectors are already in junction ${existing[0]}.`, "INVALID_INPUT", { junctionId: existing[0] });
    const problem = junctionProblem(s, members);
    if (problem) throw new DomainError(problem.message, problem.reason, problem.details as ErrorDetails);
    if (existing[0]) { s.mepJunctions[existing[0]].members = members; events.push({ type: "MepJunctionUpdated", payload: { id: existing[0], members } }); }
    else { const j = { id: nextId(s, "mep_junction" as any), members }; s.mepJunctions[j.id] = j; events.push({ type: "MepJunctionCreated", payload: { junction: j } }, counters(s)); }
    const id = existing[0] ?? Object.keys(s.mepJunctions).sort().pop()!;
    return { events, summary: { junction: id, members, kind: junctionKind(members.length) } };
  },
});
const disconnectMepTool = cmd({
  name: "bim_disconnect_mep", title: "Disconnect MEP connectors", permission: "bim.write", effect: "destructive",
  description: "Remove connectivity deterministically: give junction (delete that whole junction) and / or connectors (remove each from its junction; a junction left with fewer than 2 members is deleted). Elements are never moved or deleted.",
  input: z.object({ junction: z.string().optional(), connectors: z.array(ConnectorRefIn).optional() }),
  decide: (s, i) => {
    if (!i.junction && !i.connectors?.length) throw new DomainError("Give junction or connectors.", "INVALID_INPUT", { field: "junction" });
    const events: Decision["events"] = [], removed: string[] = [], reduced: string[] = [];
    const drop = (id: string) => { delete s.mepJunctions[id]; events.push({ type: "MepJunctionDeleted", payload: { id } }); removed.push(id); };
    if (i.junction) { if (!s.mepJunctions[i.junction]) throw new DomainError(`junction ${i.junction} does not exist.`, "MEP_CONNECTOR_NOT_FOUND", { junctionId: i.junction }); drop(i.junction); }
    for (const m of (i.connectors ?? []) as ConnectorRef[]) {
      const j = junctionOf(s, m);
      if (!j) { if (i.junction) continue; throw new DomainError(`${refKey(m)} is not connected.`, "MEP_CONNECTOR_NOT_FOUND", { elementId: m.element, connector: m.connector }); }
      const rest = j.members.filter((x) => !sameRef(x, m));
      if (rest.length < 2) drop(j.id); else { j.members = rest; events.push({ type: "MepJunctionUpdated", payload: { id: j.id, members: rest } }); reduced.push(j.id); }
    }
    return { events, summary: { deleted_junctions: removed, reduced_junctions: [...new Set(reduced)] } };
  },
});
const queryNetworkTool = qry({
  name: "bim_query_mep_network", title: "Query MEP network", permission: "bim.read",
  description: "The semantic network graph, DERIVED from explicit junctions and walked at CONNECTOR level. Three distinct modes: `system` (all that system's routes, its junctions only; shared equipment is an endpoint device, never a bridge into another system), `element` (everything reachable from all of that element's connectors) and `connector` (reachability from that exact { element, connector }; the equipment's other connectors are NOT followed). Selectors are validated: element + connector must name the same element; system + a route element / connector of another system is refused; system + element / connector restricts the walk to that system's junctions. Returns elements, junctions (coupling | tee | cross, with their system), connected components, open connectors (valid during authoring), connector-level adjacency and, for element / connector starts, a deterministic breadth-first traversal (elements and connectors; branches and cycles safe; ids sorted).",
  input: z.object({ system: Ref.optional(), element: z.string().optional(), connector: ConnectorRefIn.optional() }),
  run: ({ state: s }, i) => {
    if (!i.system && !i.element && !i.connector) throw new DomainError("Give system, element or connector.", "INVALID_INPUT", { field: "system" });
    if (i.connector && i.element && i.connector.element !== i.element) throw new DomainError(`element ${i.element} and connector.element ${i.connector.element} name different elements: give one start.`, "INVALID_INPUT", { field: "connector" });
    const sys = i.system ? findResource(s, "mep_system", i.system).id : undefined, el = i.connector?.element ?? i.element;
    if (el && !s.elements[el]) throw new DomainError(`element ${el} does not exist.`, "ELEMENT_NOT_FOUND", { elementId: el });
    if (i.connector && !resolveConnector(s, i.connector)) throw new DomainError(`element ${i.connector.element} has no connector '${i.connector.connector}'.`, "MEP_CONNECTOR_NOT_FOUND", { elementId: i.connector.element, connector: i.connector.connector });
    const startEl = el ? s.elements[el] : undefined;
    if (sys && startEl?.kind === "mep_segment" && startEl.system !== sys) throw new DomainError(`${el} belongs to system ${startEl.system}, not ${sys}: the selectors conflict.`, "INVALID_INPUT", { field: "system" });
    return { ...(sys ? { system: sys } : {}), ...mepNetwork(s, { system: sys, element: i.connector ? undefined : i.element, connector: i.connector }) };
  },
});
const createBracesTool = cmd({
  name: "bim_create_braces", title: "Create braces", permission: "bim.write",
  description: "Create structural braces (structure.brace) between two storey-aware 3D endpoints: `storey` + start [x, y] + start_offset (m above that storey), and end [x, y] + end_storey (default: the same) + end_offset (m above ITS storey). The world heights follow the storey elevations (moving a level reshapes the brace without any event). Any non-zero 3D axis is valid; coincident endpoints are refused. Thin adapter of bim_create_profile_members.",
  input: z.object({ braces: z.array(MemberIn.omit({ category: true, at: true, points: true, height: true, top_storey: true, base_offset: true, z: true, target_storey: true, length: true })).min(1) }),
  decide: (s, i) => createMembers(s, i.braces.map((x) => ({ ...x, category: "structure.brace", base_offset: 0 })) as unknown as MemberInput[]),          // adapter: profile_member engine
});
const createPilesTool = cmd({
  name: "bim_create_piles", title: "Create piles", permission: "bim.write",
  description: "Create downward vertical structural piles (structure.pile) from a storey-relative top point: `storey`, at [x, y] (or points), base_offset (the pile top above that storey, m) and length (m, hangs DOWN from the top). A pile is not a column: its category and direction cannot change. Thin adapter of bim_create_profile_members.",
  input: z.object({ piles: z.array(MemberIn.omit({ category: true, start: true, end: true, z: true, target_storey: true, height: true, top_storey: true, start_offset: true, end_storey: true, end_offset: true }).extend({ length: z.number().positive() })).min(1) }),
  decide: (s, i) => createMembers(s, i.piles.map((x) => ({ ...x, category: "structure.pile" })) as unknown as MemberInput[]),
});
const FootingIn = z.object({ storey: z.string(), type: z.string().describe("a footing type (bim_create_types kind footing: footing_kind pad | strip)"), name: z.string().optional(),
  center: z.tuple([z.number(), z.number()]).optional().describe("pad footing: centre [x, y], m"), length: z.number().positive().optional().describe("pad: size along its local X, m"), width: z.number().positive().optional().describe("pad: size along its local Y, m"),
  rotation: z.number().default(0).describe("pad: degrees CCW"), outline: z.array(z.tuple([z.number(), z.number()])).min(3).optional().describe("explicit footprint polygon (pad or strip); strip footings are given as an explicit outline"),
  holes: z.array(z.array(z.tuple([z.number(), z.number()])).min(3)).default([]), offset: z.number().default(0).describe("reference level above the storey; the footing hangs DOWN from it") });
const createFootingsTool = cmd({
  name: "bim_create_footings", title: "Create footings", permission: "bim.write",
  description: "Create structural footings (structure.footing, boundary semantics). Pad footing: centre + length + width + rotation, normalised to a rectangular footprint; or any footprint as an explicit outline (how strip footings are given). Pad / strip is decided by the TYPE (footing_kind), never by the polygon. The footing hangs DOWN from `offset` above the storey by its layered thickness. Thin adapter of bim_create_boundaries.",
  input: z.object({ footings: z.array(FootingIn).min(1) }),
  decide: (s, i) => createBoundaries(s, i.footings.map((f) => {
    let outline = f.outline as [number, number][] | undefined;
    if (!outline) {
      if (!f.center || f.length === undefined || f.width === undefined) throw new DomainError("Give center + length + width (pad) or an explicit outline.", "INVALID_GEOMETRY", { field: "outline" });
      const a = (f.rotation * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a), hl = f.length / 2, hw = f.width / 2;
      outline = ([[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]] as [number, number][]).map(([x, y]) => [r(f.center![0] + x * c - y * sn, 6), r(f.center![1] + x * sn + y * c, 6)] as [number, number]);
    }
    return { category: "structure.footing", storey: f.storey, type: f.type, name: f.name, outline, holes: f.holes, offset: f.offset } as BoundaryInput;
  })),
});
const createStairsTool = cmd({
  name: "bim_create_stairs", title: "Create stairs", permission: "bim.write",
  description: "Create straight-run stairs (architecture.stair): a walking line (start = first riser, end = last riser), width, riser_count (N risers, N - 1 treads) and a StairType (kind stair: max_riser, min_tread). The total rise follows the storeys: by default the next storey above (top_storey to choose another, or height for a fixed rise), minus base_offset; when a level moves the riser height follows, the riser count never changes by itself. The type's limits are validated (STAIR_TYPE_LIMIT_EXCEEDED). Treads and risers are derived, not stored.",
  input: z.object({ stairs: z.array(StairIn).min(1) }),
  decide: (s, i) => createStairs(s, i.stairs),
});
const RampIn = z.object({ category: z.string().default("architecture.ramp_flight"), storey: z.string(), type: z.string(), name: z.string().optional(),
  start: z.tuple([z.number(), z.number()]).describe("walking line start (low end)"), end: z.tuple([z.number(), z.number()]).describe("walking line end (high end)"),
  width: z.number().optional().describe("default: the type's defaultWidth"), rise: z.number().positive().describe("vertical rise of the walking surface over the run, m"), base_offset: z.number().default(0).describe("elevation of the walking surface at the start, above the storey") });
function createRamps(s: BimState, items: z.infer<typeof RampIn>[]): Decision {
  const events: Decision["events"] = [];
  for (const it of items) {
    const c = engineCategory(it.category, "ramp_flight"), st = storeyOf(s, it.storey), type = typeForCategory(s, c, it.type) as RampType, width = it.width ?? type.defaultWidth;
    if (width === undefined) throw new DomainError(`Give a width: type ${type.name} has no default width.`, "INVALID_RAMP_GEOMETRY", { field: "width" });
    const el = { id: nextId(s, idKeyOf(c)), kind: "ramp" as const, category: c.id, storey: st.id, type: type.id, ...(it.name ? { name: it.name } : {}), start: it.start, end: it.end, width, baseOffset: it.base_offset, rise: it.rise };
    events.push({ type: "ElementCreated", payload: el }); s.elements[el.id] = el as any;
  }
  events.push(counters(s));
  return { events, summary: { created: events.filter((e) => e.type === "ElementCreated").map((e: any) => ({ id: e.payload.id, category: e.payload.category })) } };
}
const createRampsTool = cmd({
  name: "bim_create_ramps", title: "Create ramp flights", permission: "bim.write",
  description: "Create straight ramp flights (architecture.ramp_flight, IfcRampFlight): a walking line, width, the rise over that run and the base elevation; the RampType (kind ramp: max_slope = rise / run, thickness) is the slope limit (RAMP_TYPE_LIMIT_EXCEEDED). Run, length, slope and the sloped slab are derived. Join several flights + landings into one ramp with bim_create_assemblies (category architecture.ramp_assembly: continuity of elevation and position is checked).",
  input: z.object({ ramps: z.array(RampIn).min(1) }),
  decide: (s, i) => createRamps(s, i.ramps),
});
const CurtainIn = z.object({ category: z.string().default("architecture.curtain_wall"), storey: z.string(), type: z.string(), name: z.string().optional(),
  start: z.tuple([z.number(), z.number()]), end: z.tuple([z.number(), z.number()]), height: z.number().positive(), base_offset: z.number().default(0),
  u_divisions: z.number().int().min(1).optional().describe("explicit number of columns (default: ceil(length / the type's maxPanelWidth))"), v_divisions: z.number().int().min(1).optional().describe("explicit number of rows (default: ceil(height / maxPanelHeight))") });
const createCurtainWallsTool = cmd({
  name: "bim_create_curtain_walls", title: "Create curtain walls", permission: "bim.write",
  description: "Create curtain-wall assemblies (architecture.curtain_wall, IfcCurtainWall) on a straight axis: base elevation, height and optionally an explicit grid. The CurtainWallType (kind curtain_wall) carries the maximum cell size, the mullion / transom sections and the panel thickness. The grid, the mullions, the transoms and the panels are DERIVED with stable ids (<id>.M<i>, <id>.T<i>.<j>, <id>.P<i>.<j>); bim_get_element lists them. IFC: an IfcCurtainWall aggregating IfcPlate (CURTAIN_PANEL) and IfcMember (MULLION / TRANSOM). Not modelled: per-panel overrides (doors, louvres), curved axes, anchors.",
  input: z.object({ walls: z.array(CurtainIn).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const it of i.walls) {
      const c = engineCategory(it.category, "curtain_wall"), st = storeyOf(s, it.storey), type = typeForCategory(s, c, it.type);
      const el = { id: nextId(s, idKeyOf(c)), kind: "curtain_wall" as const, category: c.id, storey: st.id, type: type.id, ...(it.name ? { name: it.name } : {}), start: it.start, end: it.end, baseOffset: it.base_offset, height: it.height,
        ...(it.u_divisions ? { uDivisions: it.u_divisions } : {}), ...(it.v_divisions ? { vDivisions: it.v_divisions } : {}) };
      events.push({ type: "ElementCreated", payload: el }); s.elements[el.id] = el as any;
    }
    events.push(counters(s));
    return { events, summary: { created: events.filter((e) => e.type === "ElementCreated").map((e: any) => ({ id: e.payload.id, category: e.payload.category })) } };
  },
});
const PitchedRoofIn = z.object({ category: z.string().default("architecture.pitched_roof"), storey: z.string(), type: z.string().describe("a layered ROOF type (bim_create_types kind roof): its layers give the thickness"), name: z.string().optional(),
  outline: z.array(z.tuple([z.number(), z.number()])).length(4).describe("the footprint: a RECTANGLE (4 corners in order, any orientation)"), form: z.enum(["gable", "hip"]),
  ridge: z.enum(["long", "short"]).default("long").describe("the ridge runs along the long / short side (a hip roof needs 'long')"), pitch: z.number().describe("degrees, (0, 80]"), overhang: z.number().min(0).default(0).describe("eave overhang beyond the footprint, m"),
  offset: z.number().default(0).describe("elevation of the eaves above the storey, m") });
const createPitchedRoofsTool = cmd({
  name: "bim_create_pitched_roofs", title: "Create pitched roofs", permission: "bim.write",
  description: "Create gable or hip roofs (architecture.pitched_roof, IfcRoof) on a RECTANGULAR footprint: form, pitch, the side the ridge runs along, overhang and eave elevation; the layered roof type gives the thickness. The planes, ridge, hips and eaves are DERIVED with stable plane ids (<id>.R<k>); quantities report plane areas, ridge / hip / eave lengths and the ridge height. IFC: an IfcRoof (GABLE_ROOF | HIP_ROOF) aggregating one IfcSlab ROOF per plane. NOT supported: valleys, L / T / general footprints, roof openings, dormers; flat and mono-pitch roofs stay with bim_create_boundaries (architecture.roof).",
  input: z.object({ roofs: z.array(PitchedRoofIn).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const it of i.roofs) {
      const c = engineCategory(it.category, "pitched_roof"), st = storeyOf(s, it.storey), type = typeForCategory(s, c, it.type);
      const el = { id: nextId(s, idKeyOf(c)), kind: "pitched_roof" as const, category: c.id, storey: st.id, type: type.id, ...(it.name ? { name: it.name } : {}), outline: it.outline, form: it.form, ridge: it.ridge, pitch: it.pitch, overhang: it.overhang, offset: it.offset };
      events.push({ type: "ElementCreated", payload: el }); s.elements[el.id] = el as any;
    }
    events.push(counters(s));
    return { events, summary: { created: events.filter((e) => e.type === "ElementCreated").map((e: any) => ({ id: e.payload.id, category: e.payload.category })) } };
  },
});
const createPathElementsTool = cmd({
  name: "bim_create_path_elements", title: "Create path elements", permission: "bim.write",
  description: "Create elements of ANY path-engine category (architecture.railing, ...): an open or closed polyline, a base offset above the storey and a height; the type decides the derived posts and rails. Zero-length segments (duplicate adjacent vertices) are refused.",
  input: z.object({ elements: z.array(PathIn).min(1) }),
  decide: (s, i) => createPathElements(s, i.elements),
});
const createRailingsTool = cmd({
  name: "bim_create_railings", title: "Create railings", permission: "bim.write",
  description: "Convenience for bim_create_path_elements with category architecture.railing (RailingType: kind railing). Posts are derived from the path and the type's max_post_spacing; nothing but the path, offset and height is stored.",
  input: z.object({ railings: z.array(PathIn.omit({ category: true })).min(1) }),
  decide: (s, i) => createPathElements(s, i.railings.map((x) => ({ ...x, category: "architecture.railing" }))),          // adapter: path engine
});
const createBoundariesTool = cmd({
  name: "bim_create_boundaries", title: "Create boundary elements", permission: "bim.write",
  description: "Create elements of ANY boundary category (architecture.floor = slabs): an outline polygon with optional holes, extruded down from offset (top above the storey) by the layered type.",
  input: z.object({ boundaries: z.array(BoundaryIn).min(1) }),
  decide: (s, i) => createBoundaries(s, i.boundaries),
});
const listEnginesTool = qry({
  name: "bim_list_engines", title: "List engines", permission: "bim.read",
  description: "The behaviour engines (implemented, internal, reserved) with their placements, representations, compatible type families and supported operations, and which categories use each.",
  input: z.object({}),
  run: () => listEngines().map((e) => ({ ...e, categories: listCategories().filter((c) => c.engine === e.id).map((c) => c.id) })),
});
const getEngineTool = qry({
  name: "bim_get_engine", title: "Get engine", permission: "bim.read",
  description: "One engine by id (e.g. profile_member).",
  input: z.object({ id: z.string() }),
  run: (_c, i) => {
    const e = findEngine(i.id);
    if (!e) throw new DomainError(`Unknown engine '${i.id}'.`, "UNKNOWN_ENGINE", { engineId: i.id });
    return { ...e, categories: listCategories().filter((c) => c.engine === e.id).map((c) => c.id) };
  },
});

// ---------------------------------------------------------------- grids
const updateGrids = cmd({
  name: "bim_update_grids", title: "Update grids", permission: "bim.write",
  description: "Rename grid lines or move their end points. Editable: name, start, end.",
  input: z.object({ items: z.array(z.object({ grid: Ref2, set: z.object({ name: z.string(), start: P2s, end: P2s }).partial().catchall(z.unknown()) })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const it of i.items) {
      const g = findResource(s, "grid", it.grid);
      patchFields(it.set, ["name", "start", "end"], { resourceKind: "grid", resourceId: g.id });
      const changes: Record<string, unknown> = {};
      if (it.set.name !== undefined) changes.name = normalizeName(String(it.set.name));
      if (it.set.start !== undefined) changes.start = it.set.start;
      if (it.set.end !== undefined) changes.end = it.set.end;
      Object.assign(s.grids[g.id], changes);
      events.push({ type: "GridUpdated", payload: { id: g.id, changes } });
    }
    return { events, summary: { updated: events.map((e: any) => e.payload.id) } };
  },
});
const deleteGrids = cmd({
  name: "bim_delete_grids", title: "Delete grids", permission: "bim.delete", effect: "destructive",
  description: "Delete grid lines (nothing in the model depends on grids today).",
  input: z.object({ grids: z.array(Ref2).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const ref of i.grids) {
      const g = findResource(s, "grid", ref);
      delete s.grids[g.id];
      events.push({ type: "GridDeleted", payload: { id: g.id } });
    }
    return { events, summary: { deleted: events.map((e: any) => e.payload.id) } };
  },
});

// ---------------------------------------------------------------- materials
const Color = z.string().describe("'#rrggbb'");
const createMaterials = cmd({
  name: "bim_create_materials", title: "Create materials", permission: "bim.write",
  description: "Create semantic materials (name unique; optional color/category) with an optional separate PBR appearance linked to the material id. Appearance supports baseColor, opacity, metallic, roughness, metric textureSize and project texture asset references.",
  input: z.object({ materials: z.array(z.object({ name: z.string(), color: Color.optional(), category: z.string().optional(), appearance: AppearanceSchema.nullable().optional() })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const m0 of i.materials) {
      const m = { id: nextId(s, "material"), name: normalizeName(m0.name), ...(m0.color !== undefined ? { color: m0.color } : {}),
                  ...(m0.category !== undefined ? { category: m0.category.trim() } : {}), ...(m0.appearance !== undefined ? { appearance: m0.appearance } : {}) };
      s.materials[m.id] = m;
      events.push({ type: "MaterialCreated", payload: m });
    }
    events.push(counters(s));
    return { events, summary: { created: events.filter((e) => e.type === "MaterialCreated").map((e: any) => e.payload.id) } };
  },
});
const updateMaterials = cmd({
  name: "bim_update_materials", title: "Update materials", permission: "bim.write",
  description: "Update semantic material fields or its separate PBR appearance. Types keep stable material ids. Editable: name, color, category, appearance (null clears appearance). Asset references come from material_import.",
  input: z.object({ items: z.array(z.object({ material: Ref2, set: z.object({ name: z.string(), color: Color, category: z.string(), appearance: AppearanceSchema.nullable() }).partial().catchall(z.unknown()) })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const it of i.items) {
      const m = findResource(s, "material", it.material);
      patchFields(it.set, ["name", "color", "category", "appearance"], { resourceKind: "material", resourceId: m.id });
      const changes: Record<string, unknown> = {};
      if (it.set.name !== undefined) changes.name = normalizeName(String(it.set.name));
      if (it.set.color !== undefined) changes.color = it.set.color;
      if (it.set.appearance !== undefined) changes.appearance = it.set.appearance;
      if (it.set.category !== undefined) changes.category = String(it.set.category).trim();
      Object.assign(s.materials[m.id], changes);
      events.push({ type: "MaterialUpdated", payload: { id: m.id, changes } });
    }
    return { events, summary: { updated: events.map((e: any) => e.payload.id) } };
  },
});
const deleteMaterials = cmd({
  name: "bim_delete_materials", title: "Delete materials", permission: "bim.delete", effect: "destructive",
  description: "Delete materials no type uses. A material in use is refused (RESOURCE_IN_USE lists the types and layer indexes); layers are never edited silently.",
  input: z.object({ materials: z.array(Ref2).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const ref of i.materials) {
      const m = findResource(s, "material", ref);
      delete s.materials[m.id];
      events.push({ type: "MaterialDeleted", payload: { id: m.id } });
    }
    return { events, summary: { deleted: events.map((e: any) => e.payload.id) } };
  },
});

// ---------------------------------------------------------------- types
const LayerPatch = z.array(z.object({ material: z.string(), thickness: z.number().min(0).max(3), color: z.string().optional(),
  function: z.enum(["structure", "insulation", "finish", "membrane", "air", "other"]).default("structure") })).min(1);
const TypeSets = {
  wall: z.object({ name: z.string(), layers: LayerPatch.describe("EXTERIOR -> INTERIOR") }).partial(),
  slab: z.object({ name: z.string(), layers: LayerPatch.describe("TOP -> BOTTOM"), finish_material:z.string() }).partial(),
  ceiling: z.object({ name: z.string(), layers: LayerPatch.describe("TOP -> BOTTOM") }).partial(),
  footing: z.object({ name: z.string(), layers: LayerPatch.describe("TOP -> BOTTOM") }).partial(),
  foundation_slab: z.object({ name: z.string(), layers: LayerPatch.describe("TOP -> BOTTOM") }).partial(),
  roof: z.object({ name: z.string(), layers: LayerPatch.describe("EXTERIOR -> INTERIOR") }).partial(),
  stair: z.object({ name: z.string(), max_riser: z.number().positive(), min_tread: z.number().positive(), default_width: z.number().positive(), material: z.string(), finish_material:z.string(), waist_thickness:z.number().positive() }).partial(),
  railing: z.object({ name: z.string(), height: z.number().positive(), top_rail: z.object({ width: z.number().positive(), depth: z.number().positive() }),
                      post: z.object({ size: z.number().positive() }), max_post_spacing: z.number().positive(), material: z.string() }).partial(),
  column: z.object({ name: z.string(), material: z.string(),
    profile: SECTION }).partial(),
  beam: z.object({ name: z.string(), material: z.string(), profile: SECTION }).partial(),
  door: z.object({ name: z.string(), width: z.number().positive(), height: z.number().positive(), material: z.string() }).partial(),
  window: z.object({ name: z.string(), width: z.number().positive(), height: z.number().positive(), material: z.string(), window_frame: z.object({width:z.number().positive(),depth:z.number().positive(),glassThickness:z.number().positive(),sashCount:z.union([z.literal(1),z.literal(2)]).optional()}) }).partial(),
  curtain_wall: z.object({ name: z.string(), max_panel_width: z.number().positive(), max_panel_height: z.number().positive(), panel_thickness: z.number().positive(),
    mullion: z.object({ width: z.number().positive(), depth: z.number().positive() }), transom: z.object({ width: z.number().positive(), depth: z.number().positive() }), material: z.string() }).partial(),
  ramp: z.object({ name: z.string(), max_slope: z.number().positive(), thickness: z.number().positive(), default_width: z.number().positive(), material: z.string() }).partial(),
  component: z.object({ name: z.string(), material: z.string(),
    parameters: z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()])).describe("merged into the type's values; null removes a value") }).partial(),
} as const;
type TKind = keyof typeof TypeSets;
const TypeUpdateItem = z.discriminatedUnion("kind", (Object.keys(TypeSets) as TKind[]).map((k) =>
  z.object({ type: Ref2, kind: z.literal(k).describe("must match the type's kind"), set: TypeSets[k].catchall(z.unknown()) })) as any);

const updateTypes = cmd({
  name: "bim_update_types", title: "Update types", permission: "bim.write",
  description: "Change types with a per-kind schema (give the type's kind): wall/slab name, layers; column/beam name, profile, material; door/window name, width, height; component name, material, parameters (merged; the family cannot change). Every element using the type is re-validated; door/window size changes are applied to their openings and must still fit their walls. One invalid item rejects the whole command.",
  input: z.object({ items: z.array(TypeUpdateItem).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const it of i.items as { type: string; kind: TKind; set: Record<string, unknown> }[]) {
      const ref = findResource(s, "type", it.type);
      const t = s.types[ref.id];
      const d = { resourceKind: "type", resourceId: t.id };
      if (t.kind !== it.kind) throw resErr(`${t.id} is a ${t.kind} type, not ${it.kind}.`, "RESOURCE_KIND_MISMATCH", { ...d, typeKind: t.kind });
      patchFields(it.set, Object.keys(TypeSets[it.kind].shape), d);
      const set = TypeSets[it.kind].parse(it.set) as Record<string, any>;
      const changes: Record<string, unknown> = {};
      if (set.name !== undefined) changes.name = normalizeName(set.name);
      if (set.layers !== undefined)
        changes.layers = set.layers.map((l: any) => ({ material: materialId(s, events, l.material, l.color), thickness: l.thickness, function: l.function }));
      if (set.profile !== undefined) changes.profile = set.profile;
      if (set.material !== undefined) changes.material = materialId(s, events, set.material);
      if (set.finish_material !== undefined) changes.finishMaterial = materialId(s, events, set.finish_material);
      if (set.waist_thickness !== undefined) changes.waistThickness = set.waist_thickness;
      if (set.width !== undefined) changes.width = set.width;
      if (set.height !== undefined) changes.height = set.height;
      if (set.window_frame !== undefined) changes.windowFrame = set.window_frame;
      if (set.max_panel_width !== undefined) changes.maxPanelWidth = set.max_panel_width;
      if (set.max_panel_height !== undefined) changes.maxPanelHeight = set.max_panel_height;
      if (set.panel_thickness !== undefined) changes.panelThickness = set.panel_thickness;
      if (set.mullion !== undefined) changes.mullion = set.mullion;
      if (set.transom !== undefined) changes.transom = set.transom;
      if (set.max_slope !== undefined) changes.maxSlope = set.max_slope;
      if (set.thickness !== undefined) changes.thickness = set.thickness;
      if (set.max_riser !== undefined) changes.maxRiser = set.max_riser;
      if (set.min_tread !== undefined) changes.minTread = set.min_tread;
      if (set.default_width !== undefined) changes.defaultWidth = set.default_width;
      if (set.top_rail !== undefined) changes.topRail = set.top_rail;
      if (set.post !== undefined) changes.post = set.post;
      if (set.max_post_spacing !== undefined) changes.maxPostSpacing = set.max_post_spacing;
      if (it.kind === "component" && set.parameters !== undefined) {           // Type parameters stay the single source of truth for every instance
        const merged: Record<string, unknown> = { ...(t as ComponentType).parameters };
        for (const [k, v] of Object.entries(set.parameters)) { if (v === null) delete merged[k]; else merged[k] = v; }
        changes.parameters = merged;
      }
      Object.assign(s.types[t.id], changes);
      events.push({ type: "TypeUpdated", payload: { id: t.id, changes } });
      // door / window size is mirrored by the openings they fill: keep them consistent, then prove they still fit
      if ((t.kind === "door" || t.kind === "window") && (set.width !== undefined || set.height !== undefined)) {
        const ot = s.types[t.id] as OpeningType;
        for (const el of Object.values(s.elements)) {
          if (el.kind !== "hosted_component" || el.type !== t.id) continue;
          Object.assign(s.elements[el.opening], { width: ot.width, height: ot.height });
          events.push({ type: "ElementUpdated", payload: { id: el.opening, changes: { width: ot.width, height: ot.height } } });
        }
        for (const el of Object.values(s.elements)) {
          if (el.kind !== "hosted_component" || el.type !== t.id) continue;
          try { checkElement(s, s.elements[el.opening]); checkElement(s, el); }
          catch (e) {
            if (!(e instanceof DomainError)) throw e;
            throw new DomainError(`Changing type ${t.name} would make ${el.id} invalid: ${e.message}`, "DEPENDENT_ELEMENT_INVALID",
              { ...(e.details ?? {}), dependentId: el.id, typeId: t.id, cause: e.reason });
          }
        }
      }
    }
    if (events.some((e) => e.type === "MaterialCreated")) events.push(counters(s));          // materials created by name: keep ids unique
    return { events, summary: { updated: events.filter((e) => e.type === "TypeUpdated").map((e: any) => e.payload.id) } };
  },
});
const deleteTypes = cmd({
  name: "bim_delete_types", title: "Delete types", permission: "bim.delete", effect: "destructive",
  description: "Delete types no element uses. A type in use is refused (RESOURCE_IN_USE with counts and sample ids); elements are never deleted with it.",
  input: z.object({ types: z.array(z.object({ type: Ref2, kind: z.enum(["wall", "slab", "ceiling", "roof", "footing", "foundation_slab", "pipe", "duct", "cable_tray", "conduit", "cable", "mep_fitting", "rebar", "ramp", "curtain_wall", "column", "beam", "door", "window", "stair", "railing"]).optional() })).min(1) }),
  decide: (s, i) => {
    const events: Decision["events"] = [];
    for (const it of i.types) {
      const t = findResource(s, "type", it.type, it.kind);
      delete s.types[t.id];
      events.push({ type: "TypeDeleted", payload: { id: t.id } });
    }
    return { events, summary: { deleted: events.map((e: any) => e.payload.id) } };
  },
});

const reconcileModel = cmd({
  name: 'bim_reconcile_model', title: 'Reconcile model junctions', permission: 'bim.write',
  description: 'Preview or propose a single atomic repair of redundant parallel wall solids and unambiguous thickness-sized wall corner gaps. Preserves hosted objects and referenced identities; unresolved issues are reported, never silently deleted.',
  input: z.object({}),
  decide: (s) => {
    const candidate=structuredClone(s), fixed=reconcileRedundantWalls(candidate);
    const changes=healWallCorners(candidate,new Set(Object.values(candidate.elements).filter(e=>e.kind==='wall').map(e=>e.id)));
    const events:Decision['events']=[...fixed.events,...changes.map(c=>({type:'ElementUpdated',payload:c}))];
    return {events,summary:{removedRedundantWalls:fixed.removed,splitWalls:fixed.split,adjustedWallEnds:changes.length}};
  },
});
export const commandTools: ToolDef<BimState>[] = [reconcileModel, setProject, createStoreys, createGrids, createTypes, createWalls, createSlabs,
  createColumns, createBeams, placeOpenings, moveElements, updateElements, setProperties, deleteElements,
  updateStoreys, deleteStoreys, reassignStoreys, joinWalls, joinWallsBatch, unjoinWalls, rehostOpening,
  splitWallTool, mergeWallsTool, trimWallTool, extendWallTool,
  createFamilies, updateFamilies, deleteFamilies, createComponents, createSpatial, createProfileMembers, createBoundariesTool, createStairsTool, createPathElementsTool, createRailingsTool, queryStructuralConnectivityTool, createMepSystemsTool, querySystemsTool, getSystemsTool, updateSystemsTool, deleteSystemsTool, createMepSegmentsTool, createMepFittingsTool, createSpatialUnitsTool, querySpatialUnitsTool, updateSpatialUnitsTool, deleteSpatialUnitsTool, setGeoreferenceTool, clearGeoreferenceTool, getCoordinateSystemTool, convertCoordinatesTool, createReinforcementTool, createAssembliesTool, createRampsTool, createCurtainWallsTool, createPitchedRoofsTool, ...mepWrappers, queryConnectorsTool, connectMepTool, disconnectMepTool, queryNetworkTool, categoryCapabilitiesTool, createBracesTool, createPilesTool, createFootingsTool, updateGrids, deleteGrids, createMaterials, updateMaterials, deleteMaterials, updateTypes, deleteTypes];
export const queryTools: ToolDef<BimState>[] = [summaryTool, listTypes, queryElements, getElement, validateTool,
  queryStoreys, queryGrids, queryMaterials, queryTypes, usageTool, detectTool, queryTopology, usageOfElement,
  listDisciplinesTool, listCategoriesTool, getCategoryTool, categoryUsageTool, queryFamilies, detectRegions, spatialAdjacencyTool, listEnginesTool, getEngineTool];

