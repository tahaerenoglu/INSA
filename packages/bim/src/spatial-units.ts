/**
 * Spatial units (Phase 14, Milestone C): the IFC4.3 spatial structure of INFRASTRUCTURE: facilities (IfcRoad, IfcRailway, IfcBridge, IfcMarineFacility, IfcFacility)
 * aggregated by the site, and facility parts (IfcRoadPart, IfcRailwayPart, IfcBridgePart, IfcMarinePart, IfcFacilityPartCommon) aggregated by a facility or another
 * part. They are RESOURCES (like storeys), not elements: infrastructure products are CONTAINED in a facility part (or a facility), never in a building storey.
 * Also the coordinate semantics of the project: units are metres / radians; an optional map conversion (IfcMapConversion + IfcProjectedCRS) places the local
 * coordinate system in a projected CRS: map = scale * R(local) + (E, N, H). Nothing is inferred (no CRS database, no datum transformation).
 */
import type { BimState, SpatialUnit, Georeference } from "./model.js";
import { IFC_SPATIAL_DATA } from "./ifc-schema-data.js";

export const FACILITY_CLASSES = Object.entries(IFC_SPATIAL_DATA).filter(([, d]) => d.kind === "facility").map(([n]) => n);
export const PART_CLASSES = Object.entries(IFC_SPATIAL_DATA).filter(([, d]) => d.kind === "facility_part").map(([n]) => n);
/** the facility a typed part belongs to (a modelling-quality rule: a road part inside a bridge is a mistake); the common part fits anywhere */
const PART_OF: Readonly<Record<string, string | null>> = Object.freeze({ IfcRoadPart: "IfcRoad", IfcRailwayPart: "IfcRailway", IfcBridgePart: "IfcBridge", IfcMarinePart: "IfcMarineFacility", IfcFacilityPartCommon: null });
const MAX_DEPTH = 12;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const unitsOf = (s: BimState) => Object.values(s.spatialUnits ?? {}).sort((a, b) => cmp(a.id, b.id));
/** ancestors, nearest first; stops (never loops) on a cycle or a dangling parent */
export function unitAncestors(s: BimState, id: string): SpatialUnit[] {
  const out: SpatialUnit[] = [], seen = new Set<string>([id]);
  for (let u = s.spatialUnits?.[id]; u?.parent; ) { const p = s.spatialUnits[u.parent]; if (!p || seen.has(p.id)) break; out.push(p); seen.add(p.id); u = p; }
  return out;
}
export const unitPath = (s: BimState, id: string): string => [...unitAncestors(s, id).reverse(), s.spatialUnits[id]].filter(Boolean).map((u) => u!.name).join("/");
export const unitChildren = (s: BimState, id: string | null) => unitsOf(s).filter((u) => u.parent === id);
/** the top-level facility a unit lives under (the unit itself for a top-level facility) */
export function rootFacility(s: BimState, u: SpatialUnit): SpatialUnit | undefined {
  const chain = [u, ...unitAncestors(s, u.id)];
  return [...chain].reverse().find((x) => x.kind === "facility");
}

