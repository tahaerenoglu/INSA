/**
 * Phase 10 · trim, extend, rehost, atomicity, dry-run parity, replay / snapshot equivalence, undo and spatial behaviour.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { Platform, MemoryStores, canonicalJson } from "@insa/core";
import { bimModule, BimState, Wall, Opening, HostedComponent, storeyRegions, modelIssues, SpatialContext, resolveSpatialElement } from "../src/index.js";
import { setup, center, nearPt, wall, P, user } from "./authoring-fixture.js";

const regions = (s: BimState) => storeyRegions(s, Object.values(s.storeys).find((x) => x.name === "L0")!.id);
const room = (s: BimState, id: string) => resolveSpatialElement(new SpatialContext(s), s.elements[id] as any);
const win = (host: string, along: number, kind = "window") => ({ kind, host, along, type: kind === "door" ? "K" : "N" });
/** every opening and its fill are consistent: same host, same storey, linked both ways */
function assertHostGraph(s: BimState) {
  for (const o of Object.values(s.elements).filter((e): e is Opening => e.kind === "opening")) {
    assert.ok(s.elements[o.host], `${o.id} host exists`);
    if (o.filledBy) { const f = s.elements[o.filledBy] as HostedComponent; assert.deepEqual([f.host, f.opening, f.storey], [o.host, o.id, o.storey], `${o.id} / ${o.filledBy} agree`); }
  }
}

