/**
 * IFC-aligned BIM schema and state for the BIM module.
 * Units: metres. Coordinates: x east, y north, z up. Element z values are
 * relative to their storey.
 */
import { DomainError, Upcaster } from "@insa/core";
import { wallRoof } from './wall-roof.js';
import type { DomainEvent } from "@insa/core";
import { P2, unit, sub, dist, wallFootprint, area, leftNormal, EndCut, intersect } from "./geo.js";
import { MITER_MIN_SIN } from "./topology.js";
import { TYPE_FAMILY_OF_KIND } from "./engines/registry.js";
import { stairGeometry, pathLength, pathPosts, slopeFrame } from "./arch.js";
import { sectionArea } from "./section.js";
import { memberLength } from "./engines/profile-member.js";
import { mepSegmentQuantities } from "./mep.js";
import { handlersOf } from "./engines/handlers.js";
import { GEOMETRY_EPSILON } from "./geometry.js";

export type LayerFunction = "finish" | "substrate" | "insulation" | "structure" | "membrane";

export interface Material { id: string; name: string; color?: string; category?: string; appearance?: import("./appearance.js").MaterialAppearance | null; }
export interface Layer { material: string; thickness: number; function: LayerFunction; }
/** footingKind: pad | strip, REQUIRED for kind footing and forbidden elsewhere (the footing's kind is type semantics, never inferred from its polygon). */
export interface LayeredType { id: string; name: string; kind: "wall" | "slab" | "ceiling" | "roof" | "footing" | "foundation_slab"; layers: Layer[]; footingKind?: "pad" | "strip"; finishMaterial?: string; }
/** Stair type: constraints and defaults only (the geometry intent lives on the stair). No building code is hard-wired: the limits are the type's. */
export interface StairType { id: string; name: string; kind: "stair"; maxRiser: number; minTread: number; defaultWidth?: number; material?: string; finishMaterial?: string; waistThickness?: number; }
/** Railing type: the dimensions the posts and rails are derived from (nothing here is persisted as geometry). */
export interface RailingType { id: string; name: string; kind: "railing"; height: number; topRail: { width: number; depth: number }; post: { size: number }; maxPostSpacing: number; material?: string; }
/** Section shapes (section.ts is their only source of validity / area / outline): b = width, h = depth, d = diameter, t = wall thickness, tw / tf = web / flange thickness. */
export type Profile = { shape: "rect"; b: number; h: number } | { shape: "circle"; d: number } | { shape: "rhs"; b: number; h: number; t: number }
  | { shape: "chs"; d: number; t: number } | { shape: "i_section"; h: number; b: number; tw: number; tf: number };
export interface ProfileType { id: string; name: string; kind: "column" | "beam"; profile: Profile; material?: string; }
export interface OpeningType { id: string; name: string; kind: "door" | "window"; width: number; height: number; material?: string; windowFrame?: { width: number; depth: number; glassThickness: number; sashCount?: 1 | 2 }; }
export interface Storey { id: string; name: string; elevation: number; }
export interface Grid { id: string; name: string; start: P2; end: P2; }

/**
 * Vertical intent of walls, columns and beams (Phase 5).
 * fixed — the stored height / z is authoritative.
 * storey — the stored value is derived from the referenced storey (immutable id):
 *   wall / column: height = storey.elevation - base.elevation - baseOffset
 *   beam:          z      = storey.elevation - base.elevation
 * Events written before Phase 5 carry no intent; they are upcast as fixed.
 */
export type Vertical = { mode: "fixed" } | { mode: "storey"; storey: string };

/** A wall endpoint, identified by the wall's stable id — never by coordinates (Phase 6). */
export interface WallEndpoint { wall: string; endpoint: "start" | "end"; }
/**
 * Explicit, persistent wall topology (Phase 6). Touching is not joining: a relation exists only
 * when it was created on purpose (bim_join_walls).
 * endpoint_endpoint — a junction: 2+ wall endpoints that always share one coordinate.
 * endpoint_segment  — a T-junction: one endpoint lies on the host wall at parameter t (0 < t < 1).
 * Every endpoint takes part in at most one relation.
 */
export type WallJoin =
  | { id: string; kind: "endpoint_endpoint"; members: WallEndpoint[] }
  | { id: string; kind: "endpoint_segment"; endpoint: WallEndpoint; host: string; t: number };

