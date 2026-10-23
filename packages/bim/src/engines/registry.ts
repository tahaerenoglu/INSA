/**
 * Engine registry (Phase 9). CATEGORY = what an object is; ENGINE = how it behaves.
 * Many categories share one engine; an engine owns a storage variant (`elementKind`), the placements it
 * understands, the type families it accepts and the operations it supports (discovery metadata — the
 * domain validators still decide). Application metadata, deep-frozen, never event sourced.
 *
 * status: implemented — production behaviour; categories may use it.
 *         internal    — an implementation primitive (the opening void), not an authorable BIM engine.
 *         reserved    — named for the future; no behaviour, no category may use it.
 */
/** Open extension points (module augmentation): an extension engine / placement adds its id here and stays fully typed. */
export interface ExtensionEngines {}
export interface ExtensionPlacements {}
export type EngineId = keyof ExtensionEngines | "wall" | "point_component" | "hosted_component" | "profile_member" | "boundary" | "spatial" | "stair" | "path" | "mep_network" | "mep_fitting" | "reinforcement" | "assembly" | "ramp_flight" | "curtain_wall" | "pitched_roof" | "void"
  | "proxy";
export type EngineStatus = "implemented" | "internal" | "reserved";
/** Where / how an element is positioned (orthogonal to what it is). */
export type PlacementKind = keyof ExtensionPlacements | "wall_axis" | "level_point" | "host" | "member_axis" | "member_vertical" | "member_spatial_axis" | "boundary" | "boundary_plane" | "spatial_point" | "stair_run" | "path" | "mep_route" | "fitting_point" | "host_layout" | "aggregate" | "ramp_run";
/** Type resource families (meaningfully different parameter semantics; deliberately not generalised). */
export type TypeFamily = "layered" | "profile" | "opening" | "component" | "stair" | "railing" | "mep" | "fitting" | "rebar" | "ramp" | "curtain";
export type Operation = "create" | "update" | "move" | "reassign_storey" | "delete" | "join" | "rehost" | "fill";

export interface EngineDefinition {
  readonly id: EngineId; readonly name: string; readonly status: EngineStatus; readonly description: string;
  readonly elementKind: string | null;                   // storage discriminant of its elements (null: reserved)
  readonly placements: readonly PlacementKind[];
  readonly representations: readonly string[];
  readonly typeFamilies: readonly TypeFamily[];
  /** honest authoring level of the engine's behaviour (0 none, 1 generic semantic, 2 dedicated parametric, 3 advanced professional editing): metadata the coverage report reads */
  readonly authoringLevel: 0 | 1 | 2 | 3;
  readonly operations: readonly Operation[];
}

const E = (d: EngineDefinition): EngineDefinition => Object.freeze({ ...d, placements: Object.freeze([...d.placements]),
  representations: Object.freeze([...d.representations]), typeFamilies: Object.freeze([...d.typeFamilies]), operations: Object.freeze([...d.operations]) });
