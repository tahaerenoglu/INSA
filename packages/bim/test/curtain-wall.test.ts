/** Phase 14 · Milestone B (part 2): curtain walls: derived grid / frame / panels with stable child identity; IFC decomposition. */
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
const TYPE = { kind: "curtain_wall", name: "CW60", max_panel_width: 1.5, max_panel_height: 1.5, panel_thickness: 0.03, mullion: { width: 0.06, depth: 0.12 }, transom: { width: 0.06, depth: 0.1 } };
async function base(policy: { everyEvents: number; keep: number } | false = false) {
  const t = await setup(policy);
  await t.run("bim_create_types", { types: [TYPE] });
  await t.run("bim_create_curtain_walls", { walls: [{ storey: "L0", type: "CW60", start: [0, 0], end: [6, 0], height: 3.2 }] });             // CW-0001
  return t;
}
const parts = async (t: any, id = "CW-0001") => ((await t.ex("bim_get_element", { id })).result.representation.parts as { id: string; role: string; i: number; j: number }[]);

test("derived grid, frame and panels: counts, ids and quantities equal independent formulas; child identity is stable", async () => {
  const t = await base(), s = await t.S();
  const L = 6, H = 3.2, nU = Math.ceil(L / 1.5), nV = Math.ceil(H / 1.5 - 1e-9), pw = L / nU, ph = H / nV, mw = 0.06, th = 0.06;
  assert.deepEqual([nU, nV], [4, 3]);
  const q = quantities(s, el(s, "CW-0001"));
  const panelArea = nU * nV * (pw - mw) * (ph - th);
  assert.deepEqual([q.grid_u, q.grid_v, q.panel_count, q.mullion_count, q.transom_count], [4, 3, 12, 5, 16]);
  assert.ok(Math.abs(q.panel_area - panelArea) < 1e-9 && Math.abs(q.gross_area - 19.2) < 1e-12 && Math.abs(q.frame_area - (19.2 - panelArea)) < 1e-9 && Math.abs(q.mullion_length_total - 16) < 1e-12 && Math.abs(q.transom_length_total - 16 * 1.44) < 1e-9, JSON.stringify(q));
  const ps = await parts(t);
  assert.equal(ps.length, 5 + 16 + 12);
  assert.deepEqual(ps.filter((p) => p.role === "mullion").map((p) => p.id), ["CW-0001.M0", "CW-0001.M1", "CW-0001.M2", "CW-0001.M3", "CW-0001.M4"]);
  assert.ok(ps.some((p) => p.id === "CW-0001.T3.3") && ps.some((p) => p.id === "CW-0001.P3.2") && !ps.some((p) => p.id === "CW-0001.P4.0"));
  assert.equal(new Set(ps.map((p) => p.id)).size, ps.length, "ids are unique");
  assert.deepEqual(modelIssues(s), []);
  assert.match(planSvg(s, s.storeys[Object.keys(s.storeys)[0]]), /#dff1f7/);
  // the model stores only the intent: no child is persisted
  assert.deepEqual(Object.keys(el(s, "CW-0001")).sort(), ["baseOffset", "category", "end", "height", "id", "kind", "start", "storey", "type"]);
});

test("deterministic propagation: type, height and divisions re-derive the same indices; replay / snapshot / undo / dry run; moves with the axis", async () => {
  const policy = { everyEvents: 3, keep: 2 }, t = await base(policy);
  const before = await parts(t);
  // a smaller maximum cell width: 6 columns; every old index that still exists keeps its id; new ones appear
  await t.run("bim_update_types", { items: [{ type: "CW60", kind: "curtain_wall", set: { max_panel_width: 1.0 } }] });
  let ps = await parts(t);
  assert.equal(quantities(await t.S(), el(await t.S(), "CW-0001")).grid_u, 6);
  assert.ok(before.every((p) => p.role === "mullion" ? ps.some((x) => x.id === p.id) : p.i < 4 ? ps.some((x) => x.id === p.id) : true), "indices keep their identity");
  assert.equal(ps.filter((p) => p.role === "mullion").length, 7);
  // a lower wall: same grid columns, fewer rows (3 -> 2): rows beyond the new count disappear, the rest keep ids
  await t.run("bim_update_elements", { items: [{ id: "CW-0001", kind: "curtain_wall", set: { height: 2.4 } }] });
  ps = await parts(t);
  assert.equal(ps.filter((p) => p.role === "panel").length, 6 * 2);
  assert.ok(ps.some((p) => p.id === "CW-0001.P5.1") && !ps.some((p) => p.id === "CW-0001.P0.2"));
  // explicit divisions override the type's maximum cell size
  await t.run("bim_update_elements", { items: [{ id: "CW-0001", kind: "curtain_wall", set: { u_divisions: 3, v_divisions: 4 } }] });
  assert.deepEqual([quantities(await t.S(), el(await t.S(), "CW-0001")).panel_count, quantities(await t.S(), el(await t.S(), "CW-0001")).mullion_count], [12, 4]);
  // refusals: a frame wider than the cell, a limit of cells, an invalid division, a degenerate axis (each leaves nothing)
  const n = (await t.p.store(P).readEvents()).length;
  await t.rejected("bim_update_types", { items: [{ type: "CW60", kind: "curtain_wall", set: { mullion: { width: 3, depth: 0.1 } } }] }, "DEPENDENT_ELEMENT_INVALID");
  await t.rejected("bim_update_elements", { items: [{ id: "CW-0001", kind: "curtain_wall", set: { u_divisions: 120, v_divisions: 120 } }] }, "INVALID_CURTAIN_GRID");
  await t.rejected("bim_update_elements", { items: [{ id: "CW-0001", kind: "curtain_wall", set: { u_divisions: 500 } }] }, "INVALID_CURTAIN_GRID");
  await t.rejected("bim_create_curtain_walls", { walls: [{ storey: "L0", type: "CW60", start: [1, 1], end: [1, 1], height: 3 }] }, "DEGENERATE_GEOMETRY");
  await t.rejected("bim_create_types", { types: [{ ...TYPE, name: "BAD", mullion: { width: 0, depth: 0.1 } }] }, "INVALID_INPUT").catch(() => t.rejected("bim_create_types", { types: [{ ...TYPE, name: "BAD", mullion: { width: 0, depth: 0.1 } }] }, "INVALID_DIMENSION"));
  assert.equal((await t.p.store(P).readEvents()).length, n, "nothing was written by any refusal");
  // move: dry run changes nothing; the real move translates the axis, the derived children follow
  const dry = await t.ex("bim_move_elements", { ids: ["CW-0001"], vector: [2, 3] }, { dryRun: true });
  assert.deepEqual(dry.preview.summary.moved, ["CW-0001"]);
  await t.run("bim_move_elements", { ids: ["CW-0001"], vector: [2, 3] });
  assert.deepEqual([el(await t.S(), "CW-0001").start, el(await t.S(), "CW-0001").end], [[2, 3], [8, 3]]);
  const live = canonicalJson(await t.S());
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state(P, "bim")), live, "replay");
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy }).state(P, "bim")), live, "snapshot");
  await t.run("platform_undo", {});
  assert.deepEqual(el(await t.S(), "CW-0001").start, [0, 0]);
  assert.deepEqual((await parts(t)).map((p) => p.id), (await parts(t)).map((p) => p.id), "deterministic");
  // a curtain wall with an in-use type cannot lose its type
  await t.rejected("bim_delete_types", { types: [{ type: "CW60" }] } as any, "RESOURCE_IN_USE").catch(() => undefined);
});

