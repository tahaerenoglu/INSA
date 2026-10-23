/**
 * Phase 10 · authoring primitives: split, merge, physical T-junction ends.
 * Every rejection is checked to leave the event log and the committed state unchanged.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Platform, canonicalJson } from "@insa/core";
import { BimState, Wall, Opening, HostedComponent, WallJoin, wallFrame, quantities, storeyRegions, modelIssues, planSvg } from "../src/index.js";
import { setup, center, near, nearPt, EVENT_TYPES, wall, P } from "./authoring-fixture.js";

const regions = (s: BimState) => storeyRegions(s, Object.values(s.storeys).find((x) => x.name === "L0")!.id);
const bimTypes = async (p: Platform, from: number) => (await p.store(P).readEvents()).slice(from).filter((e) => e.module === "bim").map((e) => e.type);
const joinsOf = (s: BimState) => Object.values(s.joins).sort((a, b) => (a.id < b.id ? -1 : 1));

// ============================================================================ split
describe("split", () => {
  test("splits at a normalized t; the original id keeps the START segment; properties are preserved; only canonical events are written", async () => {
    const { p, run, S, walls } = await setup();
    await walls([[[0, 0], [10, 0]]], { room_bounding: false });
    await run("bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { name: "Axis A", base_offset: 0.1 } }] });
    await run("bim_set_properties", { items: [{ ids: ["W-0001"], pset: "Pset_WallCommon", values: { FireRating: "EI60" } }] });
    const before = wall(await S(), "W-0001"), n = (await p.store(P).readEvents()).length;
    const r = await run("bim_split_wall", { wall: "W-0001", t: 0.4 });
    assert.deepEqual([r.summary.walls, r.summary.splitT, r.summary.splitPoint, r.summary.lengths], [["W-0001", "W-0002"], 0.4, [4, 0], [4, 6]]);
    const s = await S(), A = wall(s, "W-0001"), B = wall(s, "W-0002");
    assert.deepEqual([A.start, A.end, B.start, B.end], [[0, 0], [4, 0], [4, 0], [10, 0]]);
    for (const w of [A, B]) {
      assert.deepEqual([w.type, w.storey, w.vertical, w.height, w.baseOffset, w.roomBounding, w.props, w.name, w.exterior],
        [before.type, before.storey, before.vertical, before.height, before.baseOffset, false, before.props, "Axis A", before.exterior]);
    }
    assert.deepEqual([quantities(s, A).length, quantities(s, B).length], [4, 6]);
    assert.deepEqual(joinsOf(s).map((j) => [j.id, j.kind, (j as any).members.map((m: any) => `${m.wall}:${m.endpoint}`)]), [["J-0001", "endpoint_endpoint", ["W-0001:end", "W-0002:start"]]], "the halves stay explicitly joined");
    const types = await bimTypes(p, n);
    assert.ok(types.every((t) => EVENT_TYPES.has(t)), `only canonical events: ${types}`);
    assert.deepEqual(modelIssues(s), []);
  });
  test("splitT reports the ACTUAL position after a snap to a T at the split point (not the requested t), consistent with splitPoint", async () => {
    const { run, S, walls, tee } = await setup();
    await walls([[[0, 0], [10, 0]], [[5, 0], [5, 4]]]);
    await tee("W-0002", "start", "W-0001");
    const r = await run("bim_split_wall", { wall: "W-0001", t: 0.50008 });                  // 0.8 mm from the T: within JOIN_TOLERANCE, the split snaps to it
    assert.deepEqual([r.summary.requestedT, r.summary.splitT, r.summary.splitPoint, r.summary.lengths], [0.50008, 0.5, [5, 0], [5, 5]]);
    const s = await S();
    assert.deepEqual([wall(s, "W-0001").end, wall(s, "W-0003").start], [[5, 0], [5, 0]], "the stored geometry is the snapped one");
    assert.ok(near(r.summary.splitT * 10, wall(s, "W-0001").end[0], 1e-9), "splitT * length == the x of the split point");
    const plain = await setup();                                                              // no snap: splitT equals the requested value
    await plain.walls([[[0, 0], [10, 0]]]);
    const q = await plain.run("bim_split_wall", { wall: "W-0001", t: 0.25 });
    assert.deepEqual([q.summary.splitT, q.summary.requestedT], [0.25, 0.25]);
  });
  test("a split by point is normalised to t; invalid positions are rejected (t = 0, t = 1, outside, NaN, point off the axis, both / neither)", async () => {
    const { run, walls, rejected, S } = await setup();
    await walls([[[0, 0], [10, 0]], [[0, 5], [10, 5]]]);
    const r = await run("bim_split_wall", { wall: "W-0001", point: [2.5, 0.0004] });
    assert.equal(r.summary.splitT, 0.25);
    for (const t of [0, 1, -0.1, 1.2, 0.0000001, 0.9999999]) await rejected("bim_split_wall", { wall: "W-0002", t }, "INVALID_SPLIT");
    await rejected("bim_split_wall", { wall: "W-0002", t: Number.NaN }, "INVALID_INPUT");
    await rejected("bim_split_wall", { wall: "W-0002", point: [5, 5.5] }, "INVALID_SPLIT");
    await rejected("bim_split_wall", { wall: "W-0002" }, "INVALID_SPLIT");
    await rejected("bim_split_wall", { wall: "W-0002", t: 0.5, point: [5, 5] }, "INVALID_SPLIT");
    await rejected("bim_split_wall", { wall: "W-9999", t: 0.5 }, "INVALID_SPLIT");
    assert.deepEqual(Object.keys((await S()).elements), ["W-0001", "W-0002", "W-0003"]);
  });
  test("joins move with their end: start joins stay, end joins go to the new wall; tees transfer with renormalised t; a tee at the split point joins the new junction", async () => {
    const { run, S, roomModel } = await setup();
    await roomModel();
    const r = await run("bim_split_wall", { wall: "W-0001", t: 0.5 });
    let s = await S();
    assert.deepEqual(s.joins["J-0001"], { id: "J-0001", kind: "endpoint_endpoint", members: [{ wall: "W-0002", endpoint: "start" }, { wall: "W-0006", endpoint: "end" }] }, "the corner junction follows the end");
    assert.deepEqual(s.joins["J-0004"].kind === "endpoint_endpoint" && s.joins["J-0004"].members.map((m) => `${m.wall}:${m.endpoint}`), ["W-0001:start", "W-0004:end"], "the start junction is untouched");
    const t5 = s.joins["J-0005"] as Extract<WallJoin, { kind: "endpoint_segment" }>;
    assert.deepEqual([t5.host, t5.t], ["W-0001", 0.8], "tee at x = 4 stays on the first half: 4 / 5");
    assert.equal(r.summary.transferredJoins.length, 2);
    assert.deepEqual(regions(s).map((g) => [g.area, g.perimeter]).sort((a, b) => a[0] - b[0]), [[24, 20], [36, 24]], "rooms: same regions");
    assert.deepEqual(modelIssues(s), []);
    // a tee on the second half
    const b = await setup(); await b.roomModel();
    await b.run("bim_split_wall", { wall: "W-0001", t: 0.3 });
    const tb = (await b.S()).joins["J-0005"] as Extract<WallJoin, { kind: "endpoint_segment" }>;
    assert.deepEqual([tb.host, tb.t], ["W-0006", r_(1 / 7)], "x = 4 lies 1 m into the 7 m second half");
    // a tee exactly at the split point
    const c = await setup(); await c.roomModel();
    await c.run("bim_split_wall", { wall: "W-0001", t: 0.4 });
    const cs = await c.S(), merged = joinsOf(cs).find((j) => j.kind === "endpoint_endpoint" && j.members.length === 3)!;
    assert.deepEqual((merged as any).members.map((m: any) => `${m.wall}:${m.endpoint}`), ["W-0001:end", "W-0005:start", "W-0006:start"], "a three-wall junction, explicit");
    assert.equal(cs.joins["J-0005"], undefined, "the tee became a junction member");
    assert.equal(regions(cs).length, 2);
    assert.deepEqual(modelIssues(cs), []);
    s = cs; void s;
  });
  test("hosted openings, doors and windows keep their ids and physical positions; an opening crossed by the split rejects the whole command", async () => {
    const { run, S, roomModel, rejected } = await setup();
    await roomModel();
    const before = await S();
    const centers = ["O-0001", "O-0002", "O-0003"].map((o) => center(before, o));
    await rejected("bim_split_wall", { wall: "W-0001", t: 0.2 }, "SPLIT_INTERSECTS_HOSTED_OPENING", { wallId: "W-0001", openingId: "O-0001", intervalStart: 1.5, intervalEnd: 2.5, splitDistance: 2 });
    await run("bim_split_wall", { wall: "W-0001", t: 0.5 });
    const s = await S();
    assert.deepEqual(["O-0001", "O-0002"].map((o) => (s.elements[o] as Opening).host), ["W-0001", "W-0006"]);
    assert.equal((s.elements["O-0002"] as Opening).along, 2);
    assert.deepEqual(["N-0001", "N-0002"].map((f) => (s.elements[f] as HostedComponent).host), ["W-0001", "W-0006"], "fills follow their opening");
    ["O-0001", "O-0002", "O-0003"].forEach((o, k) => assert.ok(nearPt(center(s, o), centers[k]), `${o} physical position`));
    assert.deepEqual(Object.keys(s.elements).filter((k) => /^[ODN]-/.test(k)).sort(), ["D-0001", "N-0001", "N-0002", "O-0001", "O-0002", "O-0003"], "no door / window / opening recreated");
  });
  test("a storey-constrained wall splits into two constrained walls that follow the storey", async () => {
    const { run, S } = await setup();
    await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [10, 0] }] });          // no height: constrained to L1
    await run("bim_split_wall", { wall: "W-0001", t: 0.5 });
    await run("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.6 } }] });
    const s = await S();
    assert.deepEqual([wall(s, "W-0001").vertical.mode, wall(s, "W-0002").vertical.mode, wall(s, "W-0001").height, wall(s, "W-0002").height], ["storey", "storey", 3.6, 3.6]);
  });
  test("undo restores the pre-split state exactly (ids, joins, openings, counters)", async () => {
    const { run, S, roomModel } = await setup();
    await roomModel();
    const before = canonicalJson(await S());
    await run("bim_split_wall", { wall: "W-0001", t: 0.5 });
    assert.notEqual(canonicalJson(await S()), before);
    await run("platform_undo", {});
    assert.equal(canonicalJson(await S()), before);
  });
});
const r_ = (v: number) => Math.round(v * 1e9) / 1e9;

// ============================================================================ merge
describe("merge", () => {
  test("merge is the inverse of split: elements, joins, hosted content and the room regions return to the original (signatures included)", async () => {
    const { run, S, roomModel } = await setup();
    await roomModel();
    const orig = await S();
    const sig = regions(orig).map((g) => g.signature).sort();
    await run("bim_split_wall", { wall: "W-0001", t: 0.5 });
    assert.notDeepEqual(regions(await S()).map((g) => g.signature).sort(), sig, "a split changes the boundary references");
    const r = await run("bim_merge_walls", { walls: ["W-0001", "W-0006"] });
    assert.deepEqual([r.summary.survivor, r.summary.removed, r.summary.mergedLength], ["W-0001", "W-0006", 10]);
    const s = await S();
    assert.equal(canonicalJson({ e: s.elements, j: s.joins }), canonicalJson({ e: orig.elements, j: orig.joins }));
    assert.deepEqual(regions(s).map((g) => g.signature).sort(), sig);
    assert.deepEqual(modelIssues(s), []);
  });
  test("survivor and direction: `primary` (else the smaller id) survives with its own direction; hosted content, tees and far-end joins are transferred", async () => {
    const mk = async () => {
      const t = await setup();
      await t.walls([[[0, 0], [6, 0]], [[12, 0], [6, 0]], [[3, 4], [3, 0.0]], [[9, 3], [9, 0]], [[12, 0], [12, -4]]]);          // W-0001, W-0002 (reversed), a tee on each, a wall joined at W-0002's far end
      await t.join("W-0001", "end", "W-0002", "end");
      await t.tee("W-0003", "end", "W-0001"); await t.tee("W-0004", "end", "W-0002");
      await t.join("W-0002", "start", "W-0005", "start");
      await t.run("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 2, type: "N" }, { kind: "door", host: "W-0002", along: 2, type: "K" }] });
      return t;
    };
    const a = await mk();
    const w = await a.S(), centers = ["O-0001", "O-0002"].map((o) => center(w, o)), teePts = ["W-0003", "W-0004"].map((id) => wall(w, id).end);
    const r = await a.run("bim_merge_walls", { walls: ["W-0002", "W-0001"] });
    const s = await a.S();
    assert.deepEqual([r.summary.survivor, wall(s, "W-0001").start, wall(s, "W-0001").end, s.elements["W-0002"]], ["W-0001", [0, 0], [12, 0], undefined], "smaller id survives, keeps its direction");
    assert.ok(nearPt(center(s, "O-0001"), centers[0]) && nearPt(center(s, "O-0002"), centers[1]), "physical positions");
    assert.deepEqual(["O-0001", "O-0002"].map((o) => (s.elements[o] as Opening).host), ["W-0001", "W-0001"]);
    assert.deepEqual([(s.elements["D-0001"] as HostedComponent).host, (s.elements["N-0001"] as HostedComponent).host], ["W-0001", "W-0001"]);
    assert.deepEqual(["J-0002", "J-0003"].map((id) => { const j = s.joins[id] as any; return [j.host, j.t]; }), [["W-0001", 0.25], ["W-0001", 0.75]], "tees renormalised on 12 m");
    assert.ok(["W-0003", "W-0004"].every((id, k) => nearPt(wall(s, id).end, teePts[k])), "tee wall ends did not move");
    assert.deepEqual((s.joins["J-0004"] as any).members.map((m: any) => `${m.wall}:${m.endpoint}`), ["W-0001:end", "W-0005:start"], "the far-end junction moved to the survivor");
    assert.equal(s.joins["J-0001"], undefined, "the internal junction is gone");
    assert.deepEqual(modelIssues(s), []);
    const b = await mk();                                              // primary = the reversed wall: its direction is kept
    await b.run("bim_merge_walls", { walls: ["W-0001", "W-0002"], primary: "W-0002" });
    const sb = await b.S();
    assert.deepEqual([wall(sb, "W-0002").start, wall(sb, "W-0002").end, sb.elements["W-0001"]], [[12, 0], [0, 0], undefined]);
    assert.ok(nearPt(center(sb, "O-0001"), centers[0]) && nearPt(center(sb, "O-0002"), centers[1]));
    assert.deepEqual(modelIssues(sb), []);
  });
  test("refused: not collinear, not explicitly joined (touching / collinear / tee), different type, vertical, room bounding, ambiguous junction, conflicting properties", async () => {
    const { run, join, tee, walls, rejected, inject } = await setup();
    await walls([[[0, 0], [5, 0]], [[5, 0], [10, 0]], [[7, 0], [7, 5]], [[20, 0], [25, 0]], [[25, 0], [30, 0]], [[40, 0], [45, 0]], [[45, 0], [50, 0]]]);   // W-0001..7
    await rejected("bim_merge_walls", { walls: ["W-0001", "W-0002"] }, "MERGE_NOT_CONNECTED");                    // collinear, touching, NOT joined
    await join("W-0001", "end", "W-0002", "start");
    await rejected("bim_merge_walls", { walls: ["W-0001", "W-0004"] }, "MERGE_NOT_CONNECTED");                    // far apart
    await tee("W-0003", "start", "W-0002");                                                                       // a tee is not an endpoint junction
    await rejected("bim_merge_walls", { walls: ["W-0003", "W-0002"] }, "MERGE_NOT_CONNECTED");
    await run("bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: "W-0004", endpoint: "end" }, { wall: "W-0005", endpoint: "start" }] });
    await run("bim_create_types", { types: [{ kind: "wall", name: "W2", layers: [{ material: "m", thickness: 0.2 }] }] });
    await run("bim_update_elements", { items: [{ id: "W-0005", kind: "wall", set: { type: "W2" } }] });
    await rejected("bim_merge_walls", { walls: ["W-0004", "W-0005"] }, "MERGE_INCOMPATIBLE", { field: "type" });
    await run("bim_update_elements", { items: [{ id: "W-0005", kind: "wall", set: { type: "W" } }] });
    await run("bim_update_elements", { items: [{ id: "W-0005", kind: "wall", set: { room_bounding: false } }] });
    await rejected("bim_merge_walls", { walls: ["W-0004", "W-0005"] }, "MERGE_INCOMPATIBLE", { field: "roomBounding" });
    await run("bim_update_elements", { items: [{ id: "W-0005", kind: "wall", set: { room_bounding: true } }] });
    await run("bim_update_elements", { items: [{ id: "W-0005", kind: "wall", set: { height: 2.5 } }] });
    await rejected("bim_merge_walls", { walls: ["W-0004", "W-0005"] }, "MERGE_INCOMPATIBLE");                     // fixed 3 vs fixed 2.5 / constrained vs fixed
    await run("bim_update_elements", { items: [{ id: "W-0005", kind: "wall", set: { height: 3 } }] });
    await run("bim_update_elements", { items: [{ id: "W-0004", kind: "wall", set: { top_storey: "L1" } }] });
    await rejected("bim_merge_walls", { walls: ["W-0004", "W-0005"] }, "MERGE_INCOMPATIBLE", { field: "vertical" });
    await run("bim_update_elements", { items: [{ id: "W-0004", kind: "wall", set: { height: 3 } }] });
    await run("bim_update_elements", { items: [{ id: "W-0004", kind: "wall", set: { name: "A" } }, { id: "W-0005", kind: "wall", set: { name: "B" } }] });
    await rejected("bim_merge_walls", { walls: ["W-0004", "W-0005"] }, "MERGE_PROPERTY_CONFLICT", { property: "name" });
    await run("bim_update_elements", { items: [{ id: "W-0005", kind: "wall", set: { name: "A" } }] });
    await run("bim_set_properties", { items: [{ ids: ["W-0004"], pset: "P", values: { Rating: "A" } }, { ids: ["W-0005"], pset: "P", values: { Rating: "B" } }] });
    await rejected("bim_merge_walls", { walls: ["W-0004", "W-0005"] }, "MERGE_PROPERTY_CONFLICT", { property: "P.Rating" });
    await run("bim_set_properties", { items: [{ ids: ["W-0005"], pset: "P", values: { Rating: "A", Extra: 1 } }] });
    await inject([{ type: "ElementUpdated", v: 2, payload: { id: "W-0004", changes: { exterior: "left" } } }, { type: "ElementUpdated", v: 2, payload: { id: "W-0005", changes: { exterior: "right" } } }]);
    await rejected("bim_merge_walls", { walls: ["W-0004", "W-0005"] }, "MERGE_PROPERTY_CONFLICT", { property: "exterior" });
    await inject([{ type: "ElementUpdated", v: 2, payload: { id: "W-0005", changes: { exterior: "left" } } }]);
    const ok = await run("bim_merge_walls", { walls: ["W-0004", "W-0005"] });                                       // compatible now: properties are unioned
    assert.deepEqual([ok.summary.survivor, ok.summary.mergedLength], ["W-0004", 10]);
    // not collinear
    await walls([[[60, 0], [65, 0]], [[65, 0], [65, 5]]]);
    await join("W-0008", "end", "W-0009", "start");
    await rejected("bim_merge_walls", { walls: ["W-0008", "W-0009"] }, "MERGE_INCOMPATIBLE", { field: "geometry" });
    // a fold-back (overlapping) pair cannot even be joined (Phase 6), so it can never reach a merge
    await walls([[[80, 0], [85, 0]], [[85, 0], [80, 0.0]]]);
    await rejected("bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: "W-0010", endpoint: "end" }, { wall: "W-0011", endpoint: "start" }] }, "INVALID_WALL_JOIN");
    // ambiguous: a third wall at the junction
    await walls([[[100, 0], [105, 0]], [[105, 0], [110, 0]], [[105, 0], [105, 5]]]);
    await run("bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: "W-0012", endpoint: "end" }, { wall: "W-0013", endpoint: "start" }, { wall: "W-0014", endpoint: "start" }] });
    await rejected("bim_merge_walls", { walls: ["W-0012", "W-0013"] }, "MERGE_AMBIGUOUS_JUNCTION");
    await rejected("bim_merge_walls", { walls: ["W-0012", "W-0012"] }, "MERGE_INCOMPATIBLE");
    await rejected("bim_merge_walls", { walls: ["W-0012", "W-0013"], primary: "W-0099" }, "MERGE_INCOMPATIBLE");
  });
  test("undo restores the merged-away wall, its joins and its hosted content", async () => {
    const { run, S, roomModel } = await setup();
    await roomModel();
    await run("bim_split_wall", { wall: "W-0001", t: 0.5 });
    const split = canonicalJson(await S());
    await run("bim_merge_walls", { walls: ["W-0001", "W-0006"] });
    await run("platform_undo", {});
    assert.equal(canonicalJson(await S()), split);
  });
});

// ============================================================================ physical T junctions
describe("physical T-junction ends (derived, never persisted)", () => {
  test("a perpendicular T branch ends at the host's near face; the host stays continuous; the axes and stored fields are untouched", async () => {
    const { run, S, walls, tee } = await setup();
    await walls([[[0, 0], [10, 0]], [[4, 0], [4, 5]], [[7, 0], [7, -5]]]);
    await tee("W-0002", "start", "W-0001"); await tee("W-0003", "start", "W-0001");
    const s = await S(), f2 = wallFrame(s, wall(s, "W-0002")), f3 = wallFrame(s, wall(s, "W-0003")), f1 = wallFrame(s, wall(s, "W-0001"));
    assert.deepEqual([f2.ends.start, f2.ends.end, f1.ends.start, f1.ends.end], ["tee_branch", "free", "free", "free"]);
    // above the host: starts at y = 0.1 (its near face); below: at y = -0.1
    assert.ok(f2.footprint.slice(0, 4).filter((p) => near(p[1], 0.1)).length === 2 && Math.min(...f2.footprint.map((p) => p[1])) > 0.0999);
    assert.ok(f3.footprint.filter((p) => near(p[1], -0.1)).length === 2 && Math.max(...f3.footprint.map((p) => p[1])) < -0.0999);
    assert.ok(near(quantities(s, wall(s, "W-0002")).gross_volume, 0.2 * 3 * 4.9), "gross volume of the clipped branch");
    assert.ok(near(quantities(s, wall(s, "W-0001")).gross_volume, 0.2 * 3 * 10), "the host is not cut");
    assert.deepEqual([wall(s, "W-0002").start, wall(s, "W-0002").end], [[4, 0], [4, 5]], "the persisted axis is unchanged");
    const stored = JSON.stringify(Object.keys(wall(s, "W-0002")).sort());
    assert.ok(!/footprint|clip|cut|mesh/i.test(stored), "no derived geometry is stored");
    await run("bim_unjoin_walls", { join: "J-0001" });
    const u = await S();
    assert.equal(wallFrame(u, wall(u, "W-0002")).ends.start, "free");
    assert.ok(near(quantities(u, wall(u, "W-0002")).gross_volume, 0.2 * 3 * 5), "unjoined: square end again");
  });
  test("an oblique T is cut along the host face; a shallow T, a multi-wall junction and an over-short branch fall back to square ends (valid solids)", async () => {
    const { S, walls, tee, run } = await setup();
    await walls([[[0, 0], [10, 0]], [[5, 0], [7, 3.4641016]]]);                       // 60 degrees
    await tee("W-0002", "start", "W-0001");
    let s = await S();
    const f = wallFrame(s, wall(s, "W-0002"));
    assert.equal(f.ends.start, "tee_branch");
    assert.ok(f.footprint.filter((p) => near(p[1], 0.1, 1e-9)).length === 2, "both start corners lie on the host face y = 0.1");
    assert.deepEqual(modelIssues(s), []);
    const shallow = await setup();                                                     // 5 degrees: below the 10 degree limit
    await shallow.walls([[[0, 0], [10, 0]], [[5, 0], [9, 0.349]]]);
    await shallow.tee("W-0002", "start", "W-0001");
    const ss = await shallow.S(), fs_ = wallFrame(ss, wall(ss, "W-0002"));
    assert.equal(fs_.ends.start, "junction_fallback");
    assert.ok(near(quantities(ss, wall(ss, "W-0002")).gross_volume, 0.2 * 3 * Math.hypot(4, 0.349), 1e-6), "square end: full axis length");
    const multi = await setup();                                                       // three walls at one junction
    await multi.walls([[[0, 0], [5, 0]], [[5, 0], [10, 0]], [[5, 0], [5, 5]]]);
    await multi.run("bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: "W-0001", endpoint: "end" }, { wall: "W-0002", endpoint: "start" }, { wall: "W-0003", endpoint: "start" }] });
    const ms = await multi.S();
    assert.deepEqual(["W-0001", "W-0002", "W-0003"].map((id) => Object.values(wallFrame(ms, wall(ms, id)).ends).filter((k) => k !== "free")[0]), ["junction_fallback", "junction_fallback", "junction_fallback"]);
    const tiny = await setup();                                                        // branch shorter than half the host's thickness
    await tiny.run("bim_create_walls", { walls: [{ storey: "L0", type: "W30", start: [0, 0], end: [10, 0], height: 3 }, { storey: "L0", type: "W", start: [5, 0], end: [5, 0.12], height: 3 }] });
    await tiny.tee("W-0002", "start", "W-0001");
    const ts = await tiny.S();
    assert.equal(wallFrame(ts, wall(ts, "W-0002")).ends.start, "junction_fallback", "0.12 m branch against a 0.3 m host would vanish: square fallback");
    assert.ok(wallFrame(ts, wall(ts, "W-0002")).footprint.flat().every(Number.isFinite));
    void run;
  });
  test("spatial semantics do not depend on the clipped solid: a room's region is the wall-axis region before and after the T is joined or clipped", async () => {
    const { S, roomModel } = await setup();
    await roomModel();
    const s = await S();
    assert.deepEqual(regions(s).map((g) => [g.area, g.perimeter]).sort((a, b) => a[0] - b[0]), [[24, 20], [36, 24]]);
    assert.equal(wallFrame(s, wall(s, "W-0005")).ends.start, "tee_branch");
    assert.ok(quantities(s, wall(s, "W-0005")).gross_volume < 0.2 * 3 * 6, "the solid is clipped ...");
  });
  test("the plan reflects the clipped branch (derived from the same representation)", async () => {
    const { S, walls, tee, run } = await setup();
    await walls([[[0, 0], [10, 0]], [[4, 0], [4, 5]]]);
    const L0 = (await S()).storeys; const st = Object.values(L0).find((x) => x.name === "L0")!;
    const loose = planSvg(await S(), st), polys = (svg: string) => [...svg.matchAll(/<polygon points="([^"]+)"[^>]*stroke="#2c2f36"/g)].map((m) => m[1]);
    await tee("W-0002", "start", "W-0001");
    const joined = planSvg(await S(), st);
    assert.equal(polys(loose).length, polys(joined).length, "the same walls are drawn");
    assert.notDeepEqual(polys(loose), polys(joined), "the branch outline changed: it no longer runs to the host axis");
    await run("platform_undo", {});
    assert.deepEqual(polys(planSvg(await S(), st)), polys(loose));
  });
});
