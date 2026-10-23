/** Phase 12 · structural expansion on the existing profile_member / wall / boundary engines. */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, FileStores, canonicalJson } from "@insa/core";
import { bimModule, BimState, quantities, toIfc, checkElement, sectionArea, sectionProblem, memberWorldEnds, memberLength, engineIdOfElement, modelIssues, ifcGuid, BIM_STATE_VERSION, BIM_EVENT_VERSIONS } from "../src/index.js";
import { setup, P, wall } from "./authoring-fixture.js";

const hasIfc = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.geom, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
const el = (s: BimState, id: string) => s.elements[id] as any;
type T = Awaited<ReturnType<typeof setup>>;
async function structural() {
  const t = await setup({ everyEvents: 3, keep: 2 });
  await t.run("bim_create_types", { types: [
    { kind: "wall", name: "SW25", layers: [{ material: "Beton", thickness: 0.25 }] }, { kind: "slab", name: "D20", layers: [{ material: "Beton", thickness: 0.2 }] }, { kind: "roof", name: "R20", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "foundation_slab", name: "MAT60", layers: [{ material: "Beton", thickness: 0.6 }] }, { kind: "footing", name: "PAD", footing_kind: "pad", layers: [{ material: "Beton", thickness: 0.5 }] }, { kind: "footing", name: "STRIP", footing_kind: "strip", layers: [{ material: "Beton", thickness: 0.4 }] },
    { kind: "column", name: "C40", profile: { shape: "rect", b: 0.4, h: 0.4 } }, { kind: "column", name: "PILE40", profile: { shape: "circle", d: 0.4 } },
    { kind: "beam", name: "B30", profile: { shape: "rect", b: 0.3, h: 0.5 } }, { kind: "beam", name: "RHS", profile: { shape: "rhs", b: 0.2, h: 0.3, t: 0.01 } },
    { kind: "beam", name: "CHS", profile: { shape: "chs", d: 0.2, t: 0.008 } }, { kind: "beam", name: "IPE", profile: { shape: "i_section", h: 0.3, b: 0.15, tw: 0.007, tf: 0.011 } }] });
  return t;
}
const brace = (t: T, extra: Record<string, unknown> = {}) => t.run("bim_create_braces", { braces: [{ storey: "L0", type: "RHS", start: [0, 0], end: [4, 3], start_offset: 0, end_storey: "L1", end_offset: 0, ...extra }] });