interface ElementBase { id: string; storey: string; name?: string; props?: Record<string, Record<string, string | number | boolean>>; }
export interface Wall extends ElementBase {
  /** Explicit dependency on a single-plane roof's underside; absent in historic events. */
  topRoof?: string;
  /** semantic category of a wall-engine element; ABSENT = architecture.wall (the legacy / canonical form: never written for it) */
  category?: string;
  kind: "wall"; type: string; start: P2; end: P2; height: number; baseOffset: number;
  prevDir: P2 | null; nextDir: P2 | null; exterior: "left" | "right" | null;
  vertical: Vertical;
  /** Phase 8: does the wall bound rooms / spaces? Absent means true (every older wall is room-bounding). */
  roomBounding?: boolean;
}
// ---- Phase 9 canonical engine variants. The category (immutable) says WHAT it is; the engine HOW it behaves.
/** profile_member engine: one variant for every member category; placement is an explicit, small union. */
interface MemberBase extends ElementBase { kind: "profile_member"; category: string; type: string; }
/** member_axis: swept from start to end; z = top of the member above its storey (beams). */
export interface AxisMember extends MemberBase { placement: "member_axis"; start: P2; end: P2; z: number; vertical: Vertical; }
/**
 * member_vertical: at `at`, rotated (degrees) about Z. UP (columns; `direction` ABSENT = the legacy / canonical form): rises from baseOffset above
 * its storey by `height`. DOWN (piles; `direction: "down"`, written only for those categories): hangs from baseOffset above its storey downwards
 * by `height` (its length). The category decides the direction; a down member is always fixed (no storey constraint).
 */
export interface VerticalMember extends MemberBase { placement: "member_vertical"; at: P2; height: number; baseOffset: number; rotation: number; vertical: Vertical; direction?: "down"; }
/** A storey-aware endpoint: plan position + elevation above ITS OWN storey. World z = storey.elevation + offset (derived, never stored). */
export interface MemberEnd { storey: string; at: P2; offset: number; }
/**
 * member_spatial_axis (braces): a true 3D axis between two storey-aware endpoints; `rotation` = roll of the section about the axis (degrees).
 * `storey` (the element's) is always start.storey. Level elevations drive the world geometry: no event is needed when a storey moves.
 */
export interface SpatialAxisMember extends MemberBase { placement: "member_spatial_axis"; start: MemberEnd; end: MemberEnd; rotation: number; }
export type ProfileMember = AxisMember | VerticalMember | SpatialAxisMember;
/** Single-plane intent of a roof (see arch.slopeFrame): azimuth = the direction it RISES (degrees, [0, 360)), pitch = inclination (degrees). */
export interface BoundarySlope { azimuth: number; pitch: number; }
/**
 * boundary engine: outline + holes and a layered type. Horizontal (no `slope`): the reference surface is at `offset` above the storey;
 * the category decides which side the thickness lies on (floors, roofs: below; ceilings: above). Sloped (`slope`): a single plane whose eave
 * elevation is `offset`; the thickness is measured perpendicular to the plane.
 */
export interface Boundary extends ElementBase { kind: "boundary"; category: string; type: string; outline: P2[]; holes: P2[][]; offset: number; slope?: BoundarySlope; }
/** stair engine: a straight run. start / end = the walking line from the first to the last riser; `height` is the total rise (vertical intent, like a column's height). */
export interface StairElement extends ElementBase { kind: "stair"; category: string; type: string; start: P2; end: P2; width: number; riserCount: number; baseOffset: number; height: number; vertical: Vertical; }
/** path engine: an open or closed polyline at `offset` above the storey with a `height` (railings). Posts and rails are derived. */
export interface PathElement extends ElementBase { kind: "path"; category: string; type: string; path: P2[]; closed: boolean; offset: number; height: number; }
/** Former variant names kept as aliases of the canonical variants (no behaviour of their own). */
export type Slab = Boundary;
export type Column = VerticalMember;
export type Beam = AxisMember;
export interface Opening extends ElementBase {
  kind: "opening"; host: string; along: number; width: number; height: number; sill: number;
  /** door / window filling the opening; null (or absent) when empty */
  filledBy?: string | null;
}
/** hosted_component engine: fills an opening (internal void) in a host wall; doors and windows are categories. */
export interface HostedComponent extends ElementBase { kind: "hosted_component"; category: string; type: string; host: string; opening: string; }
export type Insert = HostedComponent;
// ================================================================ generic components (Phase 7)
/** Family / type / instance parameter values: deliberately small set of value kinds. */
export type ParamValue = number | string | boolean;
export type ParamDataType = "number" | "length" | "angle" | "string" | "boolean";
/** length: metres; angle: degrees (like column rotation). Keys are immutable machine ids. */
export interface ParameterDefinition {
  key: string; name: string; scope: "type" | "instance"; dataType: ParamDataType; required: boolean;
  default?: ParamValue; min?: number; max?: number; unit?: string;
}
/** BOX: bottom-centre origin; width along local X, depth along local Y, height along Z (type-scope lengths). */
export type Representation = { kind: "box"; width: string; depth: string; height: string };
export interface Family {
  id: string; name: string; category: string;            // category: immutable after creation
  description?: string; placement: "level_point";          // placement: immutable after creation
  parameters: ParameterDefinition[]; representation: Representation;
}
/** One Type variant for every component category; the category comes from the Family. */
export interface ComponentType { id: string; kind: "component"; name: string; family: string; parameters: Record<string, ParamValue>; material?: string;
  /** optional MEP connector definitions (Phase 13); absent on every pre-existing type */ connectors?: ConnectorDef[];
  /** optional IFC PredefinedType (Phase 14): must be one of the category's schema-derived values; absent = NOTDEFINED */ predefinedType?: string; }
