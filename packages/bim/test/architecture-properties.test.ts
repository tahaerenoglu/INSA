/** Phase 11 · property-based tests (fast-check). Reproducible: FC_SEED (default 20261007), FC_RUNS_FACTOR. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { Platform, canonicalJson } from "@insa/core";
import { bimModule, BimState, quantities, planeHeight, registerCategory, modelIssues, engineIdOfElement, stairGeometry } from "../src/index.js";
import { setup, P, user } from "./authoring-fixture.js";

const SEED = Number(process.env.FC_SEED ?? 20261007), FACTOR = Number(process.env.FC_RUNS_FACTOR ?? 1);
const runs = (n: number) => Math.max(1, Math.round(n * FACTOR));
registerCategory({ id: "architecture.test_path_feature", name: "Test Path Features", discipline: "architecture", engine: "path", placements: ["path"], typeKinds: ["railing"], capabilities: ["hasType", "levelBased", "movable"] });
type T = Awaited<ReturnType<typeof setup>>;
const el = (s: BimState, id: string) => s.elements[id] as any;
async function arch(policy: { everyEvents: number; keep: number } | false = false) {
  const t = await setup(policy);
  await t.run("bim_create_types", { types: [
    { kind: "ceiling", name: "C13", layers: [{ material: "Alçıpan", thickness: 0.0125 }] }, { kind: "roof", name: "R20", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "stair", name: "S20", max_riser: 0.2, min_tread: 0.25, default_width: 1.2 },
    { kind: "railing", name: "RL", height: 1.0, top_rail: { width: 0.05, depth: 0.04 }, post: { size: 0.04 }, max_post_spacing: 1.2 }] });
  return t;
}
const replayEqual = async (t: T) => assert.equal(canonicalJson(await t.S()), canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state<BimState>(P, "bim")), "live == replay");
const rect = (w: number, d: number): [number, number][] => [[0, 0], [w, 0], [w, d], [0, d]];
const dim = fc.integer({ min: 4, max: 40 }).map((v) => v / 2);
/** polygon area from 3D vertices (|sum of cross products| / 2): independent of the cos(pitch) formula */
const area3d = (v: number[][]) => { let x = 0, y = 0, z = 0; for (let i = 0; i < v.length; i++) { const a = v[i], b = v[(i + 1) % v.length]; x += a[1] * b[2] - a[2] * b[1]; y += a[2] * b[0] - a[0] * b[2]; z += a[0] * b[1] - a[1] * b[0]; } return Math.hypot(x, y, z) / 2; };
const cover = { stair: 0, stairRefused: 0, roofs: 0 };

test("P1 · a horizontal ceiling's area and volume match the analytic oracle (outline minus holes, x thickness)", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(dim, dim, fc.boolean(), fc.integer({ min: 0, max: 30 }).map((v) => v / 10), async (w, d, hole, off) => {
    fc.pre(w > 3 && d > 3);
    const t = await arch();
    await t.run("bim_create_boundaries", { boundaries: [{ category: "architecture.ceiling", storey: "L0", type: "C13", outline: rect(w, d), offset: off, holes: hole ? [[[1, 1], [2, 1], [2, 2], [1, 2]]] : [] }] });
    const q = quantities(await t.S(), (await t.S()).elements["CE-0001"]), a = w * d - (hole ? 1 : 0);
    assert.ok(Math.abs(q.area - a) < 1e-9 && Math.abs(q.volume - a * 0.0125) < 1e-9 && q.thickness === 0.0125);
  }), { seed: SEED, numRuns: runs(40) });
});

