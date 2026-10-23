/**
 * Phase 7 · property-based tests (fast-check): parameters, type -> instance geometry, reassignment,
 * category derivation, family schema atomicity, replay and genericity across categories.
 * Reproducible: FC_SEED (default 20261007), FC_RUNS_FACTOR for longer runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { Platform, MemoryStores, Actor, canonicalJson, PlatformLogger } from "@insa/core";
import { bimModule, BimState, Component, ComponentType, ParameterDefinition, checkParameterValues, componentBox, categoryIdOfElement, listCategories } from "../src/index.js";

const SEED = Number(process.env.FC_SEED ?? 20261007), FACTOR = Number(process.env.FC_RUNS_FACTOR ?? 1);
const runs = (n: number) => Math.max(1, Math.round(n * FACTOR));
const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "cprop";
const quiet: PlatformLogger = { info: () => {}, warn: () => {} };
const COMPONENT_CATS = listCategories().filter((c) => c.engine === "point_component").map((c) => c.id);
const L = (key: string, extra: Record<string, unknown> = {}) => ({ key, name: key, scope: "type", dataType: "length", required: true, ...extra });
const BOX = { kind: "box", width: "w", depth: "d", height: "h" };
const dim = fc.integer({ min: 10, max: 500 }).map((v) => v / 100);

async function base(policy: { everyEvents: number; keep: number } | false = false) {
  const stores = new MemoryStores();
  const p = new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet });
  const ex = (tool: string, input: unknown) => p.execute(user, P, tool, input) as Promise<any>;
  await ex("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3 }, { name: "L2", elevation: 6.5 }] });
  return { p, stores, ex };
}
const st = (p: Platform) => p.state<BimState>(P, "bim");
const snap = async (p: Platform) => ({ e: (await p.store(P).readEvents()).length, s: JSON.stringify(await st(p)) });
const view = async (x: Platform) => canonicalJson({ s: await x.state(P, "bim"), h: await x.history(P, 1e6) });

test("P1 · parameter validation accepts exactly the values an independent oracle accepts (NaN, Infinity, bounds, types, unknown keys)", (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  const defArb = fc.record({ dataType: fc.constantFrom("number", "length", "angle", "string", "boolean"), min: fc.option(fc.integer({ min: -5, max: 5 }), { nil: undefined }),
                             span: fc.integer({ min: 0, max: 10 }), required: fc.boolean() });
  const invalid = fc.oneof(fc.constantFrom(Number.NaN, Infinity, -Infinity, -0.5, 1e9, -1e9), fc.string({ maxLength: 4 }), fc.boolean(), fc.double());
  // each value is mostly a VALID value for its definition (so acceptance is exercised), sometimes anything, sometimes absent
  const case_ = fc.array(defArb, { minLength: 1, maxLength: 4 }).chain((ds) => {
    const defs: ParameterDefinition[] = ds.map((x, i) => {
      const numeric = x.dataType !== "string" && x.dataType !== "boolean";
      return { key: `p${i}`, name: `P${i}`, scope: "type", dataType: x.dataType as any, required: x.required,
               ...(numeric && x.min !== undefined ? { min: x.min, max: x.min + x.span } : {}) };
    });
    const validFor = (d: ParameterDefinition): fc.Arbitrary<unknown> => {
      if (d.dataType === "string") return fc.string({ maxLength: 8 });
      if (d.dataType === "boolean") return fc.boolean();
      const lo = Math.max(d.min ?? -1e3, d.dataType === "length" ? 0 : -1e3), hi = d.max ?? 1e3;
      return lo <= hi ? fc.double({ min: lo, max: hi, noNaN: true }) : invalid;          // e.g. a length with max < 0: no valid value exists
    };
    const val = (d: ParameterDefinition) => fc.oneof({ weight: 6, arbitrary: validFor(d) }, { weight: 2, arbitrary: invalid }, { weight: 2, arbitrary: fc.constant(undefined) });
    return fc.tuple(fc.constant(defs), fc.tuple(...defs.map(val)), fc.oneof({ weight: 5, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) }));
  });
  let accepted = 0, total = 0;
  fc.assert(fc.property(case_, ([defs, vals, extraKey]) => {
    const values: Record<string, unknown> = {};
    defs.forEach((d, i) => { if (vals[i] !== undefined) values[d.key] = vals[i]; });
    if (extraKey) values.zz_unknown = 1;
    const oracle = !extraKey && defs.every((d) => {
      const v = values[d.key];
      if (v === undefined) return !d.required;
      if (d.dataType === "string") return typeof v === "string";
      if (d.dataType === "boolean") return typeof v === "boolean";
      return typeof v === "number" && Number.isFinite(v) && !(d.dataType === "length" && v < 0) && (d.min === undefined || v >= d.min) && (d.max === undefined || v <= d.max);
    });
    let ok = true;
    try { checkParameterValues(defs, "type", values, {}); } catch { ok = false; }
    total++; if (ok) accepted++;
    assert.equal(ok, oracle, JSON.stringify({ defs, values }));
  }), { seed: SEED, numRuns: runs(300) });
  t.diagnostic(`accepted ${accepted} / ${total}`);
  assert.ok(accepted / total > 0.2 && accepted / total < 0.9, `both outcomes exercised (${accepted}/${total})`);
});

test("P2 · after a type dimension change every instance resolves to the new dimensions; ids and placements unchanged", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.tuple(dim, dim, dim), fc.tuple(dim, dim, dim), fc.array(fc.tuple(fc.integer({ min: -50, max: 50 }), fc.integer({ min: -50, max: 50 }), fc.integer({ min: 0, max: 359 })), { minLength: 1, maxLength: 5 }),
    async ([w, d, h], [w2, d2, h2], places) => {
      const { p, ex } = await base();
      await ex("bim_create_families", { families: [{ name: "F", category: "architecture.furniture", parameters: [L("w"), L("d"), L("h")], representation: BOX }] });
      await ex("bim_create_types", { types: [{ kind: "component", name: "T", family: "F", parameters: { w, d, h } }] });
      // Keep these parameter-propagation samples disjoint at both sets of dimensions.
      // Overlap/type-growth refusals are exercised by modelling-policy.test.ts.
      await ex("bim_create_components", { components: places.map(([x, y, rot],i) => ({ type: "T", storey: "L0", x:x+i*120, y, rotation: rot })) });
      const before = await st(p);
      await ex("bim_update_types", { items: [{ type: "COT-0001", kind: "component", set: { parameters: { w: w2, d: d2, h: h2 } } }] });
      const after = await st(p);
      for (const id of Object.keys(before.elements)) {
        assert.deepEqual(after.elements[id], before.elements[id], "the instance itself never changes");
        const b = componentBox(after, after.elements[id] as Component);
        assert.deepEqual([b.width, b.depth, b.height], [w2, d2, h2]);
      }
    }), { seed: SEED, numRuns: runs(40) });
});

test("P3 · storey reassignment changes only the storey (x, y, offset, rotation, type, parameters, family, category kept)", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.array(fc.record({ x: fc.integer({ min: -20, max: 20 }), y: fc.integer({ min: -20, max: 20 }), off: fc.integer({ min: -10, max: 30 }).map((v) => v / 10),
      rot: fc.integer({ min: -720, max: 720 }), from: fc.nat(2), to: fc.nat(2) }), { minLength: 1, maxLength: 5 }),
    async (items) => {
      const { p, ex } = await base();
      await ex("bim_create_families", { families: [{ name: "F", category: "mechanical.equipment", parameters: [L("w"), L("d"), L("h"), { key: "tag", name: "Tag", scope: "instance", dataType: "string", required: false }], representation: BOX }] });
      await ex("bim_create_types", { types: [{ kind: "component", name: "T", family: "F", parameters: { w: 1, d: 1, h: 1 } }] });
      const sts = Object.values((await st(p)).storeys).sort((a, b) => a.elevation - b.elevation).map((s) => s.id);
      await ex("bim_create_components", { components: items.map((it, k) => ({ type: "T", storey: sts[it.from], x: it.x, y: it.y, offset: it.off, rotation: it.rot, parameters: { tag: `t${k}` } })) });
      const before = await st(p);
      const moves = items.map((it, k) => ({ id: `CO-${String(k + 1).padStart(4, "0")}`, storey: sts[it.to] })).filter((m, k) => sts[items[k].from] !== m.storey);
      fc.pre(moves.length > 0);
      await ex("bim_reassign_storey", { items: moves });
      const after = await st(p);
      for (const m of moves) {
        const { storey: s2, ...a } = after.elements[m.id] as any, { storey: _s1, ...b } = before.elements[m.id] as any;
        assert.equal(s2, m.storey);
        assert.deepEqual(a, b);
        assert.equal(categoryIdOfElement(after, after.elements[m.id]), "mechanical.equipment");
      }
    }), { seed: SEED, numRuns: runs(40) });
});

test("P4 · every component's category is exactly Type -> Family -> Category; nothing independent is stored", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.array(fc.constantFrom(...COMPONENT_CATS), { minLength: 1, maxLength: 4 }), fc.array(fc.nat(), { minLength: 1, maxLength: 6 }), async (cats, picks) => {
    const { p, ex } = await base();
    await ex("bim_create_families", { families: cats.map((c, i) => ({ name: `F${i}`, category: c, parameters: [L("w"), L("d"), L("h")], representation: BOX })) });
    await ex("bim_create_types", { types: cats.map((_c, i) => ({ kind: "component", name: `T${i}`, family: `F${i}`, parameters: { w: 1, d: 1, h: 1 } })) });
    const types = Object.values((await st(p)).types).map((x) => x.id);
    await ex("bim_create_components", { components: picks.map((k, i) => ({ type: types[k % types.length], storey: "L0", x: i, y: 0 })) });
    const s = await st(p);
    const rows = (await ex("bim_query_elements", {})).result.elements;
    for (const el of Object.values(s.elements) as Component[]) {
      const expected = s.families[(s.types[el.type] as ComponentType).family].category;
      assert.equal(categoryIdOfElement(s, el), expected);
      assert.equal(rows.find((r: any) => r.id === el.id).category, expected);
      assert.equal("category" in el, false);
    }
  }), { seed: SEED, numRuns: runs(40) });
});

test("P5 · a family schema change that invalidates any one type is rejected as a whole; state and events unchanged", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.uniqueArray(fc.integer({ min: 30, max: 200 }), { minLength: 1, maxLength: 6 }), fc.nat(), async (widthsCm, pick) => {
    const { p, ex } = await base();
    await ex("bim_create_families", { families: [{ name: "F", category: "architecture.casework", parameters: [L("w"), L("d"), L("h")], representation: BOX }] });
    await ex("bim_create_types", { types: widthsCm.map((w, i) => ({ kind: "component", name: `T${i}`, family: "F", parameters: { w: w / 100, d: 0.6, h: 0.9 } })) });
    const victim = widthsCm[pick % widthsCm.length] / 100;
    const before = await snap(p);
    const err = await ex("bim_update_families", { items: [{ family: "F", set: { parameters: [L("w", { max: victim - 0.005 }), L("d"), L("h")] } }] }).then(() => null, (e) => e);
    assert.equal(err?.reason, "INVALID_FAMILY_UPDATE", String(err?.message));
    assert.deepEqual(await snap(p), before);
  }), { seed: SEED, numRuns: runs(40) });
});

test("P6 · random family / type / component histories: live == full replay == snapshot + tail", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  const op = fc.oneof(
    fc.record({ t: fc.constant("create"), k: fc.nat(), x: fc.integer({ min: -9, max: 9 }) }), fc.record({ t: fc.constant("move"), i: fc.nat(), dx: fc.integer({ min: -3, max: 3 }) }),
    fc.record({ t: fc.constant("reassign"), i: fc.nat(), s: fc.nat(2) }), fc.record({ t: fc.constant("resize"), k: fc.nat(), w: dim }),
    fc.record({ t: fc.constant("rename"), n: fc.nat(99) }), fc.record({ t: fc.constant("delete"), i: fc.nat() }), fc.record({ t: fc.constant("undo") }));
  await fc.assert(fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 10 }), fc.integer({ min: 1, max: 5 }), async (ops, every) => {
    const policy = { everyEvents: every, keep: 2 };
    const { p, stores, ex } = await base(policy);
    await ex("bim_create_families", { families: [{ name: "Chair", category: "architecture.furniture", parameters: [L("w"), L("d"), L("h")], representation: BOX },
                                                  { name: "Lamp", category: "electrical.lighting_fixture", parameters: [L("w"), L("d"), L("h")], representation: BOX }] });
    await ex("bim_create_types", { types: [{ kind: "component", name: "C", family: "Chair", parameters: { w: 0.5, d: 0.5, h: 0.9 } }, { kind: "component", name: "L", family: "Lamp", parameters: { w: 0.6, d: 0.6, h: 0.1 } }] });
    const sts = Object.keys((await st(p)).storeys).sort();
    for (const o of ops as any[]) {
      const els = Object.keys((await st(p)).elements).sort(), pick = (i: number) => els[i % Math.max(els.length, 1)];
      const call = o.t === "create" ? ex("bim_create_components", { components: [{ type: ["COT-0001", "COT-0002"][o.k % 2], storey: "L0", x: o.x, y: 0 }] })
        : o.t === "move" && els.length ? ex("bim_move_elements", { ids: [pick(o.i)], vector: [o.dx, 1] })
        : o.t === "reassign" && els.length ? ex("bim_reassign_storey", { items: [{ id: pick(o.i), storey: sts[o.s] }] })
        : o.t === "resize" ? ex("bim_update_types", { items: [{ type: ["COT-0001", "COT-0002"][o.k % 2], kind: "component", set: { parameters: { w: o.w } } }] })
        : o.t === "rename" ? ex("bim_update_families", { items: [{ family: "F-0001", set: { name: `Chair ${o.n}` } }] })
        : o.t === "delete" && els.length ? ex("bim_delete_elements", { ids: [pick(o.i)] })
        : o.t === "undo" ? ex("platform_undo", {}) : Promise.resolve();
      await call.catch(() => undefined);
    }
    const full = await view(new Platform({ modules: [bimModule], stores, snapshotPolicy: false }));
    assert.equal(await view(new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet })), full);
    assert.equal(await view(p), full);
  }), { seed: SEED, numRuns: runs(30) });
});

test("P7 · every component category supports create / query / move / delete through the same generic tools", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.constantFrom(...COMPONENT_CATS), fc.integer({ min: -10, max: 10 }), fc.integer({ min: -10, max: 10 }), async (cat, dx, dy) => {
    const { p, ex } = await base();
    await ex("bim_create_families", { families: [{ name: "F", category: cat, parameters: [L("w"), L("d"), L("h")], representation: BOX }] });
    await ex("bim_create_types", { types: [{ kind: "component", name: "T", family: "F", parameters: { w: 1, d: 1, h: 1 } }] });
    await ex("bim_create_components", { components: [{ type: "T", storey: "L1", x: 0, y: 0 }] });
    assert.deepEqual((await ex("bim_query_elements", { category: cat })).result.elements.map((e: any) => e.id), ["CO-0001"]);
    await ex("bim_move_elements", { ids: ["CO-0001"], vector: [dx, dy] });
    assert.deepEqual([((await st(p)).elements["CO-0001"] as Component).placement.x, ((await st(p)).elements["CO-0001"] as Component).placement.y], [dx, dy]);
    await ex("bim_delete_elements", { ids: ["CO-0001"] });
    assert.equal(Object.keys((await st(p)).elements).length, 0);
  }), { seed: SEED, numRuns: runs(40) });
});
