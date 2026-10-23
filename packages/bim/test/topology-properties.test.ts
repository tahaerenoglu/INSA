/**
 * Phase 6 · property-based tests (fast-check) for wall topology.
 * Reproducible: FC_SEED (default 20261007), FC_RUNS_FACTOR for longer runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { Platform, MemoryStores, Actor, canonicalJson, PlatformLogger } from "@insa/core";
import { bimModule, BimState, Wall, teePoint, detectConnections, JOIN_TOLERANCE, r as round } from "../src/index.js";

const SEED = Number(process.env.FC_SEED ?? 20261007), FACTOR = Number(process.env.FC_RUNS_FACTOR ?? 1);
const runs = (n: number) => Math.max(1, Math.round(n * FACTOR));
const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "tprop";
const quiet: PlatformLogger = { info: () => {}, warn: () => {} };

async function base(policy: { everyEvents: number; keep: number } | false = false) {
  const stores = new MemoryStores();
  const p = new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet });
  await p.execute(user, P, "bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }] });
  await p.execute(user, P, "bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "m", thickness: 0.2 }] }, { kind: "window", name: "N", width: 0.8, height: 1 }] });
  const ex = (tool: string, input: unknown) => p.execute(user, P, tool, input) as Promise<any>;
  const walls = (segs: number[][][]) => ex("bim_create_walls", { walls: segs.map(([a, b]) => ({ storey: "L0", type: "W", start: a, end: b, height: 3 })) });
  return { p, stores, ex, walls };
}
const st = (p: Platform) => p.state<BimState>(P, "bim");
const snap = async (p: Platform) => ({ e: (await p.store(P).readEvents()).length, s: JSON.stringify(await st(p)) });
const view = async (x: Platform) => canonicalJson({ s: await x.state(P, "bim"), h: await x.history(P, 1e6) });
const wid = (i: number) => `W-${String(i + 1).padStart(4, "0")}`;
const ee = (a: string, ea: string, b: string, eb: string) => ({ kind: "endpoint_endpoint", endpoints: [{ wall: a, endpoint: ea }, { wall: b, endpoint: eb }] });
/** a zig-zag chain: strictly increasing x, so consecutive walls never fold back */
const chain = fc.array(fc.integer({ min: -4, max: 4 }), { minLength: 3, maxLength: 6 }).map((ys) => ys.map((y, i) => [i * 3, y] as [number, number]));
async function joinedChain(pts: [number, number][], policy: { everyEvents: number; keep: number } | false = false) {
  const b = await base(policy);
  await b.walls(pts.slice(1).map((q, i) => [pts[i], q]));
  for (let i = 0; i < pts.length - 2; i++) await b.ex("bim_join_walls", ee(wid(i), "end", wid(i + 1), "start"));
  return b;
}

test("P1 · moving a shared junction keeps every joined endpoint on one point; replay == snapshot + tail == live", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(chain, fc.nat(), fc.double({ min: -1, max: 1, noNaN: true }), fc.double({ min: -3, max: 3, noNaN: true }), fc.integer({ min: 1, max: 5 }),
    async (pts, k, dx, dy, every) => {
      const policy = { everyEvents: every, keep: 2 };
      const { p, stores, ex } = await joinedChain(pts, policy);
      const j = k % (pts.length - 2);                                     // junction between wall j and j+1, at pts[j+1]
      // + 0 normalises -0 (fast-check found dy = -5e-324 -> -0): coordinates compare numerically, -0 === 0
      const np: [number, number] = [round(pts[j + 1][0] + dx) + 0, round(pts[j + 1][1] + dy) + 0];
      await ex("bim_update_elements", { items: [{ id: wid(j), kind: "wall", set: { end: np } }] });
      const s = await st(p);
      for (const jn of Object.values(s.joins) as any[]) {
        const pts2 = jn.members.map((m: any) => (s.elements[m.wall] as any)[m.endpoint]);
        assert.ok(pts2.every((q: number[]) => q[0] === pts2[0][0] && q[1] === pts2[0][1]), `junction ${jn.id} split`);
      }
      assert.deepEqual((s.elements[wid(j + 1)] as Wall).start.map((v) => v + 0), np);
      const full = await view(new Platform({ modules: [bimModule], stores, snapshotPolicy: false }));
      assert.equal(await view(new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet })), full);
      assert.equal(await view(p), full);
    }), { seed: SEED, numRuns: runs(40) });
});

