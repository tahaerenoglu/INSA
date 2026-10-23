/**
 * Phase 8 · property-based tests (fast-check) for spatial boundaries.
 * Reproducible: FC_SEED (default 20261007), FC_RUNS_FACTOR for longer runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { Platform, MemoryStores, Actor, canonicalJson, PlatformLogger } from "@insa/core";
import { bimModule, BimState, storeyRegions, SpatialContext, resolveSpatialElement, SpatialElement, Wall } from "../src/index.js";

const SEED = Number(process.env.FC_SEED ?? 20261007), FACTOR = Number(process.env.FC_RUNS_FACTOR ?? 1);
const runs = (n: number) => Math.max(1, Math.round(n * FACTOR));
const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "sprop";
const quiet: PlatformLogger = { info: () => {}, warn: () => {} };
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
type Pt = [number, number];

async function base(policy: { everyEvents: number; keep: number } | false = false) {
  const stores = new MemoryStores();
  const p = new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet });
  const ex = (tool: string, input: unknown) => p.execute(user, P, tool, input) as Promise<any>;
  await ex("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3 }] });
  await ex("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "m", thickness: 0.2 }] }] });
  const S = () => p.state<BimState>(P, "bim");
  const sid = async (name: string) => Object.values((await S()).storeys).find((s) => s.name === name)!.id;
  const newIds = async (fn: () => Promise<unknown>) => { const b = new Set(Object.keys((await S()).elements)); await fn(); return Object.keys((await S()).elements).filter((i) => !b.has(i)).sort(); };
  /** walls of a closed loop (corners coincide); joins are created separately so their order can vary */
  const loopWalls = (pts: Pt[], storey = "L0") => newIds(() => ex("bim_create_walls", { walls: [{ storey, type: "W", points: pts, closed: true, height: 3 }] }));
  const joinCorner = (ids: string[], k: number) => ex("bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: ids[k], endpoint: "end" }, { wall: ids[(k + 1) % ids.length], endpoint: "start" }] });
  const loop = async (pts: Pt[], storey = "L0") => { const ids = await loopWalls(pts, storey); for (let k = 0; k < ids.length; k++) await joinCorner(ids, k); return ids; };
  const partition = async (a: Pt, b: Pt, hostA: string, hostB: string) => {
    const [id] = await newIds(() => ex("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: a, end: b, height: 3 }] }));
    await ex("bim_join_walls", { kind: "endpoint_segment", endpoint: { wall: id, endpoint: "start" }, host: hostA });
    await ex("bim_join_walls", { kind: "endpoint_segment", endpoint: { wall: id, endpoint: "end" }, host: hostB });
    return id;
  };
  return { p, stores, ex, S, sid, loop, loopWalls, joinCorner, partition };
}
const rect = (x: number, y: number, w: number, d: number): Pt[] => [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
const dim = fc.integer({ min: 20, max: 200 }).map((v) => v / 10);                  // 2 .. 20 m, 0.1 m steps
const snap = async (p: Platform) => ({ e: (await p.store(P).readEvents()).length, s: JSON.stringify(await p.state(P, "bim")) });
const derived = (s: BimState) => canonicalJson(Object.values(s.elements).filter((e): e is SpatialElement => e.kind === "spatial").sort((a, b) => (a.id < b.id ? -1 : 1))
  .map((e) => { const r = resolveSpatialElement(new SpatialContext(s), e); return [e.id, r.status, r.regionSignature, r.area]; }));

test("P1 · a joined rectangle is exactly one region: area = w*d, perimeter = 2(w+d)", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.integer({ min: -50, max: 50 }), fc.integer({ min: -50, max: 50 }), dim, dim, async (x, y, w, d) => {
    const b = await base();
    await b.loop(rect(x, y, w, d));
    const rs = storeyRegions(await b.S(), await b.sid("L0"));
    assert.equal(rs.length, 1);
    assert.ok(close(rs[0].area, w * d) && close(rs[0].perimeter, 2 * (w + d)), `${rs[0].area} ${rs[0].perimeter}`);
  }), { seed: SEED, numRuns: runs(60) });
});