/** Level-relative point placement: world Z = storey.elevation + offset; rotation in degrees [0, 360) about Z. */
export interface LevelPointPlacement { kind: "level_point"; x: number; y: number; offset: number; rotation: number; }
/** ONE element kind for furniture, equipment, fixtures, ... — its storey is ElementBase.storey. */
export interface Component extends ElementBase {
  kind: "component"; type: string; placement: LevelPointPlacement; parameters: Record<string, ParamValue>;
}

// ================================================================ spatial elements (Phase 8)
/**
 * ONE element kind for rooms, spaces and later spatial categories (engine "spatial").
 * Persisted intent only: category (immutable), storey, a storey-local location point, number, name
 * and vertical extent. The boundary, area, perimeter and volume are always DERIVED from the current
 * explicit wall topology (spatial.ts) — never stored.
 */
export interface SpatialElement extends ElementBase {
  kind: "spatial"; category: string; point: P2; number?: string | null; height: number; vertical: Vertical;
}

/** One variant per ENGINE (plus the internal opening void) — never one per category. */
export type Element = Wall | ProfileMember | Boundary | Opening | HostedComponent | Component | SpatialElement | StairElement | PathElement | MepSegment | MepFitting | Reinforcement | Assembly | RampElement | CurtainWall | PitchedRoof;

// ================================================================ pitched roofs (Phase 14)
/** A gable / hip roof on a RECTANGULAR footprint (engines/pitched-roof.ts): the planes, ridge, hips and solids are derived; `offset` = the eave elevation above the storey. */
export interface PitchedRoof extends ElementBase { kind: "pitched_roof"; category: string; type: string; outline: P2[]; form: "gable" | "hip"; ridge: "long" | "short"; pitch: number; overhang: number; offset: number; }

// ================================================================ curtain walls (Phase 14)
/** Frame and panel parameters of a curtain wall (see engines/curtain-wall.ts): maximum cell size, mullion / transom sections (width = face, depth = out of plane), panel thickness. */
export interface CurtainWallType { id: string; name: string; kind: "curtain_wall"; maxPanelWidth: number; maxPanelHeight: number; panelThickness: number; mullion: { width: number; depth: number }; transom: { width: number; depth: number }; material?: string; }
/** A curtain wall on a straight axis; the grid, mullions, transoms and panels are derived (uDivisions / vDivisions override the type's maximum cell size). */
export interface CurtainWall extends ElementBase { kind: "curtain_wall"; category: string; type: string; start: P2; end: P2; baseOffset: number; height: number; uDivisions?: number; vDivisions?: number; }

// ================================================================ ramp flights (Phase 14)
/** maxSlope = rise / run (e.g. 1/12); thickness is perpendicular to the slope. No building code is hard-wired: the type carries the limits. */
export interface RampType { id: string; name: string; kind: "ramp"; maxSlope: number; thickness: number; defaultWidth?: number; material?: string; }
/** A straight sloped flight: the walking surface passes through (start, baseOffset) and (end, baseOffset + rise). Several flights + landings are joined by an assembly. */
export interface RampElement extends ElementBase { kind: "ramp"; category: string; type: string; start: P2; end: P2; width: number; baseOffset: number; rise: number; }

// ================================================================ assemblies (Phase 14)
/**
 * An ASSEMBLY (IfcElementAssembly): explicit aggregation of existing elements (trusses, frames, prefabricated / precast units, facade modules, reinforcement
 * assemblies ...). The children keep their own identity, category, type and lifecycle; the assembly adds the relation (and its own storey). A child has at most
 * ONE assembly parent, the graph is acyclic, and all members share the assembly's storey. No geometry of its own; nothing is inferred from proximity.
 */
export interface Assembly extends ElementBase { kind: "assembly"; category: string; children: string[]; predefinedType?: string; primary?: string; }

// ================================================================ reinforcement (Phase 14)
/** One bar layer: the path of the FIRST bar (storey-local [x, y, z]) and its copies: `count` bars `spacing` apart along `direction`. */
export interface BarLayer { path: [number, number, number][]; count: number; spacing: number; direction: [number, number, number]; }
/** wallThickness: only for tendon conduits (a hollow sweep). */
export interface RebarType { id: string; name: string; kind: "rebar"; diameter: number; steelGrade?: string; wallThickness?: number; material?: string; }
/**
 * Bar sets (IfcReinforcingBar), meshes (two crossing layers), tendons and tendon conduits bound to a HOST by explicit reference; the storey is the host's.
 * Every bar and its length are derived; the bars move with their host.
 */
export interface ColumnRebarLayout { kind: 'rectangular_column'; role: 'longitudinal' | 'stirrups'; mainType: string; tieType: string; spacing: number; }
export interface Reinforcement extends ElementBase { kind: "reinforcement"; category: string; type: string; host: string; layers: BarLayer[]; bendRadius?: number; cover: number; geometryValidation?: 'rectangular_column'; layout?: ColumnRebarLayout; }

