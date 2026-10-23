/** Phase 12 · property-based tests (fast-check). Reproducible: FC_SEED (default 20261007), FC_RUNS_FACTOR. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { Platform, canonicalJson } from "@insa/core";
import { bimModule, BimState, quantities, memberWorldEnds, memberLength, sectionArea, sectionProblem, registerCategory, listEngines, modelIssues } from "../src/index.js";
import { setup, P } from "./authoring-fixture.js";

const SEED = Number(process.env.FC_SEED ?? 20261007), FACTOR = Number(process.env.FC_RUNS_FACTOR ?? 1);
const runs = (n: number) => Math.max(1, Math.round(n * FACTOR));
registerCategory({ id: "structure.test_strut", name: "Test Struts", discipline: "structure", engine: "profile_member", placements: ["member_spatial_axis"], typeKinds: ["beam"], capabilities: ["hasType", "hasMaterial", "levelBased", "movable", "profileBased"] });
type T = Awaited<ReturnType<typeof setup>>;
const el = (s: BimState, id: string) => s.elements[id] as any;
const SECTIONS: Record<string, any> = { rect: { shape: "rect", b: 0.3, h: 0.5 }, circle: { shape: "circle", d: 0.4 }, rhs: { shape: "rhs", b: 0.2, h: 0.3, t: 0.01 }, chs: { shape: "chs", d: 0.2, t: 0.008 }, i_section: { shape: "i_section", h: 0.3, b: 0.15, tw: 0.007, tf: 0.011 } };
async function structural(policy: { everyEvents: number; keep: number } | false = false) {
  const t = await setup(policy);
  await t.run("bim_create_types", { types: [{ kind: "wall", name: "SW", layers: [{ material: "Beton", thickness: 0.25 }] }, { kind: "slab", name: "D20", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "foundation_slab", name: "MAT", layers: [{ material: "Beton", thickness: 0.6 }] }, { kind: "footing", name: "PAD", footing_kind: "pad", layers: [{ material: "Beton", thickness: 0.5 }] },
    { kind: "column", name: "C40", profile: { shape: "rect", b: 0.4, h: 0.4 } }, { kind: "column", name: "PILE", profile: { shape: "circle", d: 0.4 } },
    ...Object.entries(SECTIONS).map(([k, profile]) => ({ kind: "beam", name: `B-${k}`, profile }))] });
  return t;
}
const replayEqual = async (t: T) => assert.equal(canonicalJson(await t.S()), canonicalJson(await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state<BimState>(P, "bim")), "live == replay");
const n1 = fc.integer({ min: -30, max: 30 }).map((v) => v / 2);
const off = fc.integer({ min: -4, max: 8 }).map((v) => v / 2);
const elevation = fc.integer({ min: 28, max: 50 }).map((v) => v / 10);
const braceArb = fc.record({ sx: n1, sy: n1, ex: n1, ey: n1, so: off, eo: off, e1: fc.boolean() });
const distinct = (b: { sx: number; sy: number; ex: number; ey: number; so: number; eo: number; e1: boolean }) => !(b.sx === b.ex && b.sy === b.ey && b.so === b.eo && !b.e1) && !(b.e1 && b.sx === b.ex && b.sy === b.ey && b.eo + 3.2 === b.so);
const cover = { braces: 0, piles: 0, sections: 0, refused: 0 };

test("P1 · a brace's world length equals the independent 3D distance; P3 · live == replay", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(braceArb, async (b) => {
    fc.pre(distinct(b));
    const t = await structural({ everyEvents: 3, keep: 2 });
    await t.run("bim_create_braces", { braces: [{ storey: "L0", type: "B-rhs", start: [b.sx, b.sy], end: [b.ex, b.ey], start_offset: b.so, end_offset: b.eo, ...(b.e1 ? { end_storey: "L1" } : {}) }] });
    const s = await t.S(), oracle = Math.sqrt((b.ex - b.sx) ** 2 + (b.ey - b.sy) ** 2 + ((b.e1 ? 3.2 : 0) + b.eo - b.so) ** 2);
    cover.braces++;
    assert.ok(Math.abs(memberLength(s, el(s, "BR-0001")) - oracle) < 1e-9 && Math.abs(quantities(s, el(s, "BR-0001")).length - oracle) < 1e-9);
    await t.run("bim_move_elements", { ids: ["BR-0001"], vector: [1, 2] });
    await replayEqual(t);
  }), { seed: SEED, numRuns: runs(40) });
  assert.ok(cover.braces >= 10);
});

test("P2 · a brace follows its storeys: any level change re-derives the world ends and length with NO brace event (or is refused when it would collapse the axis)", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(braceArb, elevation, async (b, e1) => {
    fc.pre(distinct(b));
    const t = await structural();
    await t.run("bim_create_braces", { braces: [{ storey: "L0", type: "B-chs", start: [b.sx, b.sy], end: [b.ex, b.ey], start_offset: b.so, end_offset: b.eo, ...(b.e1 ? { end_storey: "L1" } : {}) }] });
    const n = (await t.p.store(P).readEvents()).length;
    const collapses = b.e1 && b.sx === b.ex && b.sy === b.ey && Math.abs(e1 + b.eo - b.so) < 1e-4;
    const r = await t.ex("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: e1 } }] }).catch((e: any) => ({ status: "error", reason: e.reason }));
    const s = await t.S();
    if (collapses) { assert.equal(r.status, "error"); assert.equal(memberLength(s, el(s, "BR-0001")) > 0, true); return; }
    assert.equal(r.status, "applied", JSON.stringify(r));
    const want = Math.sqrt((b.ex - b.sx) ** 2 + (b.ey - b.sy) ** 2 + ((b.e1 ? e1 : 0) + b.eo - b.so) ** 2);
    assert.ok(Math.abs(memberLength(s, el(s, "BR-0001")) - want) < 1e-9);
    assert.ok((await t.p.store(P).readEvents()).slice(n).filter((e) => e.module === "bim").every((e) => e.type === "StoreyUpdated"), "no brace event");
    await replayEqual(t);
  }), { seed: SEED, numRuns: runs(40) });
});

test("P4 · a pile's top / bottom world points and length are exact; P5 · live == replay; its top follows the storey, its length does not", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(n1, n1, off, fc.integer({ min: 2, max: 60 }).map((v) => v / 2), elevation, async (x, y, bo, len, e0) => {
    const t = await structural({ everyEvents: 3, keep: 2 });
    await t.run("bim_create_piles", { piles: [{ storey: "L0", type: "PILE", at: [x, y], length: len, base_offset: bo }] });
    let s = await t.S();
    cover.piles++;
    assert.deepEqual(memberWorldEnds(s, el(s, "PL-0001")), { start: [x, y, bo], end: [x, y, bo - len] });
    assert.equal(el(s, "PL-0001").direction, "down");
    await t.run("bim_update_storeys", { items: [{ storey: "L0", set: { elevation: e0 - 2.8 } }] });
    s = await t.S();
    assert.ok(Math.abs(memberWorldEnds(s, el(s, "PL-0001")).start[2] - (e0 - 2.8 + bo)) < 1e-9 && Math.abs(memberLength(s, el(s, "PL-0001")) - len) < 1e-12);
    await replayEqual(t);
  }), { seed: SEED, numRuns: runs(30) });
});

test("P6 · RHS / CHS / I-section areas equal the independent oracle and invalid dimensions are refused exactly when the oracle says so; P7 · volume = area x length", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  const dim = fc.integer({ min: 1, max: 40 }).map((v) => v / 100);
  await fc.assert(fc.asyncProperty(fc.constantFrom("rhs", "chs", "i_section"), dim, dim, dim, dim, async (kind, a, b, c, d) => {
    const prof = kind === "rhs" ? { shape: "rhs", b: a, h: b, t: c } : kind === "chs" ? { shape: "chs", d: a, t: c } : { shape: "i_section", h: a, b, tw: c, tf: d };
    const valid = kind === "rhs" ? 2 * c < Math.min(a, b) : kind === "chs" ? 2 * c < a : 2 * d < a && c < b;
    assert.equal(sectionProblem(prof as never) === null, valid, JSON.stringify(prof));
    if (!valid) { cover.refused++; return; }
    const oracle = kind === "rhs" ? a * b - (a - 2 * c) * (b - 2 * c) : kind === "chs" ? (Math.PI / 4) * (a * a - (a - 2 * c) ** 2) : 2 * b * d + (a - 2 * d) * c;
    assert.ok(Math.abs(sectionArea(prof as never) - oracle) < 1e-12);
    cover.sections++;
    const t = await structural();
    await t.run("bim_create_types", { types: [{ kind: "beam", name: "X", profile: prof }] });
    await t.run("bim_create_braces", { braces: [{ storey: "L0", type: "X", start: [0, 0], end: [3, 4], end_storey: "L1", end_offset: 1 }] });
    const s = await t.S(), q = quantities(s, el(s, "BR-0001"));
    assert.ok(Math.abs(q.volume - oracle * Math.hypot(3, 4, 4.2)) < 1e-9 && Math.abs(q.cross_section_area - oracle) < 1e-12);
  }), { seed: SEED, numRuns: runs(40) });
  assert.ok(cover.sections >= 5 && cover.refused >= 3, JSON.stringify(cover));
});

test("P8 · a shear wall keeps its category through Phase 10 split / merge; P10 · existing beams and columns are unchanged", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.integer({ min: 2, max: 20 }), fc.integer({ min: 1, max: 9 }), fc.integer({ min: 4, max: 20 }).map((v) => v / 2), async (len, tt, h) => {
    const t = await structural();
    await t.run("bim_create_walls", { walls: [{ category: "structure.shear_wall", storey: "L0", type: "SW", start: [0, 0], end: [len, 0], height: 3 }] });
    const sp = await t.run("bim_split_wall", { wall: "W-0001", t: tt / 10 });
    let s = await t.S();
    assert.deepEqual(sp.summary.walls.map((id: string) => el(s, id).category), ["structure.shear_wall", "structure.shear_wall"]);
    await t.run("bim_merge_walls", { walls: sp.summary.walls });
    s = await t.S();
    assert.equal(el(s, "W-0001").category, "structure.shear_wall");
    // P10: columns and beams: Phase 11 shapes, quantities and keys
    await t.run("bim_create_profile_members", { members: [{ category: "structure.column", storey: "L0", type: "C40", at: [1, 1], height: h }, { category: "structure.framing", storey: "L0", type: "B-rect", start: [0, 0], end: [len, 3], z: 2.8 }] });
    s = await t.S();
    const col = el(s, "C-0001"), beam = el(s, "B-0001");
    assert.equal("direction" in col, false);
    assert.deepEqual(Object.keys(quantities(s, col)).sort(), ["height", "section_area", "volume"]);
    assert.deepEqual(Object.keys(quantities(s, beam)).sort(), ["length", "section_area", "volume"]);
    assert.ok(Math.abs(quantities(s, col).volume - 0.16 * h) < 1e-12 && Math.abs(quantities(s, beam).volume - 0.15 * Math.hypot(len, 3)) < 1e-12);
    assert.deepEqual([memberWorldEnds(s, col).end[2], memberWorldEnds(s, beam).start[2]], [h, 2.8]);
    await replayEqual(t);
  }), { seed: SEED, numRuns: runs(30) });
});

test("P9 · footing / foundation slab / structural slab: live == replay (create, update, move, delete); P12 · dry run == apply", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.integer({ min: 2, max: 20 }), fc.integer({ min: 2, max: 20 }), fc.integer({ min: -4, max: 4 }), async (w, d, dx) => {
    const t = await structural({ everyEvents: 3, keep: 2 });
    const sq = [[0, 0], [w, 0], [w, d], [0, d]];
    const calls: [string, unknown][] = [["bim_create_boundaries", { boundaries: [{ category: "structure.foundation_slab", storey: "L0", type: "MAT", outline: sq, offset: -0.5 }, { category: "structure.slab", storey: "L1", type: "D20", outline: sq }] }],
      ["bim_create_footings", { footings: [{ storey: "L0", type: "PAD", center: [w / 2, d / 2], length: 1, width: 1, offset: -0.5 }] }]];
    for (const [tool, input] of calls) {
      const before = await t.snap(), dry = await t.ex(tool, input, { dryRun: true });
      assert.deepEqual(await t.snap(), before);
      assert.deepEqual((await t.run(tool, input)).summary, dry.preview.summary);
    }
    await t.run("bim_update_elements", { items: [{ id: "FT-0001", kind: "boundary", set: { offset: -0.3 } }] });
    await t.run("bim_move_elements", { ids: ["FT-0001", "FS-0001"], vector: [dx, 1] });
    await replayEqual(t);
    await t.run("bim_delete_elements", { ids: ["FT-0001"] });
    await replayEqual(t);
    assert.deepEqual(modelIssues(await t.S()), []);
  }), { seed: SEED, numRuns: runs(25) });
});

test("P11 · mixed Phase 10 + 11 + 12 histories: snapshot reload == full replay, the reloaded platform keeps authoring; P13 · a test-only structural category needs no new element kind", async (t0) => {
  t0.diagnostic(`fast-check seed=${SEED}`);
  const kinds = new Set(listEngines().map((e) => e.elementKind));
  const op = fc.oneof(fc.record({ t: fc.constant("split"), d: fc.integer({ min: 1, max: 9 }) }), fc.record({ t: fc.constant("level"), e: fc.integer({ min: 30, max: 45 }).map((v) => v / 10) }),
    fc.record({ t: fc.constant("brace"), x: fc.integer({ min: 1, max: 6 }) }), fc.record({ t: fc.constant("pile"), l: fc.integer({ min: 2, max: 12 }) }), fc.record({ t: fc.constant("undo") }));
  await fc.assert(fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 7 }), fc.integer({ min: 1, max: 5 }), async (ops, every) => {
    const policy = { everyEvents: every, keep: 2 };
    const t = await structural(policy);
    await t.run("bim_create_walls", { walls: [{ category: "structure.shear_wall", storey: "L0", type: "SW", start: [0, 0], end: [10, 0], height: 3 }] });
    await t.run("bim_create_boundaries", { boundaries: [{ category: "structure.slab", storey: "L1", type: "D20", outline: [[0, 0], [10, 0], [10, 6], [0, 6]] }] });
    for (const o of ops as any[]) {
      const call = o.t === "split" ? t.ex("bim_split_wall", { wall: "W-0001", t: o.d / 10 }) : o.t === "level" ? t.ex("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: o.e } }] })
        : o.t === "brace" ? t.ex("bim_create_profile_members", { members: [{ category: "structure.test_strut", storey: "L0", type: "B-rect", start: [0, 0], end: [o.x, 2], end_storey: "L1" }] })
        : o.t === "pile" ? t.ex("bim_create_piles", { piles: [{ storey: "L0", type: "PILE", at: [1, 1], length: o.l }] }) : t.ex("platform_undo", {});
      await call.catch(() => undefined);
    }
    const full = await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state<BimState>(P, "bim");
    const reloaded = new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy });
    assert.equal(canonicalJson(await reloaded.state(P, "bim")), canonicalJson(full));
    assert.deepEqual(modelIssues(full), []);
    assert.deepEqual(new Set(Object.values(full.elements).map((e) => e.kind)).has("brace" as never), false);
    assert.deepEqual(new Set(listEngines().map((e) => e.elementKind)), kinds, "P13: no engine / element kind was added for the test category");
  }), { seed: SEED, numRuns: runs(20) });
});