test("P2 · moving a boundary wall: same element and point, new derived region, replay equivalent", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(dim, dim, fc.double({ min: 0.1, max: 0.9, noNaN: true }), fc.double({ min: 0.1, max: 0.9, noNaN: true }), fc.integer({ min: -15, max: 30 }).map((v) => v / 10), fc.integer({ min: 1, max: 5 }),
    async (w, d, fx, fy, dx, every) => {
      const policy = { everyEvents: every, keep: 2 };
      const b = await base(policy);
      const ids = await b.loop(rect(0, 0, w, d));
      const px = Math.round(w * fx * 100) / 100, py = Math.round(d * fy * 100) / 100;
      fc.pre(w + dx - px > 0.05 && px > 0 && py > 0 && py < d);
      await b.ex("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: px, y: py }] });
      const before = (await b.S()).elements["SP-0001"];
      await b.ex("bim_move_elements", { ids: [ids[1]], vector: [dx, 0] });
      const s = await b.S();
      assert.deepEqual(s.elements["SP-0001"], before, "the room itself never changes");
      const r = resolveSpatialElement(new SpatialContext(s), s.elements["SP-0001"] as SpatialElement);
      assert.equal(r.status, "bounded");
      assert.ok(close(r.area!, (w + dx) * d), `${r.area} vs ${(w + dx) * d}`);
      const full = await new Platform({ modules: [bimModule], stores: b.stores, snapshotPolicy: false }).state<BimState>(P, "bim");
      const fromSnap = await new Platform({ modules: [bimModule], stores: b.stores, snapshotPolicy: policy, logger: quiet }).state<BimState>(P, "bim");
      assert.equal(canonicalJson(fromSnap), canonicalJson(full)); assert.equal(canonicalJson(s), canonicalJson(full));
      assert.equal(derived(fromSnap), derived(full));
    }), { seed: SEED, numRuns: runs(30) });
});

test("P3 · a tee-joined partition splits the region: the room resolves to one side, the other side is unoccupied", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(dim, dim, fc.double({ min: 0.1, max: 0.9, noNaN: true }), fc.double({ min: 0.05, max: 0.95, noNaN: true }), fc.double({ min: 0.1, max: 0.9, noNaN: true }),
    async (w, d, fa, fx, fy) => {
      const b = await base();
      const ids = await b.loop(rect(0, 0, w, d));
      const a = Math.round(w * fa * 100) / 100, px = Math.round(w * fx * 100) / 100, py = Math.round(d * fy * 100) / 100;
      fc.pre(Math.abs(px - a) > 0.01 && px > 0 && px < w && a > 0.01 && a < w - 0.01);
      await b.ex("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: px, y: py }] });
      await b.partition([a, 0], [a, d], ids[0], ids[2]);
      const s = await b.S(), ctx = new SpatialContext(s);
      const rs = ctx.storey(await b.sid("L0"));
      assert.equal(rs.length, 2);
      const r = resolveSpatialElement(ctx, s.elements["SP-0001"] as SpatialElement);
      assert.ok(close(r.area!, (px < a ? a : w - a) * d));
      const free = (await b.ex("bim_detect_spatial_regions", { include_occupied: false })).result.regions;
      assert.equal(free.length, 1);
      assert.ok(close(free[0].area, (px < a ? w - a : a) * d));
    }), { seed: SEED, numRuns: runs(30) });
});

