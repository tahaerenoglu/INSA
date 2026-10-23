/**
 * Phase 2 · property-based tests (fast-check).
 *
 * Reproducible by default: fixed seed (FC_SEED, default below), fixed run counts.
 * Extended run:  FC_SEED=<n> FC_RUNS_FACTOR=20 npm test
 * On failure fast-check reports the seed, the path and the shrunk counterexample;
 * the seed is also written to each test's diagnostics.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { Platform, MemoryStores, Actor } from "@insa/core";
import {
  bimModule, BimState, GEOMETRY_EPSILON as E, polygonProblem, polygonSignedArea, polygonArea, distance2D, validateCommand, Pt,
} from "../src/index.js";

const SEED = Number(process.env.FC_SEED ?? 20261007);
const FACTOR = Number(process.env.FC_RUNS_FACTOR ?? 1);
const runs = (n: number) => Math.max(1, Math.round(n * FACTOR));
/** fc.assert with the shared seed; the seed is recorded in the test diagnostics. */
async function check(t: { diagnostic(m: string): void }, prop: fc.IProperty<any> | fc.IAsyncProperty<any>, numRuns: number) {
  t.diagnostic(`fast-check seed=${SEED} numRuns=${numRuns}`);
  await fc.assert(prop as any, { seed: SEED, numRuns });
}

const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "pbt";

