/**
 * BIM taxonomy (Phase 7): Discipline -> Category -> (Family -> Type -> Instance).
 *
 * Disciplines and categories are APPLICATION METADATA, not project resources: they are not event
 * sourced. Category ids are persistent public identifiers once a Family references them:
 *   - never reuse an id for another meaning;
 *   - never delete a definition that persisted Families may reference — mark it `deprecated`;
 *   - an unknown category id in persisted state is an integrity error (INVALID_CATEGORY).
 *
 * CATEGORY = what an object is; ENGINE = how it behaves (engines/registry.ts, Phase 9+): wall, point_component, hosted_component,
 * profile_member, boundary, spatial, stair, path, mep_network (+ the internal void and the reserved proxy). Many categories share one engine.
 *   - Elements of a single-category variant (walls, openings) have their category DERIVED from the variant (nothing persisted);
 *     profile members, boundaries, hosted components, stairs, paths and spatial elements persist their (immutable) category;
 *   - point components get theirs through Type -> Family (a Family is a resource strategy of the point_component engine, not a universal rule).
 * (The Phase 7 classes "native" / "component" are retired: they survive only as deprecated query-filter aliases.)
 */
import { IFC_CLASS_DATA, SCHEMA_EQUIPMENT_CATEGORIES } from "./ifc-schema-data.js";
import { DomainError } from "@insa/core";
import { EngineId, PlacementKind, findEngine, TYPE_FAMILY_OF_KIND } from "./engines/registry.js";
import type { BimState, Element } from "./model.js";

// ---------------------------------------------------------------- disciplines
export const DISCIPLINES = [
  { id: "architecture", name: "Architecture" }, { id: "structure", name: "Structure" },
  { id: "mechanical", name: "Mechanical" }, { id: "electrical", name: "Electrical" },
  { id: "plumbing", name: "Plumbing" }, { id: "fire", name: "Fire Protection" },
  { id: "site", name: "Site" }, { id: "spatial", name: "Spatial" }, { id: "generic", name: "Generic" },
] as const;
export type DisciplineId = (typeof DISCIPLINES)[number]["id"];

// ---------------------------------------------------------------- capabilities (the one authoritative list)
/**
 * Declarative metadata: describes what a category is, never replaces domain validation.
 * Some capabilities have no behaviour yet (e.g. systemConnectable: MEP connectors are a later phase).
 */
/**
 * Declarative metadata, never behaviour. hasMaterial: the category's TYPE (or family) may reference a material resource (layers, a profile
 * material, a component material). hasType: its elements are typed. The engine decides how they actually behave.
 */
export const CAPABILITIES = [
  "hasType", "hasMaterial", "levelBased", "pointPlaced", "rotatable", "movable", "roomBounding",
  "joinable", "hostsOpenings", "hosted", "curveBased", "profileBased", "systemConnectable",
  "roomBoundingConsumer",                                // spatial elements: their boundary comes from room-bounding elements (Phase 8)
] as const;
export type Capability = (typeof CAPABILITIES)[number];

/** Phase 9: concrete behaviour engines (engines/registry.ts) replace the broad native / component classes. */
export type Engine = EngineId;
export type { PlacementKind } from "./engines/registry.js";