// ================================================================ MEP fittings (Phase 14)
export type FittingSection = { shape: "round"; diameter: number } | { shape: "rectangular"; width: number; height: number };
/**
 * A fitting TYPE: its kind and parameters. Connectors and geometry are DERIVED from these (engines/mep-fitting.ts): `run` = the run / inlet section,
 * `outlet` = the outlet section (reducer, transition) or the BRANCH section (tee, cross; default = run), `angle` = elbow turn or branch angle (deg),
 * `radius` = elbow centre-line radius, `length` = run length (coupling, reducer, transition, tee, cross), `branchLength` = stub length (tee, cross).
 */
export interface FittingType { id: string; name: string; kind: "mep_fitting"; fitting: "elbow" | "tee" | "cross" | "reducer" | "transition" | "coupling"; domain: MepDomainId;
  run: FittingSection; outlet?: FittingSection; angle?: number; radius?: number; length?: number; branchLength?: number; material?: string; }
/** A placed fitting: point placement (storey, at, offset) with yaw `rotation`, `pitch` and `roll` (degrees). Belongs to a system. */
export interface MepFitting extends ElementBase { kind: "mep_fitting"; category: string; type: string; system: string; at: P2; offset: number; rotation: number; pitch: number; roll: number; }

// ================================================================ MEP core (Phase 13)
/** A storey-aware route point: world z = storey.elevation + offset (derived, never stored). */
export interface MepRoutePoint { storey: string; at: P2; offset: number; }
/**
 * THE route element of every MEP network category (pipe, duct, cable tray, conduit): a semantic 3D polyline in a SYSTEM. `storey` = the first
 * point's storey. Its connectors are derived: "start" and "end".
 */
export interface MepSegment extends ElementBase { kind: "mep_segment"; category: string; type: string; system: string; route: MepRoutePoint[]; }
/** A first-class resource (not an element): a named system of one strict domain. */
export type MepDomainId = "piping" | "hvac" | "electrical";
/**
 * IFC4.3 spatial structure of infrastructure (spatial-units.ts): a facility (IfcRoad, IfcRailway, IfcBridge, IfcMarineFacility, IfcFacility) hangs under the site or
 * another facility; a facility part (IfcRoadPart, ...) under a facility or a part. `parent: null` = directly under the site. Infrastructure products are contained in a
 * unit, never in a building storey.
 */
export interface SpatialUnit { id: string; name: string; kind: "facility" | "facility_part"; ifcClass: string; parent: string | null; longName?: string; composition: "ELEMENT" | "COMPLEX" | "PARTIAL"; usage?: string; predefinedType?: string; }
/** Map conversion of the local project coordinates (IfcMapConversion + IfcProjectedCRS): map = scale * R(xAxisAbscissa, xAxisOrdinate) * local + (eastings, northings, orthogonalHeight). Units are metres. */
export interface Georeference { crs: { name: string; description?: string; geodeticDatum?: string; verticalDatum?: string; mapProjection?: string; mapZone?: string }; eastings: number; northings: number; orthogonalHeight: number; xAxisAbscissa: number; xAxisOrdinate: number; scale: number; }
export interface MepSystem { id: string; name: string; domain: MepDomainId; classification: string; description?: string; properties?: Record<string, unknown>; }
/** Stable connector identity: an element id + a connector key ("start" / "end" for routes; the definition key for components). */
export interface ConnectorRef { element: string; connector: string; }
/** EXPLICIT connectivity: >= 2 connectors at one physical point. Touching never creates one. A connector belongs to at most one junction. */
export interface MepJunction { id: string; members: ConnectorRef[]; }
/** A connector DEFINITION on a component type (local to the component; world position / direction are derived through its placement). */
export interface ConnectorDef {
  key: string; domain: MepDomainId; position: [number, number, number]; direction: [number, number, number]; flow: "in" | "out" | "bidirectional";
  shape: "round" | "rectangular"; diameter?: number; width?: number; height?: number; classification?: string;
}
export interface PipeType { id: string; name: string; kind: "pipe"; diameter: number; wallThickness?: number; insulationThickness?: number; material?: string; }
export interface DuctType { id: string; name: string; kind: "duct"; shape: "round" | "rectangular"; diameter?: number; width?: number; height?: number; insulationThickness?: number; material?: string; }
export interface CableTrayType { id: string; name: string; kind: "cable_tray"; width: number; height: number; material?: string; }
export interface ConduitType { id: string; name: string; kind: "conduit"; diameter: number; material?: string; }
export interface CableType { id: string; name: string; kind: "cable"; diameter: number; material?: string; }
export type MepType = PipeType | DuctType | CableTrayType | ConduitType | CableType | FittingType;
export type BimType = LayeredType | ProfileType | OpeningType | ComponentType | StairType | RailingType | MepType | RebarType | RampType | CurtainWallType;
export type ElementKind = Element["kind"];

export type ProjectType = "infrastructure" | "superstructure";

