/**
 * Phase 3 · property-based replay equivalence with the real BIM module (fast-check).
 * Reproducible: FC_SEED (default 20261007), FC_RUNS_FACTOR for longer runs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";
import { Platform, MemoryStores, Actor, canonicalJson, PlatformLogger } from "@insa/core";
import { bimModule, BimState } from "../src/index.js";

const SEED = Number(process.env.FC_SEED ?? 20261007), FACTOR = Number(process.env.FC_RUNS_FACTOR ?? 1);
const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "bimprop";
const quiet: PlatformLogger = { info: () => {}, warn: () => {} };
const view = async (p: Platform) => canonicalJson({ s: await p.state(P, "bim"), h: await p.history(P, 1e6) });
const idx = fc.integer({ min: 0, max: 7 });
const op = fc.oneof(
  fc.record({ t: fc.constant("wall"), x: fc.integer({ min: 0, max: 40 }), y: fc.integer({ min: 0, max: 40 }), len: fc.integer({ min: 2, max: 15 }) }),
  fc.record({ t: fc.constant("height"), i: idx, h: fc.double({ min: 2.4, max: 4, noNaN: true }) }),
  fc.record({ t: fc.constant("window"), i: idx, u: fc.double({ min: 0.2, max: 0.8, noNaN: true }) }),
  fc.record({ t: fc.constant("delete"), i: idx }),
  fc.record({ t: fc.constant("slab"), w: fc.integer({ min: 2, max: 20 }) }),
  fc.record({ t: fc.constant("undo") }));

test("G · BIM: full replay == snapshot + tail == live, for generated create / update / hosted / delete / undo histories", async (t) => {
  const runs = Math.round(25 * FACTOR);
  t.diagnostic(`fast-check seed=${SEED} numRuns=${runs}`);
  await fc.assert(fc.asyncProperty(fc.array(op, { minLength: 1, maxLength: 14 }), fc.integer({ min: 1, max: 6 }), async (ops, every) => {
    const stores = new MemoryStores();
    const policy = { everyEvents: every, keep: 2 };
    const live = new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet });
    const ex = (tool: string, input: unknown) => live.execute(user, P, tool, input).catch(() => undefined);   // rejected commands are part of life
    await ex("bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }] });
    await ex("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "m", thickness: 0.2 }] }, { kind: "slab", name: "S", layers: [{ material: "m", thickness: 0.2 }] },
                                           { kind: "window", name: "N", width: 1, height: 1 }] });
    for (const o of ops as any[]) {
      const walls = Object.values((await live.state<BimState>(P, "bim")).elements).filter((e) => e.kind === "wall").map((e) => e.id);
      const pick = (i: number) => walls.length ? walls[i % walls.length] : "W-0000";
      if (o.t === "wall") await ex("bim_create_walls", { walls: [{ storey: "00", type: "W", start: [o.x, o.y], end: [o.x + o.len, o.y], height: 3 }] });
      if (o.t === "height") await ex("bim_update_elements", { items: [{ id: pick(o.i), kind: "wall", set: { height: o.h } }] });
      if (o.t === "window") await ex("bim_place_openings", { items: [{ kind: "window", host: pick(o.i), along: 2, type: "N" }] });
      if (o.t === "delete") await ex("bim_delete_elements", { ids: [pick(o.i)], cascade_hosted: true });
      if (o.t === "slab") await ex("bim_create_slabs", { slabs: [{ storey: "00", type: "S", outline: [[0, 0], [o.w, 0], [o.w, o.w], [0, o.w]] }] });
      if (o.t === "undo") await ex("platform_undo", {});
    }
    const expected = await view(new Platform({ modules: [bimModule], stores, snapshotPolicy: false }));
    assert.equal(await view(new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet })), expected);
    assert.equal(await view(live), expected);
  }), { seed: SEED, numRuns: runs });
});