export interface CategoryDefinition {
  readonly id: string;
  readonly name: string;
  readonly discipline: DisciplineId;
  readonly engine: Engine;
  readonly capabilities: readonly Capability[];
  readonly placements: readonly PlacementKind[];        // component categories: placements a Family may use
  readonly ifcClass?: string;                           // IFC semantic class (geometry comes from the engine), only where unambiguous
  readonly deprecated?: boolean;
  /** type kinds the category accepts (data, not code; within the engine's type families) */
  readonly typeKinds?: readonly string[];
  /** id allocation key of its elements (keeps historical prefixes: C-, B-, S-, D-, N-) */
  readonly idKey?: string;
  /** boundary categories: which side of the reference surface the layered thickness lies on (floors / roofs: below; ceilings: above) */
  readonly thickness?: "below" | "above";
  /** vertical profile members: "down" for piles (the canonical absent form = up: columns) */
  readonly memberDirection?: "down";
  /** IFC PredefinedType of this category's products (e.g. BRACE, BASESLAB, SHEAR); absent = the class default */
  readonly ifcPredefined?: string;
  /** the VALID IFC PredefinedType values of this category's class (schema-derived; a type's predefinedType must be one of them) */
  readonly ifcPredefinedValues?: readonly string[];
  /** the HIGHEST authoring level this category may claim (0-3), when it is below its engine's: a category that only adds a class / PredefinedType to a richer engine's behaviour */
  readonly authoringLevel?: 0 | 1 | 2 | 3;
  /** what this category deliberately does NOT model (read by the coverage report) */
  readonly limitations?: readonly string[];
  /** assembly engine only: the id of the data-driven rule that validates and quantifies this kind of assembly (engines/assembly.ts) */
  readonly assemblyRule?: string;
  /** mep_network categories: their strict MEP domain (never inferred from a type name) */
  readonly mepDomain?: "piping" | "hvac" | "electrical";
}