const ENGINES: readonly EngineDefinition[] = Object.freeze([
  E({ id: "wall", authoringLevel: 3, name: "Wall", status: "implemented", elementKind: "wall", placements: ["wall_axis"], representations: ["wall_extrusion"], typeFamilies: ["layered"],
      operations: ["create", "update", "move", "reassign_storey", "delete", "join"], description: "Axis walls with layered types, explicit topology (joins, tees, miters), hosted openings, vertical intent and room bounding." }),
  E({ id: "point_component", authoringLevel: 1, name: "Point component", status: "implemented", elementKind: "component", placements: ["level_point"], representations: ["box"], typeFamilies: ["component"],
      operations: ["create", "update", "move", "reassign_storey", "delete"], description: "Family -> ComponentType -> Component placed at a storey-relative point (furniture, equipment, fixtures, ...)." }),
  E({ id: "hosted_component", authoringLevel: 2, name: "Hosted component", status: "implemented", elementKind: "hosted_component", placements: ["host"], representations: ["hosted_insert"], typeFamilies: ["opening"],
      operations: ["create", "update", "delete", "rehost", "fill"], description: "Components filling a host void (doors, windows): they follow the opening in their host wall." }),
  E({ id: "profile_member", authoringLevel: 2, name: "Profile member", status: "implemented", elementKind: "profile_member", placements: ["member_axis", "member_vertical", "member_spatial_axis"], representations: ["profile_sweep"],
      typeFamilies: ["profile"], operations: ["create", "update", "move", "reassign_storey", "delete"], description: "Linear members with a profile type swept along an axis (beams) or a vertical (columns), with vertical intent." }),
  E({ id: "boundary", authoringLevel: 2, name: "Boundary element", status: "implemented", elementKind: "boundary", placements: ["boundary", "boundary_plane"], representations: ["boundary_extrusion", "boundary_plane_extrusion"], typeFamilies: ["layered"],
      operations: ["create", "update", "move", "reassign_storey", "delete"], description: "Polygon-bounded elements (outline + holes) extruded by a layered type from a horizontal reference level (floors, ceilings, flat roofs) or from a sloped plane (single-plane roofs). The category decides the thickness direction." }),
  E({ id: "spatial", authoringLevel: 2, name: "Spatial element", status: "implemented", elementKind: "spatial", placements: ["spatial_point"], representations: ["spatial_prism"], typeFamilies: [],
      operations: ["create", "update", "move", "reassign_storey", "delete"], description: "Rooms / spaces: a persisted location point; boundary, area and volume derived from explicitly joined room-bounding walls." }),
  E({ id: "stair", authoringLevel: 2, name: "Stair", status: "implemented", elementKind: "stair", placements: ["stair_run"], representations: ["stair_run"], typeFamilies: ["stair"],
      operations: ["create", "update", "move", "reassign_storey", "delete"], description: "Straight-run stairs: a walking line, width and riser count; the total rise follows the storeys (vertical intent). Treads and risers are derived." }),
  E({ id: "path", authoringLevel: 2, name: "Path element", status: "implemented", elementKind: "path", placements: ["path"], representations: ["path_sweep"], typeFamilies: ["railing"],
      operations: ["create", "update", "move", "reassign_storey", "delete"], description: "Elements whose geometry follows a semantic polyline (railings): open or closed path, base offset, height; posts and rails are derived from the path and the type." }),
  E({ id: "mep_fitting", authoringLevel: 2, name: "MEP fitting", status: "implemented", elementKind: "mep_fitting", placements: ["fitting_point"], representations: ["fitting_sweep"], typeFamilies: ["fitting"],
      operations: ["create", "update", "move", "reassign_storey", "delete"], description: "Fitting products of MEP networks (elbow, tee, cross, reducer, transition, coupling): a point placement with yaw / pitch / roll in a system; connectors and swept / revolved geometry are derived from the type's parameters. Connectivity stays explicit (MepJunction)." }),
  E({ id: "reinforcement", authoringLevel: 2, name: "Reinforcement", status: "implemented", elementKind: "reinforcement", placements: ["host_layout"], representations: ["bar_sweep"], typeFamilies: ["rebar"],
      operations: ["create", "update", "move", "delete"], description: "Bar sets, meshes, tendons and tendon conduits bound to an explicit host (column, beam, wall, slab, footing, foundation slab): a bar path + count / spacing / direction per layer; every bar, its length and its volume are derived. The bars move with their host." }),
  E({ id: "assembly", authoringLevel: 2, name: "Assembly", status: "implemented", elementKind: "assembly", placements: ["aggregate"], representations: ["aggregate"], typeFamilies: [],
      operations: ["create", "update", "delete"], description: "Explicit aggregation of existing elements (IfcElementAssembly): trusses, frames, prefabricated and precast units, facade modules. Children keep their identity and lifecycle; one parent per child; acyclic; one storey. No geometry of its own." }),
  E({ id: "ramp_flight", authoringLevel: 2, name: "Ramp flight", status: "implemented", elementKind: "ramp", placements: ["ramp_run"], representations: ["ramp_run"], typeFamilies: ["ramp"],
      operations: ["create", "update", "move", "reassign_storey", "delete"], description: "A straight sloped walking surface: walking line, width, rise, base elevation; slope limit and thickness from the RampType. Flights and landings are joined into a ramp by an assembly." }),
  E({ id: "curtain_wall", authoringLevel: 2, name: "Curtain wall", status: "implemented", elementKind: "curtain_wall", placements: ["wall_axis"], representations: ["curtain_grid"], typeFamilies: ["curtain"],
      operations: ["create", "update", "move", "reassign_storey", "delete"], description: "A curtain-wall assembly on a straight axis: base, height, grid; the type carries the maximum cell size, mullion / transom sections and panel thickness. Grid, mullions, transoms and panels are derived with stable ids; IFC decomposes the curtain wall into plates and members." }),
  E({ id: "pitched_roof", authoringLevel: 2, name: "Pitched roof", status: "implemented", elementKind: "pitched_roof", placements: ["boundary"], representations: ["roof_planes"], typeFamilies: ["layered"],
      operations: ["create", "update", "move", "reassign_storey", "delete"], description: "Gable and hip roofs on a rectangular footprint: form, pitch, ridge side, overhang, eave elevation; a layered roof type gives the thickness. Planes, ridge, hips and eaves are derived with stable plane ids; IFC aggregates IfcSlab ROOF planes into an IfcRoof. No valleys, openings or general footprints." }),
  E({ id: "void", authoringLevel: 0, name: "Opening (internal)", status: "internal", elementKind: "opening", placements: ["host"], representations: ["host_cut"], typeFamilies: [],
      operations: ["create", "update", "delete", "rehost"], description: "Internal host-cut primitive: a void in a wall that a hosted component may fill. Not an authorable BIM engine." }),
  E({ id: "mep_network", authoringLevel: 2, name: "MEP network", status: "implemented", elementKind: "mep_segment", placements: ["mep_route"], representations: ["mep_route_sweep"], typeFamilies: ["mep"],
      operations: ["create", "update", "move", "reassign_storey", "delete"], description: "Route elements of connected MEP networks (pipes, ducts, cable trays, conduits): a storey-aware 3D polyline in a system, with stable endpoint connectors. Connectivity is explicit (MepJunction resources): touching is never connected. No engineering analysis." }),
  E({ id: "proxy", authoringLevel: 0, name: "Proxy (reserved)", status: "reserved", elementKind: null, placements: [], representations: [], typeFamilies: [], operations: [], description: "Reserved for imported proxies. Not implemented." }),
]);
const BY_ID = new Map(ENGINES.map((e) => [e.id, e] as const));
const BY_KIND = new Map(ENGINES.filter((e) => e.elementKind).map((e) => [e.elementKind!, e] as const));
const EXTENSIONS: EngineDefinition[] = [];