export interface BimState {
  project: { name: string; number?: string; building: string; site: string; description?: string; projectType?: ProjectType; georef?: Georeference | null };
  /** facilities and facility parts of infrastructure (Phase 14, Milestone C): resources, not elements */
  spatialUnits: Record<string, SpatialUnit>;
  storeys: Record<string, Storey>;
  grids: Record<string, Grid>;
  materials: Record<string, Material>;
  types: Record<string, LayeredType | ProfileType | OpeningType | ComponentType | StairType | RailingType | MepType | RebarType | RampType | CurtainWallType>;
  /** component families (Phase 7); native types need no family */
  families: Record<string, Family>;
  elements: Record<string, Element>;
  /** explicit wall topology (Phase 6) */
  joins: Record<string, WallJoin>;
  /** MEP systems and explicit junctions (Phase 13): resources, not elements */
  mepSystems: Record<string, MepSystem>;
  mepJunctions: Record<string, MepJunction>;
  counters: Record<string, number>;
}

export const initialState = (): BimState => ({
  project: { name: "Yeni Proje", building: "Bina", site: "Arsa" },
  storeys: {}, grids: {}, materials: {}, types: {}, elements: {}, joins: {}, families: {}, mepSystems: {}, mepJunctions: {}, spatialUnits: {}, counters: {},
});

// ------------------------------------------------------------------ ids
export const PREFIX: Record<string, string> = {
  storey: "L", grid: "G", material: "M", wall_type: "WT", slab_type: "ST", column_type: "CT", beam_type: "BT",
  door_type: "DT", window_type: "NT", wall: "W", slab: "S", column: "C", beam: "B", opening: "O", door: "D", window: "N", join: "J",
  family: "F", component_type: "COT", component: "CO", spatial: "SP",
  member: "PM", boundary: "BD", hosted: "HC", brace: "BR", pile: "PL", structural_slab: "SSL", foundation_slab: "FS", footing: "FT",
  footing_type: "FTT", foundation_slab_type: "FST", pipe_type: "PIT", duct_type: "DUT", cable_tray_type: "CTT", conduit_type: "CNT", cable_type: "CBT", mep_system: "MS", mep_junction: "MJ", mep_segment: "ME", mep_fitting: "FIT", mep_fitting_type: "FTY", reinforcement: "RB", rebar_type: "RBT", assembly: "AS", spatial_unit: "SU", ramp: "RM", ramp_type: "RMT", curtain_wall: "CW", curtain_wall_type: "CWT", pitched_roof: "PR", stair: "STR", path: "PE", ceiling: "CE", roof: "RF", railing: "RL",
  ceiling_type: "CLT", roof_type: "RFT", stair_type: "STT", railing_type: "RLT",                   // Phase 9 engine defaults (categories may keep their own idKey); never reuse a prefix
};
/** Allocates the next id for a prefix inside a decision (mutates the decision-local state clone). */
export function nextId(s: BimState, key: keyof typeof PREFIX): string {
  const p = PREFIX[key];
  const n = (s.counters[p] ?? 0) + 1;
  s.counters[p] = n;
  return `${p}-${String(n).padStart(4, "0")}`;
}

// ------------------------------------------------------------------ apply
/**
 * Current schema version of every BIM event type (the single declaration; the
 * platform's EventRegistry reads it). When a payload shape changes: bump the
 * version here and add an upcaster for the previous version to BIM_UPCASTERS.
 */
export const BIM_EVENT_VERSIONS: Record<string, number> = {
  ProjectUpdated: 1, StoreyCreated: 1, GridCreated: 1, MaterialCreated: 1, TypeCreated: 1,
  // v2 (Phase 5): walls, columns and beams carry `vertical`; ElementUpdated changes may carry `vertical` and `storey`
  // v3 (Phase 9): beams / columns -> profile_member, slabs -> boundary, doors / windows -> hosted_component (+ category);
  // ElementUpdated stays v2: patches target the same field names and the kind is never patched.
  ElementCreated: 3, ElementUpdated: 2, ElementDeleted: 1, PropertiesSet: 1, CountersSet: 1,
  // resource lifecycle (Phase 4)
  StoreyUpdated: 1, StoreyDeleted: 1, GridUpdated: 1, GridDeleted: 1,
  // wall topology (Phase 6)
  WallJoinCreated: 1, WallJoinUpdated: 1, WallJoinDeleted: 1,
  // component families (Phase 7); component types / instances reuse TypeCreated.. / ElementCreated.. unchanged
  FamilyCreated: 1, FamilyUpdated: 1, FamilyDeleted: 1,
  // MEP core (Phase 13): systems and junctions are resources; route elements reuse ElementCreated / ElementUpdated / ElementDeleted (additive variant)
  MepSystemCreated: 1, MepSystemUpdated: 1, MepSystemDeleted: 1, SpatialUnitCreated: 1, SpatialUnitUpdated: 1, SpatialUnitDeleted: 1, MepJunctionCreated: 1, MepJunctionUpdated: 1, MepJunctionDeleted: 1,
  MaterialUpdated: 1, MaterialDeleted: 1, TypeUpdated: 1, TypeDeleted: 1,
};
/**
 * Upcasters for older BIM event versions (pure; see Phase 3).
 * ElementCreated v1 -> v2: walls / columns / beams written before Phase 5 have no recorded vertical
 *   intent; the only safe reading is that their stored height / z is fixed (never guessed from numbers).
 * ElementUpdated v1 -> v2: v1 payloads are valid v2 payloads (v2 only allows more fields).
 */
