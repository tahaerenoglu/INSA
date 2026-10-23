/** Phase 14 · Milestone B (part 3): gable and hip roofs on rectangular footprints: derived planes with independent geometry oracles, stable ids, IFC. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, canonicalJson } from "@insa/core";
import { bimModule, BimState, quantities, toIfc, planSvg, modelIssues } from "../src/index.js";
import { setup, P } from "./authoring-fixture.js";

const hasIfc = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.geom, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
const el = (s: BimState, id: string) => s.elements[id] as any;
const rad = (d: number) => (d * Math.PI) / 180;
async function base(policy: { everyEvents: number; keep: number } | false = false) {
  const t = await setup(policy);
  await t.run("bim_create_types", { types: [{ kind: "roof", name: "RT", layers: [{ material: "Kiremit", thickness: 0.2 }] }] });
  return t;
}
const rect = (w: number, h: number, ang = 0, ox = 0, oy = 0) => [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => [ox + x * Math.cos(rad(ang)) - y * Math.sin(rad(ang)), oy + x * Math.sin(rad(ang)) + y * Math.cos(rad(ang))]);
const roof = (t: any, o: Record<string, unknown>) => t.run("bim_create_pitched_roofs", { roofs: [{ storey: "L0", type: "RT", outline: rect(10, 6), form: "gable", pitch: 30, offset: 3, ...o }] });

test("gable: plane count, areas, ridge, eaves and volume equal independent formulas (also rotated, with overhang, ridge on the short side)", async () => {
  const t = await base();
  await roof(t, { overhang: 0.5 });                                                                                                     // PR-0001: 11 x 7 m
  await roof(t, { outline: rect(10, 6, 33, 2, 1), ridge: "short" });                                                                  // PR-0002: rotated, ridge along the 6 m side, span 10 m
  const s = await t.S(), c = Math.cos(rad(30)), tn = Math.tan(rad(30));
  const q1 = quantities(s, el(s, "PR-0001")), plan1 = 11 * 7;
  assert.ok(Math.abs(q1.plan_area - plan1) < 1e-7 && Math.abs(q1.roof_area - plan1 / c) < 1e-7, "equal-pitch roof: surface = plan / cos(pitch)");
  assert.ok(Math.abs(q1.ridge_height - 3.5 * tn) < 1e-7 && Math.abs(q1.ridge_length - 11) < 1e-7 && Math.abs(q1.eave_length - 36) < 1e-7 && q1.plane_count === 2 && q1.hip_length_total === 0, JSON.stringify(q1));
  assert.ok(Math.abs(q1.volume_gross - (plan1 / c) * 0.2) < 1e-7);
  const q2 = quantities(s, el(s, "PR-0002"));                                                                                          // ridge along 6, span 10: height 5 * tan30
  assert.ok(Math.abs(q2.ridge_length - 6) < 1e-7 && Math.abs(q2.ridge_height - 5 * tn) < 1e-7 && Math.abs(q2.roof_area - 60 / c) < 1e-7, JSON.stringify(q2));
  const g = (await t.ex("bim_get_element", { id: "PR-0001" })).result;
  assert.deepEqual([g.engine, g.representation.kind, g.representation.planes.map((p: any) => p.id), g.taxonomy.category], ["pitched_roof", "roof_planes", ["PR-0001.R0", "PR-0001.R1"], "architecture.pitched_roof"]);
  assert.deepEqual(modelIssues(s), []);
});

test("hip: 4 planes (2 trapezoids + 2 triangles), hip rafters and ridge from formulas; a pavilion roof has no ridge; hip needs the long side", async () => {
  const t = await base();
  await roof(t, { form: "hip", outline: rect(10, 6) });                                                                                // PR-0001
  await roof(t, { form: "hip", outline: rect(8, 8), pitch: 25, offset: 0 });                                                           // PR-0002: pavilion
  const s = await t.S(), c = Math.cos(rad(30)), q = quantities(s, el(s, "PR-0001")), hR = 3 * Math.tan(rad(30)), hipLen = Math.sqrt(2 * 3 * 3 + hR * hR);
  assert.deepEqual([q.plane_count, Math.round(q.ridge_length * 1e9) / 1e9], [4, 4]);                                                    // ridge = length - span = 4
  assert.ok(Math.abs(q.hip_length_total - 4 * hipLen) < 1e-7 && Math.abs(q.roof_area - 60 / c) < 1e-7 && Math.abs(q.ridge_height - hR) < 1e-7, JSON.stringify(q));
  const qp = quantities(s, el(s, "PR-0002")), cp = Math.cos(rad(25));
  assert.deepEqual([qp.plane_count, qp.ridge_length], [4, 0]);
  assert.ok(Math.abs(qp.roof_area - 64 / cp) < 1e-7 && Math.abs(qp.hip_length_total - 4 * Math.sqrt(2 * 16 + (4 * Math.tan(rad(25))) ** 2)) < 1e-7, JSON.stringify(qp));
  const planes = (await t.ex("bim_get_element", { id: "PR-0001" })).result.representation.planes as { polygon: unknown[]; area: number }[];
  assert.deepEqual(planes.map((p) => p.polygon.length), [4, 4, 3, 3]);
  assert.deepEqual((await t.ex("bim_get_element", { id: "PR-0002" })).result.representation.planes.map((p: any) => p.polygon.length), [3, 3, 3, 3]);
  const n = (await t.p.store(P).readEvents()).length;
  await t.rejected("bim_create_pitched_roofs", { roofs: [{ storey: "L0", type: "RT", outline: rect(10, 6), form: "hip", ridge: "short", pitch: 30 }] }, "INVALID_ROOF_GEOMETRY");      // span 10 > ridge length 6
  await t.rejected("bim_create_pitched_roofs", { roofs: [{ storey: "L0", type: "RT", outline: [[0, 0], [10, 0], [9, 6], [0, 6]], form: "gable", pitch: 30 }] }, "INVALID_ROOF_GEOMETRY");   // a trapezoid
  await t.rejected("bim_create_pitched_roofs", { roofs: [{ storey: "L0", type: "RT", outline: rect(10, 6), form: "gable", pitch: 85 }] }, "INVALID_ROOF_GEOMETRY");
  await t.rejected("bim_create_pitched_roofs", { roofs: [{ storey: "L0", type: "RT", outline: rect(10, 6), form: "gable", pitch: 0 }] }, "INVALID_ROOF_GEOMETRY");
  await t.rejected("bim_create_pitched_roofs", { roofs: [{ storey: "L0", type: "RT", outline: [[0, 0], [10, 0], [10, 0], [0, 0]], form: "gable", pitch: 30 }] }, "INVALID_ROOF_GEOMETRY");
  assert.equal((await t.p.store(P).readEvents()).length, n, "no refusal left anything behind");
});

test("updates propagate deterministically (form, pitch, move, undo, replay, snapshot); the flat / mono-pitch roof (architecture.roof) shares the roof type and is unchanged; plan", async () => {
  const policy = { everyEvents: 3, keep: 2 }, t = await base(policy);
  await roof(t, {});
  assert.deepEqual((await t.ex("bim_get_element", { id: "PR-0001" })).result.representation.planes.map((p: any) => p.id), ["PR-0001.R0", "PR-0001.R1"]);
  await t.run("bim_update_elements", { items: [{ id: "PR-0001", kind: "pitched_roof", set: { form: "hip" } }] });
  assert.deepEqual((await t.ex("bim_get_element", { id: "PR-0001" })).result.representation.planes.map((p: any) => p.id), ["PR-0001.R0", "PR-0001.R1", "PR-0001.R2", "PR-0001.R3"]);
  await t.run("bim_update_elements", { items: [{ id: "PR-0001", kind: "pitched_roof", set: { pitch: 45 } }] });
  assert.ok(Math.abs(quantities(await t.S(), el(await t.S(), "PR-0001")).ridge_height - 3) < 1e-7, "45 deg: ridge height = span / 2");
  await t.rejected("bim_update_elements", { items: [{ id: "PR-0001", kind: "pitched_roof", set: { outline: [[0, 0], [1, 0], [1, 1], [0.5, 2]] } }] }, "INVALID_ROOF_GEOMETRY");
  const dry = await t.ex("bim_move_elements", { ids: ["PR-0001"], vector: [3, 4] }, { dryRun: true });
  assert.deepEqual(dry.preview.summary.moved, ["PR-0001"]);
  await t.run("bim_move_elements", { ids: ["PR-0001"], vector: [3, 4] });
  assert.deepEqual(el(await t.S(), "PR-0001").outline[0], [3, 4]);
  // the same layered roof type also serves the flat / mono-pitch roof engine (unchanged behaviour)
  await t.run("bim_create_boundaries", { boundaries: [{ category: "architecture.roof", storey: "L0", type: "RT", outline: rect(5, 5, 0, 20, 0), offset: 3, slope: { pitch: 20, direction: 90 } }] }).catch(() => t.run("bim_create_boundaries", { boundaries: [{ category: "architecture.roof", storey: "L0", type: "RT", outline: rect(5, 5, 0, 20, 0), offset: 3 }] }));
  const live = canonicalJson(await t.S());
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state(P, "bim")), live, "replay");
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy }).state(P, "bim")), live, "snapshot");
  await t.run("platform_undo", {}); await t.run("platform_undo", {});
  assert.deepEqual(el(await t.S(), "PR-0001").outline[0], [0, 0]);
  const s = await t.S();
  assert.match(planSvg(s, s.storeys[Object.keys(s.storeys)[0]]), /#9a5b34/);
  assert.deepEqual(modelIssues(s), []);
});

test("IFC: IfcRoof (GABLE_ROOF / HIP_ROOF) aggregates one IfcSlab ROOF per plane; plane volumes, bounding box and lowest level match independent formulas (IfcOpenShell, 0 schema errors)", { skip: !hasIfc, timeout: 200000 }, async () => {
  const t = await base();
  await roof(t, { overhang: 0.5 });                                                                                                     // gable 11 x 7, eave 3
  await roof(t, { form: "hip", outline: rect(10, 6, 0, 30, 0) });                                                                      // hip
  const s = await t.S(), txt = toIfc(s, { projectKey: "pr" });
  assert.match(txt, /FILE_SCHEMA\(\('IFC4'\)\)/);
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-pr-")), "m.ifc");
  fs.writeFileSync(f, txt);
  const raw = execFileSync("python3", ["-c", `
import json, sys, ifcopenshell, ifcopenshell.geom, ifcopenshell.validate, ifcopenshell.util.shape as us
f = ifcopenshell.open(sys.argv[1]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
st = ifcopenshell.geom.settings(); st.set("use-world-coords", True); out = {}
for r in f.by_type("IfcRoof"):
    parts = [o for rel in r.IsDecomposedBy for o in rel.RelatedObjects]; lo = [1e9]*3; hi = [-1e9]*3; vol = 0
    for p in parts:
        g = ifcopenshell.geom.create_shape(st, p).geometry; v = g.verts; vol += us.get_volume(g)
        for k in range(3): lo[k] = min(lo[k], min(v[k::3])); hi[k] = max(hi[k], max(v[k::3]))
    out[r.Tag] = {"pre": r.PredefinedType, "parts": sorted(p.is_a() + ":" + str(p.PredefinedType) for p in parts), "vol": vol, "lo": lo, "hi": hi, "type": r.IsTypedBy[0].RelatingType.is_a() if r.IsTypedBy else None}
cont = sorted(e.is_a() for rel in f.by_type("IfcRelContainedInSpatialStructure") for e in rel.RelatedElements)
print(json.dumps({"n": len(log.statements), "err": [str(x)[:200] for x in log.statements[:3]], "roofs": out, "cont": cont}))`, f]).toString().trim().split("\n");
  assert.deepEqual(raw.slice(0, -1), []);
  const out = JSON.parse(raw[raw.length - 1]);
  assert.deepEqual([out.n, out.err], [0, []]);
  assert.deepEqual(out.cont, ["IfcRoof", "IfcRoof"], "only the roofs are contained: their planes are aggregated parts");
  const c = Math.cos(rad(30)), tn = Math.tan(rad(30)), within = (a: number, b: number) => Math.abs(a - b) <= 0.005 * Math.abs(b) + 1e-9;
  const g = out.roofs["PR-0001"], h = out.roofs["PR-0002"];
  assert.deepEqual([g.pre, g.parts, g.type], ["GABLE_ROOF", ["IfcSlab:ROOF", "IfcSlab:ROOF"], "IfcRoofType"]);
  assert.deepEqual([h.pre, h.parts.length], ["HIP_ROOF", 4]);
  assert.ok(within(g.vol, (77 / c) * 0.2), `gable volume ${g.vol}`);                                                                      // sum of the plane slabs: surface x thickness
  assert.ok(within(h.vol, (60 / c) * 0.2), `hip volume ${h.vol}`);
  // the top surfaces bound the roof: x in [-0.5, 10.5], y in [-0.5, 6.5] for the gable; the ridge is the highest line; the lowest point is the eave's underside
  assert.ok(Math.abs(g.lo[0] + 0.5) < 1e-6 && Math.abs(g.hi[0] - 10.5) < 1e-6 && Math.abs(g.lo[1] + 0.5) < 1e-6 && Math.abs(g.hi[1] - 6.5) < 1e-6, `gable bbox ${g.lo} ${g.hi}`);
  assert.ok(Math.abs(g.hi[2] - (3 + 3.5 * tn)) < 1e-6, `ridge level ${g.hi[2]}`);
  assert.ok(Math.abs(g.lo[2] - (3 - 0.2 * c)) < 1e-6, `eave underside ${g.lo[2]}`);
  assert.ok(Math.abs(h.lo[0] - 30) < 1e-6 && Math.abs(h.hi[0] - 40) < 1e-6 && Math.abs(h.hi[2] - (3 + 3 * tn)) < 1e-6, `hip bbox ${h.lo} ${h.hi}`);
});