// ============================================================================ trim
describe("trim", () => {
  test("trims the end to the target and joins it (a T at the crossing); hosted content keeps its place; undo restores", async () => {
    const { run, S, walls, snap } = await setup();
    await walls([[[0, 3], [8, 3]], [[5, 0], [5, 6]]]);
    await run("bim_place_openings", { items: [win("W-0001", 2)] });
    const before = await snap();
    const r = await run("bim_trim_wall", { wall: "W-0001", endpoint: "end", target: "W-0002" });
    assert.deepEqual([r.summary.oldPoint, r.summary.newPoint, r.summary.oldLength, r.summary.newLength, r.summary.join], [[8, 3], [5, 3], 8, 5, { joinId: "J-0001", kind: "endpoint_segment", host: "W-0002", hostT: 0.5 }]);
    const s = await S();
    assert.deepEqual([wall(s, "W-0001").start, wall(s, "W-0001").end, (s.elements["O-0001"] as Opening).along], [[0, 3], [5, 3], 2]);
    assert.deepEqual(modelIssues(s), []);
    await run("platform_undo", {});
    assert.equal((await snap()).s, before.s, "state restored (the undo is itself a command: the log grows)");
  });
  test("trimming the START shifts start-relative parameters: openings and tees keep their physical place; one in the removed part rejects", async () => {
    const mk = async () => {
      const t = await setup();
      await t.walls([[[-3, 3], [8, 3]], [[5, 0], [5, 6]], [[7, 3], [7, 8]]]);
      await t.tee("W-0003", "start", "W-0001");
      return t;
    };
    const a = await mk();
    await a.run("bim_place_openings", { items: [win("W-0001", 10)] });                       // x = 7
    const c0 = center(await a.S(), "O-0001");
    const r = await a.run("bim_trim_wall", { wall: "W-0001", endpoint: "start", target: "W-0002" });
    const s = await a.S();
    assert.deepEqual([r.summary.newLength, (s.elements["O-0001"] as Opening).along], [3, 2]);
    assert.ok(Math.abs((s.joins["J-0001"] as any).t - 2 / 3) < 1e-8, "the tee keeps its physical place: 2 m of 3 m");
    assert.ok(nearPt(center(s, "O-0001"), c0), "world position kept");
    assert.deepEqual(wall(s, "W-0003").start, [7, 3], "the tee wall did not move");
    assert.deepEqual(modelIssues(s), []);
    const b = await mk();
    await b.run("bim_place_openings", { items: [win("W-0001", 2)] });                       // x = -1: in the part that would disappear
    await b.rejected("bim_trim_wall", { wall: "W-0001", endpoint: "start", target: "W-0002" }, "WALL_EDIT_HOSTED_CONFLICT", { openingId: "O-0001" });
  });
  test("trimming to the END of the target joins endpoint to endpoint; join: false only moves the end (touching, no topology)", async () => {
    const a = await setup();
    await a.walls([[[0, 0], [8, 0]], [[5, 0], [5, 6]]]);
    const r = await a.run("bim_trim_wall", { wall: "W-0001", endpoint: "end", target: "W-0002" });
    assert.equal(r.summary.join.kind, "endpoint_endpoint");
    assert.deepEqual(modelIssues(await a.S()), []);
    const b = await setup();
    await b.walls([[[0, 3], [8, 3]], [[5, 0], [5, 6]]]);
    const n = await b.run("bim_trim_wall", { wall: "W-0001", endpoint: "end", target: "W-0002", join: false });
    assert.equal(n.summary.join, null);
    assert.deepEqual([wall(await b.S(), "W-0001").end, Object.keys((await b.S()).joins)], [[5, 3], []]);
  });
  test("refused: parallel (and near-parallel) target, target that does not reach, nothing to trim, too short, joined endpoint, other storey, itself", async () => {
    const { run, walls, join, rejected, S } = await setup();
    await walls([[[0, 3], [8, 3]], [[0, 5], [8, 5]], [[5, 0], [5, 1]], [[12, 3], [4, 3.05]], [[5, 3], [5, 6]], [[0, 3.0005], [0, 9]], [[20, 0], [24, 0]], [[24, 0], [24, 5]]]);
    await rejected("bim_trim_wall", { wall: "W-0001", endpoint: "end", target: "W-0002" }, "INVALID_TRIM_TARGET");            // parallel
    await rejected("bim_trim_wall", { wall: "W-0001", endpoint: "end", target: "W-0004" }, "INVALID_TRIM_TARGET");            // ~2 degrees: within the join angle limit
    await rejected("bim_trim_wall", { wall: "W-0001", endpoint: "end", target: "W-0003" }, "INVALID_TRIM_TARGET");            // the target stops short of the axis
    await rejected("bim_trim_wall", { wall: "W-0005", endpoint: "end", target: "W-0001" }, "INVALID_TRIM_TARGET");            // W-0005 ends at the target: no overshoot
    await rejected("bim_trim_wall", { wall: "W-0001", endpoint: "end", target: "W-0006" }, "INVALID_TRIM_TARGET");            // would leave 0.0005 m
    await rejected("bim_trim_wall", { wall: "W-0001", endpoint: "end", target: "W-0001" }, "INVALID_TRIM_TARGET");
    await rejected("bim_trim_wall", { wall: "W-0001", endpoint: "end", target: "W-9999" }, "INVALID_TRIM_TARGET");
    await join("W-0007", "end", "W-0008", "start");
    await rejected("bim_trim_wall", { wall: "W-0007", endpoint: "end", target: "W-0008" }, "WALL_EDIT_ENDPOINT_JOINED");
    await rejected("bim_trim_wall", { wall: "W-0008", endpoint: "start", target: "W-0007" }, "WALL_EDIT_ENDPOINT_JOINED");   // would move a junction
    await run("bim_create_walls", { walls: [{ storey: "L1", type: "W", start: [5, 0], end: [5, 6], height: 3 }] });
    await rejected("bim_trim_wall", { wall: "W-0001", endpoint: "end", target: "W-0009" }, "INVALID_TRIM_TARGET");            // another storey
    assert.equal(Object.keys((await S()).joins).length, 1);
  });
});