/** A fresh platform with a storey and one type of each kind. */
async function base() {
  const p = new Platform({ modules: [bimModule], stores: new MemoryStores() });
  await p.execute(user, P, "bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }] });
  await p.execute(user, P, "bim_create_types", { types: [
    { kind: "wall", name: "W", layers: [{ material: "m", thickness: 0.2 }] }, { kind: "slab", name: "S", layers: [{ material: "m", thickness: 0.2 }] },
    { kind: "beam", name: "B", profile: { shape: "rect", b: 0.3, h: 0.5 } }] });
  return p;
}
const exec = (p: Platform, tool: string, input: unknown) =>
  p.execute(user, P, tool, input).then(() => ({ ok: true as const }), (e: any) => ({ ok: false as const, reason: String(e.reason) }));
const snapshot = async (p: Platform) => ({ events: (await p.store(P).readEvents()).length, state: JSON.stringify(await p.state<BimState>(P, "bim")) });
const st = (p: Platform) => p.state<BimState>(P, "bim");

const coord = fc.double({ min: -5000, max: 5000, noNaN: true, noDefaultInfinity: true });
const point = fc.tuple(coord, coord) as fc.Arbitrary<[number, number]>;
const tiny = fc.double({ min: -E / 3, max: E / 3, noNaN: true });                  // |offset| <= E/3 per axis -> length <= 0.48 E
const offset = fc.oneof(
  fc.tuple(tiny, tiny),                                                              // degenerate band
  fc.tuple(fc.double({ min: -200, max: 200, noNaN: true }), fc.double({ min: -200, max: 200, noNaN: true })));

// ------------------------------------------------------------------ 1 + 2 + 5: length invariants of walls and beams
for (const [kind, tool, mk] of [
  ["wall", "bim_create_walls", (a: Pt, b: Pt) => ({ walls: [{ storey: "00", type: "W", start: a, end: b, height: 3 }] })],
  ["beam", "bim_create_beams", (a: Pt, b: Pt) => ({ beams: [{ storey: "00", type: "B", start: a, end: b }] })],
] as const) {
  test(`P1/P2/P5 · every accepted ${kind} is longer than GEOMETRY_EPSILON; degenerate ${kind}s are always rejected`, async (t) => {
    await check(t, fc.asyncProperty(point, offset, async (a, [dx, dy]) => {
      // Length validity is independent of collisions with previous random samples.
      const p = await base();
      const b: [number, number] = [a[0] + dx, a[1] + dy];
      const len = distance2D(a, b);
      const before = await snapshot(p);
      const r = await exec(p, tool, mk(a, b));
      if (len <= E / 2) { assert.equal(r.ok, false); assert.equal((r as any).reason, "DEGENERATE_GEOMETRY"); assert.deepEqual(await snapshot(p), before); }
      if (len >= 2 * E) assert.equal(r.ok, true, JSON.stringify(r));
      for (const el of Object.values((await st(p)).elements))
        if (el.kind === kind) assert.ok(distance2D((el as any).start, (el as any).end) > E, `stored ${el.id} too short`);
    }), runs(150));
  });

  test(`P5 · start = end (exact) is rejected for ${kind}s, on create and on update`, async (t) => {
    const p = await base();
    await exec(p, tool, mk([0, 0], [5, 0]));
    const id = kind === "wall" ? "W-0001" : "B-0001";
    await check(t, fc.asyncProperty(point, async (a) => {
      const before = await snapshot(p);
      assert.equal((await exec(p, tool, mk(a, a))).ok, false);
      const r = await exec(p, "bim_update_elements", { items: [{ id, kind, set: { start: a, end: a } }] });
      assert.equal(r.ok, false); assert.equal((r as any).reason, "DEGENERATE_GEOMETRY");
      assert.deepEqual(await snapshot(p), before);
    }), runs(60));
  });
}

// ------------------------------------------------------------------ 3: rectangles
test("P3 · every axis-aligned rectangle larger than the tolerance is a valid simple polygon with area w·h", async (t) => {
  const size = fc.double({ min: 10 * E, max: 1000, noNaN: true });
  await check(t, fc.property(point, size, size, ([x, y], w, h) => {
    const r: Pt[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
    assert.equal(polygonProblem(r), null);
    const a = polygonArea(r);
    assert.ok(a > 0 && Math.abs(a - w * h) <= 1e-9 * Math.max(1, Math.abs(x) + Math.abs(y) + w + h) ** 2, `${a} vs ${w * h}`);
  }), runs(300));
});

// ------------------------------------------------------------------ 4: reversal (controlled generator of simple star-shaped polygons)
const starPolygon = fc.integer({ min: 4, max: 14 }).chain((k) => fc.tuple(
  point, fc.array(fc.double({ min: -0.25, max: 0.25, noNaN: true }), { minLength: k, maxLength: k }),
  fc.array(fc.double({ min: 1, max: 50, noNaN: true }), { minLength: k, maxLength: k }),
).map(([c, jit, rad]) => jit.map((j, i) => {
  const ang = ((i + j) * 2 * Math.PI) / k;                    // strictly increasing angles, gaps in (0.5, 1.5)·2π/k < π
  return [c[0] + rad[i] * Math.cos(ang), c[1] + rad[i] * Math.sin(ang)] as Pt;
})));
test("P4 · reversing a valid simple polygon keeps it valid, keeps |area| and flips the sign", async (t) => {
  await check(t, fc.property(starPolygon, (poly) => {
    assert.equal(polygonProblem(poly), null, JSON.stringify(poly));
    const rev = [...poly].reverse();
    assert.equal(polygonProblem(rev), null);
    const a = polygonSignedArea(poly), b = polygonSignedArea(rev);
    assert.ok(Math.abs(Math.abs(a) - Math.abs(b)) <= 1e-9 * Math.abs(a));
    assert.ok(Math.sign(a) === -Math.sign(b) && a !== 0);
  }), runs(300));
});

// ------------------------------------------------------------------ 6 + 9: rejected mutations, host shrink
const wallSpec = fc.record({ L: fc.double({ min: 3, max: 40, noNaN: true }), H: fc.double({ min: 2.5, max: 6, noNaN: true }),
                             ang: fc.double({ min: 0, max: 2 * Math.PI, noNaN: true, maxExcluded: true }) });
async function wallWithOpening(w: { L: number; H: number; ang: number }, o: { u: number; width: number; height: number; sillU: number }) {
  const p = await base();
  const end: [number, number] = [w.L * Math.cos(w.ang), w.L * Math.sin(w.ang)];
  await p.execute(user, P, "bim_create_walls", { walls: [{ storey: "00", type: "W", start: [0, 0], end, height: w.H }] });
  const L = distance2D([0, 0], ((await st(p)).elements["W-0001"] as any).end);
  const width = Math.min(o.width, L - 0.1), height = Math.min(o.height, w.H - 0.1);
  const along = width / 2 + o.u * (L - width), sill = o.sillU * (w.H - height);
  return { p, L, end, width, height, along, sill };
}
const openingSpec = fc.record({ u: fc.double({ min: 0, max: 1, noNaN: true }), width: fc.double({ min: 0.2, max: 3, noNaN: true }),
                                height: fc.double({ min: 0.2, max: 2.4, noNaN: true }), sillU: fc.double({ min: 0, max: 1, noNaN: true }) });

test("P8 · openings inside the wall extents are accepted; pushed beyond the host they are rejected", async (t) => {
  await check(t, fc.asyncProperty(wallSpec, openingSpec, fc.double({ min: 2 * E, max: 5, noNaN: true }), async (w, o, beyond) => {
    const g = await wallWithOpening(w, o);
    const place = (x: Record<string, number>) => exec(g.p, "bim_place_openings", { items: [{ kind: "opening", host: "W-0001", along: g.along, width: g.width, height: g.height, sill: g.sill, ...x }] });
    const before = await snapshot(g.p);
    for (const bad of [{ along: g.L - g.width / 2 + beyond }, { along: g.width / 2 - beyond }, { sill: w.H - g.height + beyond }]) {
      const r = await place(bad);
      assert.equal(r.ok, false, JSON.stringify(bad)); assert.equal((r as any).reason, "INVALID_HOST_RELATION");
    }
    assert.deepEqual(await snapshot(g.p), before);
    assert.equal((await place({})).ok, true);
  }), runs(40));
});

test("P6/P9 · shortening a wall so its opening no longer fits is rejected and nothing changes; other invalid mutations too", async (t) => {
  await check(t, fc.asyncProperty(wallSpec, openingSpec, fc.double({ min: 0.05, max: 0.95, noNaN: true }), fc.integer({ min: 0, max: 3 }), async (w, o, keep, which) => {
    const g = await wallWithOpening(w, o);
    assert.equal((await exec(g.p, "bim_place_openings", { items: [{ kind: "opening", host: "W-0001", along: g.along, width: g.width, height: g.height, sill: g.sill }] })).ok, true);
    const before = await snapshot(g.p);
    const reach = g.along + g.width / 2;                                               // the opening needs the wall to be at least this long
    const newLen = Math.max(10 * E, (reach - 2 * E) * keep);
    const dir = [g.end[0] / g.L, g.end[1] / g.L];
    const mutations = [
      { tool: "bim_update_elements", input: { items: [{ id: "W-0001", kind: "wall", set: { end: [dir[0] * newLen, dir[1] * newLen] } }] }, reason: "DEPENDENT_ELEMENT_INVALID" },
      { tool: "bim_update_elements", input: { items: [{ id: "W-0001", kind: "wall", set: { height: Math.max(10 * E, (g.sill + g.height - 2 * E) * keep) } }] }, reason: "DEPENDENT_ELEMENT_INVALID" },
      { tool: "bim_update_elements", input: { items: [{ id: "W-0001", kind: "wall", set: { end: [0, 0] } }] }, reason: "DEGENERATE_GEOMETRY" },
      { tool: "bim_update_elements", input: { items: [{ id: "O-0001", kind: "opening", set: { width: g.L + 1 } }] }, reason: "INVALID_HOST_RELATION" },
    ];
    const m = mutations[which];
    const r = await exec(g.p, m.tool, m.input);
    assert.equal(r.ok, false); assert.equal((r as any).reason, m.reason);
    assert.deepEqual(await snapshot(g.p), before);
  }), runs(40));
});

// ------------------------------------------------------------------ 7: batch atomicity
test("P7 · a batch with exactly one invalid item at a random position commits nothing", async (t) => {
  const spec = fc.integer({ min: 2, max: 6 }).chain((n) => fc.record({
    n: fc.constant(n), heights: fc.array(fc.double({ min: 2.5, max: 5, noNaN: true }), { minLength: n, maxLength: n }),
    bad: fc.integer({ min: 0, max: n - 1 }), badKind: fc.integer({ min: 0, max: 2 }) }));
  await check(t, fc.asyncProperty(spec, async ({ n, heights, bad, badKind }) => {
    const p = await base();
    await p.execute(user, P, "bim_create_walls", { walls: Array.from({ length: n }, (_, i) => ({ storey: "00", type: "W", start: [0, i * 3], end: [8, i * 3], height: 3 })) });
    const before = await snapshot(p);
    const items: any[] = heights.map((h, i) => ({ id: `W-000${i + 1}`, kind: "wall", set: { height: h } }));
    items[bad] = [{ ...items[bad], set: { end: [0, bad * 3] } },                       // zero length
                  { ...items[bad], set: { storey: "ST-0001" } },                         // immutable field
                  { ...items[bad], kind: "beam", set: { z: 1 } }][badKind];              // kind mismatch
    const r = await exec(p, "bim_update_elements", { items });
    assert.equal(r.ok, false);
    assert.deepEqual(await snapshot(p), before);
    const s = await st(p);
    for (let i = 0; i < n; i++) assert.equal((s.elements[`W-000${i + 1}`] as any).height, 3);
  }), runs(40));
});

// ------------------------------------------------------------------ 10: determinism (validation and replay)
test("P10 · polygon validation is deterministic and side-effect free", async (t) => {
  const anyPoly = fc.array(fc.tuple(fc.integer({ min: -4, max: 4 }), fc.integer({ min: -4, max: 4 })), { minLength: 3, maxLength: 8 });
  await check(t, fc.property(anyPoly, (raw) => {
    const poly = raw as Pt[];
    const copy = structuredClone(poly);
    const first = polygonProblem(poly);
    for (let k = 0; k < 3; k++) assert.deepEqual(polygonProblem(poly), first);
    assert.deepEqual(polygonProblem(structuredClone(poly)), first);
    assert.deepEqual(poly, copy, "input not mutated");
  }), runs(500));
});

test("P10 · command validation and event replay are deterministic", async (t) => {
  const cmd = fc.oneof(
    fc.record({ tool: fc.constant("wall"), a: point, b: point, h: fc.double({ min: -1, max: 5, noNaN: true }) }),
    fc.record({ tool: fc.constant("slab"), pts: fc.array(fc.tuple(fc.integer({ min: 0, max: 6 }), fc.integer({ min: 0, max: 6 })), { minLength: 3, maxLength: 6 }) }));
  await check(t, fc.asyncProperty(fc.array(cmd, { minLength: 1, maxLength: 6 }), async (cmds) => {
    const stores = new MemoryStores();
    const p = new Platform({ modules: [bimModule], stores });
    await p.execute(user, P, "bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }] });
    await p.execute(user, P, "bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "m", thickness: 0.2 }] }, { kind: "slab", name: "S", layers: [{ material: "m", thickness: 0.2 }] }] });
    for (const c of cmds) {
      const input = c.tool === "wall" ? { walls: [{ storey: "00", type: "W", start: (c as any).a, end: (c as any).b, height: (c as any).h }] }
                                      : { slabs: [{ storey: "00", type: "S", outline: (c as any).pts }] };
      const tool = c.tool === "wall" ? "bim_create_walls" : "bim_create_slabs";
      // the same command decided twice on the same state gives the same outcome
      const s0 = structuredClone(await st(p));
      const r1 = await exec(p, tool, input, );
      if (!r1.ok) assert.deepEqual(await exec(p, tool, input), r1);
      else assert.ok(JSON.stringify(s0) !== JSON.stringify(await st(p)));
    }
    const replayed = new Platform({ modules: [bimModule], stores });                 // rebuilt purely from the event log
    assert.equal(JSON.stringify(await replayed.state<BimState>(P, "bim")), JSON.stringify(await st(p)));
    const s = await st(p), empty = structuredClone(s);
    empty.elements = {};
    const outcome = () => { try { validateCommand(s, empty); return "ok"; } catch (e: any) { return e.reason; } };
    assert.equal(outcome(), outcome());
    assert.equal(outcome(), "ok", "every committed element passes the invariants");
  }), runs(40));
});
