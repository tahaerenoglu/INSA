/**
 * Phase 4 · property-based tests for resource lifecycle (fast-check).
 * Reproducible: FC_SEED (default 20261007), FC_RUNS_FACTOR for longer runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { Platform, MemoryStores, Actor, canonicalJson, PlatformLogger } from "@insa/core";
import { bimModule, BimState } from "../src/index.js";

const SEED = Number(process.env.FC_SEED ?? 20261007), FACTOR = Number(process.env.FC_RUNS_FACTOR ?? 1);
const runs = (n: number) => Math.max(1, Math.round(n * FACTOR));
const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "rprop";
const quiet: PlatformLogger = { info: () => {}, warn: () => {} };
const snap = async (p: Platform) => ({ e: (await p.store(P).readEvents()).length, s: JSON.stringify(await p.state(P, "bim")) });

async function base(policy: { everyEvents: number; keep: number } | false = false) {
  const stores = new MemoryStores();
  const p = new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet });
  await p.execute(user, P, "bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }, { name: "01", elevation: 3 }] });
  await p.execute(user, P, "bim_create_types", { types: [{ kind: "wall", name: "T", layers: [{ material: "M", thickness: 0.2 }] }] });
  return { p, stores };
}

test("P1 · a resource with dependents can never be deleted; without dependents it can", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.integer({ min: 0, max: 6 }), fc.constantFrom("type", "storey", "material"), async (n, kind) => {
    const { p } = await base();
    if (n) await p.execute(user, P, "bim_create_walls", { walls: Array.from({ length: n }, (_, i) => ({ storey: "00", type: "T", start: [0, i], end: [5, i], height: 3 })) });
    const before = await snap(p);
    const tool = kind === "type" ? "bim_delete_types" : kind === "storey" ? "bim_delete_storeys" : "bim_delete_materials";
    const input = kind === "type" ? { types: [{ type: "T" }] } : kind === "storey" ? { storeys: ["00"] } : { materials: ["M"] };
    const r = await p.execute(user, P, tool, input).then(() => null, (e) => e);
    const expectedUses = kind === "material" ? 1 : n;                 // the material is used by type T regardless of walls
    if (expectedUses > 0) {
      assert.equal(r?.reason, "RESOURCE_IN_USE");
      assert.equal(r.details.usageCount, expectedUses);
      assert.deepEqual(await snap(p), before);
    } else assert.equal(r, null);
  }), { seed: SEED, numRuns: runs(40) });
});

const NAME_CHARS = fc.constantFrom(..."abcçdefgğhıijklmnoöprsştuüvyzABCÇĞİÖŞÜ0123456789-_. ".split(""));
const validName = fc.array(NAME_CHARS, { minLength: 1, maxLength: 24 }).map((a) => a.join("").trim()).filter((s) => s.length > 0);

test("P2 · renames keep identity and replay identically (full replay == snapshot + tail == live)", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  const op = fc.oneof(
    fc.record({ t: fc.constantFrom("storey", "material", "type"), name: validName }),
    fc.record({ t: fc.constant("undo") }));
  await fc.assert(fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 10 }), fc.integer({ min: 1, max: 5 }), async (ops, every) => {
    const policy = { everyEvents: every, keep: 2 };
    const { p, stores } = await base(policy);
    const ids = (s: BimState) => canonicalJson([Object.keys(s.storeys).sort(), Object.keys(s.materials).sort(), Object.keys(s.types).sort()]);
    const idsBefore = ids(await p.state<BimState>(P, "bim"));
    let renames = 0;                                                    // undo only walks back this property's own renames
    for (const o of ops as any[]) {
      if (o.t === "undo" && renames === 0) continue;
      const tool = o.t === "storey" ? "bim_update_storeys" : o.t === "material" ? "bim_update_materials" : o.t === "type" ? "bim_update_types" : "platform_undo";
      const input = o.t === "storey" ? { items: [{ storey: "L-0001", set: { name: o.name } }] }
        : o.t === "material" ? { items: [{ material: "M-0001", set: { name: o.name } }] }
        : o.t === "type" ? { items: [{ type: "WT-0001", kind: "wall", set: { name: o.name } }] } : {};
      const ok = await p.execute(user, P, tool, input).then(() => true, (e) => { assert.equal(e.reason, "DUPLICATE_RESOURCE", e.message); return false; });
      if (ok) renames += o.t === "undo" ? -1 : 1;
    }
    const v = async (x: Platform) => canonicalJson({ s: await x.state(P, "bim"), h: await x.history(P, 1e6) });
    const full = await v(new Platform({ modules: [bimModule], stores, snapshotPolicy: false }));
    assert.equal(await v(new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet })), full);
    assert.equal(await v(p), full);
    assert.equal(ids(await p.state<BimState>(P, "bim")), idsBefore, "ids never change");
  }), { seed: SEED, numRuns: runs(40) });
});

test("P3 · a delete batch containing one used resource deletes nothing", async (t) => {
  t.diagnostic(`fast-check seed=${SEED}`);
  await fc.assert(fc.asyncProperty(fc.integer({ min: 1, max: 5 }), fc.nat(), async (k, pos) => {
    const { p } = await base();
    await p.execute(user, P, "bim_create_types", { types: Array.from({ length: k }, (_, i) => ({ kind: "window", name: `U${i}`, width: 1, height: 1 })) });
    await p.execute(user, P, "bim_create_walls", { walls: [{ storey: "00", type: "T", start: [0, 0], end: [5, 0], height: 3 }] });
    const refs = Array.from({ length: k }, (_, i) => ({ type: `U${i}` }));
    refs.splice(pos % (k + 1), 0, { type: "T" });
    const before = await snap(p);
    const r = await p.execute(user, P, "bim_delete_types", { types: refs }).then(() => null, (e) => e);
    assert.equal(r?.reason, "RESOURCE_IN_USE");
    assert.deepEqual(await snap(p), before);
  }), { seed: SEED, numRuns: runs(40) });
});