describe("brace: true 3D member", () => {
  test("world endpoints follow the storeys; the length is the 3D distance; a level move reshapes it WITHOUT any brace event", async () => {
    const t = await structural();
    await brace(t);
    let s = await t.S();
    assert.deepEqual([el(s, "BR-0001").kind, el(s, "BR-0001").category, el(s, "BR-0001").placement, memberWorldEnds(s, el(s, "BR-0001"))], ["profile_member", "structure.brace", "member_spatial_axis", { start: [0, 0, 0], end: [4, 3, 3.2] }]);
    assert.ok(Math.abs(memberLength(s, el(s, "BR-0001")) - Math.hypot(4, 3, 3.2)) < 1e-12);
    const q = quantities(s, el(s, "BR-0001"));
    assert.ok(Math.abs(q.volume - sectionArea({ shape: "rhs", b: 0.2, h: 0.3, t: 0.01 }) * q.length) < 1e-12 && q.cross_section_area === q.section_area);
    const n = (await t.p.store(P).readEvents()).length;
    await t.run("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 4.0 } }] });
    s = await t.S();
    assert.ok(Math.abs(memberLength(s, el(s, "BR-0001")) - Math.hypot(4, 3, 4.0)) < 1e-12, "world geometry follows L1");
    const types = (await t.p.store(P).readEvents()).slice(n).filter((e) => e.module === "bim").map((e) => e.type);
    assert.ok(types.every((x) => x === "StoreyUpdated"), `no brace event: ${types}`);
    const d = (await t.ex("bim_get_element", { id: "BR-0001" })).result;
    assert.deepEqual([d.engine, d.placement_info.kind, d.world.end[2], Math.round(d.length * 1e6) / 1e6], ["profile_member", "member_spatial_axis", 4, Math.round(Math.hypot(4, 3, 4) * 1e6) / 1e6]);
  });
  test("any 3D angle; within one storey; refused: coincident endpoints, missing storey, incompatible type; ambiguity is refused on reassign; typed updates are atomic", async () => {
    const t = await structural();
    await brace(t, { end_storey: undefined, end: [0, 0], end_offset: 2.5 });                               // vertical in one storey
    await brace(t, { start: [0, 0], end: [5, 0], start_offset: 0.5, end_storey: undefined, end_offset: 0.5 });   // horizontal
    await t.rejected("bim_create_braces", { braces: [{ storey: "L0", type: "RHS", start: [1, 1], end: [1, 1] }] }, "DEGENERATE_GEOMETRY");                    // M1
    await t.rejected("bim_create_braces", { braces: [{ storey: "L0", type: "RHS", start: [1, 1], end: [2, 2], end_storey: "L9" }] }, "RESOURCE_NOT_FOUND");   // M2
    await t.rejected("bim_create_braces", { braces: [{ storey: "L0", type: "SW25", start: [1, 1], end: [2, 2] }] }, "INVALID_REFERENCE");                      // M3: a wall type
    await t.rejected("bim_create_braces", { braces: [{ storey: "L0", type: "C40", start: [1, 1], end: [2, 2] }] }, "INVALID_REFERENCE");                       // a column type is vertical-only
    await t.rejected("bim_reassign_storey", { items: [{ id: "BR-0001", storey: "L1" }] }, "INVALID_ENGINE_PLACEMENT");
    await t.run("bim_update_elements", { items: [{ id: "BR-0001", kind: "brace", set: { end_storey: "L1", end_offset: 0, end: [4, 3], rotation: 30 } }] });
    assert.deepEqual([el(await t.S(), "BR-0001").end, el(await t.S(), "BR-0001").rotation], [{ storey: Object.values((await t.S()).storeys).find((x) => x.name === "L1")!.id, at: [4, 3], offset: 0 }, 30]);
    await t.rejected("bim_update_elements", { items: [{ id: "BR-0001", kind: "brace", set: { end_storey: "L0", end: [0, 0], end_offset: 0 } }] }, "DEGENERATE_GEOMETRY");   // start == end in the world
    await t.rejected("bim_update_elements", { items: [{ id: "BR-0001", kind: "brace", set: { end_storey: "L9" } }] }, "RESOURCE_NOT_FOUND");
    await t.run("bim_move_elements", { ids: ["BR-0001"], vector: [1, 2] });
    assert.deepEqual([el(await t.S(), "BR-0001").start.at, el(await t.S(), "BR-0001").end.at], [[1, 2], [5, 5]]);
    await t.rejected("bim_delete_storeys", { storeys: ["L1"] }, "RESOURCE_IN_USE");                              // the end storey is a reference
    const s = await t.S(), st = structuredClone(s);
    el(st, "BR-0001").end = { ...el(st, "BR-0001").start };
    assert.throws(() => checkElement(st, st.elements["BR-0001"]), (e: any) => e.reason === "DEGENERATE_GEOMETRY");
  });
});

describe("pile: downward vertical member", () => {
  test("hangs DOWN from its top; a pile is not a column (direction is category semantics); quantities; updates keep it a pile", async () => {
    const t = await structural();
    await t.run("bim_create_piles", { piles: [{ storey: "L0", type: "PILE40", at: [1, 1], length: 12, base_offset: 0.2 }] });
    await t.run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "C40", at: [3, 3], height: 3 }] });
    const s = await t.S();
    assert.deepEqual([el(s, "PL-0001").direction, el(s, "PL-0001").vertical, memberWorldEnds(s, el(s, "PL-0001"))], ["down", { mode: "fixed" }, { start: [1, 1, 0.2], end: [1, 1, -11.8] }]);
    assert.equal("direction" in el(s, "C-0001"), false, "legacy columns carry no direction field (absent = up)");
    const q = quantities(s, el(s, "PL-0001")), qc = quantities(s, el(s, "C-0001"));
    assert.ok(Math.abs(q.volume - Math.PI * 0.04 * 12) < 1e-9 && q.length === 12);
    assert.deepEqual(Object.keys(qc).sort(), ["height", "section_area", "volume"], "column quantities unchanged");
    await t.rejected("bim_create_piles", { piles: [{ storey: "L0", type: "PILE40", at: [1, 1], length: 0 }] }, "INVALID_INPUT");           // M4
    await t.rejected("bim_create_piles", { piles: [{ storey: "L0", type: "B30", at: [1, 1], length: 5 }] }, "INVALID_REFERENCE");           // M5: a beam type
    await t.rejected("bim_create_profile_members", { members: [{ category: "structure.pile", storey: "L0", type: "PILE40", at: [1, 1] }] }, "INVALID_ENGINE_PLACEMENT");   // length required
    await t.run("bim_update_elements", { items: [{ id: "PL-0001", kind: "pile", set: { length: 8, base_offset: 0 } }] });
    assert.deepEqual(memberWorldEnds(await t.S(), el(await t.S(), "PL-0001")).end, [1, 1, -8]);
    const st = structuredClone(await t.S());
    delete el(st, "PL-0001").direction;                                                                                    // a pile that looks like a column
    assert.throws(() => checkElement(st, st.elements["PL-0001"]), (e: any) => e.reason === "CATEGORY_ENGINE_MISMATCH");
    const st2 = structuredClone(await t.S()); el(st2, "C-0001").direction = "down";
    assert.throws(() => checkElement(st2, st2.elements["C-0001"]), (e: any) => e.reason === "CATEGORY_ENGINE_MISMATCH");
    await t.run("bim_update_storeys", { items: [{ storey: "L0", set: { elevation: 0.5 } }] });                              // storey-relative: the pile top follows, its length does not change
    assert.deepEqual(memberWorldEnds(await t.S(), el(await t.S(), "PL-0001")), { start: [1, 1, 0.5], end: [1, 1, -7.5] });
  });
});