test("P2 · a sloped roof's surface area equals the independent 3D polygon area; volume = surface x thickness; flat == projected; P3 · live == replay", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(dim, dim, fc.integer({ min: 0, max: 359 }), fc.integer({ min: 1, max: 70 }), async (w, d, az, pitch) => {
    fc.pre(w > 3 && d > 3);
    const t = await arch();
    await t.run("bim_create_boundaries", { boundaries: [{ category: "architecture.roof", storey: "L1", type: "R20", outline: rect(w, d), offset: 0.5, slope: { azimuth: az, pitch } }, { category: "architecture.roof", storey: "L1", type: "R20", outline: rect(w, d) }] });
    const s = await t.S(), r = el(s, "RF-0001"), q = quantities(s, r), flat = quantities(s, s.elements["RF-0002"]);
    cover.roofs++;
    const v3 = r.outline.map((p: number[]) => [p[0], p[1], planeHeight(r, p as [number, number])]);
    assert.ok(Math.abs(q.surface_area - area3d(v3)) < 1e-6, `surface ${q.surface_area} vs 3D ${area3d(v3)}`);
    assert.ok(Math.abs(q.volume - q.surface_area * 0.2) < 1e-9 && q.surface_area >= q.projected_area - 1e-12 && q.pitch === pitch);
    assert.ok(flat.surface_area === flat.projected_area && flat.pitch === 0);
    assert.ok(Math.min(...v3.map((p: number[]) => p[2])) === 0.5, "the eave is the lowest edge, at the offset");
    await replayEqual(t);
  }), { seed: SEED, numRuns: runs(40) });
  assert.ok(cover.roofs >= 10);
});

test("P4 · ceiling live == replay (create, update, move, reassign, delete)", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(dim, dim, fc.integer({ min: -3, max: 3 }), async (w, d, dx) => {
    fc.pre(w > 3 && d > 3);
    const t = await arch({ everyEvents: 3, keep: 2 });
    await t.run("bim_create_boundaries", { boundaries: [{ category: "architecture.ceiling", storey: "L0", type: "C13", outline: rect(w, d), offset: 2.5 }] });
    await replayEqual(t);
    await t.run("bim_update_elements", { items: [{ id: "CE-0001", kind: "boundary", set: { offset: 2.8 } }] });
    await t.run("bim_move_elements", { ids: ["CE-0001"], vector: [dx, 1] });
    await t.run("bim_reassign_storey", { items: [{ id: "CE-0001", storey: "L1" }] });
    await replayEqual(t);
    await t.run("bim_delete_elements", { ids: ["CE-0001"] });
    await replayEqual(t);
  }), { seed: SEED, numRuns: runs(25) });
});

test("P5 · a stair's total rise equals the level difference minus the base offset; the riser count never changes by itself; P6 · live == replay", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.integer({ min: 24, max: 40 }).map((v) => v / 10), fc.constantFrom(0, 0.1, 0.2), fc.integer({ min: 0, max: 3 }), async (elev, base, extra) => {
    const t = await arch({ everyEvents: 4, keep: 2 });
    const rise = 3.2 - base, N = Math.ceil(rise / 0.2) + extra;
    await t.run("bim_create_stairs", { stairs: [{ storey: "L0", type: "S20", start: [1, 1], end: [1 + (N - 1) * 0.3, 1], riser_count: N, base_offset: base }] });
    let s = await t.S();
    assert.ok(Math.abs(el(s, "STR-0001").height - (3.2 - 0 - base)) < 1e-9, "created: the next storey above");
    const r = await t.ex("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: elev } }] }).catch((e: any) => ({ status: "error", reason: e.reason }));
    s = await t.S();
    const want = elev - base, limit = want / N <= 0.2 + 1e-4;
    cover[limit ? "stair" : "stairRefused"]++;
    if (limit) {
      assert.equal(r.status, "applied");
      assert.ok(Math.abs(el(s, "STR-0001").height - want) < 1e-6, "P5: rise = level difference - base offset");
      assert.equal(el(s, "STR-0001").riserCount, N, "the riser count is intent: never changed by the system");
      assert.ok(Math.abs(stairGeometry(el(s, "STR-0001")).riserHeight * N - want) < 1e-6);
    } else {
      assert.deepEqual([r.status, r.reason], ["error", "STAIR_TYPE_LIMIT_EXCEEDED"], "validation reports it; nothing mutates");
      assert.ok(Math.abs(el(s, "STR-0001").height - (3.2 - base)) < 1e-9 && el(s, "STR-0001").riserCount === N);
    }
    await replayEqual(t);
  }), { seed: SEED, numRuns: runs(40) });
  assert.ok(cover.stair >= 5 && cover.stairRefused >= 1, `both outcomes exercised: ${JSON.stringify(cover)}`);
});

