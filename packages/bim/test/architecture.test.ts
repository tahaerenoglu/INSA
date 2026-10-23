/**
 * Phase 11 · architecture expansion: ceiling, roof (boundary), stair (stair engine), railing (path engine).
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Platform, canonicalJson } from "@insa/core";
import { bimModule, BimState, Element, quantities, listEngines, getCategory, listCategories, findEngine, planeHeight, normalizeAzimuth, stairGeometry, pathPosts, pathLength,
         modelIssues, checkElement, engineIdOfElement, resolveElementRepresentation, duplicateSignature, toIfc, planSvg, TYPE_FAMILY_OF_KIND } from "../src/index.js";
import { setup, nearPt, P } from "./authoring-fixture.js";

const SQ: [number, number][] = [[0, 0], [10, 0], [10, 6], [0, 6]];
const COS30 = Math.cos((30 * Math.PI) / 180);
type T = Awaited<ReturnType<typeof setup>>;
/** types of the four new categories on top of the fixture's storeys (L0 = 0, L1 = 3.2) */
async function arch() {
  const t = await setup();
  await t.run("bim_create_types", { types: [
    { kind: "ceiling", name: "C13", layers: [{ material: "Alçıpan", thickness: 0.0125 }] }, { kind: "roof", name: "R20", layers: [{ material: "Kiremit", thickness: 0.02 }, { material: "Beton", thickness: 0.18 }] },
    { kind: "slab", name: "D20", layers: [{ material: "Beton", thickness: 0.2 }] }, { kind: "beam", name: "B", profile: { shape: "rect", b: 0.3, h: 0.5 } },
    { kind: "stair", name: "S20", max_riser: 0.2, min_tread: 0.25, default_width: 1.2 },
    { kind: "railing", name: "RL", height: 1.0, top_rail: { width: 0.05, depth: 0.04 }, post: { size: 0.04 }, max_post_spacing: 1.2 }] });
  const boundary = (category: string, type: string, extra: Record<string, unknown> = {}, storey = "L0") =>
    t.run("bim_create_boundaries", { boundaries: [{ category, storey, type, outline: SQ, ...extra }] });
  const stair = (extra: Record<string, unknown> = {}) => t.run("bim_create_stairs", { stairs: [{ storey: "L0", type: "S20", start: [1, 1], end: [5, 1], riser_count: 16, ...extra }] });
  return { ...t, boundary, stair };
}
const el = (s: BimState, id: string) => s.elements[id] as any;
const events = async (t: T, from: number) => (await t.p.store(P).readEvents()).slice(from).filter((e) => e.module === "bim").map((e) => e.type);

describe("taxonomy and engines", () => {
  test("the four categories sit on existing / activated engines; floor, ceiling and roof share ONE boundary engine; the registry stays immutable", () => {
    const eng = (id: string) => getCategory(id).engine;
    assert.deepEqual(["architecture.floor", "architecture.ceiling", "architecture.roof", "architecture.stair", "architecture.railing"].map(eng), ["boundary", "boundary", "boundary", "stair", "path"]);
    assert.deepEqual(listEngines().filter((e) => e.status === "implemented").map((e) => e.id), ["wall", "point_component", "hosted_component", "profile_member", "boundary", "spatial", "stair", "path", "mep_fitting", "reinforcement", "assembly", "ramp_flight", "curtain_wall", "pitched_roof", "mep_network"]);
    assert.deepEqual(listEngines().filter((e) => e.status === "reserved").map((e) => e.id), ["proxy"]);   // Phase 13 activated mep_network
    assert.deepEqual([getCategory("architecture.floor").placements, getCategory("architecture.roof").placements], [["boundary"], ["boundary", "boundary_plane"]]);
    assert.deepEqual(["architecture.floor", "architecture.ceiling", "architecture.roof"].map((c) => getCategory(c).typeKinds), [["slab"], ["ceiling"], ["roof"]]);
    assert.deepEqual(["slab", "ceiling", "roof", "stair", "railing", "wall"].map((k) => TYPE_FAMILY_OF_KIND[k]), ["layered", "layered", "layered", "stair", "railing", "layered"]);
    assert.throws(() => (getCategory("architecture.roof").placements as any).push("host"), TypeError);
    assert.throws(() => { (getCategory("architecture.ceiling") as any).engine = "wall"; }, TypeError);
    assert.deepEqual([getCategory("architecture.ceiling").thickness, getCategory("architecture.floor").thickness ?? null, findEngine("path")!.typeFamilies], ["above", null, ["railing"]]);
    assert.equal(listCategories().filter((c) => c.engine === "boundary").length, 8, "floor, ceiling, roof (Phase 11) + structural slab, foundation slab, footing (Phase 12) + plate + landing (Phase 14): still ONE engine");
  });
});

