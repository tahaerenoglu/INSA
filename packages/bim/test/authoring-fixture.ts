/**
 * Shared fixture for the Phase 10 authoring tests (not a test file: the npm test glob only runs *.test.ts).
 */
import assert from "node:assert/strict";
import { Platform, MemoryStores, Actor, canonicalJson, PlatformLogger, NewEvent } from "@insa/core";
import { bimModule, BimState, Wall, Opening } from "../src/index.js";

export const P = "auth";
const quiet: PlatformLogger = { info: () => {}, warn: () => {} };
export const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
export const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
export const nearPt = (a: number[], b: number[], tol = 1e-6) => a.every((v, i) => near(v, b[i], tol));
export const EVENT_TYPES = new Set(["ElementCreated", "ElementUpdated", "ElementDeleted", "WallJoinCreated", "WallJoinUpdated", "WallJoinDeleted", "CountersSet"]);

export async function setup(policy: { everyEvents: number; keep: number } | false = false) {
  const stores = new MemoryStores();
  const p = new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet });
  const ex = async (tool: string, input: unknown, opts?: { dryRun?: boolean }) => (await p.execute(user, P, tool, input, opts)) as any;
  const run = async (tool: string, input: unknown) => { const r = await ex(tool, input); assert.equal(r.status, "applied", JSON.stringify(r)); return r; };
  await run("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3.2 }] });
  await run("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "m", thickness: 0.2 }] }, { kind: "wall", name: "W30", layers: [{ material: "m", thickness: 0.3 }] },
    { kind: "door", name: "K", width: 1, height: 2.1 }, { kind: "window", name: "N", width: 1, height: 1.2 }] });
  const S = () => p.state<BimState>(P, "bim");
  const walls = (segs: [number[], number[]][], extra: Record<string, unknown> = {}) =>
    run("bim_create_walls", { walls: segs.map(([a, b]) => ({ storey: "L0", type: "W", start: a, end: b, height: 3, ...extra })) });
  const join = (a: string, ea: string, b: string, eb: string) => run("bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: a, endpoint: ea }, { wall: b, endpoint: eb }] });
  const tee = (wall: string, ep: string, host: string) => run("bim_join_walls", { kind: "endpoint_segment", endpoint: { wall, endpoint: ep }, host });
  /** raw (legacy-style) events appended as one command: the only way to give a wall an exterior side etc. */
  const inject = async (events: { type: string; payload: unknown; v: number }[]) => {
    const st = stores.project(P), b = { commandId: `CMD-i${Math.random().toString(36).slice(2)}`, actor: "x", at: "2026-01-01T00:00:00.000Z" };
    await st.appendEvents([{ ...b, module: "platform", type: "CommandApplied", payload: { tool: "inject", summary: {} }, schemaVersion: 1 } as NewEvent,
      ...events.map((e) => ({ ...b, module: "bim", type: e.type, payload: e.payload, schemaVersion: e.v }) as NewEvent)], await st.lastSeq());
  };
  const snap = async () => ({ e: (await p.store(P).readEvents()).length, s: canonicalJson(await S()) });
  async function rejected(tool: string, input: unknown, reason: string, details: Record<string, unknown> = {}) {
    const before = await snap();
    let err: any;
    await assert.rejects(p.execute(user, P, tool, input), (e: any) => { err = e; return true; });
    assert.equal(err.reason, reason, `${tool}: ${err.reason} ${err.message}`);
    for (const [k, v] of Object.entries(details)) assert.equal(err.details?.[k], v, `details.${k} = ${err.details?.[k]}`);
    assert.deepEqual(await snap(), before, "no event and no state change");
    return err;
  }
  /** a 10 x 6 room (joined loop W-0001..4), a tee-joined partition W-0005 at x = 4, windows O-0001 (along 2) / O-0002 (along 7) on W-0001, a door O-0003 in W-0005, rooms SP-0001 / SP-0002 */
  async function roomModel() {
    await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", points: [[0, 0], [10, 0], [10, 6], [0, 6]], closed: true, height: 3 }] });
    for (const [a, b] of [["W-0001", "W-0002"], ["W-0002", "W-0003"], ["W-0003", "W-0004"], ["W-0004", "W-0001"]]) await join(a, "end", b, "start");
    await walls([[[4, 0], [4, 6]]]);
    await tee("W-0005", "start", "W-0001"); await tee("W-0005", "end", "W-0003");
    await run("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 2, type: "N" }, { kind: "window", host: "W-0001", along: 7, type: "N" }, { kind: "door", host: "W-0005", along: 3, type: "K" }] });
    await run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 2, y: 3 }, { category: "architecture.room", storey: "L0", x: 7, y: 3 }] });
  }
  return { p, stores, ex, run, S, walls, join, tee, inject, snap, rejected, roomModel };
}
export const center = (s: BimState, opId: string): [number, number] => {
  const o = s.elements[opId] as Opening, w = s.elements[o.host] as Wall, L = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]);
  return [w.start[0] + ((w.end[0] - w.start[0]) / L) * o.along, w.start[1] + ((w.end[1] - w.start[1]) / L) * o.along];
};

export const wall = (s: BimState, id: string) => s.elements[id] as Wall;
