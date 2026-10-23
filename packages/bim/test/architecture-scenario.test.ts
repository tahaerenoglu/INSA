/** Phase 11 · the mixed two-storey scenario (15 steps) and the IFC semantic class matrix (IfcOpenShell). */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, canonicalJson } from "@insa/core";
import { bimModule, BimState, quantities, modelIssues, planSvg, toIfc, stairGeometry } from "../src/index.js";
import { setup, P } from "./authoring-fixture.js";

const hasIfcOpenShell = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.geom, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
const PROBE = `
import json, sys, ifcopenshell, ifcopenshell.geom, ifcopenshell.validate, ifcopenshell.util.element as ue, ifcopenshell.util.shape as us
f = ifcopenshell.open(sys.argv[1]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
st = ifcopenshell.geom.settings(); st.set("use-world-coords", True)
out = {}; bad = 0
for e in f.by_type("IfcProduct"):
    if not e.Representation or e.is_a("IfcOpeningElement"): continue
    g = ifcopenshell.geom.create_shape(st, e).geometry; v = g.verts; z = v[2::3]
    bad += sum(1 for x in v if x != x or abs(x) == float("inf"))
    c = ue.get_container(e) or ue.get_aggregate(e)
    key = e.Name if e.Name not in out else e.Name + "#" + e.GlobalId      # hosted doors / windows may share a name
    out[key] = [e.is_a(), round(us.get_volume(g), 5), round(min(z), 4), round(max(z), 4), c.Name if c else None, getattr(e, "PredefinedType", None)]
print(json.dumps({ "errors": len(log.statements), "bad": bad, "els": out }))`;
const probe = (s: BimState) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-ifc11-")), "m.ifc");
  const ifc = toIfc(s, { projectKey: P });
  assert.equal(/NaN|Infinity/.test(ifc), false);
  fs.writeFileSync(file, ifc);
  return JSON.parse(execFileSync("python3", ["-c", PROBE, file]).toString()) as { errors: number; bad: number; els: Record<string, [string, number, number, number, string, string]> };
};
const el = (s: BimState, id: string) => s.elements[id] as any;