describe("central chain", () => {
  test("a wrong category -> engine / type family / placement is caught by the central chain for every new variant (state-level corruption)", async () => {
    const t = await arch();
    await t.boundary("architecture.roof", "R20", { slope: { azimuth: 0, pitch: 10 } }, "L1");
    await t.stair();
    await t.run("bim_create_railings", { railings: [{ storey: "L1", type: "RL", path: [[0, 0], [4, 0]] }] });
    const s = await t.S();
    const tryIt = (id: string, mutate: (e: any) => void, reason: string) => {
      const st = structuredClone(s); mutate(st.elements[id]);
      assert.throws(() => checkElement(st, st.elements[id]), (e: any) => e.reason === reason, `${id}: ${reason}`);
    };
    tryIt("RF-0001", (e) => { e.category = "architecture.stair"; }, "CATEGORY_ENGINE_MISMATCH");        // M11: a roof claiming the stair engine's category
    tryIt("STR-0001", (e) => { e.category = "architecture.railing"; }, "CATEGORY_ENGINE_MISMATCH");
    tryIt("RL-0001", (e) => { e.category = "architecture.floor"; }, "CATEGORY_ENGINE_MISMATCH");
    tryIt("RL-0001", (e) => { e.category = "architecture.furniture"; }, "CATEGORY_ENGINE_MISMATCH");
    tryIt("RF-0001", (e) => { e.category = "architecture.floor"; }, "INVALID_ENGINE_PLACEMENT");          // a floor cannot be a sloped plane
    tryIt("RF-0001", (e) => { e.type = Object.values(s.types).find((x) => x.name === "S20")!.id; }, "ENGINE_TYPE_MISMATCH");   // M12: a stair type on a roof
    tryIt("STR-0001", (e) => { e.type = Object.values(s.types).find((x) => x.name === "R20")!.id; }, "ENGINE_TYPE_MISMATCH");
    tryIt("RL-0001", (e) => { e.type = Object.values(s.types).find((x) => x.name === "S20")!.id; }, "ENGINE_TYPE_MISMATCH");   // a stair type on a railing: the type FAMILY is not the path engine's
  });
});

describe("ceiling (boundary engine)", () => {
  test("created through the generic boundary tool; thickness extends UP from the reference plane; floor and ceiling at one footprint are different things", async () => {
    const t = await arch();
    await t.boundary("architecture.ceiling", "C13", { offset: 2.7 });
    await t.boundary("architecture.floor", "D20", { offset: 0 });
    const s = await t.S();
    assert.deepEqual([el(s, "CE-0001").kind, el(s, "CE-0001").category, engineIdOfElement(s, s.elements["CE-0001"]), el(s, "BD-0001")?.category ?? el(s, "S-0001")?.category], ["boundary", "architecture.ceiling", "boundary", "architecture.floor"]);
    assert.deepEqual(quantities(s, s.elements["CE-0001"]), { area: 60, thickness: 0.0125, volume: 0.75 });
    const rep = resolveElementRepresentation(s, s.elements["CE-0001"]) as any;
    assert.deepEqual([rep.kind, rep.direction, rep.bottom, rep.top, rep.thickness], ["boundary_extrusion", "above", 2.7, 2.7125, 0.0125]);
    const fl = resolveElementRepresentation(s, s.elements[Object.keys(s.elements).find((k) => el(s, k).category === "architecture.floor")!]) as any;
    assert.deepEqual([fl.direction, fl.top, fl.bottom], ["below", 0, -0.2], "the floor is unchanged: thickness DOWN from its level");
    const v = (await t.ex("bim_validate", {})).result;
    assert.deepEqual(v.issues, [], "a floor and a ceiling on the same footprint are not duplicates");
    await t.boundary("architecture.ceiling", "C13", { offset: 2.7 });
    assert.deepEqual((await t.ex("bim_validate", {})).result.issues.map((i: any) => i.ids), [["CE-0001", "CE-0002"]], "two ceilings on the same footprint are");
  });
  test("generic update / move / reassign / delete; type usage; rows carry category and engine", async () => {
    const t = await arch();
    await t.boundary("architecture.ceiling", "C13", { offset: 2.7 });
    await t.run("bim_update_elements", { items: [{ id: "CE-0001", kind: "boundary", set: { offset: 2.9 } }] });
    await t.run("bim_move_elements", { ids: ["CE-0001"], vector: [1, 2] });
    await t.run("bim_reassign_storey", { items: [{ id: "CE-0001", storey: "L1" }] });
    const s = await t.S();
    assert.deepEqual([el(s, "CE-0001").offset, el(s, "CE-0001").outline[0], el(s, "CE-0001").storey === Object.values(s.storeys).find((x) => x.name === "L1")!.id], [2.9, [1, 2], true]);
    const rows = (await t.ex("bim_query_elements", { category: "architecture.ceiling" })).result.elements;
    assert.deepEqual(rows.map((r: any) => [r.id, r.category, r.engine]), [["CE-0001", "architecture.ceiling", "boundary"]]);
    assert.deepEqual((await t.ex("bim_query_elements", { engine: "boundary" })).result.elements.map((r: any) => r.category), ["architecture.ceiling"]);
    await t.rejected("bim_delete_types", { types: [{ type: "C13" }] }, "RESOURCE_IN_USE");
    await t.run("bim_delete_elements", { ids: ["CE-0001"] });
    assert.equal(Object.keys((await t.S()).elements).length, 0);
  });
});

