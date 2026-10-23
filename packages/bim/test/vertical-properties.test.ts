/**
 * Phase 5 · property-based tests (fast-check): propagation, atomic invalid propagation, reassignment integrity.
 * Reproducible: FC_SEED (default 20261007), FC_RUNS_FACTOR for longer runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { Platform, MemoryStores, Actor, canonicalJson, PlatformLogger } from "@insa/core";
import { bimModule, BimState, r as round } from "../src/index.js";

const SEED = Number(process.env.FC_SEED ?? 20261007), FACTOR = Number(process.env.FC_RUNS_FACTOR ?? 1);
const runs = (n: number) => Math.max(1, Math.round(n * FACTOR));
const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "vprop";
const quiet: PlatformLogger = { info: () => {}, warn: () => {} };
const gap = fc.double({ min: 2.5, max: 5, noNaN: true }).map((v) => round(v, 3));

async function base(elevations: number[], policy: { everyEvents: number; keep: number } | false = false) {
  const stores = new MemoryStores();
  const p = new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet });
  await p.execute(user, P, "bim_create_storeys", { storeys: elevations.map((e, i) => ({ name: `S${i}`, elevation: e })) });
  await p.execute(user, P, "bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "m", thickness: 0.2 }] },
    { kind: "column", name: "C", profile: { shape: "rect", b: 0.4, h: 0.4 } }, { kind: "beam", name: "B", profile: { shape: "rect", b: 0.3, h: 0.5 } },
    { kind: "window", name: "N", width: 0.8, height: 0.8 }] });
  return { p, stores };
}
const cum = (gaps: number[]) => gaps.reduce<number[]>((a, g) => [...a, round((a.at(-1) ?? -3) + g, 3)], []);
const state = (p: Platform) => p.state<BimState>(P, "bim");
const snap = async (p: Platform) => ({ e: (await p.store(P).readEvents()).length, s: JSON.stringify(await state(p)) });
const view = async (x: Platform) => canonicalJson({ s: await x.state(P, "bim"), h: await x.history(P, 1e6) });

test("P1 · after random storey elevation changes: fixed stay fixed, constrained = formula, ids stable, replay == snapshot + tail == live", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  const elem = fc.record({ kind: fc.constantFrom("wall", "column", "beam"), base: fc.nat(), up: fc.integer({ min: 1, max: 4 }),
                           fixed: fc.boolean(), value: fc.double({ min: 2.4, max: 3.2, noNaN: true }).map((v) => round(v, 3)),
                           offset: fc.double({ min: 0, max: 0.3, noNaN: true }).map((v) => round(v, 3)) });
  await fc.assert(fc.asyncProperty(fc.array(gap, { minLength: 2, maxLength: 5 }), fc.array(elem, { minLength: 1, maxLength: 6 }),
    fc.array(gap, { minLength: 5, maxLength: 5 }), fc.boolean(), fc.integer({ min: 1, max: 5 }),
    async (gaps, elems, newGaps, reverse, every) => {
      const ev = cum(gaps), n = ev.length;
      const policy = { everyEvents: every, keep: 2 };
      const { p, stores } = await base(ev, policy);
      for (const [i, e] of elems.entries()) {
        const b = e.base % n, top = Math.min(n - 1, b + e.up), name = (k: number) => `S${k}`;
        const constrained = !e.fixed && top > b;
        const x = i * 3;
        if (e.kind === "wall") await p.execute(user, P, "bim_create_walls", { walls: [{ storey: name(b), type: "W", start: [x, 0], end: [x, 5], base_offset: e.offset,
          ...(constrained ? { top_storey: name(top) } : { height: e.value }) }] });
        if (e.kind === "column") await p.execute(user, P, "bim_create_columns", { columns: [{ storey: name(b), type: "C", at: [x, 2], base_offset: e.offset,
          ...(constrained ? { top_storey: name(top) } : { height: e.value }) }] });
        if (e.kind === "beam") await p.execute(user, P, "bim_create_beams", { beams: [{ storey: name(b), type: "B", start: [x, 0], end: [x, 5],
          ...(constrained ? { target_storey: name(top) } : { z: e.value }) }] });
      }
      const before = await state(p);
      const newEv = cum(newGaps.slice(0, n));
      const items = Object.values(before.storeys).map((s) => ({ storey: s.id, set: { elevation: newEv[Number(s.name.slice(1))] } }));
      await p.execute(user, P, "bim_update_storeys", { items: reverse ? items.reverse() : items });
      const after = await state(p);
      assert.deepEqual(Object.keys(after.elements).sort(), Object.keys(before.elements).sort());
      for (const el of Object.values(after.elements) as any[]) {
        const was = before.elements[el.id] as any;
        assert.deepEqual(el.vertical, was.vertical, "intent unchanged");
        const axis = el.kind === "profile_member" && el.placement === "member_axis";      // Phase 9: beams are axis members
        const f = axis ? "z" : "height";
        if (el.vertical.mode === "fixed") assert.equal(el[f], was[f], `${el.id} fixed`);
        else {
          const base = after.storeys[el.storey].elevation, top = after.storeys[el.vertical.storey].elevation;
          assert.equal(el[f], round(axis ? top - base : top - base - el.baseOffset), `${el.id} follows its storeys`);
        }
      }
      const full = await view(new Platform({ modules: [bimModule], stores, snapshotPolicy: false }));
      assert.equal(await view(new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet })), full);
      assert.equal(await view(p), full);
    }), { seed: SEED, numRuns: runs(40) });
});

test("P2 · moving a storey so that one opening no longer fits rejects everything and changes nothing", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  const opening = fc.record({ sill: fc.double({ min: 0, max: 1.6, noNaN: true }).map((v) => round(v, 3)), height: fc.double({ min: 0.3, max: 1.2, noNaN: true }).map((v) => round(v, 3)) });
  await fc.assert(fc.asyncProperty(fc.array(fc.array(opening, { minLength: 0, maxLength: 2 }), { minLength: 1, maxLength: 4 }), fc.nat(), fc.double({ min: 0.05, max: 0.95, noNaN: true }),
    async (walls, pick, frac) => {
      const { p } = await base([0, 3]);
      let tallest = 0;
      for (const [i, ops] of walls.entries()) {
        await p.execute(user, P, "bim_create_walls", { walls: [{ storey: "S0", type: "W", start: [i * 10, 0], end: [i * 10 + 8, 0] }] });      // constrained to S1
        for (const [k, o] of ops.entries()) {
          await p.execute(user, P, "bim_place_openings", { items: [{ kind: "opening", host: `W-000${i + 1}`, along: 2 + k * 3, width: 1, height: o.height, sill: o.sill }] });
          tallest = Math.max(tallest, o.sill + o.height);
        }
      }
      fc.pre(tallest > 0.6);
      const before = await snap(p);
      const newTop = round(0.5 + frac * (tallest - 0.5 - 0.001), 6);                   // below the tallest opening, still a positive wall
      const err = await p.execute(user, P, "bim_update_storeys", { items: [{ storey: "S1", set: { elevation: newTop } }] }).then(() => null, (e) => e);
      assert.equal(err?.reason, "DEPENDENT_ELEMENT_INVALID", String(err?.message));
      assert.equal(err.details.cause, "INVALID_HOST_RELATION");
      assert.deepEqual(await snap(p), before);
      void pick;
    }), { seed: SEED, numRuns: runs(40) });
});

test("P3 · reassigning walls moves their whole host graph; ids, links and unrelated elements unchanged; impossible targets reject the whole command", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  const wall = fc.record({ windows: fc.integer({ min: 0, max: 2 }), constrained: fc.boolean(), move: fc.boolean() });
  await fc.assert(fc.asyncProperty(fc.array(wall, { minLength: 1, maxLength: 4 }), fc.constantFrom("S0", "S1", "S2", "S3"), fc.integer({ min: 1, max: 5 }),
    async (walls, target, every) => {
      const policy = { everyEvents: every, keep: 2 };
      const { p, stores } = await base([-3, 0, 3, 6.5], policy);
      for (const [i, w] of walls.entries()) {
        await p.execute(user, P, "bim_create_walls", { walls: [{ storey: "S1", type: "W", start: [i * 10, 0], end: [i * 10 + 8, 0], ...(w.constrained ? { top_storey: "S3" } : { height: 2.8 }) }] });
        for (let k = 0; k < w.windows; k++) await p.execute(user, P, "bim_place_openings", { items: [{ kind: "window", host: `W-000${i + 1}`, along: 2 + k * 3, type: "N" }] });
      }
      const moving = walls.map((w, i) => (w.move ? `W-000${i + 1}` : null)).filter((x): x is string => !!x);
      fc.pre(moving.length > 0);
      const before = await state(p), snapBefore = await snap(p);
      const tid = Object.values(before.storeys).find((s) => s.name === target)!.id;
      const impossible = target === "S3" && walls.some((w) => w.move && w.constrained);                 // base = top: no height left
      const err = await p.execute(user, P, "bim_reassign_storey", { items: moving.map((id) => ({ id, storey: target })) }).then(() => null, (e) => e);
      if (impossible) {
        assert.equal(err?.reason, "INVALID_VERTICAL_CONSTRAINT", String(err?.message));
        assert.deepEqual(await snap(p), snapBefore);
        return;
      }
      if (target === "S1") { assert.ok(err, "reassigning to the same storey is a no-op command"); return; }
      assert.equal(err, null, String(err?.message));
      const after = await state(p);
      assert.deepEqual(Object.keys(after.elements).sort(), Object.keys(before.elements).sort());
      const graph = (id: string) => [id, ...Object.values(after.elements).filter((o: any) => o.kind === "opening" && o.host === id).flatMap((o: any) => [o.id, o.filledBy].filter(Boolean))];
      const moved = new Set(moving.flatMap(graph));
      for (const el of Object.values(after.elements) as any[]) {
        const was = before.elements[el.id] as any;
        if (moved.has(el.id)) {
          assert.equal(el.storey, tid, `${el.id} on the target storey`);
          const { storey: _a, height: _h, ...rest } = el, { storey: _b, height: _g, ...prev } = was;
          assert.deepEqual(rest, prev, `${el.id}: links and geometry unchanged`);
        } else assert.deepEqual(el, was, `${el.id} untouched`);
      }
      const full = await view(new Platform({ modules: [bimModule], stores, snapshotPolicy: false }));
      assert.equal(await view(new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet })), full);
      assert.equal(await view(p), full);
    }), { seed: SEED, numRuns: runs(40) });
});
