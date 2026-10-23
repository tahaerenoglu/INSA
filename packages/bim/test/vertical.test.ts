/**
 * Phase 5 · vertical constraints, storey propagation and storey reassignment.
 * Every rejection is checked to leave the event log and the committed state unchanged.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, MemoryStores, FileStores, ArtifactStore, Actor, canonicalJson, PlatformLogger } from "@insa/core";
import { bimModule, BimState, toIfc, BIM_EVENT_VERSIONS } from "../src/index.js";

const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "vert";
const quiet: PlatformLogger = { info: () => {}, warn: () => {} };

async function setup(policy: { everyEvents: number; keep: number } | false = false) {
  const stores = new MemoryStores();
  const p = new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet,
                           artifacts: new ArtifactStore(fs.mkdtempSync(path.join(os.tmpdir(), "insa-p5-"))) });
  const run = async (tool: string, input: unknown) => {
    const r: any = await p.execute(user, P, tool, input);
    assert.ok(r.status === "applied" || r.status === "ok", JSON.stringify(r));
    return r;
  };
  await run("bim_create_storeys", { storeys: [{ name: "B1", elevation: -3 }, { name: "L0", elevation: 0 }, { name: "L1", elevation: 3 }, { name: "L2", elevation: 6.5 }] });
  await run("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "Tuğla", thickness: 0.2 }] }, { kind: "column", name: "C", profile: { shape: "rect", b: 0.4, h: 0.4 } },
    { kind: "beam", name: "B", profile: { shape: "rect", b: 0.3, h: 0.5 } }, { kind: "slab", name: "S", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "window", name: "N", width: 1, height: 1.2 }, { kind: "door", name: "K", width: 1, height: 2.1 }] });
  return { p, stores, run };
}
const ID = async (p: Platform, name: string) => Object.values((await p.state<BimState>(P, "bim")).storeys).find((x) => x.name === name)!.id;
const el = async (p: Platform, id: string) => (await p.state<BimState>(P, "bim")).elements[id] as any;
const snap = async (p: Platform) => ({ e: (await p.store(P).readEvents()).length, s: JSON.stringify(await p.state(P, "bim")) });
async function rejected(p: Platform, tool: string, input: unknown, reason: string, details: Record<string, unknown> = {}) {
  const before = await snap(p);
  let err: any;
  await assert.rejects(p.execute(user, P, tool, input), (e: any) => { err = e; return true; });
  assert.equal(err.reason, reason, `${tool}: ${err.reason} ${err.message}`);
  for (const [k, v] of Object.entries(details)) assert.equal(err.details?.[k], v, `details.${k} = ${err.details?.[k]}`);
  assert.deepEqual(await snap(p), before, "no event and no state change");
  return err;
}
const q = async (p: Platform, tool: string, input: unknown = {}) => ((await p.execute(user, P, tool, input)) as any).result;

describe("creation semantics", () => {
  test("explicit height is fixed; no height -> constrained to the next storey (by id); top_storey -> constrained; no storey above -> fixed 3.0", async () => {
    const { p, run } = await setup();
    await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [8, 0], height: 2.7 },
                                            { storey: "L0", type: "W", start: [0, 4], end: [8, 4] },
                                            { storey: "L0", type: "W", start: [0, 8], end: [8, 8], top_storey: "L2" },
                                            { storey: "L2", type: "W", start: [0, 12], end: [8, 12] }] });
    const L1 = await ID(p, "L1"), L2 = await ID(p, "L2");
    assert.deepEqual([(await el(p, "W-0001")).vertical, (await el(p, "W-0001")).height], [{ mode: "fixed" }, 2.7]);
    assert.deepEqual([(await el(p, "W-0002")).vertical, (await el(p, "W-0002")).height], [{ mode: "storey", storey: L1 }, 3]);
    assert.deepEqual([(await el(p, "W-0003")).vertical, (await el(p, "W-0003")).height], [{ mode: "storey", storey: L2 }, 6.5]);
    assert.deepEqual([(await el(p, "W-0004")).vertical, (await el(p, "W-0004")).height], [{ mode: "fixed" }, 3]);
    await run("bim_create_storeys", { storeys: [{ name: "L3", elevation: 9.5 }] });        // the fallback never attaches to a later storey
    await run("bim_update_storeys", { items: [{ storey: "L3", set: { elevation: 10 } }] }).catch(() => {});
    assert.deepEqual([(await el(p, "W-0004")).vertical, (await el(p, "W-0004")).height], [{ mode: "fixed" }, 3]);
    await rejected(p, "bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 20], end: [8, 20], height: 3, top_storey: "L1" }] }, "INVALID_VERTICAL_CONSTRAINT");
    await rejected(p, "bim_create_walls", { walls: [{ storey: "L1", type: "W", start: [0, 20], end: [8, 20], top_storey: "L0" }] }, "INVALID_VERTICAL_CONSTRAINT");
  });
});

describe("storey elevation propagation", () => {
  test("1-4 · fixed wall unchanged; constrained wall / column / auto beam follow their storeys", async () => {
    const { p, run } = await setup();
    await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [8, 0], height: 3 }, { storey: "L0", type: "W", start: [0, 4], end: [8, 4] }] });
    await run("bim_create_columns", { columns: [{ storey: "L0", type: "C", at: [4, 2], top_storey: "L2" }] });
    await run("bim_create_beams", { beams: [{ storey: "L0", type: "B", start: [0, 2], end: [8, 2] }] });
    const r = await run("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.2 } }, { storey: "L2", set: { elevation: 7 } }] });
    assert.deepEqual(r.summary.propagated, ["B-0001", "C-0001", "W-0002"]);
    assert.equal((await el(p, "W-0001")).height, 3, "1 · fixed");
    assert.equal((await el(p, "W-0002")).height, 3.2, "2 · constrained wall");
    assert.equal((await el(p, "C-0001")).height, 7, "3 · constrained column");
    assert.equal((await el(p, "B-0001")).z, 3.2, "4 · auto beam");
  });

  test("6-7 · base and target changed in one command use the FINAL elevations, whatever the item order", async () => {
    const results: string[] = [];
    for (const order of [0, 1]) {
      const { p, run } = await setup();
      await run("bim_create_walls", { walls: [{ storey: "L1", type: "W", start: [0, 0], end: [8, 0], top_storey: "L2" }] });
      assert.equal((await el(p, "W-0001")).height, 3.5);
      const items = [{ storey: "L1", set: { elevation: 3.5 } }, { storey: "L2", set: { elevation: 7.5 } }];
      await run("bim_update_storeys", { items: order ? items.reverse() : items });
      assert.equal((await el(p, "W-0001")).height, 4);
      results.push(JSON.stringify(await p.state(P, "bim")));
    }
    assert.equal(results[0], results[1]);
  });

  test("8 · a propagated wall that becomes too short for its window rejects the whole command", async () => {
    const { p, run } = await setup();
    await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [8, 0] }] });
    await run("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 4, type: "N", sill: 1.5 }] });   // top at 2.7
    await rejected(p, "bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 2.5 } }] }, "DEPENDENT_ELEMENT_INVALID",
      { dependentId: "O-0001", cause: "INVALID_HOST_RELATION" });
    assert.equal((await el(p, "W-0001")).height, 3);
  });

  test("legacy-style fixed values are never re-interpreted from numbers", async () => {
    const { p, run } = await setup();
    await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [8, 0], height: 3 }] });   // equals L1 - L0 by coincidence
    await run("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.4 } }] });
    assert.deepEqual([(await el(p, "W-0001")).height, (await el(p, "W-0001")).vertical], [3, { mode: "fixed" }]);
  });
});

describe("update semantics", () => {
  test("switching fixed <-> constrained, base_offset recompute, ambiguity refused; undo restores value and intent", async () => {
    const { p, run } = await setup();
    await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [8, 0], height: 2.7 }] });
    await run("bim_create_beams", { beams: [{ storey: "L0", type: "B", start: [0, 2], end: [8, 2], z: 2.6 }] });
    const L1 = await ID(p, "L1"), L2 = await ID(p, "L2");
    await run("bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { top_storey: "L1" } }] });
    assert.deepEqual([(await el(p, "W-0001")).vertical, (await el(p, "W-0001")).height], [{ mode: "storey", storey: L1 }, 3]);
    await run("bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { base_offset: 0.2 } }] });
    assert.equal((await el(p, "W-0001")).height, 2.8, "derived height follows the base offset");
    await run("bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { height: 2.5 } }] });
    assert.deepEqual([(await el(p, "W-0001")).vertical, (await el(p, "W-0001")).height], [{ mode: "fixed" }, 2.5]);
    await run("platform_undo", {});
    assert.deepEqual([(await el(p, "W-0001")).vertical, (await el(p, "W-0001")).height], [{ mode: "storey", storey: L1 }, 2.8]);
    await run("platform_undo", {}); await run("platform_undo", {});
    assert.deepEqual([(await el(p, "W-0001")).vertical, (await el(p, "W-0001")).height], [{ mode: "fixed" }, 2.7]);
    await rejected(p, "bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { height: 3, top_storey: "L1" } }] }, "INVALID_ELEMENT_UPDATE", { field: "top_storey" });
    await rejected(p, "bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { vertical: { mode: "fixed" } } }] }, "INVALID_ELEMENT_UPDATE", { field: "vertical" });
    await rejected(p, "bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { top_storey: "B1" } }] }, "INVALID_VERTICAL_CONSTRAINT");
    await run("bim_update_elements", { items: [{ id: "B-0001", kind: "beam", set: { target_storey: "L2" } }] });
    assert.deepEqual([(await el(p, "B-0001")).vertical, (await el(p, "B-0001")).z], [{ mode: "storey", storey: L2 }, 6.5]);
    await run("platform_undo", {});
    assert.deepEqual([(await el(p, "B-0001")).vertical, (await el(p, "B-0001")).z], [{ mode: "fixed" }, 2.6]);
  });
});

describe("storey reassignment", () => {
  test("9 · a wall takes its openings, door and window along; XY and relative values unchanged; 15 · undo", async () => {
    const { p, run } = await setup();
    await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [8, 0], height: 3, base_offset: 0.1 }] });
    await run("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 6, type: "N" }, { kind: "door", host: "W-0001", along: 2, type: "K" }] });
    await run("bim_create_slabs", { slabs: [{ storey: "L0", type: "S", outline: [[0, 0], [8, 0], [8, 4], [0, 4]], offset: -0.2 }] });
    const before = (await p.state<BimState>(P, "bim")).elements;
    const L1 = await ID(p, "L1"), L0 = await ID(p, "L0");
    const r = await run("bim_reassign_storey", { items: [{ id: "W-0001", storey: "L1" }] });
    assert.deepEqual(r.summary.moved.sort(), ["D-0001", "N-0001", "O-0001", "O-0002", "W-0001"]);
    const s = await p.state<BimState>(P, "bim");
    for (const id of ["W-0001", "O-0001", "O-0002", "N-0001", "D-0001"]) {
      assert.equal(s.elements[id].storey, L1, id);
      const { storey: _a, ...rest } = s.elements[id] as any, { storey: _b, ...was } = before[id] as any;
      assert.deepEqual(rest, was, `${id}: everything but the storey unchanged`);
    }
    assert.equal(s.elements["S-0001"].storey, L0, "unrelated elements stay");
    await run("platform_undo", {});
    for (const id of ["W-0001", "O-0001", "N-0001", "D-0001"]) assert.equal((await el(p, id)).storey, L0);
  });

  test("10-11 · hosted elements cannot move alone; impossible constraint after reassignment is refused", async () => {
    const { p, run } = await setup();
    await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [8, 0] }] });   // constrained to L1
    await run("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 4, type: "N" }] });
    await rejected(p, "bim_reassign_storey", { items: [{ id: "O-0001", storey: "L1" }] }, "INVALID_HOST_RELATION", { hostId: "W-0001" });
    await rejected(p, "bim_reassign_storey", { items: [{ id: "N-0001", storey: "L1" }] }, "INVALID_HOST_RELATION");
    await rejected(p, "bim_reassign_storey", { items: [{ id: "W-0001", storey: "L2" }] }, "INVALID_VERTICAL_CONSTRAINT");   // L1 below L2
    const r = await run("bim_reassign_storey", { items: [{ id: "W-0001", storey: "B1" }] });                                 // keeps its target L1
    assert.ok(r.summary.moved.includes("W-0001"));
    assert.equal((await el(p, "W-0001")).height, 6, "recomputed against the new base: 3 - (-3)");
  });

  test("12-13 · reassign everything off a storey -> usage 0 -> the Phase 4 delete succeeds; constraint targets count as usage", async () => {
    const { p, run } = await setup();
    await run("bim_create_walls", { walls: [{ storey: "B1", type: "W", start: [0, 0], end: [8, 0], height: 2.8 }] });
    await run("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 4, type: "N" }] });
    await run("bim_create_columns", { columns: [{ storey: "B1", type: "C", at: [4, 2], height: 2.8 }] });
    await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 4], end: [8, 4] }] });   // constrained to L1
    assert.equal((await q(p, "bim_resource_usage", { kind: "storey", ref: "B1" })).usageCount, 4);
    await rejected(p, "bim_delete_storeys", { storeys: ["B1"] }, "RESOURCE_IN_USE");
    const e = await rejected(p, "bim_delete_storeys", { storeys: ["L1"] }, "RESOURCE_IN_USE");
    assert.match(e.details.usageSummary, /1 wall constrained to it/);
    await run("bim_reassign_storey", { items: [{ id: "W-0001", storey: "L0" }, { id: "C-0001", storey: "L0" }] });
    assert.equal((await q(p, "bim_resource_usage", { kind: "storey", ref: "B1" })).usageCount, 0);
    await run("bim_delete_storeys", { storeys: ["B1"] });
  });
});

test("queries expose vertical intent: constrained_to, affected_by_storey, vertical_mode, get_element", async () => {
  const { p, run } = await setup();
  await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [8, 0] }, { storey: "L0", type: "W", start: [0, 4], end: [8, 4], height: 3 },
                                          { storey: "L1", type: "W", start: [0, 8], end: [8, 8] }] });
  const ids = async (input: unknown) => (await q(p, "bim_query_elements", input)).elements.map((x: any) => x.id).sort();
  assert.deepEqual(await ids({ constrained_to: "L1" }), ["W-0001"]);
  assert.deepEqual(await ids({ affected_by_storey: "L1" }), ["W-0001", "W-0003"]);
  assert.deepEqual(await ids({ vertical_mode: "fixed" }), ["W-0002"]);
  const row = (await q(p, "bim_query_elements", { ids: ["W-0001"] })).elements[0];
  assert.deepEqual(row.vertical, { mode: "storey", storey: await ID(p, "L1"), storey_name: "L1", height: 3 });
  assert.equal((await q(p, "bim_get_element", { id: "W-0002" })).vertical_info.mode, "fixed");
});

test("5 · a real Phase 4 project (events + version-1 snapshots) loads as fixed geometry; the old snapshots are ignored", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "insa-p4fx-"));
  fs.cpSync(path.join(import.meta.dirname, "fixtures/phase4-project"), path.join(dir, "phase4"), { recursive: true });
  const raw = fs.readFileSync(path.join(dir, "phase4/events.jsonl"), "utf8");
  const lines: string[] = [];
  const logger: PlatformLogger = { info: (e) => lines.push(e), warn: (e) => lines.push(e) };
  const p = new Platform({ modules: [bimModule], stores: new FileStores(dir), snapshotPolicy: { everyEvents: 1000, keep: 3 }, logger });
  const s = await p.state<BimState>("phase4", "bim");
  assert.ok(lines.includes("snapshot.ignored_incompatible") && p.metrics.snapshotsLoaded === 0, lines.join(","));
  const w1 = s.elements["W-0001"] as any, w2 = s.elements["W-0002"] as any, c = s.elements["C-0001"] as any, b = s.elements["B-0001"] as any;
  assert.deepEqual([w1.height, w2.height, c.height, b.z], [3, 2.7, 3, 3], "Phase 4 geometry preserved");
  for (const x of [w1, w2, c, b]) assert.deepEqual(x.vertical, { mode: "fixed" }, `${x.id} is fixed`);
  const L1 = Object.values(s.storeys).find((x) => x.name === "L1")!.id;
  const u = await p.execute(user, "phase4", "bim_update_storeys", { items: [{ storey: L1, set: { elevation: 3.3 } }] }) as any;
  assert.deepEqual(u.summary.propagated, [], "historical elements do not follow storeys");
  await p.execute(user, "phase4", "bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { top_storey: L1 } }] });
  assert.equal(((await p.state<BimState>("phase4", "bim")).elements["W-0001"] as any).height, 3.3, "an explicit Phase 5 constraint works on a historical wall");
  assert.ok(fs.readFileSync(path.join(dir, "phase4/events.jsonl"), "utf8").startsWith(raw), "history only appended to, never rewritten");
  for (const f of ["000000000012.json", "000000000020.json", "000000000026.json"])
    assert.equal(fs.readFileSync(path.join(dir, "phase4/snapshots", f), "utf8"), fs.readFileSync(path.join(import.meta.dirname, "fixtures/phase4-project/snapshots", f), "utf8"));
});

test("14-16 · undo restores propagated geometry and assignments; full replay == snapshot + tail == live after every step", async () => {
  const { p, stores, run } = await setup({ everyEvents: 3, keep: 2 });
  const steps: [string, unknown][] = [
    ["bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [8, 0] }, { storey: "L0", type: "W", start: [0, 4], end: [8, 4], height: 2.9 }] }],
    ["bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 4, type: "N" }] }],
    ["bim_create_columns", { columns: [{ storey: "L0", type: "C", at: [4, 2] }] }],
    ["bim_create_beams", { beams: [{ storey: "L0", type: "B", start: [0, 2], end: [8, 2] }] }],
    ["bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.3 } }] }],
    ["bim_reassign_storey", { items: [{ id: "W-0001", storey: "B1" }] }],
    ["bim_update_elements", { items: [{ id: "W-0002", kind: "wall", set: { top_storey: "L1" } }] }],
    ["platform_undo", {}], ["platform_undo", {}], ["platform_undo", {}],
    ["bim_update_storeys", { items: [{ storey: "L0", set: { elevation: 0.2 } }, { storey: "L1", set: { elevation: 3.2 } }] }],
  ];
  for (const [tool, input] of steps) {
    await run(tool, input);
    const v = async (x: Platform) => canonicalJson({ s: await x.state(P, "bim"), h: await x.history(P, 1e6) });
    const full = await v(new Platform({ modules: [bimModule], stores, snapshotPolicy: false }));
    assert.equal(await v(new Platform({ modules: [bimModule], stores, snapshotPolicy: { everyEvents: 3, keep: 2 }, logger: quiet })), full, `after ${tool}`);
    assert.equal(await v(p), full);
  }
  const s = await p.state<BimState>(P, "bim");
  assert.equal((s.elements["W-0001"] as any).height, 3, "after undoing the storey change and the reassignment: L1 3.2 - L0 0.2");
  assert.equal(s.elements["W-0001"].storey, await ID(p, "L0"));
  assert.ok(p.metrics.snapshotsWritten > 0);
  const ev = await stores.project(P).readEvents();
  assert.ok(ev.filter((e) => e.type === "ElementCreated").every((e) => e.schemaVersion === BIM_EVENT_VERSIONS.ElementCreated), "ElementCreated at the current version (3 since Phase 9)");
  assert.ok(ev.filter((e) => e.type === "ElementUpdated").every((e) => e.schemaVersion === 2), "ElementUpdated at v2");
});

const hasIfcOpenShell = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.geom"], { stdio: "ignore" }); return true; } catch { return false; } })();
test("IFC · world elevations, extrusion heights and storey containment after propagation, reassignment and undo (IfcOpenShell)", { skip: !hasIfcOpenShell }, async () => {
  const { p, run } = await setup();
  await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [8, 0], base_offset: 0.1 }, { storey: "L0", type: "W", start: [0, 4], end: [8, 4], height: 2.5 }] });
  await run("bim_place_openings", { items: [{ kind: "door", host: "W-0001", along: 4, type: "K" }] });
  await run("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.4 } }] });
  await run("bim_reassign_storey", { items: [{ id: "W-0002", storey: "L1" }] });
  const probe = (ifc: string) => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-ifc-")), "m.ifc");
    fs.writeFileSync(file, ifc);
    const py = `
import json, sys, ifcopenshell, ifcopenshell.geom, ifcopenshell.util.element as ue
f = ifcopenshell.open(sys.argv[1]); st = ifcopenshell.geom.settings(); st.set("use-world-coords", True); out = {}
for e in f.by_type("IfcWall") + f.by_type("IfcDoor"):
    v = ifcopenshell.geom.create_shape(st, e).geometry.verts; zs = v[2::3]
    out[e.Tag] = { "storey": ue.get_container(e).Name, "zmin": round(min(zs), 6), "zmax": round(max(zs), 6) }
print(json.dumps(out))`;
    return JSON.parse(execFileSync("python3", ["-c", py, file]).toString());
  };
  const g = probe(toIfc(await p.state<BimState>(P, "bim"), { projectKey: P }));
  assert.deepEqual(g["W-0001"], { storey: "L0", zmin: 0.1, zmax: 3.4 }, "constrained wall: storey + base offset .. derived top (3.4)");
  assert.deepEqual(g["W-0002"], { storey: "L1", zmin: 3.4, zmax: 5.9 }, "reassigned fixed wall moves with its new storey, no double elevation");
  assert.equal(g["D-0001"].storey, "L0", "the door is contained with its host");
  await run("platform_undo", {}); await run("platform_undo", {});
  const h = probe(toIfc(await p.state<BimState>(P, "bim"), { projectKey: P }));
  assert.deepEqual(h["W-0001"], { storey: "L0", zmin: 0.1, zmax: 3 });
  assert.deepEqual(h["W-0002"], { storey: "L0", zmin: 0, zmax: 2.5 });
});