const COMPONENT_CAPS: Capability[] = ["hasType", "hasMaterial", "levelBased", "pointPlaced", "rotatable", "movable"];
const BUILT_IN: CategoryDefinition[] = [
  // ---- system categories (wall / boundary / profile_member / hosted_component / stair / path engines)
  { id: "architecture.wall", name: "Walls", discipline: "architecture", engine: "wall", placements: ["wall_axis"], typeKinds: ["wall"],
    capabilities: ["hasType", "hasMaterial", "levelBased", "curveBased", "movable", "roomBounding", "joinable", "hostsOpenings"], ifcClass: "IfcWall" },
  { id: "architecture.floor", name: "Floors", discipline: "architecture", engine: "boundary", placements: ["boundary"], typeKinds: ["slab"], idKey: "slab",
    capabilities: ["hasType", "hasMaterial", "levelBased", "movable", "roomBounding"], ifcClass: "IfcSlab" },
  // ---- Phase 11: architecture expansion. Ceiling and roof are boundary categories (NOT floors: own types, own thickness direction,
  // own IFC class); the stair has its own engine; the railing is the first category of the path engine.
  { id: "architecture.ceiling", name: "Ceilings", discipline: "architecture", engine: "boundary", placements: ["boundary"], typeKinds: ["ceiling"], idKey: "ceiling", thickness: "above",
    capabilities: ["hasType", "hasMaterial", "levelBased", "movable"], ifcClass: "IfcCovering" },
  { id: "architecture.roof", name: "Roofs", discipline: "architecture", engine: "boundary", placements: ["boundary", "boundary_plane"], typeKinds: ["roof"], idKey: "roof", thickness: "below",
    capabilities: ["hasType", "hasMaterial", "levelBased", "movable"], ifcClass: "IfcRoof" },
  { id: "architecture.stair", name: "Stairs", discipline: "architecture", engine: "stair", placements: ["stair_run"], typeKinds: ["stair"], idKey: "stair",
    capabilities: ["hasType", "hasMaterial", "levelBased", "movable"], ifcClass: "IfcStair" },
  { id: "architecture.railing", name: "Railings", discipline: "architecture", engine: "path", placements: ["path"], typeKinds: ["railing"], idKey: "railing",
    capabilities: ["hasType", "hasMaterial", "levelBased", "curveBased", "movable"], ifcClass: "IfcRailing" },
  { id: "architecture.opening", name: "Openings", discipline: "architecture", engine: "void", placements: ["host"],
    capabilities: ["levelBased", "hosted"], ifcClass: "IfcOpeningElement" },
  { id: "architecture.door", name: "Doors", discipline: "architecture", engine: "hosted_component", placements: ["host"], typeKinds: ["door"], idKey: "door",
    capabilities: ["hasType", "levelBased", "hosted"], ifcClass: "IfcDoor" },
  { id: "architecture.window", name: "Windows", discipline: "architecture", engine: "hosted_component", placements: ["host"], typeKinds: ["window"], idKey: "window",
    capabilities: ["hasType", "levelBased", "hosted"], ifcClass: "IfcWindow" },
  { id: "structure.column", name: "Structural Columns", discipline: "structure", engine: "profile_member", placements: ["member_vertical"], typeKinds: ["column"], idKey: "column",
    capabilities: ["hasType", "hasMaterial", "levelBased", "pointPlaced", "rotatable", "movable", "profileBased"], ifcClass: "IfcColumn" },
  // ---- Phase 12: structural expansion on the EXISTING profile_member / wall / boundary engines (no new element kind)
  // ---- Phase 13: MEP network categories (ONE mep_network engine: the categories are semantic, not four engines)
  { id: "plumbing.pipe", name: "Pipes", discipline: "plumbing", engine: "mep_network", placements: ["mep_route"], typeKinds: ["pipe"], idKey: "mep_segment", mepDomain: "piping",
    capabilities: ["hasType", "hasMaterial", "levelBased", "curveBased", "movable", "systemConnectable"], ifcClass: "IfcPipeSegment", ifcPredefined: "RIGIDSEGMENT" },
  { id: "mechanical.duct", name: "Ducts", discipline: "mechanical", engine: "mep_network", placements: ["mep_route"], typeKinds: ["duct"], idKey: "mep_segment", mepDomain: "hvac",
    capabilities: ["hasType", "hasMaterial", "levelBased", "curveBased", "movable", "systemConnectable"], ifcClass: "IfcDuctSegment", ifcPredefined: "RIGIDSEGMENT" },
  { id: "electrical.cable_tray", name: "Cable Trays", discipline: "electrical", engine: "mep_network", placements: ["mep_route"], typeKinds: ["cable_tray"], idKey: "mep_segment", mepDomain: "electrical",
    capabilities: ["hasType", "hasMaterial", "levelBased", "curveBased", "movable", "systemConnectable"], ifcClass: "IfcCableCarrierSegment", ifcPredefined: "CABLETRAYSEGMENT" },
  { id: "electrical.conduit", name: "Conduits", discipline: "electrical", engine: "mep_network", placements: ["mep_route"], typeKinds: ["conduit"], idKey: "mep_segment", mepDomain: "electrical",
    capabilities: ["hasType", "hasMaterial", "levelBased", "curveBased", "movable", "systemConnectable"], ifcClass: "IfcCableCarrierSegment", ifcPredefined: "CONDUITSEGMENT" },
  // ---- Phase 14: more classes through EXISTING engines (no new engine, no new element kind)
  { id: "structure.plate", name: "Plates", discipline: "structure", engine: "boundary", placements: ["boundary"], typeKinds: ["slab"], idKey: "structural_slab", thickness: "below",
    capabilities: ["hasType", "hasMaterial", "levelBased", "movable"], ifcClass: "IfcPlate" },
  { id: "architecture.wall_standard_case", limitations: ["IfcWallStandardCase is deprecated in IFC4.3 (kept for IFC4 interchange); it behaves exactly as architecture.wall"], name: "Standard-case Walls", discipline: "architecture", engine: "wall", placements: ["wall_axis"], typeKinds: ["wall"],
    capabilities: ["hasType", "hasMaterial", "levelBased", "curveBased", "movable", "roomBounding", "joinable", "hostsOpenings"], ifcClass: "IfcWallStandardCase" },
  { id: "structure.caisson_foundation", authoringLevel: 1, limitations: ["generic prismatic section along a downward axis: no caisson-specific parameters (chamber, skirt, bell)"],  name: "Caisson Foundations", discipline: "structure", engine: "profile_member", placements: ["member_vertical"], typeKinds: ["column"], idKey: "pile", memberDirection: "down",
    capabilities: ["hasType", "hasMaterial", "levelBased", "pointPlaced", "rotatable", "movable", "profileBased"], ifcClass: "IfcCaissonFoundation" },
  { id: "generic.element_assembly", name: "Assemblies", discipline: "generic", engine: "assembly", placements: ["aggregate"], idKey: "assembly", capabilities: ["levelBased"], ifcClass: "IfcElementAssembly" },
  { id: "structure.deep_foundation", authoringLevel: 1, limitations: ["generic prismatic section along a downward axis: no foundation-specific parameters (shaft / base / socket), no capacity or soil interaction"],  name: "Deep Foundations", discipline: "structure", engine: "profile_member", placements: ["member_vertical"], typeKinds: ["column"], idKey: "pile", memberDirection: "down",
    capabilities: ["hasType", "hasMaterial", "levelBased", "pointPlaced", "rotatable", "movable", "profileBased"], ifcClass: "IfcDeepFoundation" },
  // ---- Phase 14: reinforcement (engine reinforcement): bound to an explicit host; the CLASS decides what the layers mean (bar set, two-way mesh, one tendon path)
  { id: "structure.rebar_set", name: "Reinforcing Bars", discipline: "structure", engine: "reinforcement", placements: ["host_layout"], typeKinds: ["rebar"], idKey: "reinforcement",
    capabilities: ["hasType", "hasMaterial", "levelBased"], ifcClass: "IfcReinforcingBar", ifcPredefined: "MAIN" },
  { id: "structure.rebar_mesh", name: "Reinforcing Meshes", discipline: "structure", engine: "reinforcement", placements: ["host_layout"], typeKinds: ["rebar"], idKey: "reinforcement",
    capabilities: ["hasType", "hasMaterial", "levelBased"], ifcClass: "IfcReinforcingMesh" },
  { id: "structure.tendon", name: "Tendons", discipline: "structure", engine: "reinforcement", placements: ["host_layout"], typeKinds: ["rebar"], idKey: "reinforcement",
    capabilities: ["hasType", "hasMaterial", "levelBased"], ifcClass: "IfcTendon", ifcPredefined: "STRAND" },
  { id: "structure.tendon_conduit", name: "Tendon Conduits", discipline: "structure", engine: "reinforcement", placements: ["host_layout"], typeKinds: ["rebar"], idKey: "reinforcement",
    capabilities: ["hasType", "hasMaterial", "levelBased"], ifcClass: "IfcTendonConduit", ifcPredefined: "DUCT" },
  // ---- Phase 14: MEP fitting products (engine mep_fitting): the category fixes the IFC class and the domain; the TYPE fixes the fitting kind
  { id: "plumbing.pipe_fitting", name: "Pipe Fittings", discipline: "plumbing", engine: "mep_fitting", placements: ["fitting_point"], typeKinds: ["mep_fitting"], idKey: "mep_fitting", mepDomain: "piping",
    capabilities: ["hasType", "hasMaterial", "levelBased", "pointPlaced", "rotatable", "movable", "systemConnectable"], ifcClass: "IfcPipeFitting" },
  { id: "mechanical.duct_fitting", name: "Duct Fittings", discipline: "mechanical", engine: "mep_fitting", placements: ["fitting_point"], typeKinds: ["mep_fitting"], idKey: "mep_fitting", mepDomain: "hvac",
    capabilities: ["hasType", "hasMaterial", "levelBased", "pointPlaced", "rotatable", "movable", "systemConnectable"], ifcClass: "IfcDuctFitting" },
  { id: "electrical.cable_carrier_fitting", name: "Cable Carrier Fittings", discipline: "electrical", engine: "mep_fitting", placements: ["fitting_point"], typeKinds: ["mep_fitting"], idKey: "mep_fitting", mepDomain: "electrical",
    capabilities: ["hasType", "hasMaterial", "levelBased", "pointPlaced", "rotatable", "movable", "systemConnectable"], ifcClass: "IfcCableCarrierFitting" },
  { id: "electrical.cable_fitting", name: "Cable Fittings", discipline: "electrical", engine: "mep_fitting", placements: ["fitting_point"], typeKinds: ["mep_fitting"], idKey: "mep_fitting", mepDomain: "electrical",
    capabilities: ["hasType", "hasMaterial", "levelBased", "pointPlaced", "rotatable", "movable", "systemConnectable"], ifcClass: "IfcCableFitting" },
  // ---- Phase 14: flexible / cable distribution segments on the SAME mep_network engine (route + connectors + junction semantics)
  { id: "electrical.cable_segment", authoringLevel: 1, limitations: ["a plain route with a round section: no conductor / insulation / core data, no bend or tension limits"],  name: "Cable Segments", discipline: "electrical", engine: "mep_network", placements: ["mep_route"], typeKinds: ["cable"], idKey: "mep_segment", mepDomain: "electrical",
    capabilities: ["hasType", "hasMaterial", "levelBased", "curveBased", "movable", "systemConnectable"], ifcClass: "IfcCableSegment", ifcPredefined: "CABLESEGMENT" },
  { id: "mechanical.flexible_duct", authoringLevel: 1, limitations: ["flexibility is category semantics only: a polyline route, no minimum bend radius or compression"],  name: "Flexible Ducts", discipline: "mechanical", engine: "mep_network", placements: ["mep_route"], typeKinds: ["duct"], idKey: "mep_segment", mepDomain: "hvac",
    capabilities: ["hasType", "hasMaterial", "levelBased", "curveBased", "movable", "systemConnectable"], ifcClass: "IfcDuctSegment", ifcPredefined: "FLEXIBLESEGMENT" },
  { id: "plumbing.flexible_pipe", authoringLevel: 1, limitations: ["flexibility is category semantics only: a polyline route, no minimum bend radius"],  name: "Flexible Pipes", discipline: "plumbing", engine: "mep_network", placements: ["mep_route"], typeKinds: ["pipe"], idKey: "mep_segment", mepDomain: "piping",
    capabilities: ["hasType", "hasMaterial", "levelBased", "curveBased", "movable", "systemConnectable"], ifcClass: "IfcPipeSegment", ifcPredefined: "FLEXIBLESEGMENT" },
  { id: "architecture.curtain_wall", name: "Curtain Walls", discipline: "architecture", engine: "curtain_wall", placements: ["wall_axis"], typeKinds: ["curtain_wall"], idKey: "curtain_wall",
    capabilities: ["hasType", "hasMaterial", "levelBased", "curveBased", "movable"], ifcClass: "IfcCurtainWall",
    limitations: ["no per-panel overrides (doors, louvres, spandrels), no curved axes, no corner mullions, no anchors / brackets or glazing build-up"] },
  { id: "architecture.pitched_roof", name: "Pitched Roofs", discipline: "architecture", engine: "pitched_roof", placements: ["boundary"], typeKinds: ["roof"], idKey: "pitched_roof",
    capabilities: ["hasType", "hasMaterial", "levelBased", "movable"], ifcClass: "IfcRoof",
    limitations: ["gable and hip forms on rectangular footprints only; no valleys, L / T / general footprints, roof openings, dormers or gambrel / mansard forms", "neighbouring plane slabs overlap at ridges and hips (volume_gross sums the planes); the roof type's layers are not associated with the plane parts"] },
  // ---- Phase 14 · Milestone B: ramps, stair flights, landings and the stair / ramp ASSEMBLIES that join them
  { id: "architecture.ramp_flight", name: "Ramp Flights", discipline: "architecture", engine: "ramp_flight", placements: ["ramp_run"], typeKinds: ["ramp"], idKey: "ramp",
    capabilities: ["hasType", "hasMaterial", "levelBased", "movable"], ifcClass: "IfcRampFlight", ifcPredefined: "STRAIGHT" },
  { id: "architecture.stair_flight", name: "Stair Flights", discipline: "architecture", engine: "stair", placements: ["stair_run"], typeKinds: ["stair"], idKey: "stair",
    capabilities: ["hasType", "hasMaterial", "levelBased", "movable"], ifcClass: "IfcStairFlight", ifcPredefined: "STRAIGHT" },
  { id: "architecture.landing", name: "Landings", discipline: "architecture", engine: "boundary", placements: ["boundary"], typeKinds: ["slab"], idKey: "slab",
    capabilities: ["hasType", "hasMaterial", "levelBased", "movable"], ifcClass: "IfcSlab", ifcPredefined: "LANDING",
    limitations: ["its type is a layered slab type (written as an IfcSlabType FLOOR); the landing is told apart by its PredefinedType only"] },
  { id: "architecture.stair_assembly", name: "Stairs (assemblies)", discipline: "architecture", engine: "assembly", placements: ["aggregate"], idKey: "assembly", capabilities: ["levelBased"], ifcClass: "IfcStair", assemblyRule: "stair_run" },
  { id: "architecture.ramp_assembly", name: "Ramps (assemblies)", discipline: "architecture", engine: "assembly", placements: ["aggregate"], idKey: "assembly", capabilities: ["levelBased"], ifcClass: "IfcRamp", assemblyRule: "ramp_run" },
  { id: "structure.brace", name: "Braces", discipline: "structure", engine: "profile_member", placements: ["member_spatial_axis"], typeKinds: ["beam"], idKey: "brace",
    capabilities: ["hasType", "hasMaterial", "levelBased", "curveBased", "movable", "profileBased"], ifcClass: "IfcMember", ifcPredefined: "BRACE" },
  { id: "structure.pile", name: "Piles", discipline: "structure", engine: "profile_member", placements: ["member_vertical"], typeKinds: ["column"], idKey: "pile", memberDirection: "down",
    capabilities: ["hasType", "hasMaterial", "levelBased", "pointPlaced", "rotatable", "movable", "profileBased"], ifcClass: "IfcPile" },
  { id: "structure.shear_wall", name: "Shear Walls", discipline: "structure", engine: "wall", placements: ["wall_axis"], typeKinds: ["wall"],
    capabilities: ["hasType", "hasMaterial", "levelBased", "curveBased", "movable", "roomBounding", "joinable", "hostsOpenings"], ifcClass: "IfcWall", ifcPredefined: "SHEAR" },
  { id: "structure.slab", name: "Structural Slabs", discipline: "structure", engine: "boundary", placements: ["boundary"], typeKinds: ["slab"], idKey: "structural_slab", thickness: "below",
    capabilities: ["hasType", "hasMaterial", "levelBased", "movable"], ifcClass: "IfcSlab" },
  { id: "structure.foundation_slab", name: "Foundation Slabs", discipline: "structure", engine: "boundary", placements: ["boundary"], typeKinds: ["foundation_slab"], idKey: "foundation_slab", thickness: "below",
    capabilities: ["hasType", "hasMaterial", "levelBased", "movable"], ifcClass: "IfcSlab", ifcPredefined: "BASESLAB" },
  { id: "structure.footing", name: "Footings", discipline: "structure", engine: "boundary", placements: ["boundary"], typeKinds: ["footing"], idKey: "footing", thickness: "below",
    capabilities: ["hasType", "hasMaterial", "levelBased", "movable"], ifcClass: "IfcFooting" },
  { id: "structure.framing", name: "Structural Framing", discipline: "structure", engine: "profile_member", placements: ["member_axis"], typeKinds: ["beam"], idKey: "beam",
    capabilities: ["hasType", "hasMaterial", "levelBased", "curveBased", "movable", "profileBased"], ifcClass: "IfcBeam" },
  // ---- generic components (one engine, many categories)
  { id: "architecture.furniture", name: "Furniture", discipline: "architecture", engine: "point_component", placements: ["level_point"], typeKinds: ["component"], capabilities: COMPONENT_CAPS, ifcClass: "IfcFurniture" },
  { id: "architecture.casework", name: "Casework", discipline: "architecture", engine: "point_component", placements: ["level_point"], typeKinds: ["component"], capabilities: COMPONENT_CAPS },
  { id: "architecture.generic_model", name: "Generic Models", discipline: "architecture", engine: "point_component", placements: ["level_point"], typeKinds: ["component"], capabilities: COMPONENT_CAPS, ifcClass: "IfcBuildingElementProxy" },
  { id: "mechanical.equipment", name: "Mechanical Equipment", discipline: "mechanical", engine: "point_component", placements: ["level_point"], typeKinds: ["component"], capabilities: [...COMPONENT_CAPS, "systemConnectable"] },
  { id: "plumbing.fixture", name: "Plumbing Fixtures", discipline: "plumbing", engine: "point_component", placements: ["level_point"], typeKinds: ["component"], capabilities: [...COMPONENT_CAPS, "systemConnectable"], ifcClass: "IfcSanitaryTerminal" },
  { id: "electrical.lighting_fixture", name: "Lighting Fixtures", discipline: "electrical", engine: "point_component", placements: ["level_point"], typeKinds: ["component"], capabilities: [...COMPONENT_CAPS, "systemConnectable"], ifcClass: "IfcLightFixture" },
  { id: "electrical.equipment", name: "Electrical Equipment", discipline: "electrical", engine: "point_component", placements: ["level_point"], typeKinds: ["component"], capabilities: [...COMPONENT_CAPS, "systemConnectable"] },
  { id: "site.component", name: "Site Components", discipline: "site", engine: "point_component", placements: ["level_point"], typeKinds: ["component"], capabilities: COMPONENT_CAPS, ifcClass: "IfcBuildingElementProxy" },
  // ---- spatial (Phase 8): one spatial engine, several categories
  { id: "architecture.room", name: "Rooms", discipline: "architecture", engine: "spatial", placements: ["spatial_point"], capabilities: ["levelBased", "movable", "roomBoundingConsumer"], ifcClass: "IfcSpace" },
  { id: "mechanical.space", name: "Spaces", discipline: "mechanical", engine: "spatial", placements: ["spatial_point"], capabilities: ["levelBased", "movable", "roomBoundingConsumer"], ifcClass: "IfcSpace" },
];