test("two-storey building: ceilings, mono-pitch roof, stair, railing + Phase 10 edits; validate, query, level change, plan, IFC, snapshot, reload, undo, replay", { timeout: 250000 }, async () => {
  const policy = { everyEvents: 1000, keep: 3 };
  const t = await setup(policy);
  const { run, S, join, tee, walls } = t;
  const L = (n: string) => (s: BimState) => Object.values(s.storeys).find((x) => x.name === n)!;
  // ---- the building (Phase 1-10 elements)
  await run("bim_create_types", { types: [
    { kind: "slab", name: "D20", layers: [{ material: "Beton", thickness: 0.2 }] }, { kind: "ceiling", name: "C13", layers: [{ material: "Alçıpan", thickness: 0.0125 }] },
    { kind: "roof", name: "R20", layers: [{ material: "Kiremit", thickness: 0.02 }, { material: "Beton", thickness: 0.18 }] }, { kind: "stair", name: "S20", max_riser: 0.2, min_tread: 0.25, default_width: 1.2 },
    { kind: "railing", name: "RL", height: 1.0, top_rail: { width: 0.05, depth: 0.04 }, post: { size: 0.04 }, max_post_spacing: 1.2 }, { kind: "column", name: "C", profile: { shape: "rect", b: 0.4, h: 0.4 } }, { kind: "beam", name: "B", profile: { shape: "rect", b: 0.3, h: 0.5 } }] });
  await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", points: [[0, 0], [10, 0], [10, 6], [0, 6]], closed: true, height: 3 }] });
  for (const [a, b] of [["W-0001", "W-0002"], ["W-0002", "W-0003"], ["W-0003", "W-0004"], ["W-0004", "W-0001"]]) await join(a, "end", b, "start");
  await walls([[[4, 0], [4, 6]]]); await tee("W-0005", "start", "W-0001"); await tee("W-0005", "end", "W-0003");
  await run("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 2, type: "N" }, { kind: "window", host: "W-0001", along: 8.5, type: "N" }, { kind: "door", host: "W-0005", along: 3, type: "K" }] });
  await run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 2, y: 3, number: "101" }, { category: "mechanical.space", storey: "L0", x: 2, y: 3 }] });
  await run("bim_create_walls", { walls: [{ storey: "L1", type: "W", points: [[0, 0], [10, 0], [10, 6], [0, 6]], closed: true, height: 3 }] });
  for (const [a, b] of [["W-0006", "W-0007"], ["W-0007", "W-0008"], ["W-0008", "W-0009"], ["W-0009", "W-0006"]]) await join(a, "end", b, "start");
  await run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L1", x: 5, y: 3, number: "201" }] });
  const sq = [[0, 0], [10, 0], [10, 6], [0, 6]];
  await run("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L0", type: "D20", outline: sq, offset: 0 }, { category: "architecture.floor", storey: "L1", type: "D20", outline: sq, offset: 0 }] });
  await run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "C", at: [9, 5], height: 3 }, { category: "structure.framing", storey: "L1", type: "B", start: [0, 3], end: [10, 3], z: 2.8 }] });
  const L0 = (await S()).storeys;
  void L0;
  // ---- Phase 11 elements
  await run("bim_create_boundaries", { boundaries: [{ category: "architecture.ceiling", storey: "L0", type: "C13", outline: sq, offset: 2.7 }, { category: "architecture.ceiling", storey: "L1", type: "C13", outline: sq, offset: 2.7 },
    { category: "architecture.roof", storey: "L1", type: "R20", outline: sq, offset: 3, slope: { azimuth: 90, pitch: 15 } }] });
  await run("bim_create_stairs", { stairs: [{ storey: "L0", type: "S20", start: [1, 1], end: [5, 1], riser_count: 16 }] });
  await run("bim_create_railings", { railings: [{ storey: "L1", type: "RL", path: [[0, 6], [10, 6]] }] });
  await run("bim_create_families", { families: [{ name: "Desk", category: "architecture.furniture", parameters: [{ key: "w", name: "w", scope: "type", dataType: "length", required: true }, { key: "d", name: "d", scope: "type", dataType: "length", required: true }, { key: "h", name: "h", scope: "type", dataType: "length", required: true }], representation: { kind: "box", width: "w", depth: "d", height: "h" } }] });
  await run("bim_create_types", { types: [{ kind: "component", name: "D160", family: "Desk", parameters: { w: 1.6, d: 0.8, h: 0.75 } }] });
  await run("bim_create_components", { components: [{ type: "D160", storey: "L0", x: 7, y: 4.5 }] });

  // 1  validate
  const v = (await t.ex("bim_validate", {})).result;
  assert.deepEqual(v.issues.filter((i: any) => i.severity === "error"), [], "validate: no errors");
  assert.deepEqual(modelIssues(await S()), []);
  // 2-3  query by category and by engine: the semantic categories stay distinct
  const q = async (input: unknown) => (await t.ex("bim_query_elements", input)).result.elements.map((e: any) => e.id).sort();
  assert.deepEqual([await q({ category: "architecture.ceiling" }), await q({ category: "architecture.roof" }), await q({ category: "architecture.stair" }), await q({ category: "architecture.railing" })],
    [["CE-0001", "CE-0002"], ["RF-0001"], ["STR-0001"], ["RL-0001"]]);
  assert.deepEqual([(await q({ engine: "boundary" })).length, await q({ engine: "stair" }), await q({ engine: "path" })], [5, ["STR-0001"], ["RL-0001"]]);
  // 4-5  a level moves: the stair's rise follows in the same command, its riser count does not change
  await run("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.0 } }] });
  let s = await S();
  assert.deepEqual([el(s, "STR-0001").height, el(s, "STR-0001").riserCount, stairGeometry(el(s, "STR-0001")).riserHeight], [3.0, 16, 0.1875]);
  // 6  move the railing, 7  change the roof pitch
  await run("bim_move_elements", { ids: ["RL-0001"], vector: [0, -1] });
  await run("bim_update_elements", { items: [{ id: "RF-0001", kind: "boundary", set: { slope: { azimuth: 90, pitch: 20 } } }] });
  s = await S();
  assert.deepEqual([el(s, "RL-0001").path, el(s, "RF-0001").slope], [[[0, 5], [10, 5]], { azimuth: 90, pitch: 20 }]);
  const beforeRoof = canonicalJson(s);
  // 8-9  Phase 10 wall edits do not touch the Phase 11 elements
  const arch11 = (st: BimState) => canonicalJson(["CE-0001", "CE-0002", "RF-0001", "STR-0001", "RL-0001"].map((id) => st.elements[id]));
  const a0 = arch11(s);
  await run("bim_split_wall", { wall: "W-0001", t: 0.5 });
  await run("bim_merge_walls", { walls: ["W-0001", "W-0010"] });
  assert.equal(arch11(await S()), a0, "walls were split and merged; the new elements are unaffected");
  // 10  plan
  s = await S();
  const p0 = planSvg(s, L("L0")(s)), p1 = planSvg(s, L("L1")(s));
  assert.ok(p0.includes('stroke-dasharray="7 4"') && p0.includes("#eef1f4"), "ground plan: dashed ceiling and the stair run");
  assert.ok(p1.includes("#a65d46") && p1.includes("#2f6f4f"), "level 1 plan: roof with its slope arrow, railing path");
  assert.equal([...p0.matchAll(/#2c2f36/g)].length > 20, true, "walls, doors, windows and the stair still draw");
  // 11  IFC class matrix
  if (hasIfcOpenShell) {
    const ifc = probe(s);
    assert.deepEqual([ifc.errors, ifc.bad], [0, 0], "0 schema errors; no NaN / Infinity");
    const byClass: Record<string, string[]> = {};
    for (const [name, v] of Object.entries(ifc.els)) (byClass[v[0]] ??= []).push(name);
    const count = (c: string) => (byClass[c] ?? []).length;
    assert.deepEqual(["IfcWall", "IfcSlab", "IfcCovering", "IfcRoof", "IfcStair", "IfcRailing", "IfcColumn", "IfcBeam", "IfcDoor", "IfcWindow", "IfcFurniture", "IfcSpace"].map(count),
      [9, 2, 2, 1, 1, 1, 1, 1, 1, 2, 1, 3], "semantic classes: floors are slabs, ceilings coverings, the roof a roof, never proxies");
    assert.equal(count("IfcBuildingElementProxy"), 0);
    assert.deepEqual([ifc.els["CE-0001"][5], ifc.els["RF-0001"][5], ifc.els["STR-0001"][5], ifc.els["RL-0001"][5]], ["CEILING", "SHED_ROOF", "STRAIGHT_RUN_STAIR", "GUARDRAIL"]);
    // geometry == the derived quantities
    assert.ok(Math.abs(ifc.els["STR-0001"][1] - (4 * 3.0 / 2) * 1.2) < 1e-4, "stair volume = run x rise / 2 x width");
    assert.deepEqual([ifc.els["STR-0001"][2], ifc.els["STR-0001"][3]], [0, 3.0 - 0.1875], "the solid ends at its last tread: the top step is the upper floor");
    assert.ok(Math.abs(ifc.els["RF-0001"][1] - quantities(s, s.elements["RF-0001"]).volume) < 1e-3, "roof volume = surface area x perpendicular thickness");
    assert.ok(Math.abs(ifc.els["CE-0001"][1] - 0.75) < 1e-5 && Math.abs(ifc.els["CE-0001"][2] - 2.7) < 1e-9 && Math.abs(ifc.els["CE-0001"][3] - 2.7125) < 1e-9, "ceiling: thickness UP from 2.7");
    assert.deepEqual([ifc.els["STR-0001"][4], ifc.els["RF-0001"][4], ifc.els["RL-0001"][4]], ["L0", "L1", "L1"], "storey containment");
    assert.ok(Math.abs(ifc.els["RL-0001"][3] - (3.0 + 1.0)) < 1e-9 && ifc.els["RL-0001"][2] >= 3.0 - 1e-9, "railing: 3.0 + 0 .. 3.0 + height");
  }
  // 12-13  snapshot and reload
  assert.equal((await t.p.createSnapshot(P))?.written, true);
  const live = canonicalJson(await S());
  const reloaded = new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy });
  assert.equal(canonicalJson(await reloaded.state(P, "bim")), live);
  assert.equal(reloaded.metrics.snapshotsLoaded, 1);
  // 14  undo one Phase 11 write: the roof pitch change is long past, so undo the latest (the merge), then the roof edit is reachable via replay equivalence
  await run("platform_undo", {});                                                         // the wall merge
  await run("platform_undo", {});                                                         // the wall split
  assert.equal(canonicalJson(await S()), beforeRoof, "back at the state right after the roof pitch update");
  await run("platform_undo", {});                                                         // the roof pitch update itself
  assert.deepEqual(el(await S(), "RF-0001").slope, { azimuth: 90, pitch: 15 });
  // 15  full replay and a reload after the undos equal the live state
  const full = await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state<BimState>(P, "bim");
  assert.equal(canonicalJson(full), canonicalJson(await S()));
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy }).state(P, "bim")), canonicalJson(full));
});