const pt = fc.tuple(fc.integer({ min: -20, max: 20 }), fc.integer({ min: -20, max: 20 })) as fc.Arbitrary<[number, number]>;
async function teeSetup(A: [number, number], B: [number, number], t: number) {
  const b = await base();
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const P0: [number, number] = [round(A[0] + t * (B[0] - A[0])), round(A[1] + t * (B[1] - A[1]))];
  const n: [number, number] = [-(B[1] - A[1]) / L, (B[0] - A[0]) / L];
  await b.walls([[A, B], [P0, [round(P0[0] + 2 * n[0]), round(P0[1] + 2 * n[1])]]]);
  await b.ex("bim_join_walls", { kind: "endpoint_segment", endpoint: { wall: "W-0002", endpoint: "start" }, host: "W-0001", t });
  return b;
}
const hostSpec = fc.tuple(pt, pt, fc.integer({ min: 10, max: 90 }).map((v) => v / 100)).filter(([A, B]) => Math.hypot(B[0] - A[0], B[1] - A[1]) >= 2);

test("P2 · after any host update the tee endpoint equals the host point at its t", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(hostSpec, pt, pt, async ([A, B, tt], A2, B2) => {
    fc.pre(Math.hypot(B2[0] - A2[0], B2[1] - A2[1]) >= 2);
    const { p, ex } = await teeSetup(A, B, tt);
    const other = ((await st(p)).elements["W-0002"] as Wall).end;
    const target = teePoint({ start: A2, end: B2 } as Wall, tt);
    fc.pre(Math.hypot(target[0] - other[0], target[1] - other[1]) > 0.5);
    await ex("bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { start: A2, end: B2 } }] });
    const s = await st(p);
    assert.deepEqual((s.elements["W-0002"] as Wall).start, teePoint(s.elements["W-0001"] as Wall, tt));
  }), { seed: SEED, numRuns: runs(60) });
});

test("P3 · moving a constrained tee endpoint on its own is always refused and changes nothing", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(hostSpec, fc.tuple(fc.double({ min: -5, max: 5, noNaN: true }), fc.double({ min: -5, max: 5, noNaN: true })), fc.boolean(),
    async ([A, B, tt], [dx, dy], viaMove) => {
      fc.pre(Math.hypot(dx, dy) > 2 * JOIN_TOLERANCE);
      const { p, ex } = await teeSetup(A, B, tt);
      const before = await snap(p);
      const cur = ((await st(p)).elements["W-0002"] as Wall).start;
      const err = await (viaMove ? ex("bim_move_elements", { ids: ["W-0002"], vector: [dx, dy] })
                                 : ex("bim_update_elements", { items: [{ id: "W-0002", kind: "wall", set: { start: [round(cur[0] + dx), round(cur[1] + dy)] } }] })).then(() => null, (e) => e);
      assert.equal(err?.reason, "CONSTRAINED_ENDPOINT", String(err?.message));
      assert.deepEqual(await snap(p), before);
    }), { seed: SEED, numRuns: runs(60) });
});

test("P4 · unjoin never moves a wall: coordinates before == after (only relation and miter data change)", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(chain, fc.nat(), async (pts, k) => {
    const { p, ex } = await joinedChain(pts);
    const coords = (s: BimState) => JSON.stringify(Object.values(s.elements).map((w: any) => [w.id, w.start, w.end]));
    const before = await st(p);
    const ids = Object.keys(before.joins).sort();
    await ex("bim_unjoin_walls", { join: ids[k % ids.length] });
    const after = await st(p);
    assert.equal(coords(after), coords(before));
    for (const id of Object.keys(after.elements)) {
      const { prevDir: _a, nextDir: _b, ...x } = after.elements[id] as any, { prevDir: _c, nextDir: _d, ...y } = before.elements[id] as any;
      assert.deepEqual(x, y);
    }
  }), { seed: SEED, numRuns: runs(40) });
});

test("P5 · candidate detection is deterministic and independent of storage iteration order", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  const seg = fc.tuple(fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 6 }))
    .filter(([a, b, c, d]) => a !== c || b !== d);
  await fc.assert(fc.asyncProperty(fc.array(seg, { minLength: 2, maxLength: 9 }), fc.array(fc.nat(), { minLength: 9, maxLength: 9 }), async (segs, perm) => {
    const { p, walls } = await base();
    await walls(segs.map(([a, b, c, d]) => [[a, b], [c, d]])).catch(() => null);
    const s = await st(p);
    fc.pre(Object.keys(s.elements).length > 1);
    const entries = Object.entries(s.elements);
    const shuffled = entries.map((e, i) => [perm[i % perm.length] * 1000 + i, e] as const).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
    const s2 = { ...structuredClone(s), elements: Object.fromEntries(shuffled) } as BimState;
    const a = detectConnections(s, { maxResults: 1000 }), b = detectConnections(s2, { maxResults: 1000 });
    assert.equal(JSON.stringify(a), JSON.stringify(b));
    assert.equal(JSON.stringify(detectConnections(s, { maxResults: 1000 })), JSON.stringify(a));
  }), { seed: SEED, numRuns: runs(100) });
});