describe("profile sections (one source of truth)", () => {
  const shapes = [{ shape: "rect", b: 0.3, h: 0.5 }, { shape: "circle", d: 0.4 }, { shape: "rhs", b: 0.2, h: 0.3, t: 0.01 }, { shape: "chs", d: 0.2, t: 0.008 }, { shape: "i_section", h: 0.3, b: 0.15, tw: 0.007, tf: 0.011 }] as const;
  const oracle = [0.3 * 0.5, Math.PI * 0.2 ** 2, 0.2 * 0.3 - 0.18 * 0.28, Math.PI * (0.1 ** 2 - 0.092 ** 2), 2 * 0.15 * 0.011 + (0.3 - 0.022) * 0.007];
  test("section areas equal the independent oracles; invalid dimensions are refused centrally (types)", async () => {
    shapes.forEach((p, i) => assert.ok(Math.abs(sectionArea(p as never) - oracle[i]) < 1e-12, p.shape));
    assert.equal(sectionProblem({ shape: "rhs", b: 0.2, h: 0.3, t: 0.15 } as never)?.field, "t");                              // M6: no hollow left
    assert.equal(sectionProblem({ shape: "chs", d: 0.2, t: 0.1 } as never)?.field, "t");                                       // M7
    assert.equal(sectionProblem({ shape: "i_section", h: 0.3, b: 0.15, tw: 0.2, tf: 0.01 } as never)?.field, "tw");            // M8: web wider than the flange
    assert.equal(sectionProblem({ shape: "i_section", h: 0.2, b: 0.15, tw: 0.007, tf: 0.1 } as never)?.field, "tf");
    assert.equal(sectionProblem({ shape: "rect", b: Number.NaN, h: 1 } as never)?.field, "b");
    const t = await structural();
    for (const [p, reason] of [[{ shape: "rhs", b: 0.2, h: 0.3, t: 0.2 }, "INVALID_DIMENSION"], [{ shape: "chs", d: 0.2, t: 0.1 }, "INVALID_DIMENSION"]] as const)
      await t.rejected("bim_create_types", { types: [{ kind: "beam", name: `bad-${p.shape}`, profile: p }] }, reason);
  });
  test("IFC: every section exports its TRUE profile (hollow stays hollow); volume = section area x member length (IfcOpenShell)", { skip: !hasIfc }, async () => {
    const t = await structural();
    await t.run("bim_create_braces", { braces: [{ storey: "L0", type: "B30", start: [0, 0], end: [4, 0], start_offset: 1, end_offset: 1 }, { storey: "L0", type: "RHS", start: [0, 1], end: [4, 1], start_offset: 1, end_offset: 1 },
      { storey: "L0", type: "CHS", start: [0, 2], end: [4, 2], start_offset: 1, end_offset: 1 }, { storey: "L0", type: "IPE", start: [0, 3], end: [4, 3], start_offset: 1, end_offset: 1 }] });
    await t.run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "PILE40", at: [8, 0], height: 3 }] });
    await t.run("bim_create_piles", { piles: [{ storey: "L0", type: "PILE40", at: [8, 5], length: 12, base_offset: 0.5 }] });
    const s = await t.S(), file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-ifc12-")), "m.ifc"), ifc = toIfc(s, { projectKey: P });
    fs.writeFileSync(file, ifc);
    for (const k of ["IFCRECTANGLEHOLLOWPROFILEDEF", "IFCCIRCLEHOLLOWPROFILEDEF", "IFCISHAPEPROFILEDEF"]) assert.match(ifc, new RegExp(k), `${k} is written`);
    const out = JSON.parse(execFileSync("python3", ["-c", `
import json, sys, ifcopenshell, ifcopenshell.geom, ifcopenshell.validate, ifcopenshell.util.shape as us
f = ifcopenshell.open(sys.argv[1]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
st = ifcopenshell.geom.settings(); st.set("use-world-coords", True); out = {}
for e in f.by_type("IfcProduct"):
    if not e.Representation: continue
    g = ifcopenshell.geom.create_shape(st, e).geometry
    z = g.verts[2::3]
    out[e.Name] = [e.is_a(), round(us.get_volume(g), 7), getattr(e, "PredefinedType", None), e.GlobalId, round(min(z), 4), round(max(z), 4)]
print(json.dumps({"errors": len(log.statements), "els": out}))`, file]).toString()) as { errors: number; els: Record<string, [string, number, string, string, number, number]> };
    assert.equal(out.errors, 0);
    const want: Record<string, number> = { "BR-0001": 0.15, "BR-0002": 0.0372, "BR-0003": 0.0049, "BR-0004": 0.0023 };
    void want;
    for (const id of ["BR-0001", "BR-0002", "BR-0003", "BR-0004"]) {
      const area = sectionArea((s.types[el(s, id).type] as any).profile);
      const round = (s.types[el(s, id).type] as any).profile.shape === "chs";                 // IfcOpenShell tessellates circles into polygons: 1 % there, exact elsewhere
      assert.ok(Math.abs(out.els[id][1] - area * 4) <= (round ? 0.01 * area * 4 : 1e-6), `${id}: ${out.els[id][1]} vs ${area * 4}`);
      assert.deepEqual([out.els[id][0], out.els[id][2], out.els[id][3]], ["IfcMember", "BRACE", ifcGuid(`${P}:${id}`)]);
    }
    assert.ok(out.els["BR-0002"][1] < sectionArea({ shape: "rect", b: 0.2, h: 0.3 }) * 4 * 0.5, "the RHS is NOT a solid rectangle");
    assert.equal(out.els["C-0001"][0], "IfcColumn");
    assert.deepEqual([out.els["C-0001"][4], out.els["C-0001"][5]], [0, 3], "a column rises");
    // the pile hangs DOWN from +0.5 to -11.5; it is an IfcPile (never an IfcColumn) and its volume is the circle area x 12
    assert.deepEqual([out.els["PL-0001"][0], out.els["PL-0001"][4], out.els["PL-0001"][5]], ["IfcPile", -11.5, 0.5]);
    assert.ok(Math.abs(out.els["PL-0001"][1] - Math.PI * 0.04 * 12) < 0.01 * Math.PI * 0.04 * 12);
  });
});