// ============================================================================ extend
describe("extend", () => {
  test("extends the end to the target and joins it; extending the START shifts parameters and keeps hosted content in place; undo restores", async () => {
    const a = await setup();
    await a.walls([[[0, 3], [3, 3]], [[5, 0], [5, 6]]]);
    const before = await a.snap();
    const r = await a.run("bim_extend_wall", { wall: "W-0001", endpoint: "end", target: "W-0002" });
    assert.deepEqual([r.summary.oldPoint, r.summary.newPoint, r.summary.oldLength, r.summary.newLength, r.summary.join.kind], [[3, 3], [5, 3], 3, 5, "endpoint_segment"]);
    assert.deepEqual(modelIssues(await a.S()), []);
    await a.run("platform_undo", {});
    assert.equal((await a.snap()).s, before.s);
    const b = await setup();
    await b.walls([[[4, 3], [8, 3]], [[2, 0], [2, 6]]]);
    await b.run("bim_place_openings", { items: [win("W-0001", 2)] });                       // x = 6
    const c0 = center(await b.S(), "O-0001");
    await b.run("bim_extend_wall", { wall: "W-0001", endpoint: "start", target: "W-0002" });
    const s = await b.S();
    assert.deepEqual([wall(s, "W-0001").start, (s.elements["O-0001"] as Opening).along], [[2, 3], 4]);
    assert.ok(nearPt(center(s, "O-0001"), c0));
    assert.deepEqual(modelIssues(s), []);
  });
  test("refused: target behind the endpoint, within the wall, missed, parallel, endpoint already joined", async () => {
    const { walls, join, rejected, S } = await setup();
    await walls([[[0, 3], [3, 3]], [[5, 0], [5, 6]], [[0, 5], [3, 5]], [[5, 8], [5, 9]], [[10, 0], [10, 3]], [[10, 3], [14, 3]]]);
    await rejected("bim_extend_wall", { wall: "W-0001", endpoint: "start", target: "W-0002" }, "INVALID_EXTEND_TARGET", { endpoint: "start" });   // the target is behind the start
    await rejected("bim_extend_wall", { wall: "W-0002", endpoint: "end", target: "W-0001" }, "INVALID_EXTEND_TARGET");                              // W-0001 ends at x = 3, W-0002 passes it: within
    await rejected("bim_extend_wall", { wall: "W-0001", endpoint: "end", target: "W-0003" }, "INVALID_EXTEND_TARGET");                              // parallel
    await rejected("bim_extend_wall", { wall: "W-0001", endpoint: "end", target: "W-0004" }, "INVALID_EXTEND_TARGET");                              // the target does not reach y = 3
    await join("W-0005", "end", "W-0006", "start");
    await rejected("bim_extend_wall", { wall: "W-0006", endpoint: "start", target: "W-0002" }, "WALL_EDIT_ENDPOINT_JOINED");
    assert.equal(Object.keys((await S()).joins).length, 1);
  });
});

// ============================================================================ rehost
describe("rehost", () => {
  test("moves an opening and its fill together (never different hosts); keep_position; overlap and fit are refused atomically; undo", async () => {
    const t = await setup();
    await t.roomModel();
    const before = await t.snap();
    const r = await t.run("bim_rehost_opening", { opening: "O-0001", host: "W-0003", along: 3 });
    assert.deepEqual([r.summary.from, r.summary.to, r.summary.fill, r.summary.oldAlong, r.summary.newAlong], ["W-0001", "W-0003", "N-0001", 2, 3]);
    let s = await t.S();
    assert.deepEqual([(s.elements["O-0001"] as Opening).host, (s.elements["N-0001"] as HostedComponent).host], ["W-0003", "W-0003"]);
    assertHostGraph(s);
    await t.rejected("bim_rehost_opening", { opening: "O-0002", host: "W-0003", along: 3.4 }, "INVALID_HOST_RELATION");              // overlaps O-0001 (M12)
    await t.rejected("bim_rehost_opening", { opening: "O-0002", host: "W-0003", along: 0.2 }, "INVALID_HOST_RELATION");              // does not fit
    await t.rejected("bim_rehost_opening", { opening: "O-0002", host: "W-0001" }, "INVALID_REHOST");                                 // already there
    await t.rejected("bim_rehost_opening", { opening: "N-0001", host: "W-0003" }, "INVALID_REHOST");                                 // a fill is not an opening
    await t.rejected("bim_rehost_opening", { opening: "O-0002", host: "W-0003", along: 5, keep_position: true }, "INVALID_REHOST");
    await t.rejected("bim_delete_elements", { ids: ["W-0003"] }, "ELEMENT_IN_USE");                                                  // host deletion stays protected
    await t.run("platform_undo", {});
    assert.equal((await t.snap()).s, before.s);
    // keep_position: the opening is physically on the new wall
    const k = await setup();
    await k.walls([[[0, 10], [10, 10]], [[2, 10], [12, 10]]]);
    await k.run("bim_place_openings", { items: [win("W-0001", 4)] });
    const c0 = center(await k.S(), "O-0001");
    const kr = await k.run("bim_rehost_opening", { opening: "O-0001", host: "W-0002", keep_position: true });
    s = await k.S();
    assert.deepEqual([kr.summary.newAlong, (s.elements["O-0001"] as Opening).host], [2, "W-0002"]);
    assert.ok(nearPt(center(s, "O-0001"), c0));
    await k.rejected("bim_rehost_opening", { opening: "O-0001", host: "W-0001", along: 1, keep_position: true }, "INVALID_REHOST");
  });
});

