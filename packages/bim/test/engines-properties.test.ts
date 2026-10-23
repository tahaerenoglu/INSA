/**
 * Phase 9 · property-based tests (fast-check) for the universal engines and the legacy migration.
 * Reproducible: FC_SEED (default 20261007), FC_RUNS_FACTOR for longer runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { Platform, MemoryStores, Actor, canonicalJson, PlatformLogger, NewEvent } from "@insa/core";
import { bimModule, BimState, Element, engineIdOfElement, engineOfKind, getCategory, categoryIdOfElement, quantities, resolveElementRepresentation, registerCategory, toIfc } from "../src/index.js";

const SEED = Number(process.env.FC_SEED ?? 20261007), FACTOR = Number(process.env.FC_RUNS_FACTOR ?? 1);
const runs = (n: number) => Math.max(1, Math.round(n * FACTOR));
const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "eprop";
const quiet: PlatformLogger = { info: () => {}, warn: () => {} };
registerCategory({ id: "structure.test_strut", name: "Test Struts", discipline: "structure", engine: "profile_member", placements: ["member_axis"], typeKinds: ["beam"], capabilities: ["hasType", "movable"] });

async function base(policy: { everyEvents: number; keep: number } | false = false, stores = new MemoryStores()) {
  const p = new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet });
  const ex = (tool: string, input: unknown) => p.execute(user, P, tool, input) as Promise<any>;
  await ex("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3 }] });
  await ex("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "m", thickness: 0.2 }] }, { kind: "slab", name: "D", layers: [{ material: "c", thickness: 0.25 }] },
    { kind: "column", name: "C", profile: { shape: "rect", b: 0.4, h: 0.5 } }, { kind: "column", name: "CR", profile: { shape: "circle", d: 0.3 } },
    { kind: "beam", name: "B", profile: { shape: "rect", b: 0.3, h: 0.5 } }, { kind: "door", name: "K", width: 1, height: 2.1 }, { kind: "window", name: "N", width: 1, height: 1.2 }] });
  const s = await p.state<BimState>(P, "bim");
  const L0 = Object.values(s.storeys).find((x) => x.name === "L0")!.id;
  const T = (n: string) => Object.values(s.types).find((x) => x.name === n)!.id;
  /** appends a command of raw LEGACY (pre-Phase-9) events, exactly as Phase 8 stored them */
  const legacy = async (events: { type: string; payload: unknown; v: number }[], cmd = `CMD-l${Math.random().toString(36).slice(2)}`) => {
    const st = stores.project(P), b = { commandId: cmd, actor: "old", at: "2026-01-01T00:00:00.000Z" };
    await st.appendEvents([{ ...b, module: "platform", type: "CommandApplied", payload: { tool: "legacy", summary: {} }, schemaVersion: 1 } as NewEvent,
      ...events.map((e) => ({ ...b, module: "bim", type: e.type, payload: e.payload, schemaVersion: e.v }) as NewEvent)], await st.lastSeq());
  };
  return { p, stores, ex, L0, T, legacy, S: () => p.state<BimState>(P, "bim") };
}
const replay = (stores: MemoryStores, policy: { everyEvents: number; keep: number } | false = false) =>
  new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet }).state<BimState>(P, "bim");
const els = (s: BimState, ids: string[]) => canonicalJson(ids.map((id) => s.elements[id]));
const dim = fc.integer({ min: 5, max: 80 }).map((v) => v / 10);
const pt = fc.tuple(fc.integer({ min: -20, max: 20 }), fc.integer({ min: -20, max: 20 })) as fc.Arbitrary<[number, number]>;

test("P1 · every element's engine is its category's engine and its variant's owner; no engine is stored", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.array(fc.constantFrom("beam", "column", "strut", "slab", "wall"), { minLength: 1, maxLength: 6 }), async (kinds) => {
    const b = await base();
    for (const [i, k] of kinds.entries()) {
      if (k === "beam" || k === "strut") await b.ex("bim_create_profile_members", { members: [{ category: k === "beam" ? "structure.framing" : "structure.test_strut", storey: "L0", type: "B", start: [i * 3, 0], end: [i * 3 + 2, 1], z: 2.5 }] });
      if (k === "column") await b.ex("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "C", at: [i * 3, 5], height: 2.5 }] });
      if (k === "slab") await b.ex("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L0", type: "D", outline: [[i * 3, 10], [i * 3 + 2, 10], [i * 3 + 1, 12]] }] });
      if (k === "wall") await b.ex("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [i * 3, 20], end: [i * 3 + 2, 20], height: 3 }] });
    }
    const s = await b.S();
    for (const el of Object.values(s.elements) as Element[]) {
      const viaCategory = getCategory(categoryIdOfElement(s, el)!).engine;
      assert.equal(engineIdOfElement(s, el), viaCategory);
      assert.equal(engineOfKind(el.kind)!.id, viaCategory, el.id);
      assert.equal("engine" in el, false);
    }
  }), { seed: SEED, numRuns: runs(30) });
});