test("P4 · unjoining any corner opens the region even though the coordinates still coincide (touching is not joining)", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(dim, dim, fc.nat(3), async (w, d, k) => {
    const b = await base();
    const ids = await b.loop(rect(0, 0, w, d));
    await b.ex("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: w / 2, y: d / 2 }] });
    const s0 = await b.S();
    const j = Object.values(s0.joins).find((x: any) => x.members.some((m: any) => m.wall === ids[k] && m.endpoint === "end"))!;
    await b.ex("bim_unjoin_walls", { join: j.id });
    const s = await b.S();
    for (const i of ids) assert.deepEqual([(s.elements[i] as Wall).start, (s.elements[i] as Wall).end], [(s0.elements[i] as Wall).start, (s0.elements[i] as Wall).end], "nothing moved");
    assert.equal(storeyRegions(s, await b.sid("L0")).length, 0);
    assert.equal(resolveSpatialElement(new SpatialContext(s), s.elements["SP-0001"] as SpatialElement).status, "unbounded");
  }), { seed: SEED, numRuns: runs(30) });
});

test("P5 · two elements of the same category can never share a region; different categories can", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(dim, dim, fc.tuple(fc.double({ min: 0.05, max: 0.95, noNaN: true }), fc.double({ min: 0.05, max: 0.95, noNaN: true })),
    fc.tuple(fc.double({ min: 0.05, max: 0.95, noNaN: true }), fc.double({ min: 0.05, max: 0.95, noNaN: true })), fc.constantFrom("architecture.room", "mechanical.space"),
    async (w, d, [ax, ay], [bx, by], cat) => {
      const b = await base();
      await b.loop(rect(0, 0, w, d));
      await b.ex("bim_create_spatial_elements", { items: [{ category: cat, storey: "L0", x: w * ax, y: d * ay }] });
      const before = await snap(b.p);
      const err = await b.ex("bim_create_spatial_elements", { items: [{ category: cat, storey: "L0", x: w * bx, y: d * by }] }).then(() => null, (e) => e);
      assert.equal(err?.reason, "SPATIAL_REGION_OCCUPIED");
      assert.deepEqual(await snap(b.p), before);
      const other = cat === "architecture.room" ? "mechanical.space" : "architecture.room";
      await b.ex("bim_create_spatial_elements", { items: [{ category: other, storey: "L0", x: w * bx, y: d * by }] });
    }), { seed: SEED, numRuns: runs(30) });
});

test("P6 · regions do not depend on join creation order, record order or join member order", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.array(fc.nat(), { minLength: 12, maxLength: 12 }), fc.array(fc.nat(), { minLength: 30, maxLength: 30 }), async (order, perm) => {
    const build = async (joinOrder: number[]) => {
      const b = await base();
      const a = await b.loopWalls(rect(0, 0, 10, 6)), c = await b.loopWalls(rect(5, 1.5, 2, 2)), e = await b.loopWalls(rect(20, 0, 4, 4));
      const corners: [string[], number][] = [...a.map((_, k) => [a, k] as [string[], number]), ...c.map((_, k) => [c, k] as [string[], number]), ...e.map((_, k) => [e, k] as [string[], number])];
      for (const i of joinOrder) await b.joinCorner(corners[i][0], corners[i][1]);
      return { s: await b.S(), L0: await b.sid("L0") };
    };
    const shuffled = [...Array(12).keys()].map((i) => [order[i], i]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map((x) => x[1]);
    const A = await build([...Array(12).keys()]), B = await build(shuffled);
    const key = (s: BimState, L0: string) => JSON.stringify(storeyRegions(s, L0).map((r) => [r.signature, r.area, r.perimeter, r.holes.length]));
    assert.equal(key(B.s, B.L0), key(A.s, A.L0), "join creation order");
    const mix = <T>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).map((x, i) => [perm[i % perm.length] * 100 + i, x] as const).sort((p, q) => p[0] - q[0]).map((x) => x[1]));
    const s2 = { ...structuredClone(A.s), elements: mix(A.s.elements), joins: Object.fromEntries(Object.entries(mix(A.s.joins)).map(([k, j]: [string, any]) =>
      [k, j.kind === "endpoint_endpoint" ? { ...j, members: [...j.members].reverse() } : j])) } as BimState;
    assert.equal(key(s2, A.L0), key(A.s, A.L0), "record and member order");
  }), { seed: SEED, numRuns: runs(15) });
});

