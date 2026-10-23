/**
 * Phase 6 · explicit wall topology, joins, propagation, lifecycle.
 * Every rejection is checked to leave the event log and the committed state unchanged.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, MemoryStores, FileStores, ArtifactStore, Actor, canonicalJson, PlatformLogger } from "@insa/core";
import { bimModule, BimState, Wall, wallFootprint, toIfc, checkElement } from "../src/index.js";

const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "topo";
const quiet: PlatformLogger = { info: () => {}, warn: () => {} };

async function setup(policy: { everyEvents: number; keep: number } | false = false) {
  const stores = new MemoryStores();
  const p = new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet,
                           artifacts: new ArtifactStore(fs.mkdtempSync(path.join(os.tmpdir(), "insa-p6-"))) });
  const run = async (tool: string, input: unknown) => {
    const r: any = await p.execute(user, P, tool, input);
    assert.ok(r.status === "applied" || r.status === "ok", JSON.stringify(r));
    return r;
  };
  await run("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3 }] });
  await run("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "Tuğla", thickness: 0.2 }] },
    { kind: "window", name: "N", width: 1, height: 1.2 }, { kind: "door", name: "K", width: 1, height: 2.1 }] });
  const walls = async (...segs: [number[], number[], string?][]) =>
    run("bim_create_walls", { walls: segs.map(([a, b, st]) => ({ storey: st ?? "L0", type: "W", start: a, end: b, height: 3 })) });
  return { p, stores, run, walls };
}
const S = (p: Platform) => p.state<BimState>(P, "bim");
const W = async (p: Platform, id: string) => (await S(p)).elements[id] as Wall;
const snap = async (p: Platform) => ({ e: (await p.store(P).readEvents()).length, s: JSON.stringify(await S(p)) });
async function rejected(p: Platform, tool: string, input: unknown, reason: string, details: Record<string, unknown> = {}) {
  const before = await snap(p);
  let err: any;
  await assert.rejects(p.execute(user, P, tool, input), (e: any) => { err = e; return true; });
  assert.equal(err.reason, reason, `${tool}: ${err.reason} ${err.message}`);
  for (const [k, v] of Object.entries(details)) assert.equal(err.details?.[k], v, `details.${k} = ${err.details?.[k]}`);
  assert.deepEqual(await snap(p), before, "no event and no state change");
  return err;
}
const q = async (p: Platform, tool: string, input: unknown = {}) => ((await p.execute(user, P, tool, input)) as any).result;
const ee = (...e: [string, "start" | "end"][]) => ({ kind: "endpoint_endpoint", endpoints: e.map(([wall, endpoint]) => ({ wall, endpoint })) });
const tee = (wall: string, endpoint: "start" | "end", host: string, t?: number) => ({ kind: "endpoint_segment", endpoint: { wall, endpoint }, host, ...(t !== undefined ? { t } : {}) });
const fp = (w: Wall) => wallFootprint(w.start, w.end, 0.2, w.prevDir, w.nextDir);
const close = (a: number[][], b: number[][]) => a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-9 && Math.abs(p[1] - b[i][1]) < 1e-9);

// ============================================================================ A
describe("A · endpoint joins", () => {
  test("create, query, snapping within tolerance; the mitred corner equals a polyline corner exactly", async () => {
    const { p, run, walls } = await setup();
    await walls([[0, 0], [5, 0]], [[5.0004, 0], [5, 4]]);
    const r = await run("bim_join_walls", ee(["W-0002", "start"], ["W-0001", "end"]));
    assert.deepEqual(r.summary, { joinId: "J-0001", kind: "endpoint_endpoint", affectedWalls: ["W-0001", "W-0002"], propagated: ["W-0001", "W-0002"] });
    assert.deepEqual((await W(p, "W-0002")).start, [5, 0], "snapped to the deterministic anchor (W-0001.end)");
    const topo = await q(p, "bim_query_wall_topology", { wall: "W-0001" });
    assert.deepEqual(topo.joins.map((j: any) => [j.id, j.kind, j.point, j.walls]), [["J-0001", "endpoint_endpoint", [5, 0], ["W-0001", "W-0002"]]]);
    assert.deepEqual(topo.connectedWalls, ["W-0002"]);
    await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", points: [[0, 10], [5, 10], [5, 14]], height: 3 }] });   // reference: polyline corner
    const s = await S(p);
    const shift = (pts: number[][]) => pts.map(([x, y]) => [x, y + 10]);
    assert.ok(close(shift(fp(s.elements["W-0001"] as Wall)), fp(s.elements["W-0003"] as Wall)), "W-0001 footprint == polyline");
    assert.ok(close(shift(fp(s.elements["W-0002"] as Wall)), fp(s.elements["W-0004"] as Wall)), "W-0002 footprint == polyline");
  });
  test("rejections: too far, duplicate (either order), self, both ends of one wall, overlap, other storey, missing wall, bad endpoint", async () => {
    const { p, run, walls } = await setup();
    await walls([[0, 0], [5, 0]], [[5.01, 0], [5, 4]], [[5, 0], [2, 0]], [[5, 0], [5, -3], "L1"]);
    await rejected(p, "bim_join_walls", ee(["W-0001", "end"], ["W-0002", "start"]), "INVALID_WALL_JOIN", { wallId: "W-0002" });
    await run("bim_update_elements", { items: [{ id: "W-0002", kind: "wall", set: { start: [5, 0] } }] });
    await run("bim_join_walls", ee(["W-0001", "end"], ["W-0002", "start"]));
    await rejected(p, "bim_join_walls", ee(["W-0002", "start"], ["W-0001", "end"]), "DUPLICATE_WALL_JOIN", { joinId: "J-0001" });
    await rejected(p, "bim_join_walls", ee(["W-0003", "start"], ["W-0003", "start"]), "INVALID_WALL_JOIN");
    await rejected(p, "bim_join_walls", ee(["W-0003", "start"], ["W-0003", "end"]), "INVALID_WALL_JOIN");
    await rejected(p, "bim_join_walls", ee(["W-0001", "end"], ["W-0003", "start"]), "INVALID_WALL_JOIN");          // folds back over W-0001
    await rejected(p, "bim_join_walls", ee(["W-0001", "end"], ["W-0004", "start"]), "WALL_JOIN_CONFLICT");         // other storey
    await rejected(p, "bim_join_walls", ee(["W-0001", "start"], ["W-9999", "start"]), "INVALID_WALL_JOIN", { wallId: "W-9999" });
    await rejected(p, "bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: "W-0001", endpoint: "middle" }, { wall: "W-0002", endpoint: "end" }] }, "INVALID_INPUT");
    await rejected(p, "bim_join_walls", { kind: "endpoint_endpoint", endpoint: { wall: "W-0001", endpoint: "end" }, host: "W-0002" }, "INVALID_WALL_JOIN");
  });
  test("moving one endpoint moves the junction; chains propagate; a translation moves both junctions; conflicting moves refused", async () => {
    const { p, run, walls } = await setup();
    await walls([[0, 0], [5, 0]], [[5, 0], [5, 4]], [[5, 4], [0, 4]]);
    await run("bim_join_walls", ee(["W-0001", "end"], ["W-0002", "start"]));
    await run("bim_join_walls", ee(["W-0002", "end"], ["W-0003", "start"]));
    const r = await run("bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { end: [6, 0] } }] });
    assert.deepEqual(r.summary.propagated, ["W-0001", "W-0002", "W-0003"]);
    assert.deepEqual((await W(p, "W-0002")).start, [6, 0]);
    await run("bim_move_elements", { ids: ["W-0002"], vector: [1, 0] });
    assert.deepEqual([(await W(p, "W-0001")).end, (await W(p, "W-0003")).start], [[7, 0], [6, 4]]);       // W-0002 was (6,0)-(5,4)
    await run("bim_update_elements", { items: [{ id: "W-0002", kind: "wall", set: { start: [8, 0], end: [8, 5] } }] });   // both ends at once
    assert.deepEqual([(await W(p, "W-0001")).end, (await W(p, "W-0003")).start], [[8, 0], [8, 5]]);
    await rejected(p, "bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { end: [9, 0] } }, { id: "W-0002", kind: "wall", set: { start: [9, 1] } }] }, "WALL_JOIN_CONFLICT");
    for (const id of ["W-0001", "W-0002", "W-0003"]) checkElement(await S(p), (await S(p)).elements[id]);
  });
  test("multi-wall junction: all members follow, no miters; extend keeps the id; detach one endpoint; unjoin keeps coordinates; undo", async () => {
    const { p, run, walls } = await setup();
    await walls([[0, 0], [5, 0]], [[5, 0], [5, 4]], [[5, 0], [9, -3]], [[5, 0], [5, -4]]);
    await run("bim_join_walls", ee(["W-0001", "end"], ["W-0002", "start"], ["W-0003", "start"]));
    const s0 = await S(p);
    for (const [id, f] of [["W-0001", "nextDir"], ["W-0002", "prevDir"], ["W-0003", "prevDir"]] as const) assert.equal((s0.elements[id] as any)[f], null, `${id} square end`);
    const x = await run("bim_join_walls", ee(["W-0004", "start"], ["W-0002", "start"]));
    assert.equal(x.summary.joinId, "J-0001", "extending a junction keeps its id");
    await run("bim_update_elements", { items: [{ id: "W-0003", kind: "wall", set: { start: [5.5, 0.5] } }] });
    for (const [id, e] of [["W-0001", "end"], ["W-0002", "start"], ["W-0004", "start"]] as const) assert.deepEqual((await W(p, id))[e], [5.5, 0.5]);
    const coords = JSON.stringify(Object.values((await S(p)).elements).map((w: any) => [w.start, w.end]));
    await run("bim_unjoin_walls", { endpoint: { wall: "W-0004", endpoint: "start" } });
    assert.deepEqual((await q(p, "bim_query_wall_topology", {})).joins[0].members.length, 3);
    await run("bim_unjoin_walls", { join: "J-0001" });
    assert.equal(JSON.stringify(Object.values((await S(p)).elements).map((w: any) => [w.start, w.end])), coords, "unjoin never moves walls");
    assert.deepEqual((await q(p, "bim_query_wall_topology", {})).joins, []);
    await run("platform_undo", {});
    assert.equal((await q(p, "bim_query_wall_topology", {})).joins[0].members.length, 3, "undo restores the junction");
    await run("platform_undo", {}); await run("platform_undo", {});
    assert.deepEqual((await W(p, "W-0003")).start, [5, 0], "undo restores the propagated geometry");
    await rejected(p, "bim_unjoin_walls", { join: "J-0099" }, "JOIN_NOT_FOUND");
  });
});

// ============================================================================ B
describe("B · T-junctions", () => {
  test("create (t by projection), host stretch / rotation propagates, constrained tee endpoint refused, other end free", async () => {
    const { p, run, walls } = await setup();
    await walls([[0, 0], [10, 0]], [[4, 0], [4, 3]]);
    const r = await run("bim_join_walls", tee("W-0002", "start", "W-0001"));
    const j = (await S(p)).joins[r.summary.joinId] as any;
    assert.deepEqual([j.kind, j.t, j.host], ["endpoint_segment", 0.4, "W-0001"]);
    assert.equal((await W(p, "W-0002")).prevDir, null);
    await run("bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { end: [20, 0] } }] });
    assert.deepEqual((await W(p, "W-0002")).start, [8, 0], "host scaled: tee at 0.4 * 20");
    await run("bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { end: [10, 10] } }] });
    assert.deepEqual((await W(p, "W-0002")).start, [4, 4], "host rotated");
    await rejected(p, "bim_update_elements", { items: [{ id: "W-0002", kind: "wall", set: { start: [5, 5] } }] }, "CONSTRAINED_ENDPOINT", { hostWallId: "W-0001", hostT: 0.4 });
    await rejected(p, "bim_move_elements", { ids: ["W-0002"], vector: [1, 0] }, "CONSTRAINED_ENDPOINT");
    await run("bim_update_elements", { items: [{ id: "W-0002", kind: "wall", set: { end: [0, 6] } }] });
    await run("bim_move_elements", { ids: ["W-0001", "W-0002"], vector: [2, 1] });                         // moved together
    assert.deepEqual((await W(p, "W-0002")).start, [6, 5]);
  });
  test("rejections: missing host, t out of range, too close to the host end, along the host, already constrained, duplicate", async () => {
    const { p, run, walls } = await setup();
    await walls([[0, 0], [10, 0]], [[4, 0], [4, 3]], [[0.0005, 0], [0.0005, 3]], [[2, 0], [3, 0]], [[6, 0], [6, 2]]);
    await rejected(p, "bim_join_walls", tee("W-0002", "start", "W-9999"), "INVALID_WALL_JOIN");
    await rejected(p, "bim_join_walls", tee("W-0002", "start", "W-0001", 1.5), "INVALID_WALL_JOIN");
    await rejected(p, "bim_join_walls", tee("W-0002", "start", "W-0001", 0.7), "INVALID_WALL_JOIN");          // 3 m away from (4, 0)
    await rejected(p, "bim_join_walls", tee("W-0003", "start", "W-0001"), "INVALID_WALL_JOIN");               // at the host end: use endpoint_endpoint
    await rejected(p, "bim_join_walls", tee("W-0004", "start", "W-0001"), "INVALID_WALL_JOIN");               // lies along the host
    await run("bim_join_walls", tee("W-0002", "start", "W-0001"));
    await rejected(p, "bim_join_walls", tee("W-0002", "start", "W-0001"), "DUPLICATE_WALL_JOIN");
    await rejected(p, "bim_join_walls", tee("W-0002", "start", "W-0005"), "WALL_ENDPOINT_ALREADY_CONSTRAINED");
    // t is the intent: a shorter host carries the tee along (0.4 of the new length) ...
    await run("bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { end: [5, 0] } }] });
    assert.deepEqual((await W(p, "W-0002")).start, [2, 0]);
    // ... but a host so short that the tee is no longer clear of its ends is refused
    await rejected(p, "bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { end: [0.002, 0] } }] }, "INVALID_WALL_JOIN");
  });
});

// ============================================================================ C
describe("C · candidate detection (non-mutating)", () => {
  test("exact and near endpoint matches, tee, crossing, near miss; other storeys and unrelated walls ignored; sorted; existing joins hidden", async () => {
    const { p, run, walls } = await setup();
    await walls([[0, 0], [5, 0]], [[5, 0], [5, 4]], [[5.0005, 4], [0, 4]], [[2, 0], [2, 2]], [[10, 0], [16, 6]], [[10, 6], [16, 0]], [[20, 0], [24, 0]], [[24.02, 0], [28, 0]], [[5, 0], [5, -2], "L1"], [[50, 50], [55, 50]]);
    const before = await snap(p);
    const d = await q(p, "bim_detect_wall_connections", {});
    assert.deepEqual(await snap(p), before, "detection does not mutate");
    assert.deepEqual(d.candidates.map((c: any) => c.type === "endpoint_endpoint" ? [c.type, c.wallA, c.endpointA, c.wallB, c.endpointB] : [c.type, c.wall, c.endpoint, c.hostWall, c.hostT]),
      [["endpoint_endpoint", "W-0001", "end", "W-0002", "start"], ["endpoint_endpoint", "W-0002", "end", "W-0003", "start"], ["endpoint_segment", "W-0004", "start", "W-0001", 0.4]]);
    assert.deepEqual(d.crossings.map((c: any) => [c.wallA, c.wallB, c.point]), [["W-0005", "W-0006", [13, 3]]]);
    assert.deepEqual(d.nearMisses.map((n: any) => [n.kind, n.wallA, n.wallB, n.distance]), [["endpoint_endpoint", "W-0007", "W-0008", 0.02]]);
    assert.equal(d.truncated, false);
    await run("bim_join_walls", ee(["W-0001", "end"], ["W-0002", "start"]));
    const d2 = await q(p, "bim_detect_wall_connections", { storey: "L0" });
    assert.equal(d2.candidates.length, 2);
    assert.equal((await q(p, "bim_detect_wall_connections", { include_existing: true })).candidates.length, 3);
    assert.equal((await q(p, "bim_detect_wall_connections", { max_results: 2 })).truncated, true);
    assert.deepEqual((await q(p, "bim_detect_wall_connections", { walls: ["W-0005"] })).crossings.length, 1);
  });
});

// ============================================================================ D
describe("D · miter synchronisation", () => {
  for (const [name, deg] of [["90°", 90], ["acute 30°", 30], ["obtuse 135°", 135]] as const) {
    test(`${name} corner: joined footprint == polyline footprint; valid; finite`, async () => {
      const { p, run } = await setup();
      const a = (deg * Math.PI) / 180, B = [5 + 4 * Math.cos(Math.PI - a), 4 * Math.sin(Math.PI - a)].map((v) => Math.round(v * 1e6) / 1e6);
      await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [5, 0], height: 3 }, { storey: "L0", type: "W", start: [5, 0], end: B, height: 3 }] });
      await run("bim_join_walls", ee(["W-0001", "end"], ["W-0002", "start"]));
      await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", points: [[0, 0], [5, 0], B], height: 3 }] });
      const s = await S(p);
      assert.ok(close(fp(s.elements["W-0001"] as Wall), fp(s.elements["W-0003"] as Wall)) && close(fp(s.elements["W-0002"] as Wall), fp(s.elements["W-0004"] as Wall)));
      for (const id of ["W-0001", "W-0002"]) { checkElement(s, s.elements[id]); assert.ok(fp(s.elements[id] as Wall).flat().every(Number.isFinite)); }
    });
  }
  test("straight continuation and near-parallel joins get square ends (no extreme miter); unjoin clears managed hints", async () => {
    const { p, run, walls } = await setup();
    await walls([[0, 0], [5, 0]], [[5, 0], [10, 0]], [[0, 5], [5, 5]], [[5, 5], [0, 5.3]]);
    await run("bim_join_walls", ee(["W-0001", "end"], ["W-0002", "start"]));
    await run("bim_join_walls", ee(["W-0003", "end"], ["W-0004", "start"]));                                   // ~3.4° fold
    const s = await S(p);
    assert.deepEqual([(s.elements["W-0001"] as Wall).nextDir, (s.elements["W-0002"] as Wall).prevDir, (s.elements["W-0003"] as Wall).nextDir, (s.elements["W-0004"] as Wall).prevDir], [null, null, null, null]);
    assert.ok(Object.values(s.elements).every((w: any) => fp(w).flat().every(Number.isFinite)));
    await run("bim_update_elements", { items: [{ id: "W-0002", kind: "wall", set: { end: [5, 4] } }] });
    assert.ok((await W(p, "W-0001")).nextDir !== null, "now a 90° corner: mitred");
    await run("bim_unjoin_walls", { join: "J-0001" });
    assert.deepEqual([(await W(p, "W-0001")).nextDir, (await W(p, "W-0002")).prevDir], [null, null]);
    assert.equal(/NaN|Infinity/.test(toIfc(await S(p), { projectKey: P })), false);
  });
});

// ============================================================================ E
describe("E · lifecycle protection and usage", () => {
  test("joined wall / wall with openings / filled opening refused with structured usage; cascade_hosted is explicit and never removes joins", async () => {
    const { p, run, walls } = await setup();
    await walls([[0, 0], [8, 0]], [[8, 0], [8, 5]], [[0, 10], [5, 10]]);
    await run("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 3, type: "N" }, { kind: "door", host: "W-0001", along: 6, type: "K" }] });
    await run("bim_join_walls", ee(["W-0001", "end"], ["W-0002", "start"]));
    const u = await q(p, "bim_get_element_usage", { id: "W-0001" });
    assert.deepEqual([u.usageCount, u.hostedOpenings, u.joins.map((j: any) => j.joinId), u.connectedWalls], [3, ["O-0001", "O-0002"], ["J-0001"], ["W-0002"]]);
    assert.deepEqual((await q(p, "bim_get_element_usage", { id: "O-0001" })).references, { host: "W-0001", filledBy: "N-0001" });
    assert.deepEqual((await q(p, "bim_get_element_usage", { id: "N-0001" })).references, { host: "W-0001", opening: "O-0001" });
    const e = await rejected(p, "bim_delete_elements", { ids: ["W-0002"] }, "ELEMENT_IN_USE", { elementId: "W-0002", usageCount: 1 });
    assert.match(e.details.usageSummary, /1 join/);
    await rejected(p, "bim_delete_elements", { ids: ["W-0001"], cascade_hosted: true }, "ELEMENT_IN_USE");        // joins are never cascaded
    await rejected(p, "bim_delete_elements", { ids: ["O-0001"] }, "ELEMENT_IN_USE", { dependentIds: "N-0001" });
    await run("bim_unjoin_walls", { join: "J-0001" });
    await rejected(p, "bim_delete_elements", { ids: ["W-0001"] }, "ELEMENT_IN_USE", { usageCount: 2 });
    await run("bim_delete_elements", { ids: ["N-0001"] });                                                         // window removed, opening stays empty
    assert.equal(((await S(p)).elements["O-0001"] as any).filledBy, null);
    await run("bim_delete_elements", { ids: ["O-0001"] });
    await run("bim_delete_elements", { ids: ["W-0001"], cascade_hosted: true });
    assert.deepEqual(Object.keys((await S(p)).elements).sort(), ["W-0002", "W-0003"]);
    await run("bim_delete_elements", { ids: ["W-0003"] });                                                         // standalone: fine
  });
  test("rehost an opening with its door; other storey refused; must fit; undo restores the host", async () => {
    const { p, run, walls } = await setup();
    await walls([[0, 0], [8, 0]], [[0, 4], [3, 4]], [[0, 9], [8, 9], "L1"]);
    await run("bim_place_openings", { items: [{ kind: "door", host: "W-0001", along: 6, type: "K" }] });
    await rejected(p, "bim_rehost_opening", { opening: "O-0001", host: "W-0003" }, "INVALID_REHOST");
    await rejected(p, "bim_rehost_opening", { opening: "O-0001", host: "W-0002" }, "INVALID_HOST_RELATION");      // along 6 > 3 m
    await rejected(p, "bim_rehost_opening", { opening: "D-0001", host: "W-0002" }, "INVALID_REHOST");
    await run("bim_rehost_opening", { opening: "O-0001", host: "W-0002", along: 1.5 });
    const s = await S(p);
    assert.deepEqual([(s.elements["O-0001"] as any).host, (s.elements["D-0001"] as any).host, (s.elements["O-0001"] as any).along], ["W-0002", "W-0002", 1.5]);
    await run("platform_undo", {});
    assert.equal(((await S(p)).elements["O-0001"] as any).host, "W-0001");
  });
});

// ============================================================================ F
describe("F · storey reassignment and topology", () => {
  test("standalone wall moves as before; a joined wall alone is refused; the whole joined set together is fine; hosted graph follows", async () => {
    const { p, run, walls } = await setup();
    await walls([[0, 0], [8, 0]], [[8, 0], [8, 5]], [[0, 10], [5, 10]]);
    await run("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 3, type: "N" }] });
    await run("bim_join_walls", ee(["W-0001", "end"], ["W-0002", "start"]));
    await run("bim_reassign_storey", { items: [{ id: "W-0003", storey: "L1" }] });
    await rejected(p, "bim_reassign_storey", { items: [{ id: "W-0001", storey: "L1" }] }, "WALL_JOIN_CONFLICT", { joinId: "J-0001" });
    await run("bim_reassign_storey", { items: [{ id: "W-0001", storey: "L1" }, { id: "W-0002", storey: "L1" }] });
    const s = await S(p), L1 = Object.values(s.storeys).find((x) => x.name === "L1")!.id;
    for (const id of ["W-0001", "W-0002", "O-0001", "N-0001"]) assert.equal(s.elements[id].storey, L1, id);
    assert.ok(s.joins["J-0001"], "the join survives");
    assert.equal(((s.elements["W-0001"]) as any).height, 3, "vertical intent untouched");
  });
});

// ============================================================================ G
test("G · a real Phase 5 project loads with NO inferred joins, unchanged geometry; old snapshots ignored; detection reports candidates", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "insa-p5fx-"));
  fs.cpSync(path.join(import.meta.dirname, "fixtures/phase5-project"), path.join(dir, "phase5"), { recursive: true });
  const lines: string[] = [];
  const p = new Platform({ modules: [bimModule], stores: new FileStores(dir), snapshotPolicy: { everyEvents: 1000, keep: 3 }, logger: { info: (e) => lines.push(e), warn: (e) => lines.push(e) } });
  const s = await p.state<BimState>("phase5", "bim");
  assert.ok(lines.includes("snapshot.ignored_incompatible") && p.metrics.snapshotsLoaded === 0);
  assert.deepEqual(s.joins, {}, "touching is not joining: no topology inferred from history");
  // Phase 5 geometry kept exactly, including the polyline mitre hints
  const raw = fs.readFileSync(path.join(dir, "phase5/events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  for (const e of raw.filter((x) => x.type === "ElementCreated" && x.payload.kind === "wall")) {
    const w = s.elements[e.payload.id] as Wall;
    assert.deepEqual([w.start, w.end, w.prevDir, w.nextDir], [e.payload.start, e.payload.end, e.payload.prevDir, e.payload.nextDir], e.payload.id);
  }
  const d = ((await p.execute(user, "phase5", "bim_detect_wall_connections", {})) as any).result;
  assert.equal(d.candidates.filter((c: any) => c.type === "endpoint_endpoint").length, 5, "4 perimeter corners + W-0005/W-0006");
  assert.ok(d.candidates.some((c: any) => c.type === "endpoint_segment" && c.wall === "W-0007" && c.hostWall === "W-0001"));
  assert.deepEqual(d.crossings.map((c: any) => [c.wallA, c.wallB]), [["W-0008", "W-0009"]]);
  await p.execute(user, "phase5", "bim_move_elements", { ids: ["W-0005"], vector: [0, -1] });
  assert.deepEqual(((await p.state<BimState>("phase5", "bim")).elements["W-0006"] as Wall).start, [26, 0], "unjoined neighbours do not follow");
});

// ============================================================================ H
test("H · topology history: live == full replay == snapshot + tail after every step (incl. rejected storey op, undo, rehost)", async () => {
  const { p, stores, run, walls } = await setup({ everyEvents: 3, keep: 2 });
  await walls([[0, 0], [8, 0]], [[8, 0], [8, 5]], [[3, 0], [3, 4]], [[0, 9], [6, 9]]);
  const steps: [string, unknown, string?][] = [
    ["bim_join_walls", ee(["W-0001", "end"], ["W-0002", "start"])],
    ["bim_join_walls", tee("W-0003", "start", "W-0001")],
    ["bim_place_openings", { items: [{ kind: "window", host: "W-0004", along: 2, type: "N" }] }],
    ["bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { start: [-2, 0] } }] }],
    ["bim_move_elements", { ids: ["W-0002"], vector: [1, 0] }],
    ["bim_reassign_storey", { items: [{ id: "W-0002", storey: "L1" }] }, "WALL_JOIN_CONFLICT"],
    ["bim_unjoin_walls", { join: "J-0001" }],
    ["bim_join_walls", ee(["W-0001", "end"], ["W-0002", "start"])],
    ["bim_rehost_opening", { opening: "O-0001", host: "W-0001", along: 20 }, "INVALID_HOST_RELATION"],
    ["bim_rehost_opening", { opening: "O-0001", host: "W-0001", along: 6 }],
    ["platform_undo", {}], ["platform_undo", {}], ["platform_undo", {}],
  ];
  for (const [tool, input, expectReason] of steps) {
    if (expectReason) await rejected(p, tool, input, expectReason); else await run(tool, input);
    const v = async (x: Platform) => canonicalJson({ s: await x.state(P, "bim"), h: await x.history(P, 1e6) });
    const full = await v(new Platform({ modules: [bimModule], stores, snapshotPolicy: false }));
    assert.equal(await v(new Platform({ modules: [bimModule], stores, snapshotPolicy: { everyEvents: 3, keep: 2 }, logger: quiet })), full, `after ${tool}`);
    assert.equal(await v(p), full);
  }
  assert.ok(p.metrics.snapshotsWritten > 0);
  const ev = await stores.project(P).readEvents();
  for (const t of ["WallJoinCreated", "WallJoinDeleted"]) assert.ok(ev.some((e) => e.type === t && e.schemaVersion === 1), t);
  assert.ok(ev.filter((e) => e.type === "ElementUpdated").every((e) => e.schemaVersion === 2), "ElementUpdated stays at v2");
});

// ============================================================================ J
const hasIfcOpenShell = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.geom"], { stdio: "ignore" }); return true; } catch { return false; } })();
test("J · IFC geometry after topology operations (IfcOpenShell): joined corner == polyline corner volumes, moved corner, tee, unjoined, joined wall with opening", { skip: !hasIfcOpenShell }, async () => {
  const { p, run, walls } = await setup();
  await walls([[0, 0], [6, 0]], [[6, 0], [6, 4]], [[2, 0], [2, 3]], [[0, 20], [4, 20]], [[4, 20], [4, 24]]);
  await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", points: [[0, 10], [6, 10], [6, 14]], height: 3 }] });       // W-0006 / W-0007 reference
  await run("bim_join_walls", ee(["W-0001", "end"], ["W-0002", "start"]));
  await run("bim_join_walls", tee("W-0003", "start", "W-0001"));
  await run("bim_place_openings", { items: [{ kind: "window", host: "W-0002", along: 2, type: "N" }] });
  const probe = async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-ifc6-")), "m.ifc");
    const ifc = toIfc(await S(p), { projectKey: P });
    assert.equal(/NaN|Infinity/.test(ifc), false);
    fs.writeFileSync(file, ifc);
    const py = `
import json, sys, ifcopenshell, ifcopenshell.geom, ifcopenshell.util.shape as us
f = ifcopenshell.open(sys.argv[1]); st = ifcopenshell.geom.settings(); st.set("use-world-coords", True); out = {}
for e in f.by_type("IfcWall"):
    g = ifcopenshell.geom.create_shape(st, e).geometry
    out[e.Tag] = round(us.get_volume(g), 6)
print(json.dumps(out))`;
    return JSON.parse(execFileSync("python3", ["-c", py, file]).toString()) as Record<string, number>;
  };
  let v = await probe();
  const t = 0.2, h = 3;
  assert.ok(Math.abs(v["W-0001"] + v["W-0002"] + 1 * 1.2 * t - (v["W-0006"] + v["W-0007"])) < 1e-6, "joined corner (plus the window void) == polyline corner");
  // Phase 10: the branch is cut back to the host's near face (derived end condition); Phase 6 left it running to the host axis
  assert.ok(Math.abs(v["W-0003"] - t * h * (3 - t / 2)) < 1e-6, "tee wall: ends at the host face, not at its axis");
  assert.ok(Math.abs(v["W-0004"] - t * h * 4) < 1e-6 && Math.abs(v["W-0005"] - t * h * 4) < 1e-6, "unjoined walls: plain boxes");
  await run("bim_update_elements", { items: [{ id: "W-0002", kind: "wall", set: { start: [7, 0] } }] });           // moved joined corner
  v = await probe();
  assert.ok(Object.values(v).every((x) => Number.isFinite(x) && x > 0));
  await run("bim_unjoin_walls", { join: "J-0001" });
  v = await probe();
  assert.ok(Object.values(v).every((x) => Number.isFinite(x) && x > 0));
});