test("P2 · a legacy (Phase 8) beam / column history and the canonical profile_member commands give identical elements and quantities", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(pt, pt, dim, pt, dim, fc.integer({ min: -180, max: 180 }), fc.integer({ min: 0, max: 5 }).map((v) => v / 10), fc.boolean(), async (a, b2, z, at, h, rot, off, circle) => {
    fc.pre(a[0] !== b2[0] || a[1] !== b2[1]);
    const L = await base(), N = await base();
    await L.legacy([{ type: "ElementCreated", v: 2, payload: { id: "B-0001", kind: "beam", storey: L.L0, type: L.T("B"), start: a, end: b2, z, vertical: { mode: "fixed" } } },
                    { type: "ElementCreated", v: 2, payload: { id: "C-0001", kind: "column", storey: L.L0, type: L.T(circle ? "CR" : "C"), at, height: h, baseOffset: off, rotation: rot, vertical: { mode: "fixed" } } }]);
    await N.ex("bim_create_profile_members", { members: [{ category: "structure.framing", storey: "L0", type: "B", start: a, end: b2, z },
      { category: "structure.column", storey: "L0", type: circle ? "CR" : "C", at, height: h, base_offset: off, rotation: rot }] });
    const ls = await replay(L.stores), ns = await N.S();
    assert.equal(els(ls, ["B-0001", "C-0001"]), els(ns, ["B-0001", "C-0001"]));
    for (const id of ["B-0001", "C-0001"]) assert.equal(canonicalJson(quantities(ls, ls.elements[id])), canonicalJson(quantities(ns, ns.elements[id])));
    // the legacy oracle (Phase 8 formulas): section area x length / height
    const sec = (pr: any) => (pr.shape === "rect" ? pr.b * pr.h : Math.PI * (pr.d / 2) ** 2);
    assert.ok(Math.abs(quantities(ns, ns.elements["B-0001"]).volume - 0.15 * Math.hypot(b2[0] - a[0], b2[1] - a[1])) < 1e-9);
    assert.ok(Math.abs(quantities(ns, ns.elements["C-0001"]).volume - sec((ns.types[ns.elements["C-0001"].type!] as any).profile) * h) < 1e-12);
  }), { seed: SEED, numRuns: runs(40) });
});

const poly = fc.tuple(fc.integer({ min: 2, max: 12 }), fc.integer({ min: 2, max: 12 }), fc.boolean(), fc.boolean())
  .map(([w, d, tri, hole]) => ({ outline: (tri ? [[0, 0], [w, 0], [w / 2, d]] : [[0, 0], [w, 0], [w, d], [0, d]]) as [number, number][],
    holes: hole && !tri && w > 2 && d > 2 ? [[[0.5, 0.5], [1.5, 0.5], [1.5, 1.5], [0.5, 1.5]] as [number, number][]] : [] }));
test("P3 · a legacy slab and the canonical boundary give identical elements; area / thickness / extrusion as the slab rules", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(poly, fc.integer({ min: -3, max: 3 }).map((v) => v / 10), async ({ outline, holes }, offset) => {
    const L = await base(), N = await base();
    await N.ex("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L0", type: "D", outline, holes, offset }] });
    const ns = await N.S(), canon = ns.elements["S-0001"] as any;
    await L.legacy([{ type: "ElementCreated", v: 2, payload: { id: "S-0001", kind: "slab", storey: L.L0, type: L.T("D"), outline: canon.outline, holes: canon.holes, offset } }]);
    const ls = await replay(L.stores);
    assert.equal(els(ls, ["S-0001"]), els(ns, ["S-0001"]));
    const area = (r: number[][]) => Math.abs(r.reduce((a, p, i) => a + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0) / 2);
    const q = quantities(ns, canon), rep = resolveElementRepresentation(ns, canon) as any;
    assert.ok(Math.abs(q.area - (area(outline) - holes.reduce((a, h) => a + area(h), 0))) < 1e-9 && q.thickness === 0.25);
    assert.deepEqual([rep.top, rep.bottom], [offset, offset - 0.25]);
  }), { seed: SEED, numRuns: runs(40) });
});