export const BIM_UPCASTERS: Upcaster[] = [
  { type: "ElementCreated", fromVersion: 1,
    upcast: (p: any) => (["wall", "column", "beam"].includes(p?.kind) && p.vertical === undefined ? { ...p, vertical: { mode: "fixed" } } : { ...p }) },
  { type: "ElementUpdated", fromVersion: 1, upcast: (p: any) => ({ ...p }) },
  /**
   * ElementCreated v2 -> v3 (Phase 9): the former per-category variants become engine variants with their
   * category. Pure and lossless: every field keeps its name and value; only kind / category / placement are set.
   */
  { type: "ElementCreated", fromVersion: 2, upcast: (p: any) => {
      const to = LEGACY_KIND_V3[p?.kind];
      if (!to) return { ...p };
      const { kind: _k, ...rest } = p;
      return { ...rest, kind: to.kind, category: to.category, ...(to.placement ? { placement: to.placement } : {}) };
    } },
];
/** Former storage kind -> canonical engine variant (the migration table; also used by compatible tool inputs). */
export const LEGACY_KIND_V3: Readonly<Record<string, { kind: string; category: string; placement?: string }>> = Object.freeze({
  beam: { kind: "profile_member", category: "structure.framing", placement: "member_axis" },
  column: { kind: "profile_member", category: "structure.column", placement: "member_vertical" },
  slab: { kind: "boundary", category: "architecture.floor" },
  door: { kind: "hosted_component", category: "architecture.door" },
  window: { kind: "hosted_component", category: "architecture.window" },
});
/**
 * Format version of BimState inside snapshots.
 * 1: Phases 1-4 (Phase 4 resource events kept the shape).
 * 2: Phase 5 — walls, columns and beams carry `vertical`. Version-1 snapshots are ignored and the
 *    state is rebuilt from the event log through the upcasters (Phase 3 fallback).
 * 3: Phase 6 — explicit wall topology (`joins`). Older snapshots are ignored; replay of older
 *    events yields no joins (topology is never inferred from geometry).
 * 5: Phase 9 — engine variants: beams / columns -> profile_member, slabs -> boundary, doors / windows ->
 *    hosted_component (with category). Older snapshots are ignored and rebuilt from events (v2 -> v3 upcaster).
 * 7: Phase 14 — top-level `spatialUnits` (facilities / facility parts of infrastructure) and the optional project `georef`. Older snapshots are ignored and rebuilt
 *    from events (nothing is inferred: replay of older events yields no spatial units and no georeference). Additive events: SpatialUnit{Created,Updated,Deleted} v1.
 * 6: Phase 13 — top-level `mepSystems` / `mepJunctions`. Older snapshots are ignored and rebuilt from events (nothing is inferred: replay of older events
 *    yields no systems, junctions or MEP elements).
 * 4: Phase 7 — component families, component types and component elements. Older snapshots are
 *    ignored; replay of older events yields no families / components (nothing is inferred).
 */
export const BIM_STATE_VERSION = 7;

export function apply(s: BimState, e: DomainEvent): BimState {
  const p = e.payload;
  switch (e.type) {
    case "ProjectUpdated": Object.assign(s.project, p); break;
    case "StoreyCreated": s.storeys[p.id] = p; break;
    case "GridCreated": s.grids[p.id] = p; break;
    case "MaterialCreated": s.materials[p.id] = p; break;
    case "TypeCreated": s.types[p.id] = p; break;
    // resource lifecycle: `changes` holds only the explicitly editable fields (validated before commit)
    case "StoreyUpdated": Object.assign(s.storeys[p.id], p.changes); break;
    case "StoreyDeleted": delete s.storeys[p.id]; break;
    case "GridUpdated": Object.assign(s.grids[p.id], p.changes); break;
    case "GridDeleted": delete s.grids[p.id]; break;
    case "MaterialUpdated": Object.assign(s.materials[p.id], p.changes); break;
    case "MaterialDeleted": delete s.materials[p.id]; break;
    case "TypeUpdated": Object.assign(s.types[p.id], p.changes); break;
    case "TypeDeleted": delete s.types[p.id]; break;
    case "WallJoinCreated": s.joins[p.join.id] = p.join; break;
    case "WallJoinUpdated": (s.joins[p.id] as { members: WallEndpoint[] }).members = p.members; break;
    case "WallJoinDeleted": delete s.joins[p.id]; break;
    case "FamilyCreated": s.families[p.id] = p; break;
    case "FamilyUpdated": Object.assign(s.families[p.id], p.changes); break;
    case "FamilyDeleted": delete s.families[p.id]; break;
    case "SpatialUnitCreated": (s.spatialUnits ??= {})[p.id] = p; break;
    case "SpatialUnitUpdated": Object.assign(s.spatialUnits[p.id], p.changes); break;
    case "SpatialUnitDeleted": delete s.spatialUnits[p.id]; break;
    case "MepSystemCreated": s.mepSystems[p.id] = p; break;
    case "MepSystemUpdated": Object.assign(s.mepSystems[p.id], p.changes); break;
    case "MepSystemDeleted": delete s.mepSystems[p.id]; break;
    case "MepJunctionCreated": s.mepJunctions[p.junction.id] = p.junction; break;
    case "MepJunctionUpdated": s.mepJunctions[p.id].members = p.members; break;
    case "MepJunctionDeleted": delete s.mepJunctions[p.id]; break;
    case "ElementCreated": s.elements[p.id] = p; break;
    case "ElementUpdated": Object.assign(s.elements[p.id], p.changes); break;
    case "ElementDeleted": delete s.elements[p.id]; break;
    case "PropertiesSet": {
      const el = s.elements[p.id];
      el.props ??= {};
      el.props[p.pset] = { ...(el.props[p.pset] ?? {}), ...p.values };
      break;
    }
    case "CountersSet": Object.assign(s.counters, p); break;
  }
  return s;
}

