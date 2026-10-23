/** Phase 12 · the mixed structural scenario (two-storey bay) with the IFC class matrix, plan, usage, duplicates, undo and replay. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, canonicalJson } from "@insa/core";
import { bimModule, BimState, memberWorldEnds, memberLength, modelIssues, planSvg, toIfc, quantities } from "../src/index.js";
import { setup, P } from "./authoring-fixture.js";

const hasIfc = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.geom, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
const PROBE = `
import json, sys, ifcopenshell, ifcopenshell.geom, ifcopenshell.validate, ifcopenshell.util.element as ue, ifcopenshell.util.shape as us
f = ifcopenshell.open(sys.argv[1]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
st = ifcopenshell.geom.settings(); st.set("use-world-coords", True); out = {}; bad = 0
for e in f.by_type("IfcProduct"):
    if not e.Representation or e.is_a("IfcOpeningElement"): continue
    g = ifcopenshell.geom.create_shape(st, e).geometry; v = g.verts; z = v[2::3]
    bad += sum(1 for x in v if x != x or abs(x) == float("inf"))
    c = ue.get_container(e) or ue.get_aggregate(e)
    key = e.Name if e.Name not in out else e.Name + "#" + e.GlobalId
    out[key] = [e.is_a(), round(us.get_volume(g), 5), round(min(z), 4), round(max(z), 4), c.Name if c else None, getattr(e, "PredefinedType", None)]
print(json.dumps({"errors": len(log.statements), "bad": bad, "els": out}))`;
const el = (s: BimState, id: string) => s.elements[id] as any;

test("two-storey structural bay + architecture: validate, query, level change, brace update, shear wall split / merge, footing move, plan, IFC matrix, snapshot, reload, undo, replay", { timeout: 250000 }, async () => {
  const policy = { everyEvents: 1000, keep: 3 };
  const t = await setup(policy);
  const { run, S } = t;
  await run("bim_create_types", { types: [{ kind: "wall", name: "SW25", layers: [{ material: "Beton", thickness: 0.25 }] }, { kind: "slab", name: "D20", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "foundation_slab", name: "MAT", layers: [{ material: "Beton", thickness: 0.6 }] }, { kind: "footing", name: "PAD", footing_kind: "pad", layers: [{ material: "Beton", thickness: 0.5 }] },
    { kind: "column", name: "C40", profile: { shape: "rect", b: 0.4, h: 0.4 } }, { kind: "column", name: "PILE", profile: { shape: "circle", d: 0.4 } }, { kind: "beam", name: "IPE", profile: { shape: "i_section", h: 0.3, b: 0.15, tw: 0.007, tf: 0.011 } },
    { kind: "beam", name: "RHS", profile: { shape: "rhs", b: 0.2, h: 0.3, t: 0.01 } }, { kind: "ceiling", name: "C13", layers: [{ material: "Alçıpan", thickness: 0.0125 }] }, { kind: "roof", name: "R20", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "stair", name: "S20", max_riser: 0.25, min_tread: 0.25, default_width: 1.2 }, { kind: "railing", name: "RL", height: 1.0, top_rail: { width: 0.05, depth: 0.04 }, post: { size: 0.04 }, max_post_spacing: 1.2 }] });
  const sq = [[0, 0], [12, 0], [12, 6], [0, 6]];
  // ground: 6 x 6 m bays: pads under the four columns, a mat, two piles, columns, a shear wall; level 1: structural slab, beams, braces
  await run("bim_create_boundaries", { boundaries: [{ category: "structure.foundation_slab", storey: "L0", type: "MAT", outline: [[-1, -1], [13, -1], [13, 7], [-1, 7]], offset: -0.7 }, { category: "structure.slab", storey: "L1", type: "D20", outline: sq },
    { category: "architecture.floor", storey: "L0", type: "D20", outline: sq }, { category: "architecture.ceiling", storey: "L0", type: "C13", outline: sq, offset: 2.7 }, { category: "architecture.roof", storey: "L1", type: "R20", outline: sq, offset: 3, slope: { azimuth: 90, pitch: 10 } }] });
  await run("bim_create_footings", { footings: [0, 6, 12].flatMap((x) => [0, 6].map((y) => ({ storey: "L0", type: "PAD", center: [x, y], length: 1.4, width: 1.4, offset: -0.2 }))) });
  await run("bim_create_piles", { piles: [{ storey: "L0", type: "PILE", at: [0, 0], length: 12, base_offset: -0.7 }, { storey: "L0", type: "PILE", at: [12, 6], length: 12, base_offset: -0.7 }] });
  await run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "C40", points: [[0, 0], [6, 0], [12, 0], [0, 6], [6, 6], [12, 6]], height: 3.2 },
    { category: "structure.framing", storey: "L1", type: "IPE", start: [0, 0], end: [12, 0], z: 0 }] });
  await run("bim_create_braces", { braces: [{ storey: "L0", type: "RHS", start: [0, 0], end: [6, 0], end_storey: "L1" }, { storey: "L1", type: "RHS", start: [6, 0], end: [12, 0], end_storey: "L0" }] });
  await run("bim_create_walls", { walls: [{ category: "structure.shear_wall", storey: "L0", type: "SW25", start: [0, 6], end: [12, 6], height: 3.2 }, { storey: "L0", type: "SW25", start: [0, 0], end: [12, 0], height: 3 }] });
  await run("bim_create_stairs", { stairs: [{ storey: "L0", type: "S20", start: [2, 3], end: [6, 3], riser_count: 16 }] });
  await run("bim_create_railings", { railings: [{ storey: "L1", type: "RL", path: [[0, 0], [12, 0]] }] });
  const room = await t.ex("bim_create_walls", { walls: [{ storey: "L0", type: "SW25", points: [[20, 0], [26, 0], [26, 5], [20, 5]], closed: true, height: 3 }] });
  assert.equal(room.status, "applied");

  // 1-3  validate, query by structural category and by engine, usage and duplicates stay semantic
  assert.deepEqual((await t.ex("bim_validate", {})).result.issues.filter((i: any) => i.severity === "error"), []);
  const q = async (i: unknown) => (await t.ex("bim_query_elements", i)).result.elements.map((e: any) => e.id).sort();
  assert.deepEqual([(await q({ category: "structure.brace" })).length, (await q({ category: "structure.pile" })).length, (await q({ category: "structure.footing" })).length, await q({ category: "structure.shear_wall" }),
    (await q({ engine: "profile_member" })).length, (await q({ engine: "boundary" })).length], [2, 2, 6, ["W-0001"], 11, 11]);
  const usage = (await t.ex("bim_resource_usage", { kind: "storey", ref: "L0" })).result.summary as string;
  for (const k of ["structure.brace", "structure.pile", "structure.footing", "structure.shear_wall", "structure.foundation_slab"]) assert.match(usage, new RegExp(k.replace(".", "\\.")), `usage names ${k}`);
  assert.doesNotMatch(usage, /profile_member|boundary/, "no engine names in usage");
  // a floor and a structural slab on one footprint are not duplicates; two identical braces are
  await run("bim_create_braces", { braces: [{ storey: "L0", type: "RHS", start: [0, 0], end: [6, 0], end_storey: "L1" }] });
  assert.deepEqual((await t.ex("bim_validate", {})).result.issues.filter((i: any) => /uplicate/.test(i.issue)).map((i: any) => i.ids), [["BR-0001", "BR-0003"]]);
  await run("bim_delete_elements", { ids: ["BR-0003"] });

  // 4-5  level 1 moves: braces re-derive, columns keep their fixed height
  const before = await S();
  await run("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.4 } }] });
  let s = await S();
  assert.ok(Math.abs(memberLength(s, el(s, "BR-0001")) - Math.hypot(6, 0, 3.4)) < 1e-9 && Math.abs(memberLength(s, el(s, "BR-0002")) - Math.hypot(6, 0, 3.4)) < 1e-9);
  assert.deepEqual([memberWorldEnds(s, el(s, "BR-0001")).end[2], el(s, "C-0001").height], [3.4, 3.2], "the fixed column is unchanged");
  assert.deepEqual([el(s, "BR-0001").start, el(s, "BR-0001").end.offset], [el(before, "BR-0001").start, 0], "the brace's intent was not rewritten");
  // 6-8  update a brace endpoint; split / merge the shear wall; move a footing
  await run("bim_update_elements", { items: [{ id: "BR-0001", kind: "brace", set: { end: [6, 2], end_offset: 0.5 } }] });
  const sp = await run("bim_split_wall", { wall: "W-0001", t: 0.5 });
  await run("bim_merge_walls", { walls: sp.summary.walls });
  await run("bim_move_elements", { ids: ["FT-0001"], vector: [0.5, 0.5] });
  s = await S();
  assert.deepEqual([memberWorldEnds(s, el(s, "BR-0001")).end, el(s, "W-0001").category, el(s, "FT-0001").outline[0]], [[6, 2, 3.9], "structure.shear_wall", [-0.7 + 0.5, -0.7 + 0.5].map((v) => Math.round(v * 1e6) / 1e6)]);
  assert.deepEqual(modelIssues(s), []);
  // 9  plan: every structural category is drawn from its engine representation
  const p0 = planSvg(s, Object.values(s.storeys).find((x) => x.name === "L0")!);
  assert.ok(p0.includes("#b5651d") && p0.includes("#8a6d3b") && p0.includes("#c8ccd2"), "braces (diagonal, own colour), piles (own tone), slabs / footings");
  // 10  IFC class matrix
  if (hasIfc) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-ifc12m-")), "m.ifc"), ifcText = toIfc(s, { projectKey: P });
    assert.equal(/NaN|Infinity/.test(ifcText), false);
    fs.writeFileSync(file, ifcText);
    const ifc = JSON.parse(execFileSync("python3", ["-c", PROBE, file]).toString()) as { errors: number; bad: number; els: Record<string, [string, number, number, number, string, string]> };
    assert.deepEqual([ifc.errors, ifc.bad], [0, 0]);
    const byClass: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(ifc.els)) (byClass[v[0]] ??= []).push(k);
    const count = (c: string) => (byClass[c] ?? []).length;
    assert.deepEqual(["IfcColumn", "IfcBeam", "IfcMember", "IfcPile", "IfcFooting", "IfcStair", "IfcRailing", "IfcCovering", "IfcRoof"].map(count), [6, 1, 2, 2, 6, 1, 1, 1, 1]);
    assert.equal(count("IfcBuildingElementProxy"), 0);
    assert.equal(count("IfcSlab"), 3, "structural slab + foundation slab + architectural floor: slabs, none a roof");
    assert.deepEqual([ifc.els["W-0001"][5], ifc.els["FS-0001"][5], ifc.els["BR-0001"][5], ifc.els["FT-0001"][5], ifc.els["FT-0002"][5]], ["SHEAR", "BASESLAB", "BRACE", "PAD_FOOTING", "PAD_FOOTING"]);
    assert.ok(Math.abs(ifc.els["BR-0001"][1] - quantities(s, el(s, "BR-0001")).volume) < 1e-4, "brace volume == quantity (the probe rounds to 5 decimals)");
    const [bz0, bz1] = [ifc.els["BR-0001"][2], ifc.els["BR-0001"][3]];                    // the world z range follows the storeys: 0 .. 3.9 plus the section's half extent
    assert.ok(bz0 > -0.3 && bz0 < 0.3 && bz1 > 3.6 && bz1 < 4.2 && bz1 - bz0 > 3.6, `brace z range ${bz0} .. ${bz1}`);
    assert.ok(ifc.els["PL-0001"][3] <= -0.7 + 1e-9 && Math.abs(ifc.els["PL-0001"][2] - (-12.7)) < 1e-6, "the pile hangs down from -0.7");
    assert.equal(ifc.els["BR-0001"][4], "L0");
  }
  // 11-12  snapshot, reload
  assert.equal((await t.p.createSnapshot(P))?.written, true);
  const live = canonicalJson(await S());
  const reloaded = new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy });
  assert.equal(canonicalJson(await reloaded.state(P, "bim")), live);
  assert.equal(reloaded.metrics.snapshotsLoaded, 1);
  // 13  undo selected structural commands (footing move, the merge, the split, the brace update, the level change)
  const states: string[] = [];
  for (let k = 0; k < 5; k++) { states.push(canonicalJson(await S())); await run("platform_undo", {}); }
  assert.equal(el(await S(), "BR-0001").end.offset, 0, "the level change and the brace update are undone");
  assert.equal(memberLength(await S(), el(await S(), "BR-0001")), Math.hypot(6, 0, 3.2));
  // 14  full replay
  const full = await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state<BimState>(P, "bim");
  assert.equal(canonicalJson(full), canonicalJson(await S()));
  assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy }).state(P, "bim")), canonicalJson(full));
  assert.equal(states.length, 5);
});