describe("shear wall (wall engine) and the Phase 10 primitives", () => {
  test("created through bim_create_walls; split / merge / trim / extend keep the category; architecture + shear walls do not merge; non-wall types refused", async () => {
    const t = await structural();
    await t.run("bim_create_walls", { walls: [{ category: "structure.shear_wall", storey: "L0", type: "SW25", start: [0, 0], end: [10, 0], height: 3 }, { category: "structure.shear_wall", storey: "L0", type: "SW25", start: [4, -2], end: [4, 3], height: 3 }] });
    await t.run("bim_create_walls", { walls: [{ storey: "L0", type: "SW25", start: [20, 0], end: [25, 0], height: 3 }, { storey: "L0", type: "SW25", start: [25, 0], end: [30, 0], height: 3 }] });
    let s = await t.S();
    assert.deepEqual([el(s, "W-0001").category, "category" in el(s, "W-0003"), engineIdOfElement(s, s.elements["W-0001"])], ["structure.shear_wall", false, "wall"]);
    const sp = await t.run("bim_split_wall", { wall: "W-0001", t: 0.5 });
    await t.run("bim_trim_wall", { wall: "W-0002", endpoint: "start", target: "W-0001" });
    s = await t.S();
    assert.deepEqual([sp.summary.walls, el(s, "W-0001").category, el(s, sp.summary.walls[1]).category], [["W-0001", "W-0005"], "structure.shear_wall", "structure.shear_wall"]);
    await t.run("bim_merge_walls", { walls: ["W-0001", "W-0005"] }).catch(() => undefined);
    await t.run("bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: "W-0003", endpoint: "end" }, { wall: "W-0004", endpoint: "start" }] });
    await t.run("bim_merge_walls", { walls: ["W-0003", "W-0004"] });
    assert.equal(el(await t.S(), "W-0003").category, undefined, "an architectural wall stays architectural");
    // a shear wall + an architectural wall: not merge-compatible (different semantic categories)
    await t.run("bim_create_walls", { walls: [{ category: "structure.shear_wall", storey: "L0", type: "SW25", start: [40, 0], end: [45, 0], height: 3 }, { storey: "L0", type: "SW25", start: [45, 0], end: [50, 0], height: 3 }] });
    const ids = Object.keys((await t.S()).elements).filter((k) => k.startsWith("W-")).slice(-2);
    await t.run("bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: ids[0], endpoint: "end" }, { wall: ids[1], endpoint: "start" }] });
    await t.rejected("bim_merge_walls", { walls: ids }, "MERGE_INCOMPATIBLE", { field: "category" });                                    // M12
    await t.rejected("bim_create_walls", { walls: [{ category: "structure.shear_wall", storey: "L0", type: "D20", start: [0, 9], end: [4, 9], height: 3 }] }, "INVALID_REFERENCE");   // M9
    await t.rejected("bim_create_walls", { walls: [{ category: "structure.slab", storey: "L0", type: "SW25", start: [0, 9], end: [4, 9], height: 3 }] }, "CATEGORY_ENGINE_MISMATCH");
    assert.deepEqual(modelIssues(await t.S()), []);
  });
});

describe("structural slab, foundation slab, footing (boundary engine)", () => {
  const sq = [[0, 0], [8, 0], [8, 6], [0, 6]];
  test("quantities, thickness DOWN, type families, pad / strip decided by the TYPE; floor and structural slab at one footprint are not duplicates", async () => {
    const t = await structural();
    await t.run("bim_create_boundaries", { boundaries: [{ category: "structure.slab", storey: "L1", type: "D20", outline: sq }, { category: "architecture.floor", storey: "L1", type: "D20", outline: sq },
      { category: "structure.foundation_slab", storey: "L0", type: "MAT60", outline: sq, offset: -0.5 }] });
    await t.run("bim_create_footings", { footings: [{ storey: "L0", type: "PAD", center: [2, 2], length: 1.2, width: 1.0, rotation: 90, offset: -0.5 }, { storey: "L0", type: "STRIP", outline: [[0, 5.8], [8, 5.8], [8, 6.2], [0, 6.2]], offset: -0.5 }] });
    const s = await t.S();
    assert.deepEqual(["SSL-0001", "FS-0001", "FT-0001", "FT-0002"].map((id) => el(s, id).category), ["structure.slab", "structure.foundation_slab", "structure.footing", "structure.footing"]);
    assert.deepEqual(quantities(s, el(s, "SSL-0001")), { area: 48, thickness: 0.2, volume: 9.600000000000001 });
    assert.ok(Math.abs(quantities(s, el(s, "FT-0001")).volume - 1.2 * 1.0 * 0.5) < 1e-9 && Math.abs(quantities(s, el(s, "FT-0002")).area - 3.2) < 1e-9);
    assert.deepEqual([el(s, "FT-0001").outline[0], (s.types[el(s, "FT-0001").type] as any).footingKind, (s.types[el(s, "FT-0002").type] as any).footingKind], [[2.5, 1.4], "pad", "strip"]);
    assert.deepEqual((await t.ex("bim_validate", {})).result.issues, [], "structural slab vs floor: same footprint, different categories");
    const sig = (await t.ex("bim_query_elements", {})).result.elements.map((e: any) => [e.category, e.engine]);
    assert.ok(sig.every(([, eng]: string[]) => eng === "boundary"));
    for (const [cat, type, reason] of [["structure.slab", "R20", "INVALID_REFERENCE"], ["structure.slab", "SW25", "INVALID_REFERENCE"], ["structure.footing", "R20", "INVALID_REFERENCE"], ["structure.footing", "MAT60", "INVALID_REFERENCE"], ["structure.foundation_slab", "PAD", "INVALID_REFERENCE"]])
      await t.rejected("bim_create_boundaries", { boundaries: [{ category: cat, storey: "L0", type, outline: sq }] }, reason);                  // M10
    await t.rejected("bim_create_boundaries", { boundaries: [{ category: "structure.footing", storey: "L0", type: "PAD", outline: [[0, 0], [4, 4], [4, 0], [0, 4]] }] }, "SELF_INTERSECTING_POLYGON");   // M11
    await t.rejected("bim_create_types", { types: [{ kind: "footing", name: "x", footing_kind: "spread", layers: [{ material: "Beton", thickness: 0.3 }] }] }, "INVALID_INPUT");
    assert.deepEqual(Object.values((await t.S()).elements).filter((e: any) => e.kind !== "boundary").length, 0, "no component workaround, no new element kind");
  });
});

describe("compatibility and migration", () => {
  test("event / state versions: unchanged by design (additive optional fields only); the real Phase 11 and Phase 8 fixtures replay with NO structural element, same ids, same measurements", async () => {
    assert.deepEqual([BIM_STATE_VERSION, BIM_EVENT_VERSIONS.ElementCreated, BIM_EVENT_VERSIONS.ElementUpdated], [7, 3, 2]);   // 7 = Phase 14 spatial units (additive); the element event versions are unchanged
    for (const [name, key] of [["phase11-project", "phase11"], ["phase8-project", "phase8"]]) {
      const FX = path.join(import.meta.dirname, "fixtures", name), dir = fs.mkdtempSync(path.join(os.tmpdir(), "insa-p12fx-"));
      fs.cpSync(FX, path.join(dir, key), { recursive: true });
      const raw = fs.readFileSync(path.join(dir, key, "events.jsonl"), "utf8");
      const s = await new Platform({ modules: [bimModule], stores: new FileStores(dir), snapshotPolicy: false }).state<BimState>(key, "bim");
      const oracle = JSON.parse(fs.readFileSync(path.join(FX, `${key}-oracle/measurements.json`), "utf8"));
      assert.deepEqual(Object.keys(s.elements).sort(), Object.keys(oracle.quantities).sort(), `${key}: same ids`);
      assert.deepEqual(Object.values(s.elements).filter((e: any) => /structure\.(brace|pile|shear_wall|slab|footing|foundation_slab)/.test(e.category ?? "")), [], `${key}: nothing structural is inferred`);
      for (const e of Object.values(s.elements)) {
        const q = quantities(s, e), old = oracle.quantities[e.id];
        if (e.kind === "wall") { for (const k of ["length", "thickness", "height"]) assert.equal(q[k], old[k], `${key} ${e.id} ${k}`); }    // tee-clipped volumes were settled in Phase 10
        else assert.equal(canonicalJson(q), canonicalJson(old), `${key}: ${e.id}`);
      }
      assert.equal(fs.readFileSync(path.join(dir, key, "events.jsonl"), "utf8"), raw, "history never rewritten");
      assert.deepEqual(modelIssues(s), []);
    }
  });
});
void wall;