// ------------------------------------------------------------------ derived values
export const thickness = (t: LayeredType) => t.layers.reduce((a, l) => a + l.thickness, 0);
/** A layered type (wall, slab, ceiling, roof, ...): by the registry's type FAMILY, never by a literal list of kinds. */
export const isLayeredType = (t: { kind: string } | undefined): t is LayeredType => !!t && TYPE_FAMILY_OF_KIND[t.kind] === "layered";

/**
 * How each end of a wall is physically resolved (derived from explicit topology — never persisted, never changes the axis):
 *   free              no relation (a legacy mitre hint, if any, still applies)
 *   endpoint_join     a two-wall junction (mitred, or square for a straight / near-parallel continuation)
 *   tee_branch        the branch end of a T: cut back to the near face of its host wall
 *   junction_fallback conservative square end: a junction of more than two walls, a shallow T (< MITER_MIN_ANGLE_DEG) or a cut
 *                     that would not leave a valid solid. No full commercial wall-join solver.
 */
export type EndKind = "free" | "endpoint_join" | "tee_branch" | "junction_fallback";
export interface WallEnds { start: EndKind; end: EndKind; startCut: EndCut | null; endCut: EndCut | null; }

/** The cut line of a T branch end: the host's near face (the side the branch lies on), or null when it cannot be cut safely. */
function teeCut(s: BimState, w: Wall, which: "start" | "end", hostId: string): EndCut | null {
  const h = s.elements[hostId];
  if (!h || h.kind !== "wall") return null;
  const hd = unit(sub(h.end, h.start)), bd = unit(sub(w.end, w.start));
  if (Math.abs(hd[0] * bd[1] - hd[1] * bd[0]) < MITER_MIN_SIN) return null;                    // shallow T: square fallback
  const e = which === "start" ? w.start : w.end, o = which === "start" ? w.end : w.start;
  const hn = leftNormal(hd), side = Math.sign((o[0] - e[0]) * hn[0] + (o[1] - e[1]) * hn[1]);
  if (side === 0) return null;
  const th = thickness(s.types[h.type] as LayeredType);
  return { p: [e[0] + hn[0] * side * th / 2, e[1] + hn[1] * side * th / 2], d: hd };
}
export function wallEnds(s: BimState, w: Wall): WallEnds {
  const kinds: Record<"start" | "end", EndKind> = { start: "free", end: "free" };
  const cuts: Record<"start" | "end", EndCut | null> = { start: null, end: null };
  for (const j of Object.values(s.joins ?? {})) {
    if (j.kind === "endpoint_segment") {
      if (j.endpoint.wall !== w.id) continue;
      const c = teeCut(s, w, j.endpoint.endpoint, j.host);
      kinds[j.endpoint.endpoint] = c ? "tee_branch" : "junction_fallback";
      cuts[j.endpoint.endpoint] = c;
    } else {
      const m = j.members.find((x) => x.wall === w.id);
      if (m) kinds[m.endpoint] = j.members.length > 2 ? "junction_fallback" : "endpoint_join";
    }
  }
  const t = thickness(s.types[w.type] as LayeredType), d = unit(sub(w.end, w.start));
  const valid = (sc: EndCut | null, ec: EndCut | null) => {                                     // the clipped solid must keep a positive extent
    const f = wallFootprint(w.start, w.end, t, w.prevDir, w.nextDir, sc, ec);
    const pr = (p: P2) => (p[0] - w.start[0]) * d[0] + (p[1] - w.start[1]) * d[1];
    return Math.max(pr(f[0]), pr(f[3])) < Math.min(pr(f[1]), pr(f[2])) - GEOMETRY_EPSILON;
  };
  if ((cuts.start || cuts.end) && !valid(cuts.start, cuts.end)) {
    for (const k of ["start", "end"] as const) if (cuts[k]) { kinds[k] = "junction_fallback"; cuts[k] = null; }
  }
  return { start: kinds.start, end: kinds.end, startCut: cuts.start, endCut: cuts.end };
}