test("P4 · legacy doors / windows and canonical hosted components: same host, opening, fill, storey; rehost works on both", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 7 }), fc.constantFrom("door", "window"), async (along, kind) => {
    const L = await base(), N = await base();
    for (const b of [L, N]) await b.ex("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [8, 0], height: 3 }, { storey: "L0", type: "W", start: [0, 5], end: [8, 5], height: 3 }] });
    await N.ex("bim_place_openings", { items: [{ kind, host: "W-0001", along, type: kind === "door" ? "K" : "N" }] });
    const ns = await N.S(), op = ns.elements["O-0001"] as any, id = kind === "door" ? "D-0001" : "N-0001";
    await L.legacy([{ type: "ElementCreated", v: 2, payload: { ...op } }, { type: "ElementCreated", v: 2, payload: { id, kind, storey: L.L0, type: L.T(kind === "door" ? "K" : "N"), host: "W-0001", opening: "O-0001" } }]);
    assert.equal(els(await replay(L.stores), ["O-0001", id]), els(ns, ["O-0001", id]));
    const Lp = new Platform({ modules: [bimModule], stores: L.stores, snapshotPolicy: false, logger: quiet });
    for (const pl of [Lp, N.p]) await pl.execute(user, P, "bim_rehost_opening", { opening: "O-0001", host: "W-0002", along: 4 });
    assert.equal(els(await Lp.state<BimState>(P, "bim"), ["O-0001", id]), els(await N.S(), ["O-0001", id]));
  }), { seed: SEED, numRuns: runs(30) });
});

test("P5 · compatibility wrappers (beams / columns / slabs) and the generic engine tools write identical canonical events", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(pt, pt, fc.option(dim, { nil: undefined }), pt, fc.option(dim, { nil: undefined }), poly, async (a, b2, z, at, h, pg) => {
    fc.pre(a[0] !== b2[0] || a[1] !== b2[1]);
    const W = await base(), G = await base();
    await W.ex("bim_create_beams", { beams: [{ storey: "L0", type: "B", start: a, end: b2, ...(z ? { z } : {}) }] });
    await W.ex("bim_create_columns", { columns: [{ storey: "L0", type: "C", at, ...(h ? { height: h } : {}) }] });
    await W.ex("bim_create_slabs", { slabs: [{ storey: "L1", type: "D", ...pg }] });
    await G.ex("bim_create_profile_members", { members: [{ category: "structure.framing", storey: "L0", type: "B", start: a, end: b2, ...(z ? { z } : {}) }] });
    await G.ex("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "C", at, ...(h ? { height: h } : {}) }] });
    await G.ex("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L1", type: "D", ...pg }] });
    const evs = async (x: Platform) => canonicalJson((await x.store(P).readEvents()).filter((e) => e.module === "bim").map((e) => [e.type, e.schemaVersion, e.payload]));
    assert.equal(await evs(W.p), await evs(G.p));
  }), { seed: SEED, numRuns: runs(40) });
});

test("P6 · categories added to existing engines (a test strut on profile_member) go through the same generic create / query / update / move / delete", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(pt, pt, fc.integer({ min: -3, max: 3 }), dim, async (a, b2, dx, z) => {
    fc.pre(a[0] !== b2[0] || a[1] !== b2[1]);
    const b = await base();
    const r = await b.ex("bim_create_profile_members", { members: [{ category: "structure.test_strut", storey: "L0", type: "B", start: a, end: b2, z }] });
    const id = r.summary.created[0];
    assert.deepEqual((await b.ex("bim_query_elements", { category: "structure.test_strut" })).result.elements.map((e: any) => e.engine), ["profile_member"]);
    await b.ex("bim_update_elements", { items: [{ id, kind: "profile_member", set: { z: z + 0.5 } }] });
    await b.ex("bim_move_elements", { ids: [id], vector: [dx, 0] });
    const e = (await b.S()).elements[id] as any;
    assert.deepEqual([e.z, e.start, e.category], [z + 0.5, [a[0] + dx, a[1]], "structure.test_strut"]);
    await b.ex("bim_delete_elements", { ids: [id] });
    assert.equal((await b.S()).elements[id], undefined);
  }), { seed: SEED, numRuns: runs(30) });
});

