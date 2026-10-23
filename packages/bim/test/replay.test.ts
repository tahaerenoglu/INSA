/**
 * Phase 3 · event versioning and snapshots with the real BIM module.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Platform, MemoryStores, Actor, ModuleDef, NewEvent, canonicalJson, PlatformLogger, SnapshotPolicy } from "@insa/core";
import { bimModule, BimState, BIM_EVENT_VERSIONS, BIM_UPCASTERS, checkElement, quantities, toIfc } from "../src/index.js";

const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "replay";
const quiet: PlatformLogger = { info: () => {}, warn: () => {} };
const mk = (stores: MemoryStores, policy: SnapshotPolicy | false, mod: ModuleDef = bimModule) =>
  new Platform({ modules: [mod], stores, snapshotPolicy: policy, logger: quiet });
const run = async (p: Platform, tool: string, input: unknown) => {
  const r: any = await p.execute(user, P, tool, input);
  assert.ok(r.status === "applied" || r.status === "ok", JSON.stringify(r));
  return r;
};
const view = async (p: Platform) => canonicalJson({ bim: await p.state(P, "bim"), history: await p.history(P, 1e6) });

/**
 * Test-only "future" BIM schema, one version above production: in this fiction walls were once stored
 * as {from, to, h}. The chain is production's own steps (v1 -> ... -> CURRENT) followed by a test step
 * CURRENT -> CURRENT+1 that renames the fields — a real multi-step upcast chain.
 */
const CURRENT = BIM_EVENT_VERSIONS.ElementCreated, FUTURE = CURRENT + 1;
const legacyWallUpcaster = {
  type: "ElementCreated", fromVersion: CURRENT,
  upcast: (p: any) => p.kind === "wall" && "from" in p
    ? { id: p.id, kind: "wall", storey: p.storey, type: p.type, start: p.from, end: p.to, height: p.h, baseOffset: p.base ?? 0,
        prevDir: null, nextDir: null, exterior: null, vertical: p.vertical ?? { mode: "fixed" }, ...(p.name ? { name: p.name } : {}) }
    : p,
};
const bimV2: ModuleDef = { ...bimModule, eventVersions: { ...BIM_EVENT_VERSIONS, ElementCreated: FUTURE }, upcasters: [...BIM_UPCASTERS, legacyWallUpcaster] };

