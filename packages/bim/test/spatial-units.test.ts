/** Phase 14 · Milestone C (part 1): the infrastructure spatial structure (facilities / facility parts), the coordinate semantics and the container capability. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, canonicalJson } from "@insa/core";
import { bimModule, BimState, Element, toIfc, toMap, toLocal, registerEngine, unregisterEngine, registerCategory, defineHandlers, undefineHandlers, checkElement, resourceUsage, BIM_STATE_VERSION } from "../src/index.js";
import { setup, P } from "./authoring-fixture.js";

const hasIfc = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
declare module "../src/engines/registry.js" { interface ExtensionEngines { test_infra: true } interface ExtensionPlacements { infra_point: true } }
interface InfraMarker { kind: "test_infra_marker"; id: string; storey: string; category: string; unit: string; at: [number, number] }
const asEl = (m: InfraMarker) => m as unknown as Element;
registerEngine({ id: "test_infra", name: "Test infrastructure marker", status: "implemented", elementKind: "test_infra_marker", placements: ["infra_point"], representations: ["marker"], typeFamilies: [], authoringLevel: 1, operations: ["create", "delete"], description: "test-only" });
registerCategory({ id: "site.test_infra_marker", name: "Test infra markers", discipline: "site", engine: "test_infra", placements: ["infra_point"], capabilities: ["pointPlaced"], ifcClass: "IfcBuildingElementProxy" });
defineHandlers<InfraMarker>({
  kind: "test_infra_marker", placementKind: () => "infra_point", semanticLabel: true, container: (el) => ({ kind: "spatial_unit", id: el.unit }),
  placement: (_s, el) => ({ kind: "infra_point", at: el.at }), representation: (_s, el) => ({ kind: "marker", at: el.at }), signature: () => null, validate: () => undefined, quantities: () => ({ marker: 1 }),
  plan: { mode: "none", reason: "test" },
  ifc: { mode: "writer", write: (c, els) => { for (const el of els) { const ref = c.add("IFCBUILDINGELEMENTPROXY", `${c.gid(el.id)},$,${c.str(el.id)},$,$,${c.placement(c.unitPlacement(el.unit), c.identity)},$,${c.str(el.id)},.ELEMENT.`); c.elRef[el.id] = ref; c.containIn(el.unit, ref); } } },
});
after(() => { unregisterEngine("test_infra"); undefineHandlers("test_infra_marker"); });

const mk = (t: any, units: object[]) => t.run("bim_create_spatial_units", { units });
async function roadModel(policy: { everyEvents: number; keep: number } | false = false) {
  const t = await setup(policy);
  await mk(t, [{ name: "Ring Road", kind: "facility", ifc_class: "IfcRoad" }, { name: "Carriageway", kind: "facility_part", ifc_class: "IfcRoadPart", parent: "Ring Road", usage: "LONGITUDINAL", predefined_type: "CARRIAGEWAY" },
    { name: "Km 0-1", kind: "facility_part", ifc_class: "IfcFacilityPartCommon", parent: "Carriageway", usage: "LONGITUDINAL", predefined_type: "SEGMENT" }]);                       // SU-0001, SU-0002, SU-0003
  return t;
}

test("hierarchy: facilities under the site, parts inside; typed parts stay in their facility class; names unique among siblings; enumerations from the schema; delete protection; undo / replay / snapshot; version 7", async () => {
  assert.equal(BIM_STATE_VERSION, 7);
  const policy = { everyEvents: 3, keep: 2 }, t = await roadModel(policy);
  const q = (await t.ex("bim_query_spatial_units", {})).result as any[];
  assert.deepEqual(q.map((u) => [u.id, u.path, u.depth, u.kind, u.ifcClass, u.root_facility]), [["SU-0001", "Ring Road", 0, "facility", "IfcRoad", "SU-0001"], ["SU-0002", "Ring Road/Carriageway", 1, "facility_part", "IfcRoadPart", "SU-0001"], ["SU-0003", "Ring Road/Carriageway/Km 0-1", 2, "facility_part", "IfcFacilityPartCommon", "SU-0001"]]);
  assert.deepEqual((await t.ex("bim_query_spatial_units", { parent: "Ring Road" })).result.map((u: any) => u.id), ["SU-0002"]);
  const n = (await t.p.store(P).readEvents()).length, bad = (units: object[], reason: string) => t.rejected("bim_create_spatial_units", { units }, reason);
  await bad([{ name: "Loose", kind: "facility_part", ifc_class: "IfcRoadPart", usage: "LATERAL" }], "INVALID_SPATIAL_UNIT");                                     // a part cannot hang under the site
  await bad([{ name: "Bridge in part", kind: "facility", ifc_class: "IfcBridge", parent: "SU-0002" }], "INVALID_SPATIAL_UNIT");                              // a facility never inside a part
  await bad([{ name: "Deck", kind: "facility_part", ifc_class: "IfcBridgePart", parent: "Ring Road", usage: "LATERAL" }], "INVALID_SPATIAL_UNIT");           // a bridge part inside a road
  await bad([{ name: "Carriageway", kind: "facility_part", ifc_class: "IfcRoadPart", parent: "Ring Road", usage: "LATERAL" }], "INVALID_SPATIAL_UNIT");     // sibling name taken
  await bad([{ name: "X", kind: "facility", ifc_class: "IfcRoadPart" }], "INVALID_SPATIAL_UNIT");                                                           // kind / class mismatch
  await bad([{ name: "X", kind: "facility", ifc_class: "IfcWall" }], "INVALID_SPATIAL_UNIT");
  await bad([{ name: "X", kind: "facility", ifc_class: "IfcRoad", predefined_type: "FOO" }], "INVALID_SPATIAL_UNIT");                                       // not in IfcRoadTypeEnum
  await bad([{ name: "X", kind: "facility", ifc_class: "IfcFacility", predefined_type: "NOTDEFINED" }], "INVALID_SPATIAL_UNIT");                            // IfcFacility has no PredefinedType
  await bad([{ name: "X", kind: "facility_part", ifc_class: "IfcRoadPart", parent: "Ring Road", usage: "SIDEWAYS" }], "INVALID_SPATIAL_UNIT");
  await bad([{ name: "X", kind: "facility", parent: "NOPE" }], "RESOURCE_NOT_FOUND");
  assert.equal((await t.p.store(P).readEvents()).length, n, "no refusal left anything behind");
  // a neutral part fits anywhere; a part under a different road may reuse a name; an ambiguous name needs the id
  await mk(t, [{ name: "Rail Line", kind: "facility", ifc_class: "IfcRailway" }, { name: "Carriageway", kind: "facility_part", ifc_class: "IfcFacilityPartCommon", parent: "Rail Line", usage: "NOTDEFINED" }]);
  await bad([{ name: "Lane 1", kind: "facility_part", ifc_class: "IfcRoadPart", parent: "Carriageway", usage: "LATERAL" }], "INVALID_INPUT");                      // 'Carriageway' is ambiguous now
  // update: rename, re-parent a facility, no cycles, class immutable
  await t.run("bim_update_spatial_units", { items: [{ unit: "SU-0003", set: { name: "Km 0-2", long_name: "first two kilometres" } }] });
  await t.run("bim_update_spatial_units", { items: [{ unit: "SU-0003", set: { parent: "SU-0004" } }] });                                                       // a NEUTRAL part may move into the railway ...
  await t.rejected("bim_update_spatial_units", { items: [{ unit: "SU-0002", set: { parent: "SU-0004" } }] }, "INVALID_SPATIAL_UNIT");                          // ... a ROAD part may not
  await t.run("bim_update_spatial_units", { items: [{ unit: "SU-0003", set: { parent: "SU-0002" } }] });                                                       // back into the road part
  await mk(t, [{ name: "Annex", kind: "facility", ifc_class: "IfcFacility", parent: "SU-0001" }]);                                                              // a facility inside a facility is allowed
  await t.rejected("bim_update_spatial_units", { items: [{ unit: "SU-0001", set: { parent: "Annex" } }] }, "INVALID_SPATIAL_UNIT");                              // cycle
  // delete protection: a unit with children is in use; a leaf is deletable; undo restores
  await t.rejected("bim_delete_spatial_units", { units: ["SU-0001"] }, "RESOURCE_IN_USE");
  const live = canonicalJson(await t.S());
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state(P, "bim")), live, "replay");
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy }).state(P, "bim")), live, "snapshot");
  await t.run("bim_delete_spatial_units", { units: ["Annex"] });
  assert.equal((await t.S()).spatialUnits["SU-0006"], undefined);
  await t.run("platform_undo", {});
  assert.ok((await t.S()).spatialUnits["SU-0006"]);
  assert.equal(resourceUsage(await t.S(), "spatial_unit", "SU-0001").usageCount, 2, "child units count as usage");
});

test("a system used only by a FITTING cannot be deleted (found while adding the usage rule: fittings were not counted)", async () => {
  const t = await setup();
  await t.run("bim_create_types", { types: [{ kind: "mep_fitting", name: "EL90", fitting: "elbow", domain: "piping", run: { shape: "round", diameter: 0.05 }, angle: 90, radius: 0.3 }] });
  await t.run("bim_create_mep_systems", { systems: [{ name: "W", domain: "piping", classification: "domestic_cold_water" }] });
  await t.run("bim_create_mep_fittings", { fittings: [{ category: "plumbing.pipe_fitting", type: "EL90", system: "W", storey: "L0", at: [0, 0] }] });
  await t.rejected("bim_delete_mep_systems", { systems: ["W"] }, "RESOURCE_IN_USE");
  await t.run("bim_delete_elements", { ids: ["FIT-0001"] });
  await t.run("bim_delete_mep_systems", { systems: ["W"] });
});

test("coordinate system: units, a georeference (map conversion) with independent conversion formulas, round trip, refusals, replay / snapshot / undo", async () => {
  const policy = { everyEvents: 2, keep: 2 }, t = await setup(policy);
  assert.deepEqual((await t.ex("bim_get_coordinate_system", {})).result.units, { length: "METRE", plane_angle: "RADIAN" });
  assert.equal((await t.ex("bim_get_coordinate_system", {})).result.georeference, null);
  await t.rejected("bim_convert_coordinates", { points: [[1, 2]], direction: "local_to_map" }, "GEOREFERENCE_NOT_SET");
  await t.rejected("bim_clear_georeference", {}, "GEOREFERENCE_NOT_SET");
  await t.rejected("bim_set_georeference", { crs: { name: "EPSG:5254" }, eastings: 1, northings: 1, scale: 0 }, "INVALID_GEOREFERENCE");
  await t.run("bim_set_georeference", { crs: { name: "EPSG:5254", description: "TUREF / TM30", map_projection: "TM", map_zone: "30" }, eastings: 500000, northings: 4540000, orthogonal_height: 100, rotation_degrees: 30, scale: 1 });
  const g = (await t.ex("bim_get_coordinate_system", {})).result.georeference;
  assert.ok(Math.abs(g.rotation_degrees - 30) < 1e-9 && Math.abs(g.xAxisAbscissa - Math.cos(Math.PI / 6)) < 1e-9 && g.crs.name === "EPSG:5254");
  // independent formula: map = (E, N, H) + R(30 deg) * local
  const [x, y, z] = [100, 40, 2], th = Math.PI / 6;
  const want = [500000 + x * Math.cos(th) - y * Math.sin(th), 4540000 + x * Math.sin(th) + y * Math.cos(th), 102];
  const out = (await t.ex("bim_convert_coordinates", { points: [[x, y, z], [0, 0]], direction: "local_to_map" })).result.points;
  assert.ok(out[0].every((v: number, i: number) => Math.abs(v - want[i]) < 1e-6) && out[1][0] === 500000 && out[1][2] === 100, JSON.stringify(out));
  const back = (await t.ex("bim_convert_coordinates", { points: [out[0]], direction: "map_to_local" })).result.points[0];
  assert.ok(back.every((v: number, i: number) => Math.abs(v - [x, y, z][i]) < 1e-6), "round trip");
  assert.deepEqual(toMap((await t.S()).project.georef!, [0, 0, 0]), [500000, 4540000, 100]);
  assert.deepEqual(toLocal((await t.S()).project.georef!, [500000, 4540000, 100]), [0, 0, 0]);
  // a scale: map = s * R * local + T
  await t.run("bim_set_georeference", { crs: { name: "LOCAL-GRID" }, eastings: 10, northings: 20, rotation_degrees: 90, scale: 2 });
  assert.deepEqual((await t.ex("bim_convert_coordinates", { points: [[1, 0, 1]], direction: "local_to_map" })).result.points[0], [10, 22, 2]);        // 90 deg: local +X -> map +N, doubled
  const live = canonicalJson(await t.S());
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state(P, "bim")), live, "replay");
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy }).state(P, "bim")), live, "snapshot");
  await t.run("platform_undo", {});
  assert.equal((await t.S()).project.georef!.crs.name, "EPSG:5254", "undo restored the earlier georeference");
  await t.run("bim_clear_georeference", {});
  assert.equal(!(await t.S()).project.georef, true);
});

test("container capability: infrastructure elements live in a facility part, never a storey; a missing unit is refused; a used unit cannot be deleted; IFC contains them in the unit", async () => {
  const t = await roadModel(), s = await t.S();
  const m: InfraMarker = { kind: "test_infra_marker", id: "TI-1", storey: "", category: "site.test_infra_marker", unit: "SU-0002", at: [3, 4] };
  s.elements[m.id] = asEl(m);
  assert.doesNotThrow(() => checkElement(s, asEl(m)), "no storey needed: the container is the unit");
  assert.throws(() => checkElement(s, asEl({ ...m, unit: "SU-9999" })), (e: any) => e.reason === "INVALID_REFERENCE");
  assert.deepEqual(resourceUsage(s, "spatial_unit", "SU-0002").usages.map((u: any) => [u.elementKind, u.count]), [["child spatial unit", 1], ["site.test_infra_marker", 1]]);
  const q = (await t.ex("bim_query_spatial_units", {})).result;                                                     // the query reads the live platform state (without the marker)
  assert.ok(Array.isArray(q));
  assert.throws(() => toIfc(s, { projectKey: "u", schema: "IFC4" }), (e: any) => e.reason === "UNSUPPORTED_IFC_SCHEMA", "facilities exist only in IFC4.3");
  if (!hasIfc) return;
  await t.run("bim_set_georeference", { crs: { name: "EPSG:5254", description: "TUREF / TM30", geodetic_datum: "TUREF", map_projection: "TM", map_zone: "30" }, eastings: 500000, northings: 4540000, orthogonal_height: 100, rotation_degrees: 30 });
  s.project.georef = (await t.S()).project.georef;
  const txt = toIfc(s, { projectKey: "u" });
  assert.match(txt, /FILE_SCHEMA\(\('IFC4X3_ADD2'\)\)/);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-su-")), "m.ifc");
  fs.writeFileSync(f, txt);
  const raw = execFileSync("python3", ["-c", `
import json, sys, ifcopenshell, ifcopenshell.validate
f = ifcopenshell.open(sys.argv[1]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
site = f.by_type("IfcSite")[0]
def kids(o): return sorted(c.is_a() + ":" + (c.Name or "") for r in o.IsDecomposedBy for c in r.RelatedObjects)
road = f.by_type("IfcRoad")[0]; part = f.by_type("IfcRoadPart")[0]; seg = f.by_type("IfcFacilityPartCommon")[0]
mc = f.by_type("IfcMapConversion")[0]
cont = {r.RelatingStructure.is_a() + ":" + r.RelatingStructure.Name: sorted(e.is_a() for e in r.RelatedElements) for r in f.by_type("IfcRelContainedInSpatialStructure")}
print(json.dumps({"n": len(log.statements), "err": [str(x)[:200] for x in log.statements[:3]], "site": kids(site), "road": kids(road), "part": kids(part),
  "part_attrs": [part.UsageType, part.PredefinedType, part.CompositionType], "seg_attrs": [seg.UsageType, seg.PredefinedType], "road_pre": road.PredefinedType,
  "map": [mc.Eastings, mc.Northings, mc.OrthogonalHeight, mc.XAxisAbscissa, mc.XAxisOrdinate, mc.Scale, mc.SourceCRS.is_a(), mc.TargetCRS.is_a(), mc.TargetCRS.Name, mc.TargetCRS.MapProjection, mc.TargetCRS.MapZone],
  "cont": cont}))`, f]).toString().trim().split("\n");
  const out = JSON.parse(raw[raw.length - 1]);
  assert.deepEqual([out.n, out.err], [0, []]);
  assert.deepEqual(out.site, ["IfcBuilding:Bina", "IfcRoad:Ring Road"]);
  assert.deepEqual([out.road, out.part], [["IfcRoadPart:Carriageway"], ["IfcFacilityPartCommon:Km 0-1"]]);
  assert.deepEqual([out.part_attrs, out.seg_attrs, out.road_pre], [["LONGITUDINAL", "CARRIAGEWAY", "ELEMENT"], ["LONGITUDINAL", "SEGMENT"], "NOTDEFINED"]);
  assert.deepEqual(out.map.slice(0, 3), [500000, 4540000, 100]);
  assert.ok(Math.abs(out.map[3] - Math.cos(Math.PI / 6)) < 1e-9 && Math.abs(out.map[4] - 0.5) < 1e-9 && out.map[5] === 1);
  assert.deepEqual(out.map.slice(6), ["IfcGeometricRepresentationContext", "IfcProjectedCRS", "EPSG:5254", "TM", "30"]);
  assert.deepEqual(out.cont["IfcRoadPart:Carriageway"], ["IfcBuildingElementProxy"], "the infrastructure element is contained in its facility part");
  assert.equal(Object.keys(out.cont).some((k) => k.startsWith("IfcBuildingStorey") && out.cont[k].includes("IfcBuildingElementProxy")), false, "and in no building storey");
});