const pathArb = fc.array(fc.tuple(fc.integer({ min: -20, max: 20 }), fc.integer({ min: -20, max: 20 })), { minLength: 2, maxLength: 7 })
  .map((pts) => pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]) as [number, number][]);
test("P7 · a railing's path length equals the independent polyline oracle and its posts follow the spacing rule; P8 · live == replay", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(pathArb, fc.boolean(), async (pts, closed) => {
    fc.pre(pts.length >= (closed ? 3 : 2) && !(closed && pts[0][0] === pts.at(-1)![0] && pts[0][1] === pts.at(-1)![1]));
    const t = await arch({ everyEvents: 3, keep: 2 });
    const r = await t.ex("bim_create_railings", { railings: [{ storey: "L1", type: "RL", path: pts, closed }] }).catch((e: any) => ({ status: "error", reason: e.reason }));
    assert.equal(r.status, "applied", JSON.stringify(r));
    const q = quantities(await t.S(), (await t.S()).elements["RL-0001"]);
    let oracle = 0, posts = closed ? 0 : 1;
    const seg = closed ? [...pts, pts[0]] : pts;
    for (let i = 0; i + 1 < seg.length; i++) { const l = Math.hypot(seg[i + 1][0] - seg[i][0], seg[i + 1][1] - seg[i][1]); oracle += l; posts += Math.max(1, Math.ceil(Math.round((l / 1.2) * 1e9) / 1e9)); }
    assert.ok(Math.abs(q.path_length - oracle) < 1e-9, "P7: length");
    assert.equal(q.post_count, posts, "P7: post count = sum of ceil(length / spacing) (+1 when open)");
    await replayEqual(t);
  }), { seed: SEED, numRuns: runs(40) });
});

test("P9 · the category and engine of every Phase 11 element survive generic move / update / reassign; P10 · a test-only path category needs no new kind; P12 · dry run == apply", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.array(fc.constantFrom("move", "update", "reassign"), { minLength: 1, maxLength: 5 }), async (ops) => {
    const t = await arch();
    const sq = rect(10, 6);
    const batches: [string, unknown][] = [["bim_create_boundaries", { boundaries: [{ category: "architecture.ceiling", storey: "L0", type: "C13", outline: sq, offset: 2.5 }, { category: "architecture.roof", storey: "L1", type: "R20", outline: sq, slope: { azimuth: 45, pitch: 20 } }] }],
      ["bim_create_stairs", { stairs: [{ storey: "L0", type: "S20", start: [1, 1], end: [5, 1], riser_count: 16 }] }],
      ["bim_create_railings", { railings: [{ storey: "L1", type: "RL", path: [[0, 0], [4, 0]] }] }],
      ["bim_create_path_elements", { elements: [{ category: "architecture.test_path_feature", storey: "L1", type: "RL", path: [[0, 2], [4, 2]] }] }]];
    for (const [tool, input] of batches) {                                          // P12: the dry run is the apply's decision
      const before = await t.snap(), dry = await t.ex(tool, input, { dryRun: true });
      assert.deepEqual(await t.snap(), before);
      const real = await t.run(tool, input);
      assert.deepEqual(real.summary, dry.preview.summary);
    }
    const want = { "CE-0001": ["architecture.ceiling", "boundary"], "RF-0001": ["architecture.roof", "boundary"], "STR-0001": ["architecture.stair", "stair"], "RL-0001": ["architecture.railing", "path"], "PE-0001": ["architecture.test_path_feature", "path"] } as Record<string, string[]>;
    for (const o of ops) {
      if (o === "move") await t.run("bim_move_elements", { ids: ["CE-0001", "RF-0001", "STR-0001", "RL-0001", "PE-0001"], vector: [1, 1] });
      if (o === "update") await t.run("bim_update_elements", { items: [{ id: "RL-0001", kind: "path", set: { height: 1.2 } }, { id: "CE-0001", kind: "boundary", set: { offset: 2.6 } }] });
      if (o === "reassign") await t.run("bim_reassign_storey", { items: [{ id: "PE-0001", storey: "L0" }] }).catch(() => undefined);
      const s = await t.S();
      for (const [id, [cat, eng]] of Object.entries(want)) assert.deepEqual([el(s, id).category, engineIdOfElement(s, s.elements[id]), el(s, id).kind === "stair" || el(s, id).kind === "path" || el(s, id).kind === "boundary"], [cat, eng, true], id);
    }
    assert.deepEqual(modelIssues(await t.S()), []);
    assert.deepEqual([...new Set(Object.values((await t.S()).elements).map((e) => e.kind))].sort(), ["boundary", "path", "stair"], "no element kind per category");
  }), { seed: SEED, numRuns: runs(15) });
});