describe("roof (boundary engine, flat and single-plane)", () => {
  test("flat roof: surface == projected; sloped roof: surface = projected / cos(pitch) and the volume follows the perpendicular thickness (analytic oracle)", async () => {
    const t = await arch();
    await t.boundary("architecture.roof", "R20", { offset: 3, holes: [[[2, 2], [4, 2], [4, 3], [2, 3]]] }, "L1");
    await t.boundary("architecture.roof", "R20", { offset: 3, slope: { azimuth: 90, pitch: 30 } }, "L1");
    const s = await t.S(), q0 = quantities(s, s.elements["RF-0001"]), q1 = quantities(s, s.elements["RF-0002"]);
    assert.deepEqual([q0.projected_area, q0.surface_area, q0.pitch], [58, 58, 0]);
    assert.ok(Math.abs(q0.volume - 58 * 0.2) < 1e-12);
    assert.ok(Math.abs(q1.surface_area - 60 / COS30) < 1e-9 && q1.surface_area >= q1.projected_area && q1.pitch === 30);
    assert.ok(Math.abs(q1.volume - (60 / COS30) * 0.2) < 1e-9, "volume = surface area x perpendicular thickness, NOT plan area x thickness");
    assert.ok(Math.abs(q1.volume - 60 * 0.2) > 1, "...which is clearly different from the plan-area volume");
    // the ONE height formula: eave (y = 0, the lowest projection) at the offset, rising along +y by tan(pitch)
    const r1 = el(s, "RF-0002");
    assert.ok([[5, 0, 3], [5, 6, 3 + 6 * Math.tan(Math.PI / 6)], [0, 3, 3 + 3 * Math.tan(Math.PI / 6)]].every(([x, y, z]) => Math.abs(planeHeight(r1, [x, y]) - z) < 1e-9));
    const rep = resolveElementRepresentation(s, s.elements["RF-0002"]) as any;
    assert.deepEqual([rep.kind, rep.azimuth, rep.pitch, rep.riseDir], ["boundary_plane_extrusion", 90, 30, [0, 1]]);
    assert.ok(rep.outerHeights.every((z: number, i: number) => Math.abs(z - planeHeight(r1, SQ[i])) < 1e-12), "the representation reads the same formula");
    // other azimuths: the eave is always the lowest side
    for (const [az, lowPt] of [[0, [0, 3]], [180, [10, 3]], [270, [5, 6]]] as [number, number[]][]) {
      const r = { outline: SQ, offset: 3, slope: { azimuth: az, pitch: 20 } };
      assert.ok(Math.abs(planeHeight(r as any, lowPt as any) - 3) < 1e-9, `azimuth ${az}`);
    }
  });
  test("plane intent is canonical and validated: azimuth normalised, pitch in (0, 80], finite; a floor / ceiling cannot be sloped; self-intersecting outlines are refused", async () => {
    const t = await arch();
    await t.boundary("architecture.roof", "R20", { slope: { azimuth: -90, pitch: 10 } }, "L1");
    assert.equal(el(await t.S(), "RF-0001").slope.azimuth, 270, "normalised to [0, 360)");
    assert.equal(normalizeAzimuth(725), 5);
    for (const pitch of [0, -5, 80.5, 90]) await t.rejected("bim_create_boundaries", { boundaries: [{ category: "architecture.roof", storey: "L1", type: "R20", outline: SQ, slope: { azimuth: 0, pitch } }] }, "INVALID_ROOF_PLANE");
    await t.rejected("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L0", type: "D20", outline: SQ, slope: { azimuth: 0, pitch: 10 } }] }, "INVALID_ENGINE_PLACEMENT");
    await t.rejected("bim_create_boundaries", { boundaries: [{ category: "architecture.ceiling", storey: "L0", type: "C13", outline: SQ, slope: { azimuth: 0, pitch: 10 } }] }, "INVALID_ENGINE_PLACEMENT");
    await t.rejected("bim_create_boundaries", { boundaries: [{ category: "architecture.roof", storey: "L1", type: "R20", outline: [[0, 0], [10, 6], [10, 0], [0, 6]] }] }, "SELF_INTERSECTING_POLYGON");
    const s = await t.S(), r = structuredClone(el(s, "RF-0001"));
    for (const bad of [{ azimuth: Number.NaN, pitch: 10 }, { azimuth: 10, pitch: Number.POSITIVE_INFINITY }, { azimuth: 361, pitch: 10 }, { azimuth: 10 }]) {
      const st = structuredClone(s); (st.elements["RF-0001"] as any).slope = bad;
      assert.throws(() => checkElement(st, st.elements["RF-0001"]), (e: any) => e.reason === "INVALID_ROOF_PLANE", JSON.stringify(bad));
    }
    void r;
  });
  test("a roof updates its plane; a flat roof stays flat; two planes with the same outline are not duplicates; floor / ceiling types are refused (central chain)", async () => {
    const t = await arch();
    await t.boundary("architecture.roof", "R20", { slope: { azimuth: 0, pitch: 15 } }, "L1");
    await t.boundary("architecture.roof", "R20", { slope: { azimuth: 90, pitch: 15 } }, "L1");
    assert.deepEqual((await t.ex("bim_validate", {})).result.issues, [], "different planes, same outline: not duplicates");
    await t.run("bim_update_elements", { items: [{ id: "RF-0001", kind: "boundary", set: { slope: { azimuth: 90, pitch: 15 } } }] });
    assert.deepEqual((await t.ex("bim_validate", {})).result.issues.map((i: any) => i.ids), [["RF-0001", "RF-0002"]], "now they are");
    await t.boundary("architecture.roof", "R20", {}, "L1");
    await t.rejected("bim_update_elements", { items: [{ id: "RF-0003", kind: "boundary", set: { slope: { azimuth: 0, pitch: 10 } } }] }, "INVALID_ELEMENT_UPDATE");
    await t.rejected("bim_create_boundaries", { boundaries: [{ category: "architecture.roof", storey: "L1", type: "C13", outline: SQ }] }, "INVALID_REFERENCE");    // M1 mirrored: a ceiling type on a roof
    await t.rejected("bim_create_boundaries", { boundaries: [{ category: "architecture.ceiling", storey: "L0", type: "R20", outline: SQ }] }, "INVALID_REFERENCE");
    await t.rejected("bim_create_boundaries", { boundaries: [{ category: "architecture.roof", storey: "L1", type: "W", outline: SQ }] }, "INVALID_REFERENCE");    // a wall type
    await t.rejected("bim_create_boundaries", { boundaries: [{ category: "architecture.ceiling", storey: "L0", type: "B", outline: SQ }] }, "INVALID_REFERENCE");   // a beam type
    await t.rejected("bim_create_boundaries", { boundaries: [{ category: "architecture.roof", storey: "L1", type: "S20", outline: SQ }] }, "INVALID_REFERENCE");
  });
});