/** a controlled legacy history: member / boundary creates and updates (ElementUpdated payloads exactly as Phase 8 wrote them) */
const historyOp = fc.oneof(fc.record({ t: fc.constant("beamEnd"), x: fc.integer({ min: 6, max: 12 }) }), fc.record({ t: fc.constant("colH"), h: dim }),
  fc.record({ t: fc.constant("colRot"), r: fc.integer({ min: 0, max: 90 }) }), fc.record({ t: fc.constant("slabOff"), o: fc.integer({ min: -2, max: 2 }).map((v) => v / 10) }));
const toUpdate = (o: any) => o.t === "beamEnd" ? { id: "B-0001", changes: { end: [o.x, 1] } } : o.t === "colH" ? { id: "C-0001", changes: { height: o.h } }
  : o.t === "colRot" ? { id: "C-0001", changes: { rotation: o.r } } : { id: "S-0001", changes: { offset: o.o } };
const toCommand = (o: any) => o.t === "beamEnd" ? { tool: "bim_update_elements", input: { items: [{ id: "B-0001", kind: "beam", set: { end: [o.x, 1] } }] } }
  : o.t === "colH" ? { tool: "bim_update_elements", input: { items: [{ id: "C-0001", kind: "column", set: { height: o.h } }] } }
  : o.t === "colRot" ? { tool: "bim_update_elements", input: { items: [{ id: "C-0001", kind: "column", set: { rotation: o.r } }] } }
  : { tool: "bim_update_elements", input: { items: [{ id: "S-0001", kind: "slab", set: { offset: o.o } }] } };
async function twoHistories(ops: any[], undos: number) {
  const L = await base(), N = await base();
  // one legacy command per canonical command, so that undo walks the same commands on both sides
  await L.legacy([{ type: "ElementCreated", v: 2, payload: { id: "B-0001", kind: "beam", storey: L.L0, type: L.T("B"), start: [0, 1], end: [5, 1], z: 2.5, vertical: { mode: "fixed" } } },
    { type: "ElementCreated", v: 2, payload: { id: "C-0001", kind: "column", storey: L.L0, type: L.T("C"), at: [2, 2], height: 2.5, baseOffset: 0, rotation: 0, vertical: { mode: "fixed" } } }]);
  await L.legacy([{ type: "ElementCreated", v: 2, payload: { id: "S-0001", kind: "slab", storey: L.L0, type: L.T("D"), outline: [[0, 0], [6, 0], [6, 4], [0, 4]], holes: [], offset: 0 } }]);
  await N.ex("bim_create_profile_members", { members: [{ category: "structure.framing", storey: "L0", type: "B", start: [0, 1], end: [5, 1], z: 2.5 }, { category: "structure.column", storey: "L0", type: "C", at: [2, 2], height: 2.5 }] });
  await N.ex("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L0", type: "D", outline: [[0, 0], [6, 0], [6, 4], [0, 4]] }] });
  for (const o of ops) {                       // a legacy command only where the canonical command was accepted
    const c = toCommand(o);
    if (await N.ex(c.tool, c.input).then(() => true, () => false)) await L.legacy([{ type: "ElementUpdated", v: 2, payload: toUpdate(o) }]);
  }
  const Lp = new Platform({ modules: [bimModule], stores: L.stores, snapshotPolicy: false, logger: quiet });
  for (let k = 0; k < undos; k++) { await Lp.execute(user, P, "platform_undo", {}).catch(() => undefined); await N.ex("platform_undo", {}).catch(() => undefined); }
  return { L, N, Lp };
}
test("P7 · legacy update histories: upcast full replay == snapshot + tail == the canonical live model", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.array(historyOp, { minLength: 1, maxLength: 8 }), async (ops) => {
    const { L, N } = await twoHistories(ops, 0);
    const full = await replay(L.stores);
    const sp = new Platform({ modules: [bimModule], stores: L.stores, snapshotPolicy: { everyEvents: 1, keep: 2 }, logger: quiet });
    await sp.state(P, "bim"); await sp.createSnapshot(P);
    await L.legacy([{ type: "ElementUpdated", v: 2, payload: { id: "C-0001", changes: { rotation: 7 } } }]);          // a legacy tail after the v5 snapshot
    await N.ex("bim_update_elements", { items: [{ id: "C-0001", kind: "column", set: { rotation: 7 } }] });
    const fromSnap = await replay(L.stores, { everyEvents: 1, keep: 2 }), full2 = await replay(L.stores);
    const ids = ["B-0001", "C-0001", "S-0001"];
    assert.equal(els(fromSnap, ids), els(full2, ids));
    assert.equal(els(full2, ids), els(await N.S(), ids));
    assert.ok(full);
  }), { seed: SEED, numRuns: runs(30) });
});