test("P11 · random mixed Phase 10 + Phase 11 histories: snapshot reload == full replay, and the reloaded platform keeps authoring", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  const op = fc.oneof(fc.record({ t: fc.constant("split"), d: fc.integer({ min: 1, max: 5 }) }), fc.record({ t: fc.constant("pitch"), p: fc.integer({ min: 5, max: 60 }) }),
    fc.record({ t: fc.constant("level"), e: fc.integer({ min: 28, max: 36 }).map((v) => v / 10) }), fc.record({ t: fc.constant("rail"), x: fc.integer({ min: 1, max: 4 }) }), fc.record({ t: fc.constant("undo") }));
  await fc.assert(fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 7 }), fc.integer({ min: 1, max: 5 }), async (ops, every) => {
    const policy = { everyEvents: every, keep: 2 };
    const t = await arch(policy);
    await t.roomModel();
    await t.run("bim_create_boundaries", { boundaries: [{ category: "architecture.roof", storey: "L1", type: "R20", outline: rect(10, 6), slope: { azimuth: 90, pitch: 20 } }, { category: "architecture.ceiling", storey: "L0", type: "C13", outline: rect(10, 6), offset: 2.7 }] });
    await t.run("bim_create_stairs", { stairs: [{ storey: "L0", type: "S20", start: [1, 7], end: [5, 7], riser_count: 16 }] });
    for (const o of ops as any[]) {
      const call = o.t === "split" ? t.ex("bim_split_wall", { wall: "W-0003", t: o.d / 6 }) : o.t === "pitch" ? t.ex("bim_update_elements", { items: [{ id: "RF-0001", kind: "boundary", set: { slope: { azimuth: 90, pitch: o.p } } }] })
        : o.t === "level" ? t.ex("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: o.e } }] }) : o.t === "rail" ? t.ex("bim_create_railings", { railings: [{ storey: "L1", type: "RL", path: [[0, 0], [o.x, 0]] }] }) : t.ex("platform_undo", {});
      await call.catch(() => undefined);
    }
    const full = await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state<BimState>(P, "bim");
    const reloaded = new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy });
    assert.equal(canonicalJson(await reloaded.state(P, "bim")), canonicalJson(full));
    assert.deepEqual(modelIssues(full), []);
    await reloaded.execute(user, P, "bim_move_elements", { ids: ["CE-0001"], vector: [0.5, 0] }).catch(() => undefined);
    assert.equal(canonicalJson(await reloaded.state(P, "bim")), canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state(P, "bim")));
  }), { seed: SEED, numRuns: runs(20) });
});