/**
 * Register an EXTENSION engine (a new engine module): nothing else needs editing. Built-in ids and element kinds can never be redefined. The engine must also
 * `defineHandlers` for its element kind (engines/handlers.ts) before its elements are validated, queried, quantified, moved, drawn or exported.
 */
export function registerEngine(def: EngineDefinition): void {
  if (BY_ID.has(def.id)) throw new Error(`engine '${def.id}' is already registered`);
  if (def.elementKind && BY_KIND.has(def.elementKind)) throw new Error(`element kind '${def.elementKind}' is already owned by engine '${BY_KIND.get(def.elementKind)!.id}'`);
  const e = E(def);
  EXTENSIONS.push(e); BY_ID.set(e.id, e); if (e.elementKind) BY_KIND.set(e.elementKind, e);
}
/** test hygiene for extension engines only (a built-in engine can never be removed) */
export function unregisterEngine(id: string): boolean {
  const i = EXTENSIONS.findIndex((e) => e.id === id);
  if (i < 0) return false;
  const [e] = EXTENSIONS.splice(i, 1);
  BY_ID.delete(e.id); if (e.elementKind) BY_KIND.delete(e.elementKind);
  return true;
}
/** Registry order: the built-ins (implemented, internal, reserved: fixed), then extension engines in registration order. */
export const listEngines = (): readonly EngineDefinition[] => (EXTENSIONS.length ? [...ENGINES, ...EXTENSIONS] : ENGINES);
export const findEngine = (id: string): EngineDefinition | undefined => BY_ID.get(id as EngineId);
/** The engine owning a storage variant (element.kind). */
export const engineOfKind = (kind: string): EngineDefinition | undefined => BY_KIND.get(kind);

/** Type kind -> type family (type kinds stay as persisted; families give engine compatibility). */
export const TYPE_FAMILY_OF_KIND: Readonly<Record<string, TypeFamily>> = Object.freeze({
  wall: "layered", slab: "layered", ceiling: "layered", roof: "layered", footing: "layered", foundation_slab: "layered", stair: "stair", railing: "railing", column: "profile", beam: "profile", door: "opening", window: "opening", component: "component",
  pipe: "mep", duct: "mep", cable_tray: "mep", conduit: "mep", cable: "mep", mep_fitting: "fitting", rebar: "rebar", ramp: "ramp", curtain_wall: "curtain" });

/** Backward-compatible engine filters: Phase 7 "component" and the former "native" GROUP (documented, deprecated). */
export const ENGINE_ALIASES: Readonly<Record<string, readonly EngineId[]>> = Object.freeze({
  component: Object.freeze(["point_component"] as EngineId[]),
  native: Object.freeze(["wall", "profile_member", "boundary", "hosted_component", "void"] as EngineId[]),
});
/** Concrete engine ids a filter value stands for (a concrete id, or a documented alias). */
export function engineFilter(v: string): Set<string> {
  if (findEngine(v)) return new Set([v]);
  return new Set(ENGINE_ALIASES[v] ?? []);
}