test("P6 · the connected component of any wall is exactly its explicitly joined chain", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 1, maxLength: 4 }), fc.nat(), async (lens, pick) => {
    const { ex, walls } = await base();
    const segs: number[][][] = [], chains: string[][] = [];
    let n = 0;
    lens.forEach((len, c) => {                                            // chain c at y = 10c, len walls, plus near-touching walls of other chains never joined
      const ids: string[] = [];
      for (let k = 0; k < len; k++) { segs.push([[k * 3, c * 10], [k * 3 + 3, c * 10 + (k % 2)]]); ids.push(wid(n++)); }
      chains.push(ids);
    });
    // make consecutive walls share endpoints exactly, then join them
    for (const ids of chains) for (let k = 1; k < ids.length; k++) segs[Number(ids[k].slice(2)) - 1][0] = segs[Number(ids[k - 1].slice(2)) - 1][1];
    await walls(segs);
    for (const ids of chains) for (let k = 1; k < ids.length; k++) await ex("bim_join_walls", ee(ids[k - 1], "end", ids[k], "start"));
    const all = chains.flat(), q = all[pick % all.length];
    const res = await ex("bim_query_wall_topology", { component_of: q });
    assert.deepEqual(res.result.component.walls, chains.find((c) => c.includes(q))!.slice().sort());
  }), { seed: SEED, numRuns: runs(40) });
});

test("P7 · deleting a wall with joins or openings is refused atomically; without usages it succeeds", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.boolean(), fc.boolean(), fc.integer({ min: 0, max: 2 }), async (joinStart, joinEnd, openings) => {
    const { p, ex, walls } = await base();
    await walls([[[0, 0], [8, 0]], [[0, 0], [0, 5]], [[8, 0], [8, 5]]]);
    if (joinStart) await ex("bim_join_walls", ee("W-0001", "start", "W-0002", "start"));
    if (joinEnd) await ex("bim_join_walls", ee("W-0001", "end", "W-0003", "start"));
    for (let k = 0; k < openings; k++) await ex("bim_place_openings", { items: [{ kind: "opening", host: "W-0001", along: 2 + k * 3, width: 1, height: 1 }] });
    const used = Number(joinStart) + Number(joinEnd) + openings;
    const before = await snap(p);
    const err = await ex("bim_delete_elements", { ids: ["W-0001"] }).then(() => null, (e) => e);
    if (used) { assert.equal(err?.reason, "ELEMENT_IN_USE"); assert.equal(err.details.usageCount, used); assert.deepEqual(await snap(p), before); }
    else assert.equal(err, null);
  }), { seed: SEED, numRuns: runs(60) });
});

test("P8 · random topology command sequences: live == full replay == snapshot + tail", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  const op = fc.oneof(
    fc.record({ t: fc.constant("join"), i: fc.nat() }), fc.record({ t: fc.constant("unjoin"), i: fc.nat() }),
    fc.record({ t: fc.constant("move"), i: fc.nat(), dx: fc.integer({ min: -2, max: 2 }), dy: fc.integer({ min: -2, max: 2 }) }),
    fc.record({ t: fc.constant("end"), i: fc.nat(), x: fc.integer({ min: -2, max: 20 }), y: fc.integer({ min: -6, max: 6 }) }),
    fc.record({ t: fc.constant("undo") }));
  await fc.assert(fc.asyncProperty(chain, fc.array(op, { minLength: 1, maxLength: 10 }), fc.integer({ min: 1, max: 5 }), async (pts, ops, every) => {
    const policy = { everyEvents: every, keep: 2 };
    const b = await base(policy);
    await b.walls(pts.slice(1).map((q, i) => [pts[i], q]));
    const nW = pts.length - 1;
    for (const o of ops as any[]) {
      const k = (o.i ?? 0) % nW;
      const call = o.t === "join" && k < nW - 1 ? b.ex("bim_join_walls", ee(wid(k), "end", wid(k + 1), "start"))
        : o.t === "unjoin" ? b.ex("bim_unjoin_walls", { endpoint: { wall: wid(k), endpoint: "end" } })
        : o.t === "move" ? b.ex("bim_move_elements", { ids: [wid(k)], vector: [o.dx, o.dy] })
        : o.t === "end" ? b.ex("bim_update_elements", { items: [{ id: wid(k), kind: "wall", set: { end: [o.x, o.y] } }] })
        : o.t === "undo" ? b.ex("platform_undo", {}) : Promise.resolve();
      await call.catch(() => undefined);                                    // rejected commands are part of the history being tested
    }
    const full = await view(new Platform({ modules: [bimModule], stores: b.stores, snapshotPolicy: false }));
    assert.equal(await view(new Platform({ modules: [bimModule], stores: b.stores, snapshotPolicy: policy, logger: quiet })), full);
    assert.equal(await view(b.p), full);
  }), { seed: SEED, numRuns: runs(30) });
});