export function wallFrame(s: BimState, w: Wall) {
  const t = thickness(s.types[w.type] as LayeredType);
  const dir = unit(sub(w.end, w.start));
  const ends = wallEnds(s, w);
  const footprint = wallFootprint(w.start, w.end, t, w.prevDir, w.nextDir, ends.startCut, ends.endCut);
  // Each shared face uses BOTH wall thicknesses. Reusing our own thickness for
  // the neighbour leaves a wedge at a 110/220 mm (or any unequal) corner.
  for (const j of Object.values(s.joins ?? {})) {
    if (j.kind !== 'endpoint_endpoint' || j.members.length !== 2) continue;
    const own = j.members.find(m=>m.wall===w.id); if (!own) continue;
    const other = j.members.find(m=>m.wall!==w.id)!;
    const nb = s.elements[other.wall] as Wall;
    const joint = w[own.endpoint], toward = unit(sub(other.endpoint==='start'?nb.end:nb.start,joint));
    const nd:P2 = own.endpoint==='start'?[-toward[0],-toward[1]]:toward;
    if (Math.abs(dir[0]*nd[1]-dir[1]*nd[0])<MITER_MIN_SIN) continue;
    const nt=thickness(s.types[nb.type] as LayeredType), n=leftNormal(dir), nn=leftNormal(nd);
    for(const side of [1,-1]) {
      const p=intersect([joint[0]+n[0]*side*t/2,joint[1]+n[1]*side*t/2],dir,
        [joint[0]+nn[0]*side*nt/2,joint[1]+nn[1]*side*nt/2],nd);
      if(p)footprint[own.endpoint==='start'?(side===1?0:3):(side===1?1:2)]=p;
    }
  }
  return { t, dir, length: dist(w.start, w.end), ends,
           footprint };
}

export function hostOf(s: BimState, o: Opening): Wall { return s.elements[o.host] as Wall; }

/** Net quantities used by queries and tests. */
/** Net quantities used by queries and tests: the engine's handler computes them. */
export function quantities(s: BimState, el: Element): Record<string, number> { return handlersOf(el).quantities(s, el); }
/** The quantity formulas of the original engines (wall ... mep_segment): moved behind their handlers, unchanged. */
export function builtinQuantities(s: BimState, el: Element): Record<string, number> {
  switch (el.kind) {                                   // engine variants (one formula per engine, never per category)
    case "wall": {
      const f = wallFrame(s, el);
      const effectiveHeight = wallRoof(s, el)?.meanHeight ?? el.height;
      const gross = area(f.footprint) * effectiveHeight;
      const voids = Object.values(s.elements).filter((o): o is Opening => o.kind === "opening" && o.host === el.id)
        .reduce((a, o) => a + o.width * o.height * f.t, 0);
      return { length: f.length, thickness: f.t, height: el.height, gross_volume: gross, net_volume: gross - voids,
               side_area_net: f.length * effectiveHeight - voids / f.t };
    }
    case "boundary": {
      const ty = s.types[el.type] as LayeredType, t = thickness(ty);
      const a = area(el.outline) - el.holes.reduce((x, h) => x + area(h), 0);
      // roofs (by their TYPE kind, flat or sloped) report the roof set; the thickness of a sloped plane is perpendicular to it, so the
      // surface area (not the plan area) times the thickness is the volume. Floors and ceilings keep {area, thickness, volume}.
      if (ty.kind === "roof") {
        const cos = el.slope ? slopeFrame({ outline: el.outline, slope: el.slope }).cos : 1, surface = a / cos;
        return { projected_area: a, surface_area: surface, thickness: t, volume: surface * t, pitch: el.slope?.pitch ?? 0 };
      }
      return { area: a, thickness: t, volume: a * t };
    }
    case "stair": {
      const g = stairGeometry(el);
      return { total_rise: el.height, run: g.run, width: el.width, riser_count: el.riserCount, riser_height: g.riserHeight, tread_depth: g.treadDepth,
               slope_angle: g.slopeAngle, footprint_area: g.run * el.width };
    }
    case "path": {
      const ty = s.types[el.type] as RailingType;
      return { path_length: pathLength(el), height: el.height, post_count: pathPosts(el, ty.maxPostSpacing).length };
    }
    case "mep_segment": return mepSegmentQuantities(s, el);
    case "profile_member": {
      const a = sectionArea((s.types[el.type] as ProfileType).profile);              // ONE section-area source (section.ts)
      if (el.placement === "member_axis") { const l = dist(el.start, el.end); return { length: l, section_area: a, volume: a * l }; }
      if (el.placement === "member_vertical" && el.direction !== "down") return { height: el.height, section_area: a, volume: a * el.height };      // columns: unchanged
      const l = memberLength(s, el);                                                  // braces: the 3D length; piles: the (downward) length
      return { length: l, section_area: a, cross_section_area: a, volume: a * l };
    }
    case "opening": return { width: el.width, height: el.height, area: el.width * el.height };
    default: return {};
  }
}

// ------------------------------------------------------------------ invariants