describe("stair engine", () => {
  test("a straight run: riser height, tread depth, slope, quantities and the stepped profile are derived; the rise follows the storeys", async () => {
    const t = await arch();
    const r = await t.stair();
    assert.deepEqual(r.summary.created, ["STR-0001"]);
    const s = await t.S(), e = el(s, "STR-0001");
    assert.deepEqual([e.kind, e.category, e.height, e.vertical.mode, e.width, e.riserCount, e.baseOffset], ["stair", "architecture.stair", 3.2, "storey", 1.2, 16, 0], "rise = L1 - L0, width from the type");
    const g = stairGeometry(e);
    assert.ok(Math.abs(g.riserHeight - 0.2) < 1e-12 && Math.abs(g.treadDepth - 4 / 15) < 1e-12 && g.treadCount === 15 && Math.abs(g.run - 4) < 1e-12);
    assert.ok(Math.abs(g.slopeAngle - (Math.atan2(0.2, 4 / 15) * 180) / Math.PI) < 1e-9);
    const q = quantities(s, e);
    assert.deepEqual([q.total_rise, q.riser_count, q.width, Math.round(q.run * 1e9) / 1e9, q.footprint_area], [3.2, 16, 1.2, 4, 4.8]);
    const rep = resolveElementRepresentation(s, e) as any;
    assert.deepEqual([rep.kind, rep.steps.length, rep.profile[0], rep.profile.at(-1), rep.steps.at(-1).top], ["stair_run", 16, [0, 0], [4, 0], 3.2]);
    assert.equal(Math.max(...rep.profile.map((p: number[]) => p[1])), 3.0, "the solid's highest tread is the 15th: 15 x 0.2 (the 16th riser reaches the upper floor)");
    const area = rep.profile.reduce((a: number, p: number[], i: number) => a + (p[0] * rep.profile[(i + 1) % rep.profile.length][1] - rep.profile[(i + 1) % rep.profile.length][0] * p[1]), 0) / 2;
    assert.ok(Math.abs(Math.abs(area) - 4 * 3.2 / 2) < 1e-9, "section area = run x rise / 2 (analytic)");
    assert.ok(rep.profile.every((p: number[]) => p.every(Number.isFinite)));
    assert.ok(Object.keys(s.elements).length === 1, "treads are NOT elements");
  });
  test("moving a level updates the stair's rise in the same command (the riser count never changes by itself); a level move that breaks the type limit is refused atomically", async () => {
    const t = await arch();
    await t.stair();
    const n = (await t.p.store(P).readEvents()).length;
    await t.run("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.0 } }] });
    const s = await t.S();
    assert.deepEqual([el(s, "STR-0001").height, el(s, "STR-0001").riserCount, stairGeometry(el(s, "STR-0001")).riserHeight], [3.0, 16, 0.1875]);
    assert.ok((await events(t, n)).every((x) => ["StoreyUpdated", "ElementUpdated"].includes(x)), "canonical events only");
    await t.rejected("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.4 } }] }, "STAIR_TYPE_LIMIT_EXCEEDED");           // 3.4 / 16 = 0.2125 > 0.2
    assert.equal(el(await t.S(), "STR-0001").riserCount, 16, "the intent was not mutated to make validation pass");
    await t.rejected("bim_update_elements", { items: [{ id: "STR-0001", kind: "stair", set: { riser_count: 18 } }] }, "STAIR_TYPE_LIMIT_EXCEEDED");   // 18 risers on 4 m: tread 0.235 < 0.25
    await t.run("bim_update_elements", { items: [{ id: "STR-0001", kind: "stair", set: { riser_count: 18, end: [5.4, 1] } }] });                  // a longer run: valid
    await t.run("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.4 } }] });                                                    // 3.4 / 18 = 0.1889: fine now
    assert.equal(el(await t.S(), "STR-0001").height, 3.4);
  });
  test("validation: riser count, run, width, vertical constraint, type limits, type family", async () => {
    const t = await arch();
    const bad = (extra: Record<string, unknown>, reason: string) => t.rejected("bim_create_stairs", { stairs: [{ storey: "L0", type: "S20", start: [1, 1], end: [5, 1], riser_count: 16, ...extra }] }, reason);
    await bad({ riser_count: 1 }, "INVALID_STAIR_GEOMETRY");                                                       // M6
    await bad({ riser_count: 0 }, "INVALID_STAIR_GEOMETRY");
    await bad({ end: [1, 1] }, "INVALID_STAIR_GEOMETRY");                                                          // zero run
    await bad({ width: 0 }, "INVALID_DIMENSION");
    await bad({ top_storey: "L0", storey: "L1" }, "STAIR_VERTICAL_CONSTRAINT_INVALID");                            // M5: the top is not above the base
    await bad({ height: 5 }, "STAIR_TYPE_LIMIT_EXCEEDED");                                                         // M7: 5 / 16 = 0.3125 > 0.2
    await bad({ riser_count: 4 }, "STAIR_TYPE_LIMIT_EXCEEDED");                                                    // 3.2 / 4 = 0.8
    await bad({ end: [3, 1] }, "STAIR_TYPE_LIMIT_EXCEEDED");                                                       // tread 2 / 15 < 0.25
    await bad({ type: "RL" }, "INVALID_REFERENCE");                                                                // a railing type
    await bad({ type: "D20" }, "INVALID_REFERENCE");                                                               // a slab type
    await bad({ category: "architecture.railing" }, "CATEGORY_ENGINE_MISMATCH");
    await t.run("bim_create_types", { types: [{ kind: "stair", name: "NoDefault", max_riser: 0.2, min_tread: 0.25 }] });
    await bad({ type: "NoDefault" }, "INVALID_STAIR_GEOMETRY");                                                    // no width anywhere
    await t.run("bim_create_stairs", { stairs: [{ storey: "L0", type: "NoDefault", start: [1, 1], end: [5, 1], riser_count: 16, width: 1.0, height: 3.0 }] });
    assert.equal(el(await t.S(), "STR-0001").vertical.mode, "fixed", "an explicit rise is a FIXED intent");
  });
  test("generic move / update / reassign / delete; duplicates; query by engine", async () => {
    const t = await arch();
    await t.stair();
    await t.run("bim_move_elements", { ids: ["STR-0001"], vector: [2, 3] });
    await t.run("bim_update_elements", { items: [{ id: "STR-0001", kind: "stair", set: { width: 1.5, riser_count: 17, base_offset: 0.1, end: [7.2, 4] } }] });
    let s = await t.S();
    assert.deepEqual([el(s, "STR-0001").start, el(s, "STR-0001").end, el(s, "STR-0001").width, el(s, "STR-0001").riserCount, Math.round(el(s, "STR-0001").height * 1e6) / 1e6], [[3, 4], [7.2, 4], 1.5, 17, 3.1]);
    // a storey-constrained stair cannot be reassigned to its own top storey: its vertical semantics would break, so the command is refused
    await t.rejected("bim_reassign_storey", { items: [{ id: "STR-0001", storey: "L1" }] }, "STAIR_VERTICAL_CONSTRAINT_INVALID");
    await t.run("bim_update_elements", { items: [{ id: "STR-0001", kind: "stair", set: { height: 3.1 } }] });                              // fixed rise: it simply moves with the storey
    await t.run("bim_reassign_storey", { items: [{ id: "STR-0001", storey: "L1" }] });
    s = await t.S();
    assert.deepEqual([el(s, "STR-0001").storey === Object.values(s.storeys).find((x) => x.name === "L1")!.id, el(s, "STR-0001").height, el(s, "STR-0001").vertical.mode], [true, 3.1, "fixed"]);
    assert.deepEqual((await t.ex("bim_query_elements", { engine: "stair" })).result.elements.map((x: any) => [x.id, x.category, x.engine]), [["STR-0001", "architecture.stair", "stair"]]);
    await t.stair();                                                                                                       // an identical stair is a duplicate
    await t.stair({ riser_count: 17 });
    const dup = (await t.ex("bim_validate", {})).result.issues.filter((i: any) => /uplicate/.test(i.issue));
    assert.deepEqual(dup.map((d: any) => d.ids), [], "STR-0001 moved and changed: nothing duplicates yet");
    await t.stair();
    assert.deepEqual((await t.ex("bim_validate", {})).result.issues.filter((i: any) => /uplicate/.test(i.issue)).map((d: any) => d.ids), [["STR-0002", "STR-0004"]]);
    await t.run("bim_delete_elements", { ids: ["STR-0004"] });
    assert.ok(!(await t.S()).elements["STR-0004"]);
  });
});