const registry = new Map<string, CategoryDefinition>();
const CATEGORY_ID = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
/**
 * Adds a category definition (built-ins at load; developers add new component categories here).
 * Ids are permanent: an id can never be registered twice, so it can never change meaning.
 */
export function registerCategory(def: CategoryDefinition): void {
  const bad = (m: string) => { throw new DomainError(`Category ${def.id}: ${m}`, "INVALID_CATEGORY", { categoryId: String(def.id) }); };
  if (!CATEGORY_ID.test(def.id)) bad("id must look like 'discipline.name' (lowercase, digits, _).");
  if (registry.has(def.id)) bad("is already registered; category ids can never be redefined.");
  if (!DISCIPLINES.some((x) => x.id === def.discipline)) bad(`unknown discipline ${def.discipline}.`);
  if (!def.id.startsWith(def.discipline + ".")) bad("id must start with its discipline.");
  const eng = findEngine(def.engine);
  if (!eng) bad(`unknown engine '${def.engine}'.`);
  if (eng!.status === "reserved") bad(`engine '${def.engine}' is reserved (not implemented); no category may use it yet.`);
  if (def.capabilities.some((c) => !(CAPABILITIES as readonly string[]).includes(c))) bad("unknown capability.");
  if (def.placements.some((p) => !eng!.placements.includes(p))) bad(`placements must be among the ${def.engine} engine's (${eng!.placements.join(", ")}).`);
  if (!def.placements.length) bad("a category needs at least one placement of its engine.");
  if (def.typeKinds?.some((k) => !eng!.typeFamilies.includes(TYPE_FAMILY_OF_KIND[k]))) bad(`type kinds must belong to the ${def.engine} engine's type families.`);
  const pv = def.ifcPredefinedValues ?? (def.ifcClass ? IFC_CLASS_DATA[def.ifcClass]?.predefined ?? undefined : undefined);
  // deep-frozen: nothing returned by getCategory() / listCategories() can change the registry
  registry.set(def.id, Object.freeze({ ...def, ...(pv ? { ifcPredefinedValues: Object.freeze([...pv]) } : {}), capabilities: Object.freeze([...def.capabilities].sort()), placements: Object.freeze([...def.placements]),
    ...(def.typeKinds ? { typeKinds: Object.freeze([...def.typeKinds]) } : {}) }));
}
BUILT_IN.forEach(registerCategory);
/**
 * Schema-derived categories (generated from the official IFC schema, scripts/ifc-schema-data.py): typed point components whose IFC class, valid
 * PredefinedTypes and attribute template come from the schema. They share the point_component engine: no engine and no element kind per class.
 */