// ============================================================================ atomicity
describe("atomicity", () => {
  /** an open room (three walls joined, the fourth short) with a window on the short wall and TWO rooms inside */
  async function openRoom() {
    const t = await setup({ everyEvents: 1, keep: 2 });
    await t.walls([[[0, 0], [10, 0]], [[10, 0], [10, 6]], [[10, 6], [0, 6]], [[0, 2], [0, 6]]]);
    await t.join("W-0001", "end", "W-0002", "start"); await t.join("W-0002", "end", "W-0003", "start"); await t.join("W-0003", "end", "W-0004", "end");
    await t.run("bim_place_openings", { items: [win("W-0004", 2)] });
    await t.run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 3, y: 3, allow_unbounded: true }, { category: "architecture.room", storey: "L0", x: 7, y: 3, allow_unbounded: true }] });
    return t;
  }
  test("a compound extend (geometry + new junction + hosted shift) that ends in a spatial occupancy conflict leaves NOTHING behind: events, state, snapshots, audit", async () => {
    const t = await openRoom();
    const before = await t.snap(), auditBefore = (await t.p.store("auth").readAudit(1000)).length;
    assert.deepEqual([room(await t.S(), "SP-0001").status, room(await t.S(), "SP-0002").status], ["unbounded", "unbounded"]);
    // the extension would close the loop: both rooms would then occupy ONE region of the same category
    await t.rejected("bim_extend_wall", { wall: "W-0004", endpoint: "start", target: "W-0001" }, "SPATIAL_REGION_OCCUPIED", { categoryId: "architecture.room" });
    await assert.rejects(t.ex("bim_extend_wall", { wall: "W-0004", endpoint: "start", target: "W-0001" }, { dryRun: true }), (e: any) => e.reason === "SPATIAL_REGION_OCCUPIED");   // dry run: same full validation
    assert.deepEqual(await t.snap(), before, "state and event count unchanged");
    assert.equal((await t.p.store("auth").readAudit(1000)).length, auditBefore, "a failed command writes no 'applied' audit entry");
    assert.equal((await t.p.store("auth").readAudit(1000)).filter((a) => a.action === "bim_extend_wall").length, 0);
    const full = await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state<BimState>("auth", "bim");
    const snapped = await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: { everyEvents: 1, keep: 2 } }).state<BimState>("auth", "bim");
    assert.equal(canonicalJson(full), before.s);
    assert.equal(canonicalJson(snapped), before.s, "snapshot state equals the untouched state");
    // the only reason was the occupancy: remove one room and the same command goes through, as one command
    await t.run("bim_delete_elements", { ids: ["SP-0002"] });
    const n = (await t.p.store("auth").readEvents()).length;
    const r = await t.run("bim_extend_wall", { wall: "W-0004", endpoint: "start", target: "W-0001" });
    const s = await t.S();
    assert.deepEqual([r.summary.newPoint, (s.elements["O-0001"] as Opening).along, room(s, "SP-0001").status, room(s, "SP-0001").area], [[0, 0], 4, "bounded", 60]);
    const added = (await t.p.store("auth").readEvents()).slice(n);
    assert.equal(new Set(added.map((e) => e.commandId)).size, 1, "all changes belong to one command");
    assertHostGraph(s);
  });
});

// ============================================================================ dry run parity
describe("dry run", () => {
  const cases: [string, (t: Awaited<ReturnType<typeof setup>>) => Promise<unknown>, string, unknown][] = [
    ["split", (t) => t.roomModel(), "bim_split_wall", { wall: "W-0001", t: 0.5 }],
    ["merge", async (t) => { await t.roomModel(); await t.run("bim_split_wall", { wall: "W-0001", t: 0.5 }); }, "bim_merge_walls", { walls: ["W-0001", "W-0006"] }],
    ["trim", (t) => t.walls([[[0, 3], [8, 3]], [[5, 0], [5, 6]]]), "bim_trim_wall", { wall: "W-0001", endpoint: "end", target: "W-0002" }],
    ["extend", (t) => t.walls([[[0, 3], [3, 3]], [[5, 0], [5, 6]]]), "bim_extend_wall", { wall: "W-0001", endpoint: "end", target: "W-0002" }],
    ["rehost", (t) => t.roomModel(), "bim_rehost_opening", { opening: "O-0001", host: "W-0003", along: 3 }],
  ];
  for (const [name, prepare, tool, input] of cases)
    test(`${name}: the preview is the same decision as the apply, and persists nothing`, async () => {
      const t = await setup();
      await prepare(t);
      const before = await t.snap();
      const dry = await t.ex(tool, input, { dryRun: true });
      assert.equal(dry.status, "preview");
      assert.deepEqual(await t.snap(), before, "a dry run changes nothing");
      const n = (await t.p.store("auth").readEvents()).length;
      const real = await t.ex(tool, input);
      assert.equal(real.status, "applied");
      assert.deepEqual(real.summary, dry.preview.summary, "same structured result");
      const types = (await t.p.store("auth").readEvents()).slice(n).filter((e) => e.module === "bim").map((e) => e.type);
      assert.deepEqual(types, dry.preview.events, "the events the preview announced are the events committed");
      assert.deepEqual((await t.ex(tool, input, { dryRun: true }).catch((e: any) => e.reason)) === "x", false);
    });
});