test("P7 · identical loops on two storeys stay independent: an L0 room never uses L1 walls", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(dim, dim, fc.nat(3), async (w, d, k) => {
    const b = await base();
    const l0 = await b.loop(rect(0, 0, w, d), "L0"), l1 = await b.loop(rect(0, 0, w, d), "L1");
    await b.ex("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: w / 2, y: d / 2 }, { category: "architecture.room", storey: "L1", x: w / 2, y: d / 2 }] });
    const j = Object.values((await b.S()).joins).find((x: any) => x.members?.some((m: any) => m.wall === l0[k] && m.endpoint === "end"))!;
    await b.ex("bim_unjoin_walls", { join: j.id });
    const s = await b.S(), ctx = new SpatialContext(s);
    const r0 = resolveSpatialElement(ctx, s.elements["SP-0001"] as SpatialElement), r1 = resolveSpatialElement(ctx, s.elements["SP-0002"] as SpatialElement);
    assert.equal(r0.status, "unbounded", "the open L0 loop is not closed by the L1 walls above it");
    assert.equal(r1.status, "bounded");
    assert.ok(r1.boundaryWalls.every((x) => l1.includes(x)));
  }), { seed: SEED, numRuns: runs(20) });
});

test("P8 · tees cut the host virtually: correct regions, host wall unchanged, parametric boundary references", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(dim, dim, fc.uniqueArray(fc.integer({ min: 1, max: 19 }), { minLength: 1, maxLength: 3 }), async (w, d, cuts) => {
    const b = await base();
    const ids = await b.loop(rect(0, 0, w, d));
    const host = structuredClone((await b.S()).elements[ids[0]]);
    const xs = [...cuts].sort((a, c) => a - c).map((c) => Math.round((w * c) / 20 * 100) / 100);
    fc.pre(new Set(xs).size === xs.length && xs.every((x) => x > 0.01 && x < w - 0.01));
    for (const x of xs) await b.partition([x, 0], [x, d], ids[0], ids[2]);
    const s = await b.S();
    assert.deepEqual(s.elements[ids[0]], host, "host wall never split or changed");
    const rs = storeyRegions(s, await b.sid("L0"));
    assert.equal(rs.length, xs.length + 1);
    assert.ok(close(rs.reduce((a, r) => a + r.area, 0), w * d));
    const tees = (s.joins ? Object.values(s.joins) : []).filter((j: any) => j.kind === "endpoint_segment" && j.host === ids[0]).map((j: any) => j.t);
    for (const t2 of tees) assert.ok(rs.some((r) => r.boundarySegments.some((x) => x.wallId === ids[0] && (x.fromT === t2 || x.toT === t2))), `cut at t=${t2}`);
  }), { seed: SEED, numRuns: runs(30) });
});