SCHEMA_EQUIPMENT_CATEGORIES.forEach((c) => registerCategory({ id: c.id, name: c.name, discipline: c.discipline as DisciplineId, engine: "point_component", placements: ["level_point"], typeKinds: ["component"],
  capabilities: c.system ? [...COMPONENT_CAPS, "systemConnectable"] : COMPONENT_CAPS, ifcClass: c.ifcClass }));

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export const listDisciplines = () => [...DISCIPLINES];
/** All categories, ordered by discipline (registry order) then id. */
export function listCategories(): CategoryDefinition[] {
  const order = DISCIPLINES.map((d) => d.id as string);
  return [...registry.values()].sort((a, b) => order.indexOf(a.discipline) - order.indexOf(b.discipline) || cmp(a.id, b.id));
}
export const findCategory = (id: string) => registry.get(id);
export function getCategory(id: string): CategoryDefinition {
  const c = registry.get(id);
  if (!c) throw new DomainError(`Unknown category '${id}'.`, "INVALID_CATEGORY", { categoryId: String(id) });
  return c;
}
export const hasCapability = (c: CategoryDefinition, cap: Capability) => c.capabilities.includes(cap);
export const isSpatialCategory = (id: string) => findCategory(id)?.engine === "spatial";

// ---------------------------------------------------------------- type / element -> category (derived, never persisted)
/** Storage variants that hold exactly one category (their category is implied by the variant). */
export const SINGLE_CATEGORY_KIND: Readonly<Record<string, string>> = Object.freeze({ wall: "architecture.wall", opening: "architecture.opening" });
/** The "home" category of a non-family (system) type kind — used to describe types, not to restrict them. */
export const NATIVE_TYPE_CATEGORY: Readonly<Record<string, string>> = Object.freeze({
  wall: "architecture.wall", slab: "architecture.floor", ceiling: "architecture.ceiling", roof: "architecture.roof",
  stair: "architecture.stair", railing: "architecture.railing", footing: "structure.footing", foundation_slab: "structure.foundation_slab", pipe: "plumbing.pipe", duct: "mechanical.duct", cable_tray: "electrical.cable_tray", conduit: "electrical.conduit", cable: "electrical.cable_segment", rebar: "structure.rebar_set", ramp: "architecture.ramp_flight", curtain_wall: "architecture.curtain_wall", column: "structure.column", beam: "structure.framing",
  door: "architecture.door", window: "architecture.window",
});

/** Category of a type: system types by their home category; component types through their Family. */
export function categoryIdOfType(s: BimState, typeId: string): string | undefined {
  const t = s.types[typeId] as { kind: string; family?: string } | undefined;
  if (!t) return undefined;
  if (t.kind === "component") return t.family ? s.families?.[t.family]?.category : undefined;
  if (t.kind === "mep_fitting") return ({ piping: "plumbing.pipe_fitting", hvac: "mechanical.duct_fitting", electrical: "electrical.cable_carrier_fitting" } as Record<string, string>)[(t as unknown as { domain: string }).domain];   // the home category of a fitting type is its domain's
  return NATIVE_TYPE_CATEGORY[t.kind];
}
/**
 * Category of an element — the single source of its engine (engines/dispatch.ts):
 * components through Type -> Family; members, boundaries, hosted components and spatial elements carry their
 * immutable category; walls and openings are single-category variants.
 */
export function categoryIdOfElement(s: BimState, el: Element): string | undefined {
  if (el.kind === "component") return categoryIdOfType(s, el.type);
  if ("category" in el) return (el as { category: string }).category;
  return SINGLE_CATEGORY_KIND[el.kind];
}