// ============================================================================ replay, snapshot, determinism
describe("replay and snapshots", () => {
  test("every command: live state == the state rebuilt from its events; ids and events are deterministic across two identical runs", async () => {
    const script = async () => {
      const t = await setup({ everyEvents: 3, keep: 2 });
      await t.roomModel();
      await t.walls([[[20, 3], [28, 3]], [[25, 0], [25, 6]], [[30, 3], [33, 3]], [[35, 0], [35, 6]]]);
      const steps: [string, unknown][] = [
        ["bim_split_wall", { wall: "W-0001", t: 0.5 }], ["bim_merge_walls", { walls: ["W-0001", "W-0010"] }],
        ["bim_trim_wall", { wall: "W-0006", endpoint: "end", target: "W-0007" }], ["bim_extend_wall", { wall: "W-0008", endpoint: "end", target: "W-0009" }],
        ["bim_rehost_opening", { opening: "O-0001", host: "W-0003", along: 3 }], ["bim_split_wall", { wall: "W-0003", t: 0.7 }], ["platform_undo", {}],
      ];
      const states: string[] = [];
      for (const [tool, input] of steps) {
        await t.run(tool, input);
        const full = await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state<BimState>("auth", "bim");
        const live = await t.S();
        assert.equal(canonicalJson(live), canonicalJson(full), `after ${tool}`);
        states.push(canonicalJson(live));
      }
      return { t, states, events: (await t.p.store("auth").readEvents()).map((e) => [e.module, e.type, e.schemaVersion, e.payload]) };
    };
    const a = await script(), b = await script();
    assert.deepEqual(a.states, b.states, "identical runs, identical states");
    // command ids are random by design (an undo event names the command it reverts): normalise them, nothing else
    const norm = (ev: unknown) => canonicalJson(ev).replace(/CMD-[0-9a-f]{8}/g, "CMD");
    assert.equal(norm(a.events), norm(b.events), "identical runs, identical events");
    assert.ok(a.events.some((e) => e[1] === "WallJoinUpdated") && a.events.some((e) => e[1] === "ElementDeleted"), "the compared stream really contains the authoring events");
    assert.ok(a.t.p.metrics.snapshotsWritten > 0);
  });
  test("history -> snapshot -> reload -> keep authoring == full replay; BIM_STATE_VERSION is unchanged by Phase 10", async () => {
    const policy = { everyEvents: 4, keep: 2 };
    const t = await setup(policy);
    await t.roomModel();
    await t.run("bim_split_wall", { wall: "W-0001", t: 0.5 });
    await t.run("bim_split_wall", { wall: "W-0003", t: 0.25 });
    const fresh = new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy });
    await fresh.state("auth", "bim");
    assert.equal(fresh.metrics.snapshotsLoaded, 1, "reloaded from a snapshot");
    await fresh.execute(user, "auth", "bim_merge_walls", { walls: ["W-0001", "W-0006"] });          // continue authoring on the reloaded platform
    await fresh.execute(user, "auth", "bim_trim_wall", { wall: "W-0005", endpoint: "end", target: "W-0001" }).catch(() => undefined);
    const full = await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state<BimState>("auth", "bim");
    assert.equal(canonicalJson(await fresh.state("auth", "bim")), canonicalJson(full));
    assert.deepEqual(modelIssues(full), []);
    const { BIM_STATE_VERSION, BIM_EVENT_VERSIONS } = await import("../src/index.js");
    assert.deepEqual([BIM_STATE_VERSION, BIM_EVENT_VERSIONS.ElementCreated, BIM_EVENT_VERSIONS.ElementUpdated, BIM_EVENT_VERSIONS.WallJoinCreated], [7, 3, 2, 1]);   // 7 = Phase 14 spatial units (additive); Phase 10 itself changed no version
  });
});

