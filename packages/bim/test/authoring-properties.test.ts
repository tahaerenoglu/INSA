/**
 * Phase 10 · property-based tests (fast-check) for the authoring primitives.
 * Reproducible: FC_SEED (default 20261007), FC_RUNS_FACTOR for longer runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { Platform, canonicalJson } from "@insa/core";
import { bimModule, BimState, Wall, Opening, WallJoin, connectedComponent, modelIssues, storeyRegions, SpatialContext, resolveSpatialElement } from "../src/index.js";
import { setup, center, wall, nearPt, P, user } from "./authoring-fixture.js";

const SEED = Number(process.env.FC_SEED ?? 20261007), FACTOR = Number(process.env.FC_RUNS_FACTOR ?? 1);
const runs = (n: number) => Math.max(1, Math.round(n * FACTOR));
type T = Awaited<ReturnType<typeof setup>>;
/** what the generators really exercised (asserted below: a property that only ever sees one outcome proves little) */
const cover = { p8: { applied: 0, refused: 0, trim: 0, extend: 0, start: 0 } as Record<string, number>, p1: { split: 0, refused: 0, teeAtSplit: 0 } };

/** numbers compared within tol, everything else exactly */
function approx(a: unknown, b: unknown, tol: number, path = "$"): string | null {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= tol ? null : `${path}: ${a} vs ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) return a.length !== b.length ? `${path}: length` : a.map((x, i) => approx(x, b[i], tol, `${path}[${i}]`)).find(Boolean) ?? null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
    if (canonicalJson(ka) !== canonicalJson(kb)) return `${path}: keys ${ka} vs ${kb}`;
    return ka.map((k) => approx((a as any)[k], (b as any)[k], tol, `${path}.${k}`)).find(Boolean) ?? null;
  }
  return a === b ? null : `${path}: ${String(a)} vs ${String(b)}`;
}
const model = (s: BimState) => ({ e: s.elements, j: s.joins });

// ---- scenario: one main wall [0,0]->[L,0] with end neighbours, tee branches and windows at integer positions
interface Scn { L: number; wins: number[]; tees: number[]; corners: boolean }
const scn = fc.record({
  L: fc.integer({ min: 6, max: 16 }),
  winsRaw: fc.uniqueArray(fc.integer({ min: 1, max: 15 }), { maxLength: 4 }),
  teesRaw: fc.uniqueArray(fc.integer({ min: 1, max: 15 }), { maxLength: 3 }),
  corners: fc.boolean(),
}).map(({ L, winsRaw, teesRaw, corners }): Scn => {
  const wins: number[] = [];
  for (const w of winsRaw.filter((x) => x < L).sort((a, b) => a - b)) if (!wins.length || w - wins[wins.length - 1] >= 2) wins.push(w);
  return { L, wins, tees: teesRaw.filter((x) => x < L).sort((a, b) => a - b), corners };
});
async function build(t: T, c: Scn) {
  const segs: [number[], number[]][] = [[[0, 0], [c.L, 0]]];
  if (c.corners) segs.push([[0, -4], [0, 0]], [[c.L, 0], [c.L, -4]]);
  for (const x of c.tees) segs.push([[x, 0], [x, 4]]);
  await t.walls(segs);
  let next = 2;
  if (c.corners) { await t.join("W-0002", "end", "W-0001", "start"); await t.join("W-0001", "end", "W-0003", "start"); next = 4; }
  for (let k = 0; k < c.tees.length; k++) await t.tee(`W-000${next + k}`, "start", "W-0001");
  if (c.wins.length) await t.run("bim_place_openings", { items: c.wins.map((a) => ({ kind: "window", host: "W-0001", along: a, type: "N" })) });
}
const noPartial = async (t: T, fn: () => Promise<unknown>, reason: string) => {
  const before = await t.snap();
  await assert.rejects(fn(), (e: any) => e.reason === reason, reason);
  assert.deepEqual(await t.snap(), before);
};

test("P1 · split is refused exactly when an opening is crossed; otherwise split then merge restores the model (ids, joins, hosted content)", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(scn, fc.integer({ min: 1, max: 15 }), async (c, d) => {
    fc.pre(d < c.L);
    const t = await setup();
    await build(t, c);
    const orig = await t.S();
    if (c.wins.includes(d)) { cover.p1.refused++; await noPartial(t, () => t.p.execute(user, P, "bim_split_wall", { wall: "W-0001", t: d / c.L }), "SPLIT_INTERSECTS_HOSTED_OPENING"); return; }
    const r = await t.run("bim_split_wall", { wall: "W-0001", t: d / c.L });
    cover.p1.split++; if (c.tees.includes(d)) cover.p1.teeAtSplit++;
    const child = r.summary.walls[1] as string;
    assert.deepEqual(modelIssues(await t.S()), []);
    if (c.tees.includes(d)) {                               // a T exactly at the split point became a THREE-wall junction: merging would destroy it
      await noPartial(t, () => t.p.execute(user, P, "bim_merge_walls", { walls: ["W-0001", child] }), "MERGE_AMBIGUOUS_JUNCTION");
      return;
    }
    await t.run("bim_merge_walls", { walls: ["W-0001", child] });
    const back = await t.S();
    assert.equal(approx(model(back), model(orig), 2e-6), null, "equivalent model");
    assert.deepEqual(modelIssues(back), []);
  }), { seed: SEED, numRuns: runs(60) });
  t0.diagnostic(`coverage ${JSON.stringify(cover.p1)}`);
  assert.ok(cover.p1.split >= 20 && cover.p1.refused >= 1, `splits and refusals both exercised: ${JSON.stringify(cover.p1)}`);
});

test("P2 · split preserves the total wall length; P3 · it preserves the world position of every hosted opening; P5 · and every external connection", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(scn, fc.integer({ min: 1, max: 15 }), async (c, d) => {
    fc.pre(d < c.L && !c.wins.includes(d));
    const t = await setup();
    await build(t, c);
    const s0 = await t.S(), centers = Object.keys(s0.elements).filter((k) => k.startsWith("O-")).map((o) => [o, center(s0, o)] as const);
    const comp0 = connectedComponent(s0, "W-0001");
    const r = await t.run("bim_split_wall", { wall: "W-0001", t: d / c.L });
    const s = await t.S(), [a, b] = r.summary.walls.map((id: string) => wall(s, id));
    assert.ok(Math.abs(Math.hypot(a.end[0] - a.start[0], a.end[1] - a.start[1]) + Math.hypot(b.end[0] - b.start[0], b.end[1] - b.start[1]) - c.L) <= 2e-6, "P2: total length");
    for (const [o, ctr] of centers) assert.ok(nearPt(center(s, o), ctr, 2e-6), `P3: ${o} stays where it was`);
    assert.deepEqual(connectedComponent(s, "W-0001"), [...comp0, b.id].sort(), "P5: the same walls stay connected (plus the new half)");
    for (const x of c.tees) {                               // every tee branch is still a T on the half that contains it, at its physical place
      if (x === d) {                                        // ... or a member of the new three-wall junction when it sits exactly at the split
        const j = Object.values(s.joins).find((q) => q.kind === "endpoint_endpoint" && q.members.length === 3)!;
        assert.ok(j && (j as any).members.some((m: any) => pointKey(wall(s, m.wall), m.endpoint) === `${x},0` && m.wall !== a.id && m.wall !== b.id), `tee at x=${x} joined the junction`);
        continue;
      }
      const tw = Object.values(s.joins).find((j) => j.kind === "endpoint_segment" && pointKey(wall(s, j.endpoint.wall), j.endpoint.endpoint) === `${x},0`) as Extract<WallJoin, { kind: "endpoint_segment" }> | undefined;
      assert.ok(tw, `tee at x=${x} survives`);
      assert.equal(tw!.host, x < d ? a.id : x > d ? b.id : tw!.host);
    }
  }), { seed: SEED, numRuns: runs(40) });
});
const pointKey = (w: Wall, e: "start" | "end") => `${w[e][0]},${w[e][1]}`;

test("P4 · merge preserves the world position of hosted openings and the physical place of tees, for either survivor and either orientation of the second wall", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.integer({ min: 4, max: 10 }), fc.integer({ min: 4, max: 10 }), fc.boolean(), fc.boolean(), fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 3 }), async (a, b, reversed, otherPrimary, wa, wb) => {
    fc.pre(wa < a - 1 && wb < b - 1);
    const t = await setup();
    await t.walls([[[0, 0], [a, 0]], reversed ? [[a + b, 0], [a, 0]] : [[a, 0], [a + b, 0]], [[1, 0], [1, 4]], [[a + b - 1, 0], [a + b - 1, 4]]]);
    await (reversed ? t.join("W-0001", "end", "W-0002", "end") : t.join("W-0001", "end", "W-0002", "start"));
    await t.tee("W-0003", "start", "W-0001"); await t.tee("W-0004", "start", "W-0002");
    const lenB = b;
    await t.run("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: wa, type: "N" }, { kind: "door", host: "W-0002", along: reversed ? lenB - wb : wb, type: "K" }] });
    const s0 = await t.S(), c0 = ["O-0001", "O-0002"].map((o) => center(s0, o)), tees0 = ["W-0003", "W-0004"].map((id) => wall(s0, id).start);
    const primary = otherPrimary ? "W-0002" : "W-0001";
    const r = await t.run("bim_merge_walls", { walls: ["W-0001", "W-0002"], primary });
    const s = await t.S();
    assert.equal(r.summary.survivor, primary);
    assert.deepEqual(modelIssues(s), []);
    ["O-0001", "O-0002"].forEach((o, k) => assert.ok(nearPt(center(s, o), c0[k], 2e-6), `${o} world position`));
    assert.deepEqual(["W-0003", "W-0004"].map((id) => wall(s, id).start), tees0, "tee walls did not move");
    assert.deepEqual([wall(s, primary).start[1], wall(s, primary).end[1]], [0, 0]);
    assert.ok(Math.abs(Math.hypot(...(wall(s, primary).end.map((v, i) => v - wall(s, primary).start[i]) as [number, number])) - (a + b)) <= 1e-9, "merged length");
  }), { seed: SEED, numRuns: runs(50) });
});

/** replay: live state equals the state rebuilt from the events alone, for any single command */
async function replayEqual(t: T) {
  const full = await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state<BimState>(P, "bim");
  assert.equal(canonicalJson(await t.S()), canonicalJson(full), "live == replay");
}
test("P6 · live == replay for split; P7 · for merge", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(scn, fc.integer({ min: 1, max: 15 }), async (c, d) => {
    fc.pre(d < c.L && !c.wins.includes(d));
    const t = await setup();
    await build(t, c);
    const r = await t.run("bim_split_wall", { wall: "W-0001", t: d / c.L });
    await replayEqual(t);
    if (c.tees.includes(d)) return;                          // merge is refused there (three-wall junction): covered by P1
    await t.run("bim_merge_walls", { walls: ["W-0001", r.summary.walls[1]] });
    await replayEqual(t);
  }), { seed: SEED, numRuns: runs(40) });
});

test("P8 · trim / extend: live == replay, hosted content stays put, the end ends exactly on the target; P9 · dry run = apply without persisting", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.integer({ min: 4, max: 12 }), fc.integer({ min: 1, max: 11 }), fc.boolean(), fc.boolean(), async (a, c, fromStart, withWindow) => {
    fc.pre(c !== a && c > 0 && c !== 0);
    const t = await setup();
    // a horizontal wall from x = 0 to x = a, a vertical target at x = c; trim when c < a (overshoot), extend when c > a
    const mode = c < a ? "trim" : "extend", endpoint = "end";
    fc.pre(!(mode === "trim" && c < 2));
    const x0 = fromStart ? a : 0, x1 = fromStart ? 0 : a;                                 // fromStart: the wall runs right to left, so "start" is the one to edit
    await t.walls([[[x0, 3], [x1, 3]], [[c, 0], [c, 6]]]);
    if (withWindow) await t.run("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 0.0 + 1, type: "N" }] });
    const ep = fromStart ? "start" : endpoint;
    // the far side of the wall relative to the edited end must not make the extension go the wrong way
    const before = await t.snap(), s0 = await t.S(), c0 = withWindow ? center(s0, "O-0001") : null;
    const tool = mode === "trim" ? "bim_trim_wall" : "bim_extend_wall", input = { wall: "W-0001", endpoint: ep, target: "W-0002" };
    const dry = await t.ex(tool, input, { dryRun: true }).catch((e: any) => ({ status: "error", reason: e.reason }));
    assert.deepEqual(await t.snap(), before, "P9: the dry run persisted nothing");
    const real = await t.ex(tool, input).catch((e: any) => ({ status: "error", reason: e.reason }));
    if (real.status === "error") { cover.p8.refused++; assert.equal(dry.status, "error", "P9: preview and apply agree on failure"); assert.equal(dry.reason, real.reason); return; }
    cover.p8.applied++; cover.p8[mode]++; if (fromStart) cover.p8.start++;
    assert.equal(dry.status, "preview"); assert.deepEqual(dry.preview.summary, real.summary, "P9: same result plan");
    const s = await t.S();
    assert.deepEqual(wall(s, "W-0001")[ep as "start" | "end"], [c, 3], "the edited end is exactly on the target");
    assert.deepEqual(modelIssues(s), []);
    if (c0) assert.ok(nearPt(center(s, "O-0001"), c0, 2e-6), "the window keeps its place");
    await replayEqual(t);
  }), { seed: SEED, numRuns: runs(60) });
  t0.diagnostic(`coverage ${JSON.stringify(cover.p8)}`);
  assert.ok(cover.p8.applied >= 10 && cover.p8.refused >= 1 && cover.p8.trim >= 3 && cover.p8.extend >= 3 && cover.p8.start >= 2, `both outcomes, both modes, both ends exercised: ${JSON.stringify(cover.p8)}`);
});

test("P10 · random authoring sequences: snapshot reload == full replay, and the reloaded platform keeps authoring", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  const op = fc.oneof(
    fc.record({ t: fc.constant("split"), w: fc.integer({ min: 1, max: 5 }), d: fc.integer({ min: 1, max: 5 }) }),
    fc.record({ t: fc.constant("merge"), a: fc.integer({ min: 1, max: 12 }), b: fc.integer({ min: 1, max: 12 }) }),
    fc.record({ t: fc.constant("rehost"), o: fc.integer({ min: 1, max: 3 }), h: fc.integer({ min: 1, max: 5 }), a: fc.integer({ min: 1, max: 5 }) }),
    fc.record({ t: fc.constant("undo") }));
  await fc.assert(fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 8 }), fc.integer({ min: 1, max: 5 }), async (ops, every) => {
    const policy = { everyEvents: every, keep: 2 };
    const t = await setup(policy);
    await t.roomModel();
    for (const o of ops as any[]) {
      const id = (n: number) => `W-${String(n).padStart(4, "0")}`;
      const call = o.t === "split" ? t.ex("bim_split_wall", { wall: id(o.w), t: o.d / 6 }) : o.t === "merge" ? t.ex("bim_merge_walls", { walls: [id(o.a), id(o.b)] })
        : o.t === "rehost" ? t.ex("bim_rehost_opening", { opening: `O-000${o.o}`, host: id(o.h), along: o.a + 0.5 }) : t.ex("platform_undo", {});
      await call.catch(() => undefined);                   // rejected edits are part of the history under test
    }
    const full = await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state<BimState>(P, "bim");
    const reloaded = new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy });
    assert.equal(canonicalJson(await reloaded.state(P, "bim")), canonicalJson(full), "snapshot reload == full replay");
    assert.deepEqual(modelIssues(full), []);
    await reloaded.execute(user, P, "bim_split_wall", { wall: "W-0004", t: 0.25 }).catch(() => undefined);
    const full2 = await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state<BimState>(P, "bim");
    assert.equal(canonicalJson(await reloaded.state(P, "bim")), canonicalJson(full2), "after continuing");
  }), { seed: SEED, numRuns: runs(30) });
});

test("P11 · spatial: a topology-preserving split keeps both rooms bounded with identical area and perimeter and no room event; merging back restores the region signatures", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 9 }), async (w, d) => {
    const t = await setup();
    await t.roomModel();
    const L = [10, 6, 10, 6, 6][w - 1], s0 = await t.S();
    const L0 = Object.values(s0.storeys).find((x) => x.name === "L0")!.id;
    const sig0 = storeyRegions(s0, L0).map((g) => g.signature).sort();
    const stat = (s: BimState) => ["SP-0001", "SP-0002"].map((id) => { const r = resolveSpatialElement(new SpatialContext(s), s.elements[id] as any); return [r.status, r.area, r.perimeter]; });
    const dist = (d / 10) * L;
    // oracle: the windows (W-0001: 1.5..2.5, 6.5..7.5) and the door (W-0005: 2.5..3.5) block a split through them
    const blocked = (w === 1 && ((dist > 1.5 && dist < 2.5) || (dist > 6.5 && dist < 7.5))) || (w === 5 && dist > 2.5 && dist < 3.5);
    const evBefore = (await t.p.store(P).readEvents()).length;
    const r = await t.ex("bim_split_wall", { wall: `W-000${w}`, t: d / 10 }).catch((e: any) => ({ status: "error", reason: e.reason }));
    if (blocked) { assert.equal(r.reason, "SPLIT_INTERSECTS_HOSTED_OPENING"); return; }
    if (r.status === "error") assert.fail(`unexpected ${r.reason} for wall ${w} at ${d}/10`);
    const s1 = await t.S();
    assert.deepEqual(stat(s1), stat(s0), "rooms: same status, area, perimeter");
    assert.equal(canonicalJson(s1.elements["SP-0001"]), canonicalJson(s0.elements["SP-0001"]), "no room edit");
    assert.ok((await t.p.store(P).readEvents()).slice(evBefore).every((e) => e.module !== "bim" || !String((e.payload as any)?.id ?? "").startsWith("SP-")), "no spatial event");
    // the partition (x = 4) is teed onto W-0001 at 4 m from its start and onto W-0003 at 6 m: a split exactly there makes a three-wall junction
    const teeAtSplit = (w === 1 && Math.abs(dist - 4) < 1e-9) || (w === 3 && Math.abs(dist - 6) < 1e-9);
    if (teeAtSplit) {
      await assert.rejects(t.ex("bim_merge_walls", { walls: [`W-000${w}`, r.summary.walls[1]] }), (e: any) => e.reason === "MERGE_AMBIGUOUS_JUNCTION");
      assert.deepEqual(stat(await t.S()), stat(s0), "rooms unaffected");
      return;
    }
    await t.run("bim_merge_walls", { walls: [`W-000${w}`, r.summary.walls[1]] });
    assert.deepEqual(storeyRegions(await t.S(), L0).map((g) => g.signature).sort(), sig0, "signatures restored");
  }), { seed: SEED, numRuns: runs(40) });
});

test("P12 · identical command scripts give identical states and (command ids aside) identical events", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.array(fc.record({ w: fc.integer({ min: 1, max: 5 }), d: fc.integer({ min: 1, max: 5 }), m: fc.boolean() }), { minLength: 1, maxLength: 6 }), async (ops) => {
    const script = async () => {
      const t = await setup();
      await t.roomModel();
      for (const o of ops) {
        const r = await t.ex("bim_split_wall", { wall: `W-000${o.w}`, t: o.d / 6 }).catch(() => null);
        if (r && o.m) await t.ex("bim_merge_walls", { walls: [`W-000${o.w}`, r.summary.walls[1]] }).catch(() => null);
      }
      return { s: canonicalJson(await t.S()), e: canonicalJson((await t.p.store(P).readEvents()).map((e) => [e.module, e.type, e.schemaVersion, e.payload])) };
    };
    const a = await script(), b = await script();
    assert.equal(a.s, b.s); assert.equal(a.e.replace(/CMD-[0-9a-f]{8}/g, "CMD"), b.e.replace(/CMD-[0-9a-f]{8}/g, "CMD"));
  }), { seed: SEED, numRuns: runs(15) });
});