test("legacy BIM events: v1 walls upcast to the current shape, reduce, validate, export to IFC and can be undone", async () => {
  const stores = new MemoryStores();
  const p = mk(stores, { everyEvents: 3, keep: 3 }, bimV2);
  await run(p, "bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }] });
  await run(p, "bim_create_types", { types: [{ kind: "wall", name: "DD", layers: [{ material: "Tuğla", thickness: 0.2 }] }] });
  const s0 = await p.state<BimState>(P, "bim");
  const storey = Object.keys(s0.storeys)[0], type = Object.keys(s0.types)[0];
  // stored history from before the schema change (no schemaVersion, old field names)
  const st = stores.project(P);
  const base = { commandId: "CMD-legacy", actor: "old", at: "2025-12-01T00:00:00.000Z" };
  const legacy: NewEvent[] = [
    { ...base, module: "platform", type: "CommandApplied", payload: { tool: "bim_create_walls", summary: {} } },
    { ...base, module: "bim", type: "ElementCreated", payload: { id: "W-0900", kind: "wall", storey, type, from: [0, 0], to: [8, 0], h: 3.2, name: "Eski" } },
    { ...base, module: "bim", type: "ElementCreated", payload: { id: "W-0901", kind: "wall", storey, type, from: [8, 0], to: [8, 5], h: 3.2 } },
  ];
  await st.appendEvents(legacy, await st.lastSeq());
  const s = await p.state<BimState>(P, "bim");
  const w = s.elements["W-0900"] as any;
  assert.deepEqual([w.start, w.end, w.height, w.baseOffset, w.name], [[0, 0], [8, 0], 3.2, 0, "Eski"]);
  assert.equal((w as any).from, undefined);
  for (const id of ["W-0900", "W-0901"]) checkElement(s, s.elements[id]);
  assert.equal(quantities(s, w).length, 8);
  const ifc = toIfc(s, { projectKey: P });
  assert.match(ifc, /IFCWALL\(/); assert.equal(/NaN|Infinity/.test(ifc), false);
  // new writes use the current version
  await run(p, "bim_create_walls", { walls: [{ storey: "00", type: "DD", start: [0, 5], end: [8, 5], height: 3 }] });
  const created = (await st.readEvents()).filter((e) => e.type === "ElementCreated");
  assert.deepEqual(created.map((e) => e.schemaVersion), [undefined, undefined, FUTURE]);
  // the production module (ElementCreated v1) refuses this newer log instead of guessing
  await assert.rejects(mk(stores, false).state(P, "bim"), (e: any) => e.reason === "UNSUPPORTED_EVENT_VERSION");
  // undo walks back across the legacy command
  await run(p, "platform_undo", {});
  const u = await run(p, "platform_undo", {});
  assert.equal(u.summary.reverted, "CMD-legacy");
  assert.deepEqual(Object.keys((await p.state<BimState>(P, "bim")).elements), []);
  assert.equal(await view(mk(stores, { everyEvents: 3, keep: 3 }, bimV2)), await view(mk(stores, false, bimV2)));
});

test("BIM replay equivalence after every command: snapshot + tail == full replay (creates, multi-event, hosted, batch, delete, undo)", async () => {
  const stores = new MemoryStores();
  const p = mk(stores, { everyEvents: 3, keep: 2 });
  const steps: [string, unknown][] = [
    ["bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }, { name: "01", elevation: 3.2 }] }],
    ["bim_create_types", { types: [{ kind: "wall", name: "DD", layers: [{ material: "Sıva", thickness: 0.02, function: "finish" }, { material: "Tuğla", thickness: 0.2 }] },
                                   { kind: "slab", name: "D", layers: [{ material: "Beton", thickness: 0.2 }] }, { kind: "window", name: "P", width: 1.2, height: 1.2 },
                                   { kind: "door", name: "K", width: 1, height: 2.1 }] }],
    ["bim_create_walls", { walls: [{ storey: "00", type: "DD", points: [[0, 0], [12, 0], [12, 8], [0, 8]], closed: true, location_line: "exterior_face", height: 3 }] }],
    ["bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 3, type: "P" }, { kind: "door", host: "W-0001", along: 8, type: "K" }] }],
    ["bim_create_slabs", { slabs: [{ storey: "01", type: "D", outline: [[0, 0], [12, 0], [12, 8], [0, 8]], holes: [[[4, 3], [6, 3], [6, 5], [4, 5]]] }] }],
    ["bim_update_elements", { items: [{ id: "W-0002", kind: "wall", set: { height: 3.1 } }, { id: "W-0003", kind: "wall", set: { height: 3.1 } }, { id: "N-0001", kind: "window", set: { along: 4 } }] }],
    ["platform_undo", {}],
    ["bim_move_elements", { ids: ["W-0003"], vector: [0, 0.5] }],
    ["bim_delete_elements", { ids: ["W-0001"], cascade_hosted: true }],          // explicit cascade (Phase 6: no silent cascade)
    ["platform_undo", {}],
    ["platform_undo", {}],
    ["platform_undo", {}],
    ["bim_set_properties", { items: [{ ids: ["W-0002"], pset: "Pset_WallCommon", values: { IsExternal: true } }] }],
  ];
  for (const [tool, input] of steps) {
    await run(p, tool, input);
    const fresh = mk(stores, { everyEvents: 3, keep: 2 }), full = mk(stores, false);
    const [a, b, c] = [await view(fresh), await view(full), await view(p)];
    assert.equal(a, b, `after ${tool}: snapshot load != full replay`);
    assert.equal(c, b, `after ${tool}: live state != full replay`);
  }
  assert.ok(p.metrics.snapshotsWritten > 3);
  const s = await p.state<BimState>(P, "bim");
  assert.equal(Object.values(s.elements).filter((e) => e.kind === "wall").length, 4, "delete undone");
  assert.equal(Object.values(s.elements).filter((e) => e.kind === "boundary" && e.category === "architecture.floor").length, 0, "the third undo walked back to the slab command");
  assert.ok(s.elements["O-0001"] && s.elements["N-0001"], "hosted elements restored with their wall");
});