// ============================================================================ spatial
describe("spatial behaviour", () => {
  test("extend-and-join closes a room; join: false (touching) does not; undo opens it again; the element itself is never touched", async () => {
    const mk = async () => {
      const t = await setup();
      await t.walls([[[0, 0], [10, 0]], [[10, 0], [10, 6]], [[10, 6], [0, 6]], [[0, 2], [0, 6]]]);
      await t.join("W-0001", "end", "W-0002", "start"); await t.join("W-0002", "end", "W-0003", "start"); await t.join("W-0003", "end", "W-0004", "end");
      await t.run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 5, y: 3, allow_unbounded: true }] });
      return t;
    };
    const a = await mk();
    const roomBefore = JSON.stringify((await a.S()).elements["SP-0001"]);
    await a.run("bim_extend_wall", { wall: "W-0004", endpoint: "start", target: "W-0001", join: false });
    assert.equal(room(await a.S(), "SP-0001").status, "unbounded", "geometry touching but topology disconnected: not closed");
    await a.run("platform_undo", {});
    await a.run("bim_extend_wall", { wall: "W-0004", endpoint: "start", target: "W-0001" });
    const closed = room(await a.S(), "SP-0001");
    assert.deepEqual([closed.status, closed.area, closed.perimeter], ["bounded", 60, 32]);
    assert.equal(JSON.stringify((await a.S()).elements["SP-0001"]), roomBefore, "the room element was not edited");
    await a.run("platform_undo", {});
    assert.equal(room(await a.S(), "SP-0001").status, "unbounded");
    assert.ok((await a.S()).elements["SP-0001"], "the room persists as a semantic element");
    // a closing trim: the wall overshoots the corner
    const b = await setup();
    await b.walls([[[0, 0], [10, 0]], [[10, 0], [10, 6]], [[10, 6], [0, 6]], [[0, 6], [0, -1]]]);
    await b.join("W-0001", "end", "W-0002", "start"); await b.join("W-0002", "end", "W-0003", "start"); await b.join("W-0003", "end", "W-0004", "start");
    await b.run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 5, y: 3, allow_unbounded: true }] });
    assert.equal(room(await b.S(), "SP-0001").status, "unbounded");
    await b.run("bim_trim_wall", { wall: "W-0004", endpoint: "end", target: "W-0001" });
    assert.deepEqual([room(await b.S(), "SP-0001").status, room(await b.S(), "SP-0001").area], ["bounded", 60]);
    // a joined boundary endpoint can never be trimmed / extended away: a closed room is not silently opened
    await b.rejected("bim_trim_wall", { wall: "W-0002", endpoint: "end", target: "W-0001" }, "WALL_EDIT_ENDPOINT_JOINED");
  });
  test("a split keeps the room bounded with the same area; a partition split into halves keeps both rooms; merging back restores the signatures", async () => {
    const { run, S, roomModel } = await setup();
    await roomModel();
    const s0 = await S(), sig0 = regions(s0).map((g) => g.signature).sort(), areas0 = [room(s0, "SP-0001").area, room(s0, "SP-0002").area];
    await run("bim_split_wall", { wall: "W-0003", t: 0.3 });
    await run("bim_split_wall", { wall: "W-0005", t: 0.3 });
    const s1 = await S();
    assert.deepEqual([room(s1, "SP-0001").status, room(s1, "SP-0002").status, room(s1, "SP-0001").area, room(s1, "SP-0002").area], ["bounded", "bounded", areas0[0], areas0[1]]);
    assert.equal(canonicalJson(s1.elements["SP-0001"]), canonicalJson(s0.elements["SP-0001"]), "no room event: boundaries are derived");
    await run("bim_merge_walls", { walls: ["W-0005", "W-0007"] });
    await run("bim_merge_walls", { walls: ["W-0003", "W-0006"] });
    assert.deepEqual(regions(await S()).map((g) => g.signature).sort(), sig0);
  });
});