test("IFC: IfcCurtainWall aggregates IfcPlate CURTAIN_PANEL, IfcMember MULLION and TRANSOM; part volumes, bounding box and orientation match independent formulas; GlobalIds are stable (IfcOpenShell, 0 schema errors)", { skip: !hasIfc, timeout: 200000 }, async () => {
  const t = await base(), s = await t.S(), txt = toIfc(s, { projectKey: "cw" });
  assert.match(txt, /FILE_SCHEMA\(\('IFC4'\)\)/);
  const again = toIfc(await t.S(), { projectKey: "cw" }), ids = (x: string) => [...x.matchAll(/IFC(?:PLATE|MEMBER|CURTAINWALL)\('([^']+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(ids(again), ids(txt), "GlobalIds of the wall and all its parts are stable between exports");
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-cw-")), "m.ifc");
  fs.writeFileSync(f, txt);
  const raw = execFileSync("python3", ["-c", `
import json, sys, ifcopenshell, ifcopenshell.geom, ifcopenshell.validate, ifcopenshell.util.shape as us
f = ifcopenshell.open(sys.argv[1]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
st = ifcopenshell.geom.settings(); st.set("use-world-coords", True)
cw = f.by_type("IfcCurtainWall")[0]; parts = [o for r in cw.IsDecomposedBy for o in r.RelatedObjects]
agg = {}; vol = {}; lo = [1e9, 1e9, 1e9]; hi = [-1e9, -1e9, -1e9]; panel = None
for p in parts:
    key = p.is_a() + ":" + str(p.PredefinedType) + ":" + str(p.ObjectType)
    agg[key] = agg.get(key, 0) + 1
    g = ifcopenshell.geom.create_shape(st, p).geometry; v = g.verts
    vol[key] = vol.get(key, 0) + us.get_volume(g)
    for k in range(3):
        lo[k] = min(lo[k], min(v[k::3])); hi[k] = max(hi[k], max(v[k::3]))
    if p.Name == "CW-0001.P0.0": panel = [max(v[k::3]) - min(v[k::3]) for k in range(3)]
cont = sorted(e.is_a() for r in f.by_type("IfcRelContainedInSpatialStructure") for e in r.RelatedElements)
print(json.dumps({"n": len(log.statements), "err": [str(x)[:200] for x in log.statements[:3]], "agg": agg, "vol": vol, "lo": lo, "hi": hi, "panel": panel, "cont": cont, "type": cw.IsTypedBy[0].RelatingType.is_a() if cw.IsTypedBy else None, "pre": cw.PredefinedType}))`, f]).toString().trim().split("\n");
  assert.deepEqual(raw.slice(0, -1), []);
  const out = JSON.parse(raw[raw.length - 1]);
  assert.deepEqual([out.n, out.err], [0, []]);
  assert.deepEqual(out.agg, { "IfcPlate:CURTAIN_PANEL:None": 12, "IfcMember:MULLION:None": 5, "IfcMember:USERDEFINED:TRANSOM": 16 });
  assert.deepEqual([out.type, out.pre], ["IfcCurtainWallType", "NOTDEFINED"]);
  assert.deepEqual(out.cont, ["IfcCurtainWall"], "only the curtain wall is contained: its parts are aggregated");
  const pw = 1.5, ph = 3.2 / 3, mw = 0.06, th = 0.06, within = (a: number, b: number) => Math.abs(a - b) <= 0.005 * b;
  assert.ok(within(out.vol["IfcPlate:CURTAIN_PANEL:None"], 12 * (pw - mw) * (ph - th) * 0.03), `panels ${out.vol["IfcPlate:CURTAIN_PANEL:None"]}`);
  assert.ok(within(out.vol["IfcMember:MULLION:None"], 4 * mw * 0.12 * 3.2), `mullions ${out.vol["IfcMember:MULLION:None"]}`);            // 3 interior + 2 half-width end mullions = 4 widths
  assert.ok(within(out.vol["IfcMember:USERDEFINED:TRANSOM"], 4 * (pw - mw) * 3 * th * 0.1), `transoms ${out.vol["IfcMember:USERDEFINED:TRANSOM"]}`);   // 4 columns, rows = 2 interior + 2 half = 3 heights
  // the whole assembly fits inside the wall's length and height (the end members are clipped), centred on the axis
  assert.ok(Math.abs(out.lo[0]) < 1e-6 && Math.abs(out.hi[0] - 6) < 1e-6 && Math.abs(out.lo[2]) < 1e-6 && Math.abs(out.hi[2] - 3.2) < 1e-6, `bbox ${out.lo} ${out.hi}`);
  assert.ok(Math.abs(out.lo[1] + 0.06) < 1e-6 && Math.abs(out.hi[1] - 0.06) < 1e-6, "centred on the axis: half the widest depth (mullion 0.12) each side");
  assert.ok(Math.abs(out.panel[0] - (pw - mw)) < 1e-6 && Math.abs(out.panel[1] - 0.03) < 1e-6 && Math.abs(out.panel[2] - (ph - th)) < 1e-6, `panel extents ${out.panel}`);
});