test("P8 · undo across the migration: legacy histories undone through the replay equal the canonical histories undone", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.array(historyOp, { minLength: 1, maxLength: 6 }), fc.integer({ min: 1, max: 6 }), async (ops, undos) => {
    const { N, Lp } = await twoHistories(ops, undos);
    const ids = ["B-0001", "C-0001", "S-0001"];
    assert.equal(els(await Lp.state<BimState>(P, "bim"), ids), els(await N.S(), ids));
  }), { seed: SEED, numRuns: runs(30) });
});

test("P9 · the representation agrees with quantities and IFC for members and boundaries", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(pt, pt, dim, poly, async (a, b2, h, pg) => {
    fc.pre(a[0] !== b2[0] || a[1] !== b2[1]);
    const b = await base();
    await b.ex("bim_create_profile_members", { members: [{ category: "structure.framing", storey: "L0", type: "B", start: a, end: b2, z: 2.5 }, { category: "structure.column", storey: "L0", type: "CR", at: a, height: h }] });
    await b.ex("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L0", type: "D", ...pg }] });
    const s = await b.S();
    const bm = resolveElementRepresentation(s, s.elements["B-0001"]) as any, col = resolveElementRepresentation(s, s.elements["C-0001"]) as any;
    assert.ok(Math.abs(bm.length - quantities(s, s.elements["B-0001"]).length) < 1e-12 && bm.origin[2] === 2.5 && bm.profileCenter[1] === -0.25);
    assert.ok(Math.abs(Math.PI * 0.15 ** 2 * col.length - quantities(s, s.elements["C-0001"]).volume) < 1e-12);
    const ifc = toIfc(s, { projectKey: P });
    assert.equal(/NaN|Infinity/.test(ifc), false);
    const depths = [...ifc.matchAll(/IFCEXTRUDEDAREASOLID\(([^)]*)\)/g)].map((m) => parseFloat(m[1].split(",").at(-1)!));
    assert.ok(depths.some((d) => Math.abs(d - bm.length) < 1e-9) && depths.some((d) => Math.abs(d - col.length) < 1e-9), "IFC sweeps use the representation's lengths");
  }), { seed: SEED, numRuns: runs(30) });
});

test("P10 · queries answer in the same order for a live model and the same model reloaded from a snapshot", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.array(fc.constantFrom("col", "beam", "slab"), { minLength: 2, maxLength: 7 }), async (order) => {
    const stores = new MemoryStores();
    const b = await base({ everyEvents: 1, keep: 2 }, stores);
    for (const [i, k] of order.entries()) {
      if (k === "col") await b.ex("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "C", at: [i, 0], height: 2.5 }] });
      if (k === "beam") await b.ex("bim_create_profile_members", { members: [{ category: "structure.framing", storey: "L0", type: "B", start: [i, 1], end: [i + 1, 2], z: 2 }] });
      if (k === "slab") await b.ex("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L0", type: "D", outline: [[i, 5], [i + 1, 5], [i, 6]] }] });
    }
    const q = async (p: Platform, input: unknown) => canonicalJson((await p.execute(user, P, "bim_query_elements", input) as any).result.elements);
    const reloaded = new Platform({ modules: [bimModule], stores, snapshotPolicy: { everyEvents: 1, keep: 2 }, logger: quiet });
    for (const input of [{}, { engine: "profile_member" }, { kind: "column" }, { discipline: "structure" }]) assert.equal(await q(reloaded, input), await q(b.p, input));
    assert.ok(reloaded.metrics.snapshotsLoaded === 1);
  }), { seed: SEED, numRuns: runs(25) });
});
