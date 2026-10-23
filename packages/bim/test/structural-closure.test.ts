/** Phase 12 closure · derived connectivity, per-command undo / dry run, plan matrix, full IFC matrix, legacy IFC product-by-product. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, FileStores, canonicalJson } from "@insa/core";
import { bimModule, BimState, planSvg, toIfc, structuralConnectivity, ifcGuid } from "../src/index.js";
import { setup, P } from "./authoring-fixture.js";

const hasIfc = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.geom, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
type T = Awaited<ReturnType<typeof setup>>;
const el = (s: BimState, id: string) => s.elements[id] as any;
const PROBE = `
import json, sys, ifcopenshell, ifcopenshell.geom, ifcopenshell.validate, ifcopenshell.util.element as ue, ifcopenshell.util.shape as us
f = ifcopenshell.open(sys.argv[1]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
st = ifcopenshell.geom.settings(); st.set("use-world-coords", True); out = {}; bad = 0
for e in f.by_type("IfcProduct"):
    if not e.Representation or e.is_a("IfcOpeningElement"): continue
    g = ifcopenshell.geom.create_shape(st, e).geometry; v = g.verts; z = v[2::3]
    bad += sum(1 for x in v if x != x or abs(x) == float("inf"))
    c = ue.get_container(e) or ue.get_aggregate(e)
    xs = v[0::3]
    out[e.GlobalId] = [e.is_a(), round(us.get_volume(g), 4), round(min(z), 3), round(max(z), 3), c.Name if c else None, e.Name, round(min(xs), 3), round(max(xs), 3)]
print(json.dumps({"errors": len(log.statements), "bad": bad, "els": out}))`;
type Probe = { errors: number; bad: number; els: Record<string, [string, number, number, number, string, string, number, number]> };
const probeFile = (file: string) => JSON.parse(execFileSync("python3", ["-c", PROBE, file]).toString()) as Probe;
const probeState = (s: BimState, key: string) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-ifc12c-")), "m.ifc"); const txt = toIfc(s, { projectKey: key }); assert.equal(/NaN|Infinity/.test(txt), false); fs.writeFileSync(f, txt); return probeFile(f); };

async function types(t: T) {
  await t.run("bim_create_types", { types: [{ kind: "wall", name: "SW", layers: [{ material: "Beton", thickness: 0.25 }] }, { kind: "slab", name: "D20", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "foundation_slab", name: "MAT", layers: [{ material: "Beton", thickness: 0.6 }] }, { kind: "footing", name: "PAD", footing_kind: "pad", layers: [{ material: "Beton", thickness: 0.5 }] },
    { kind: "column", name: "C40", profile: { shape: "rect", b: 0.4, h: 0.4 } }, { kind: "column", name: "PILE", profile: { shape: "circle", d: 0.4 } }, { kind: "beam", name: "IPE", profile: { shape: "i_section", h: 0.3, b: 0.15, tw: 0.007, tf: 0.011 } },
    { kind: "beam", name: "RHS", profile: { shape: "rhs", b: 0.2, h: 0.3, t: 0.01 } }] });
}

describe("derived structural connectivity", () => {
  test("endpoint / axis / wall / footing contacts are derived from geometry, stored nowhere, and change when an element moves (no event of its own)", async () => {
    const t = await setup();
    await types(t);
    await t.run("bim_create_footings", { footings: [{ storey: "L0", type: "PAD", center: [0, 0], length: 1.6, width: 1.6, offset: -0.5 }] });          // solid z -1.0 .. -0.5
    await t.run("bim_create_piles", { piles: [{ storey: "L0", type: "PILE", at: [0, 0], length: 8, base_offset: -0.75 }] });                          // top at -0.75: inside the footing
    await t.run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "C40", at: [0, 0], height: 3, base_offset: -0.5 },       // z -0.5 .. 2.5: bottom on the footing top
      { category: "structure.framing", storey: "L0", type: "IPE", start: [0, 0], end: [6, 0], z: 2.5 }] });                                         // start touches the column top
    await t.run("bim_create_braces", { braces: [{ storey: "L0", type: "RHS", start: [0, 0], start_offset: 2.5, end: [3, 0], end_offset: 2.5 }] });      // start touches the column top, end lies ALONG the beam
    await t.run("bim_create_walls", { walls: [{ category: "structure.shear_wall", storey: "L0", type: "SW", start: [6, -2], end: [6, 2], height: 3 }] });   // the beam end is inside it
    const rel = (s: BimState, o: Record<string, unknown> = {}) => structuralConnectivity(s, o as never).relations.map((r) => `${r.source}>${r.target}:${r.relation}:${r.endpoint}${r.targetEndpoint ? "/" + r.targetEndpoint : ""}`);
    let s = await t.S();
    const r0 = rel(s);
    for (const want of ["C-0001>FT-0001:endpoint_in_boundary:start", "PL-0001>FT-0001:endpoint_in_boundary:start", "B-0001>C-0001:endpoint_contact:start/end".replace("B-0001>C-0001", "B-0001>C-0001"), "B-0001>W-0001:endpoint_in_wall:end", "BR-0001>B-0001:endpoint_on_member:end"])
      if (!want.startsWith("B-0001>C-0001")) assert.ok(r0.includes(want), `${want} in ${JSON.stringify(r0)}`);
    assert.ok(r0.some((x) => /^B-0001>C-0001|^C-0001>B-0001/.test(x) && x.includes("endpoint_contact")), "beam start touches the column top");
    assert.ok(r0.some((x) => /BR-0001/.test(x) && /endpoint_contact/.test(x)), "brace start touches the column / beam end");
    assert.ok(!r0.some((x) => /PL-0001>C-0001|C-0001>PL-0001/.test(x) && x.includes("endpoint_contact")), "the pile top (z -0.75) and the column bottom (z -0.5) are 0.25 m apart: no contact");
    const q = (await t.ex("bim_query_structural_connectivity", {})).result;
    assert.deepEqual([q.derived, q.relations.length], [true, r0.length]);
    assert.equal(canonicalJson(structuralConnectivity(s)), canonicalJson(structuralConnectivity(s)), "deterministic");
    assert.deepEqual(rel(s, { ids: ["PL-0001"] }).every((x) => x.includes("PL-0001")), true);
    // it is derived: a query writes nothing, and moving the column changes the answer through the column's own move only
    const n = (await t.p.store(P).readEvents()).length;
    await t.ex("bim_query_structural_connectivity", {});
    assert.equal((await t.p.store(P).readEvents()).length, n, "a query persists nothing");
    await t.run("bim_move_elements", { ids: ["C-0001"], vector: [3, 3] });
    s = await t.S();
    const r1 = rel(s);
    assert.notDeepEqual(r1, r0);
    assert.ok(!r1.some((x) => x.startsWith("C-0001>FT-0001")) && !r1.some((x) => /B-0001>C-0001|C-0001>B-0001/.test(x) && x.includes("endpoint_contact")), "the moved column no longer touches the footing or the beam");
    const types2 = new Set((await t.p.store(P).readEvents()).slice(n).filter((e) => e.module === "bim").map((e) => e.type));
    assert.deepEqual([...types2].sort(), ["ElementUpdated"], "only the column's own update: no connectivity / joint event exists");
    assert.ok(Object.keys(s).every((k) => !/connect|joint/i.test(k)), "no connectivity record in the state");
  });
});

describe("per-command undo, replay, snapshot reload and dry run", () => {
  const cases: [string, (t: T) => Promise<unknown>, string, unknown][] = [
    ["brace", async () => undefined, "bim_create_braces", { braces: [{ storey: "L0", type: "RHS", start: [0, 0], end: [4, 3], end_storey: "L1" }] }],
    ["pile", async () => undefined, "bim_create_piles", { piles: [{ storey: "L0", type: "PILE", at: [1, 1], length: 12 }] }],
    ["shear wall", async () => undefined, "bim_create_walls", { walls: [{ category: "structure.shear_wall", storey: "L0", type: "SW", start: [0, 0], end: [10, 0], height: 3 }] }],
    ["footing", async () => undefined, "bim_create_footings", { footings: [{ storey: "L0", type: "PAD", center: [2, 2], length: 1.2, width: 1.2, offset: -0.5 }] }],
    ["structural slab", async () => undefined, "bim_create_boundaries", { boundaries: [{ category: "structure.slab", storey: "L1", type: "D20", outline: [[0, 0], [8, 0], [8, 6], [0, 6]] }] }],
    ["foundation slab", async () => undefined, "bim_create_boundaries", { boundaries: [{ category: "structure.foundation_slab", storey: "L0", type: "MAT", outline: [[0, 0], [8, 0], [8, 6], [0, 6]], offset: -0.5 }] }],
  ];
  for (const [name, , tool, input] of cases)
    test(`${name}: dry run == apply without persistence; undo restores exactly; replay and snapshot reload agree`, async () => {
      const policy = { everyEvents: 2, keep: 3 };
      const t = await setup(policy);
      await types(t);
      const before = await t.snap(), prior = canonicalJson(await t.S());
      const dry = await t.ex(tool, input, { dryRun: true });
      assert.equal(dry.status, "preview");
      assert.deepEqual(await t.snap(), before, "dry run persisted nothing");
      const n = (await t.p.store(P).readEvents()).length;
      const real = await t.ex(tool, input);
      assert.deepEqual(real.summary, dry.preview.summary, "same decision");
      assert.deepEqual((await t.p.store(P).readEvents()).slice(n).filter((e) => e.module === "bim").map((e) => e.type), dry.preview.events);
      const live = canonicalJson(await t.S());
      assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state(P, "bim")), live, "replay");
      assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy }).state(P, "bim")), live, "snapshot reload");
      await t.run("platform_undo", {});
      assert.equal(canonicalJson(await t.S()), prior, "undo");
      assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state(P, "bim")), prior, "replay after undo");
    });
  test("shear wall -> Phase 10 split -> undo; footing -> update -> undo; a level change that reshapes a brace -> undo", async () => {
    const t = await setup({ everyEvents: 3, keep: 2 });
    await types(t);
    await t.run("bim_create_walls", { walls: [{ category: "structure.shear_wall", storey: "L0", type: "SW", start: [0, 0], end: [10, 0], height: 3 }] });
    await t.run("bim_create_footings", { footings: [{ storey: "L0", type: "PAD", center: [2, 2], length: 1.2, width: 1.2, offset: -0.5 }] });
    await t.run("bim_create_braces", { braces: [{ storey: "L0", type: "RHS", start: [0, 0], end: [4, 3], end_storey: "L1" }] });
    for (const [tool, input] of [["bim_split_wall", { wall: "W-0001", t: 0.5 }], ["bim_update_elements", { items: [{ id: "FT-0001", kind: "boundary", set: { offset: -0.3 } }] }], ["bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 4.2 } }] }]] as [string, unknown][]) {
      const prior = canonicalJson(await t.S());
      await t.run(tool, input);
      assert.notEqual(canonicalJson(await t.S()), prior);
      assert.equal(canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state(P, "bim")), canonicalJson(await t.S()), `replay after ${tool}`);
      await t.run("platform_undo", {});
      assert.equal(canonicalJson(await t.S()), prior, `undo of ${tool}`);
    }
  });
});

describe("plan matrix", () => {
  test("every structural category is drawn from its engine representation next to the architecture; moving an element changes exactly its drawing", async () => {
    const t = await setup();
    await types(t);
    const sq = [[0, 0], [8, 0], [8, 6], [0, 6]];
    await t.run("bim_create_walls", { walls: [{ category: "structure.shear_wall", storey: "L0", type: "SW", start: [0, 0], end: [8, 0], height: 3 }, { storey: "L0", type: "SW", start: [0, 6], end: [8, 6], height: 3 }] });
    await t.run("bim_place_openings", { items: [{ kind: "door", host: "W-0002", along: 4, type: "K" }] });
    await t.run("bim_create_boundaries", { boundaries: [{ category: "structure.slab", storey: "L0", type: "D20", outline: sq }, { category: "structure.foundation_slab", storey: "L0", type: "MAT", outline: sq, offset: -0.5 }] });
    await t.run("bim_create_footings", { footings: [{ storey: "L0", type: "PAD", center: [1, 1], length: 1, width: 1, offset: -0.5 }] });
    await t.run("bim_create_piles", { piles: [{ storey: "L0", type: "PILE", at: [1, 1], length: 8 }] });
    await t.run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "C40", at: [4, 3], height: 3 }, { category: "structure.column", storey: "L0", type: "PILE", at: [6, 3], height: 3 },
      { category: "structure.framing", storey: "L0", type: "IPE", start: [0, 1], end: [8, 1], z: 3 }] });
    await t.run("bim_create_braces", { braces: [{ storey: "L0", type: "RHS", start: [0, 3], end: [4, 5], end_storey: "L1" }] });
    const s = await t.S(), L0 = Object.values(s.storeys).find((x) => x.name === "L0")!;
    const svg = planSvg(s, L0), count = (re: RegExp) => [...svg.matchAll(re)].length;
    assert.equal(count(/<path d="[^"]*" fill="#c8ccd2"/g), 3, "structural slab + foundation slab + footing: three boundary drawings");
    assert.equal(count(/stroke="#b5651d"[^>]*stroke-dasharray="4 4"/g), 1, "the brace: one dashed diagonal");
    assert.equal(count(/<circle[^>]*fill="#b5651d"/g), 2, "... with two end markers");
    assert.equal(count(/<circle[^>]*fill="#8a6d3b"/g), 1, "the pile (round, its own tone)");
    assert.equal(count(/<circle[^>]*fill="#1e1e1e"/g), 1, "a round column");
    assert.equal(count(/<polygon points="[^"]*" fill="#1e1e1e"/g), 1, "a rectangular column footprint");
    assert.equal(count(/stroke="#7850a0"/g), 1, "the beam axis");
    assert.ok(count(/stroke="#2c2f36"/g) >= 2, `walls and the door still draw (${count(/stroke="#2c2f36"/g)} dark strokes)`);
    assert.ok(count(/<polygon/g) >= 4, "wall footprints, the rectangular column and the brace / door drawings are polygons");
    const moved = planSvg((await (async () => { await t.run("bim_move_elements", { ids: ["BR-0001"], vector: [1, 0] }); return t.S(); })()), L0);
    assert.notEqual(moved, svg);
    const only = (a: string, b: string) => a.split("\n").filter((l, i) => l !== b.split("\n")[i]).length;
    assert.ok(only(svg, moved) <= 4 + 2, "only the brace's drawing (its line and markers) changed (plus the scaled frame)");
  });
});

describe("IFC", () => {
  test("one model, every architectural and structural category: classes, containment, 0 schema errors; GlobalIds of unchanged elements stay stable after an edit", { skip: !hasIfc, timeout: 200000 }, async () => {
    const t = await setup();
    await types(t);
    await t.run("bim_create_types", { types: [{ kind: "ceiling", name: "C13", layers: [{ material: "Alçıpan", thickness: 0.0125 }] },
      { kind: "roof", name: "R20", layers: [{ material: "Beton", thickness: 0.2 }] }, { kind: "stair", name: "S20", max_riser: 0.25, min_tread: 0.25, default_width: 1.2 },
      { kind: "railing", name: "RL", height: 1.0, top_rail: { width: 0.05, depth: 0.04 }, post: { size: 0.04 }, max_post_spacing: 1.2 }] });
    const sq = [[0, 0], [8, 0], [8, 6], [0, 6]], L = (k: string) => ({ key: k, name: k, scope: "type", dataType: "length", required: true });
    await t.run("bim_create_walls", { walls: [{ storey: "L0", type: "W", points: sq, closed: true, height: 3 }, { category: "structure.shear_wall", storey: "L0", type: "SW", start: [10, 0], end: [14, 0], height: 3 }] });
    for (const [a, b] of [["W-0001", "W-0002"], ["W-0002", "W-0003"], ["W-0003", "W-0004"], ["W-0004", "W-0001"]]) await t.join(a, "end", b, "start");
    await t.run("bim_place_openings", { items: [{ kind: "door", host: "W-0001", along: 2, type: "K" }, { kind: "window", host: "W-0001", along: 6, type: "N" }] });
    await t.run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 4, y: 3 }] });
    await t.run("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L0", type: "D20", outline: sq }, { category: "architecture.ceiling", storey: "L0", type: "C13", outline: sq, offset: 2.7 }, { category: "architecture.roof", storey: "L1", type: "R20", outline: sq, offset: 3 },
      { category: "structure.slab", storey: "L1", type: "D20", outline: sq }, { category: "structure.foundation_slab", storey: "L0", type: "MAT", outline: [[-1, -1], [9, -1], [9, 7], [-1, 7]], offset: -0.5 }] });
    await t.run("bim_create_footings", { footings: [{ storey: "L0", type: "PAD", center: [2, 2], length: 1.2, width: 1.2, offset: -0.2 }] });
    await t.run("bim_create_piles", { piles: [{ storey: "L0", type: "PILE", at: [2, 2], length: 10, base_offset: -0.7 }] });
    await t.run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "C40", at: [2, 2], height: 3.2 }, { category: "structure.framing", storey: "L1", type: "IPE", start: [0, 3], end: [8, 3], z: 0 }] });
    await t.run("bim_create_braces", { braces: [{ storey: "L0", type: "RHS", start: [2, 2], end: [6, 2], end_storey: "L1" }] });
    await t.run("bim_create_stairs", { stairs: [{ storey: "L0", type: "S20", start: [1, 4], end: [5, 4], riser_count: 16 }] });
    await t.run("bim_create_railings", { railings: [{ storey: "L1", type: "RL", path: [[0, 6], [8, 6]] }] });
    await t.run("bim_create_families", { families: [{ name: "Desk", category: "architecture.furniture", parameters: [L("w"), L("d"), L("h")], representation: { kind: "box", width: "w", depth: "d", height: "h" } }] });
    await t.run("bim_create_types", { types: [{ kind: "component", name: "D160", family: "Desk", parameters: { w: 1.6, d: 0.8, h: 0.75 } }] });
    await t.run("bim_create_components", { components: [{ type: "D160", storey: "L0", x: 6, y: 4.5 }] });
    let s = await t.S();
    const a = probeState(s, "mx");
    assert.deepEqual([a.errors, a.bad], [0, 0]);
    const byClass: Record<string, string[]> = {};
    for (const v of Object.values(a.els)) (byClass[v[0]] ??= []).push(v[5]);
    const n = (c: string) => (byClass[c] ?? []).length;
    assert.deepEqual(["IfcWall", "IfcSlab", "IfcCovering", "IfcRoof", "IfcDoor", "IfcWindow", "IfcStair", "IfcRailing", "IfcSpace", "IfcFurniture", "IfcColumn", "IfcBeam", "IfcMember", "IfcPile", "IfcFooting"].map(n),
      [5, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    assert.equal(n("IfcBuildingElementProxy"), 0, "no proxy where a class exists");
    const g = (id: string) => a.els[ifcGuid(`mx:${id}`)];
    assert.deepEqual([g("W-0005")[0], g("FS-0001")[0], g("SSL-0001")[0], g("RF-0001")[0], g("CE-0001")[0], g("BR-0001")[0], g("PL-0001")[0], g("FT-0001")[0]], ["IfcWall", "IfcSlab", "IfcSlab", "IfcRoof", "IfcCovering", "IfcMember", "IfcPile", "IfcFooting"]);
    assert.deepEqual([g("STR-0001")[4], g("RL-0001")[4], g("BR-0001")[4], g("RF-0001")[4], g("SSL-0001")[4]], ["L0", "L1", "L0", "L1", "L1"], "storey containment");
    // an edit: only the touched product changes; every other GlobalId keeps its class, storey and geometry
    await t.run("bim_move_elements", { ids: ["C-0001"], vector: [0.5, 0] });
    s = await t.S();
    const b = probeState(s, "mx");
    const changed = Object.keys(a.els).filter((k) => JSON.stringify(a.els[k]) !== JSON.stringify(b.els[k]));
    assert.deepEqual(Object.keys(b.els).sort(), Object.keys(a.els).sort(), "same products");
    assert.deepEqual(changed.map((k) => a.els[k][5]), ["C-0001"], "only the moved column differs");
  });
  test("legacy: the Phase 11 fixture exports exactly the products the Phase 11 code exported (class, storey, volume, Z range, GlobalId)", { skip: !hasIfc, timeout: 200000 }, async () => {
    const FX = path.join(import.meta.dirname, "fixtures/phase11-project"), dir = fs.mkdtempSync(path.join(os.tmpdir(), "insa-p12leg-"));
    fs.cpSync(FX, path.join(dir, "phase11"), { recursive: true });
    const s = await new Platform({ modules: [bimModule], stores: new FileStores(dir), snapshotPolicy: false }).state<BimState>("phase11", "bim");
    const oldP = probeFile(path.join(FX, "phase11-oracle/phase11.ifc")), now = probeState(s, "phase11");
    assert.deepEqual([oldP.errors, now.errors, now.bad], [0, 0, 0]);
    assert.deepEqual(Object.keys(now.els).sort(), Object.keys(oldP.els).sort(), "the same products with the same GlobalIds");
    for (const [gid, v] of Object.entries(oldP.els)) {
      assert.deepEqual([now.els[gid][0], now.els[gid][4], now.els[gid][5]], [v[0], v[4], v[5]], `${v[5]}: class, storey, name`);
      assert.ok(Math.abs(now.els[gid][1] - v[1]) <= 1e-3 && Math.abs(now.els[gid][2] - v[2]) <= 1e-3 && Math.abs(now.els[gid][3] - v[3]) <= 1e-3, `${v[5]} (${v[0]}): ${JSON.stringify(now.els[gid].slice(1, 4))} vs ${JSON.stringify(v.slice(1, 4))}`);
    }
  });
});