test("P9 · random spatial histories: live == full replay == snapshot + tail, including derived regions", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  const op = fc.oneof(
    fc.record({ t: fc.constant("room"), x: fc.integer({ min: 1, max: 9 }), y: fc.integer({ min: 1, max: 5 }), c: fc.boolean() }),
    fc.record({ t: fc.constant("east"), dx: fc.integer({ min: -2, max: 3 }) }), fc.record({ t: fc.constant("partition"), x: fc.integer({ min: 2, max: 8 }) }),
    fc.record({ t: fc.constant("toggle"), on: fc.boolean() }), fc.record({ t: fc.constant("moveRoom"), dx: fc.integer({ min: -3, max: 3 }) }),
    fc.record({ t: fc.constant("corner"), k: fc.nat(3) }), fc.record({ t: fc.constant("undo") }));
  await fc.assert(fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 9 }), fc.integer({ min: 1, max: 5 }), async (ops, every) => {
    const policy = { everyEvents: every, keep: 2 };
    const b = await base(policy);
    const ids = await b.loop(rect(0, 0, 10, 6));
    let part: string | null = null;
    for (const o of ops as any[]) {
      const s = await b.S();
      const rooms = Object.keys(s.elements).filter((i) => i.startsWith("SP-")).sort();
      const call =
        o.t === "room" ? b.ex("bim_create_spatial_elements", { items: [{ category: o.c ? "architecture.room" : "mechanical.space", storey: "L0", x: o.x + 0.5, y: o.y + 0.5, allow_unbounded: true }] })
        : o.t === "east" ? b.ex("bim_move_elements", { ids: [ids[1]], vector: [o.dx, 0] })
        : o.t === "partition" && !part ? b.partition([o.x + 0.25, 0], [o.x + 0.25, 6], ids[0], ids[2]).then((id) => { part = id; })
        : o.t === "toggle" && part && s.elements[part] ? b.ex("bim_update_elements", { items: [{ id: part, kind: "wall", set: { room_bounding: o.on } }] })
        : o.t === "moveRoom" && rooms.length ? b.ex("bim_move_elements", { ids: [rooms[0]], vector: [o.dx, 0] })
        : o.t === "corner" ? (async () => { const j = Object.values(s.joins).find((x: any) => x.kind === "endpoint_endpoint" && x.members.some((m: any) => m.wall === ids[o.k] && m.endpoint === "end"));
            return j ? b.ex("bim_unjoin_walls", { join: j.id }) : b.joinCorner(ids, o.k); })()
        : o.t === "undo" ? b.ex("platform_undo", {}) : Promise.resolve();
      await Promise.resolve(call).catch(() => undefined);
    }
    const full = await new Platform({ modules: [bimModule], stores: b.stores, snapshotPolicy: false }).state<BimState>(P, "bim");
    const fromSnap = await new Platform({ modules: [bimModule], stores: b.stores, snapshotPolicy: policy, logger: quiet }).state<BimState>(P, "bim");
    const live = await b.S();
    assert.equal(canonicalJson(fromSnap), canonicalJson(full)); assert.equal(canonicalJson(live), canonicalJson(full));
    assert.equal(derived(fromSnap), derived(full)); assert.equal(derived(live), derived(full));
  }), { seed: SEED, numRuns: runs(25) });
});

test("P10 · turning a partition off merges regions: refused atomically iff two same-category rooms would share it", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(dim, dim, fc.double({ min: 0.2, max: 0.8, noNaN: true }), fc.boolean(), fc.boolean(), fc.boolean(), async (w, d, fa, left, right, mixed) => {
    const b = await base();
    const ids = await b.loop(rect(0, 0, w, d));
    const a = Math.round(w * fa * 100) / 100;
    const part = await b.partition([a, 0], [a, d], ids[0], ids[2]);
    const items: any[] = [];
    if (left) items.push({ category: "architecture.room", storey: "L0", x: a / 2, y: d / 2 });
    if (right) items.push({ category: mixed ? "mechanical.space" : "architecture.room", storey: "L0", x: (a + w) / 2, y: d / 2 });
    if (items.length) await b.ex("bim_create_spatial_elements", { items });
    const before = await snap(b.p);
    const err = await b.ex("bim_update_elements", { items: [{ id: part, kind: "wall", set: { room_bounding: false } }] }).then(() => null, (e) => e);
    if (left && right && !mixed) { assert.equal(err?.reason, "SPATIAL_REGION_OCCUPIED"); assert.deepEqual(await snap(b.p), before); }
    else { assert.equal(err, null, String(err?.message)); assert.equal(storeyRegions(await b.S(), await b.sid("L0")).length, 1); }
  }), { seed: SEED, numRuns: runs(30) });
});