/** true when following the parent chain from `u` ever returns to `u` (or never ends): walked directly, because unitAncestors stops on a repeat by design */
function wouldCycle(s: BimState, u: SpatialUnit): boolean {
  for (let cur: string | null = u.parent, n = 0; cur; cur = s.spatialUnits?.[cur]?.parent ?? null) { if (cur === u.id || ++n > 64) return true; }
  return false;
}
/** the first problem of a spatial unit in the given state (null = valid): [reason, message, field] */
export function spatialUnitProblem(s: BimState, u: SpatialUnit): { reason: "INVALID_SPATIAL_UNIT" | "INVALID_REFERENCE"; message: string; field: string } | null {
  const bad = (message: string, field: string, reason: "INVALID_SPATIAL_UNIT" | "INVALID_REFERENCE" = "INVALID_SPATIAL_UNIT") => ({ reason, message: `Spatial unit ${u.name}: ${message}`, field });
  const d = IFC_SPATIAL_DATA[u.ifcClass];
  if (!d) return bad(`unknown IFC class '${String(u.ifcClass)}' (facilities: ${FACILITY_CLASSES.join(", ")}; parts: ${PART_CLASSES.join(", ")}).`, "ifc_class");
  if (d.kind !== u.kind) return bad(`${u.ifcClass} is a ${d.kind.replace("_", " ")} class, not a ${u.kind.replace("_", " ")}.`, "ifc_class");
  if (typeof u.name !== "string" || !u.name.trim() || u.name.length > 120) return bad("a name of 1-120 characters is required.", "name");
  if (!d.composition.includes(u.composition)) return bad(`composition must be one of ${d.composition.join(" | ")}.`, "composition");
  if (u.kind === "facility") {
    if (u.usage !== undefined) return bad("a facility has no usage type (only facility parts do).", "usage");
  } else if (!u.usage || !d.usage!.includes(u.usage)) return bad(`a facility part needs a usage type: ${d.usage!.join(" | ")}.`, "usage");
  if (u.predefinedType !== undefined && !(d.predefined ?? []).includes(u.predefinedType)) return bad(`'${u.predefinedType}' is not a valid ${u.ifcClass} PredefinedType (${(d.predefined ?? []).join(", ") || "none: the class has no PredefinedType"}).`, "predefined_type");
  if (u.parent !== null) {
    const p = s.spatialUnits?.[u.parent];
    if (!p) return bad(`parent ${u.parent} does not exist.`, "parent", "INVALID_REFERENCE");
    if (u.kind === "facility" && p.kind !== "facility") return bad("a facility sits directly under the site or inside another facility, never inside a facility part.", "parent");
    if (unitAncestors(s, u.id).length >= MAX_DEPTH) return bad(`the hierarchy is deeper than ${MAX_DEPTH} levels.`, "parent");
    if (wouldCycle(s, u)) return bad("the hierarchy would be cyclic.", "parent");
  } else if (u.kind === "facility_part") return bad("a facility part belongs to a facility or another part (it cannot hang directly under the site).", "parent");
  if (u.kind === "facility_part") {
    const want = PART_OF[u.ifcClass], root = rootFacility(s, u);
    if (want && root && root.ifcClass !== want) return bad(`${u.ifcClass} belongs inside an ${want}, not inside the ${root.ifcClass} '${root.name}' (use IfcFacilityPartCommon for a neutral part).`, "ifc_class");
  }
  if (unitChildren(s, u.parent).some((x) => x.id !== u.id && same(x.name, u.name))) return bad(`the name is already used by a sibling (names are unique within one parent).`, "name");
  return null;
}

// ---------------------------------------------------------------- coordinate semantics
export const LENGTH_UNIT = "METRE" as const, ANGLE_UNIT = "RADIAN" as const;
export function georefProblem(g: Georeference): string | null {
  const fin = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  if (!g?.crs || typeof g.crs.name !== "string" || !g.crs.name.trim()) return "the CRS needs a name (e.g. 'EPSG:5254').";
  for (const k of ["eastings", "northings", "orthogonalHeight", "xAxisAbscissa", "xAxisOrdinate", "scale"] as const) if (!fin(g[k])) return `${k} must be a finite number.`;
  if (Math.hypot(g.xAxisAbscissa, g.xAxisOrdinate) < 1e-9) return "the local X axis direction (xAxisAbscissa, xAxisOrdinate) cannot be the zero vector.";
  if (!(g.scale > 0)) return "scale must be greater than 0.";
  return null;
}
/** the grid rotation of the local X axis, degrees counter-clockwise from map East (derived) */
export const georefRotationDegrees = (g: Georeference) => (Math.atan2(g.xAxisOrdinate, g.xAxisAbscissa) * 180) / Math.PI;
const unitAxis = (g: Georeference): [number, number] => { const l = Math.hypot(g.xAxisAbscissa, g.xAxisOrdinate); return [g.xAxisAbscissa / l, g.xAxisOrdinate / l]; };
const r9 = (v: number) => Math.round(v * 1e9) / 1e9 + 0;
/** local project coordinates -> projected map coordinates: map = scale * R * local + (E, N, H) */
export function toMap(g: Georeference, p: [number, number, number]): [number, number, number] {
  const [a, b] = unitAxis(g);
  return [r9(g.eastings + g.scale * (a * p[0] - b * p[1])), r9(g.northings + g.scale * (b * p[0] + a * p[1])), r9(g.orthogonalHeight + g.scale * p[2])];
}
export function toLocal(g: Georeference, m: [number, number, number]): [number, number, number] {
  const [a, b] = unitAxis(g), dx = (m[0] - g.eastings) / g.scale, dy = (m[1] - g.northings) / g.scale;
  return [r9(a * dx + b * dy), r9(-b * dx + a * dy), r9((m[2] - g.orthogonalHeight) / g.scale)];
}
