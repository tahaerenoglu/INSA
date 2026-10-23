/**
 * Phase 3 · property-based replay equivalence (fast-check).
 * Reproducible: FC_SEED (default 20261007), FC_RUNS_FACTOR for longer runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { z } from "zod";
import { Platform, MemoryStores, Actor, ModuleDef, canonicalJson, PlatformLogger } from "../src/index.js";

const SEED = Number(process.env.FC_SEED ?? 20261007), FACTOR = Number(process.env.FC_RUNS_FACTOR ?? 1);
const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "prop";
const quiet: PlatformLogger = { info: () => {}, warn: () => {} };
const acc: ModuleDef<{ n: number; items: Record<string, number> }> = {
  id: "acc", title: "acc", initialState: () => ({ n: 0, items: {} }), eventVersions: { Inc: 1, Set: 1 },
  apply(s, e) { if (e.type === "Inc") s.n += e.payload.by; if (e.type === "Set") s.items[e.payload.key] = e.payload.value; return s; },
  tools: [
    { kind: "command", effect: "write", module: "acc", name: "inc", title: "", description: "", permission: "bim.write", input: z.object({ by: z.number() }),
      decide: (_s, i) => ({ events: [{ type: "Inc", payload: i }], summary: i }) },
    { kind: "command", effect: "write", module: "acc", name: "multi", title: "", description: "", permission: "bim.write", input: z.object({ k: z.number() }),
      decide: (_s, i) => ({ events: Array.from({ length: i.k }, (_, j) => ({ type: "Set", payload: { key: `m${j}`, value: i.k } })), summary: i }) },
  ],
};
const op = fc.oneof(
  fc.record({ t: fc.constant("inc"), by: fc.integer({ min: -50, max: 50 }) }),
  fc.record({ t: fc.constant("multi"), k: fc.integer({ min: 1, max: 5 }) }),
  fc.record({ t: fc.constant("undo") }));
const view = async (p: Platform) => canonicalJson({ s: await p.state(P, "acc"), h: await p.history(P, 1e6) });

test("G · full replay == snapshot + tail == live state, for generated histories, policies and a corrupted newest snapshot", async (t) => {
  const runs = Math.round(80 * FACTOR);
  t.diagnostic(`fast-check seed=${SEED} numRuns=${runs}`);
  await fc.assert(fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 25 }), fc.integer({ min: 1, max: 6 }), fc.integer({ min: 1, max: 4 }), fc.boolean(),
    async (ops, every, keep, corrupt) => {
      const stores = new MemoryStores();
      const policy = { everyEvents: every, keep };
      const live = new Platform({ modules: [acc], stores, snapshotPolicy: policy, logger: quiet });
      for (const o of ops) {
        if (o.t === "undo") await live.execute(user, P, "platform_undo", {}).catch((e) => assert.equal(e.reason, "NOTHING_TO_UNDO"));
        else await live.execute(user, P, o.t, o.t === "inc" ? { by: (o as any).by } : { k: (o as any).k });
      }
      const st = stores.project(P) as any;
      const ev = await st.readEvents();
      for (const s of st.snapshots) assert.ok(!ev[s.lastSeq] || ev[s.lastSeq].commandId !== ev[s.lastSeq - 1].commandId, "snapshot at a command boundary");
      if (corrupt && st.snapshots.length) st.snapshots.at(-1).body = st.snapshots.at(-1).body.slice(0, -7) + "garbage";
      const full = new Platform({ modules: [acc], stores, snapshotPolicy: false });
      const fresh = new Platform({ modules: [acc], stores, snapshotPolicy: policy, logger: quiet });
      const expected = await view(full);
      assert.equal(await view(fresh), expected);
      assert.equal(await view(live), expected);
      assert.equal(await view(new Platform({ modules: [acc], stores, snapshotPolicy: policy, logger: quiet })), expected, "deterministic");
    }), { seed: SEED, numRuns: runs });
});
