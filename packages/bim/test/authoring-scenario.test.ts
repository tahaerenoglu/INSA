/**
 * Phase 10 · the real building-fragment scenario (18 steps) and the IFC checks of the authoring primitives.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, canonicalJson } from "@insa/core";
import { bimModule, BimState, Wall, Opening, modelIssues, planSvg, toIfc, wallFrame, quantities, SpatialContext, resolveSpatialElement, storeyRegions, ifcGuid } from "../src/index.js";
import { setup, wall, P, user } from "./authoring-fixture.js";

const hasIfcOpenShell = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.geom, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
const room = (s: BimState, id: string) => resolveSpatialElement(new SpatialContext(s), s.elements[id] as any);

const PROBE = `
import json, sys, ifcopenshell, ifcopenshell.geom, ifcopenshell.validate, ifcopenshell.util.element as ue, ifcopenshell.util.shape as us
f = ifcopenshell.open(sys.argv[1]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
st = ifcopenshell.geom.settings(); st.set("use-world-coords", True)
ident = lambda e: ue.get_psets(e).get("INSA_Identity", {}).get("Id")
walls = {}
for w in f.by_type("IfcWall"):
    g = ifcopenshell.geom.create_shape(st, w).geometry
    walls[ident(w)] = { "gid": w.GlobalId, "vol": round(us.get_volume(g), 6), "storey": ue.get_container(w).Name }
openings = {}
for o in f.by_type("IfcOpeningElement"):
    host = o.VoidsElements[0].RelatingBuildingElement if o.VoidsElements else None
    fills = [r.RelatedBuildingElement for r in o.HasFillings]
    openings[ident(o)] = { "host": ident(host) if host else None, "fills": sorted(ident(x) for x in fills), "fillCls": sorted(x.is_a() for x in fills) }
bad = 0
for e in f.by_type("IfcProduct"):
    if e.Representation:
        v = ifcopenshell.geom.create_shape(st, e).geometry.verts
        bad += sum(1 for x in v if x != x or abs(x) == float("inf"))
print(json.dumps({ "errors": len(log.statements), "walls": walls, "openings": openings, "badCoords": bad }))`;
const probe = (s: BimState, name: string) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-ifc10-")), `${name}.ifc`);
  const ifc = toIfc(s, { projectKey: P });
  assert.equal(/NaN|Infinity/.test(ifc), false, "no NaN / Infinity in the IFC text");
  fs.writeFileSync(file, ifc);
  return JSON.parse(execFileSync("python3", ["-c", PROBE, file]).toString()) as { errors: number; walls: Record<string, any>; openings: Record<string, any>; badCoords: number };
};
const expectedOpenings = (s: BimState) => Object.fromEntries(Object.values(s.elements).filter((e): e is Opening => e.kind === "opening")
  .map((o) => [o.id, { host: o.host, fills: o.filledBy ? [o.filledBy] : [] }]));

test("the 18-step scenario: build, edit with every primitive, validate, plan, IFC, snapshot, reload, undo, replay", { timeout: 200000 }, async () => {
  const policy = { everyEvents: 1000, keep: 3 };
  const t = await setup(policy);
  const { run, S, walls, join, tee } = t;
  const L0 = (s: BimState) => Object.values(s.storeys).find((x) => x.name === "L0")!;

  // 1-2  walls, explicit joins
  await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", points: [[0, 0], [10, 0], [10, 6], [0, 6]], closed: true, height: 3 }] });
  for (const [a, b] of [["W-0001", "W-0002"], ["W-0002", "W-0003"], ["W-0003", "W-0004"], ["W-0004", "W-0001"]]) await join(a, "end", b, "start");
  await walls([[[4, -1], [4, 6]]]);                                                            // the partition overshoots the south wall
  await tee("W-0005", "end", "W-0003");
  // 3  a door and two windows
  await run("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 2, type: "N" }, { kind: "window", host: "W-0001", along: 8.5, type: "N" }, { kind: "door", host: "W-0005", along: 3, type: "K" }] });
  const doorWorld = (s: BimState) => { const o = s.elements["O-0003"] as Opening, w = wall(s, o.host); return w.start[1] + o.along * Math.sign(w.end[1] - w.start[1]); };
  const doorY0 = doorWorld(await S());
  // 4  a room
  await run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 2, y: 3, number: "101" }] });
  const r0 = room(await S(), "SP-0001"), sig0 = storeyRegions(await S(), L0(await S()).id).map((g) => g.signature);
  assert.deepEqual([r0.status, r0.area, r0.perimeter], ["bounded", 60, 32], "one 10 x 6 region: the partition is not closed yet");
  const baseline = await S();

  // 5-7  split a boundary wall, the room is unchanged, merge it back
  const sp = await run("bim_split_wall", { wall: "W-0003", t: 0.25 });
  const r1 = room(await S(), "SP-0001");
  assert.deepEqual([r1.status, r1.area, r1.perimeter, sp.summary.walls], [r0.status, r0.area, r0.perimeter, ["W-0003", "W-0006"]], "room unchanged semantically after the split");
  await run("bim_merge_walls", { walls: ["W-0003", "W-0006"] });
  const afterMerge = await S();
  assert.deepEqual(storeyRegions(afterMerge, L0(afterMerge).id).map((g) => g.signature), sig0, "merge restored the region");
  assert.deepEqual([afterMerge.elements["W-0006"], Object.keys(afterMerge.elements).filter((k) => k.startsWith("W-")).length], [undefined, 5]);

  // 8-9  trim the partition to the south wall: a T junction, the door keeps its place, the region splits in two
  const tr = await run("bim_trim_wall", { wall: "W-0005", endpoint: "start", target: "W-0001" });
  let s = await S();
  assert.deepEqual([tr.summary.newPoint, tr.summary.join.kind, tr.summary.join.hostT, wallFrame(s, wall(s, "W-0005")).ends.start], [[4, 0], "endpoint_segment", 0.4, "tee_branch"]);
  assert.ok(Math.abs(doorWorld(s) - doorY0) < 1e-6, "the door did not move");
  assert.deepEqual(storeyRegions(s, L0(s).id).map((g) => g.area).sort((a, b) => a - b), [24, 36]);
  assert.equal(room(s, "SP-0001").area, 24, "the room follows its side of the partition");
  await run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 8.5, y: 3, number: "102" }] });
  assert.equal(room(await S(), "SP-0002").area, 36);

  // 10  extend a short wall to its target: a second partition appears
  await walls([[[7, 6], [7, 4]]]);                                                              // W-0007: ids are never reused (W-0006 was merged away)
  await tee("W-0007", "start", "W-0003");
  const ex = await run("bim_extend_wall", { wall: "W-0007", endpoint: "end", target: "W-0001" });
  s = await S();
  assert.deepEqual([ex.summary.newPoint, ex.summary.join.hostT, room(s, "SP-0002").area, room(s, "SP-0001").area], [[7, 0], 0.7, 18, 24]);
  const regionsNow = (await t.ex("bim_detect_spatial_regions", { include_occupied: false })).result.regions;
  assert.deepEqual(regionsNow.map((g: any) => g.area), [18], "the middle region is an unoccupied candidate: nothing was created automatically");

  // 11  rehost a window onto another wall
  const preRehost = canonicalJson(await S());
  await run("bim_rehost_opening", { opening: "O-0002", host: "W-0003", along: 5 });
  s = await S();
  assert.equal((s.elements["O-0002"] as Opening).host, "W-0003");

  // 12-14  validate, plan, IFC
  const v = (await t.ex("bim_validate", {})).result;
  assert.deepEqual(v.issues.filter((i: any) => i.severity === "error"), [], "validate");
  assert.deepEqual(modelIssues(s), []);
  const svg = planSvg(s, L0(s));
  assert.equal([...svg.matchAll(/stroke="#2c2f36"/g)].length >= 6, true, "plan draws the walls");
  if (hasIfcOpenShell) {
    const ifc = probe(s, "scenario");
    assert.equal(ifc.errors, 0, "IFC schema valid");
    assert.equal(ifc.badCoords, 0);
    assert.deepEqual(Object.keys(ifc.walls).sort(), ["W-0001", "W-0002", "W-0003", "W-0004", "W-0005", "W-0007"]);
    assert.deepEqual(Object.fromEntries(Object.entries(ifc.openings).map(([k, o]: [string, any]) => [k, { host: o.host, fills: o.fills }])), expectedOpenings(s), "opening / fill relations");
    // the clipped T branches: the partition runs 0..6 and is cut back 0.1 m at both ends; minus the door void
    assert.ok(Math.abs(ifc.walls["W-0005"].vol - (0.2 * 3 * 5.8 - 1 * 2.1 * 0.2)) < 1e-5, `partition volume ${ifc.walls["W-0005"].vol}`);
    for (const id of Object.keys(ifc.walls)) assert.equal(ifc.walls[id].gid, ifcGuid(`${P}:${id}`), "GlobalIds follow element ids");
  }

  // 15-16  snapshot and reload
  const snap = await t.p.createSnapshot(P);
  assert.equal(snap?.written, true);
  const live = canonicalJson(await S());
  const reloaded = new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy });
  assert.equal(canonicalJson(await reloaded.state(P, "bim")), live, "snapshot reload == live");
  assert.equal(reloaded.metrics.snapshotsLoaded, 1);

  // 17  undo the selected authoring command (the last one: the rehost); the snapshot that contains it must not be used
  await run("platform_undo", {});
  assert.equal(canonicalJson(await S()), preRehost, "undo restored the exact pre-rehost state");
  assert.equal((await S()).elements["O-0002"] && ((await S()).elements["O-0002"] as Opening).host, "W-0001");

  // 18  full replay and a reload after the undo equal the live state; the baseline model is still intact where nothing changed
  const full = await new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: false }).state<BimState>(P, "bim");
  const after = new Platform({ modules: [bimModule], stores: t.stores, snapshotPolicy: policy });
  assert.equal(canonicalJson(full), canonicalJson(await S()));
  assert.equal(canonicalJson(await after.state(P, "bim")), canonicalJson(full), "reload after the undo == replay");
  for (const id of ["W-0002", "W-0004", "O-0001", "N-0001"]) assert.equal(canonicalJson(full.elements[id]), canonicalJson(baseline.elements[id]), `${id} untouched by every edit`);
  assert.deepEqual([room(full, "SP-0001").status, room(full, "SP-0002").status], ["bounded", "bounded"]);
});

test("IFC after split and merge (IfcOpenShell): wall count +1 / −1, valid hosted relations, 0 schema errors, stable GlobalIds of unchanged elements", { skip: !hasIfcOpenShell, timeout: 120000 }, async () => {
  const { run, S, roomModel } = await setup();
  await roomModel();
  const a = probe(await S(), "base");
  assert.equal(a.errors, 0);
  await run("bim_split_wall", { wall: "W-0001", t: 0.5 });
  const b = probe(await S(), "split"), s = await S();
  assert.deepEqual([b.errors, Object.keys(b.walls).length, Object.keys(a.walls).length], [0, 6, 5]);
  assert.deepEqual(Object.fromEntries(Object.entries(b.openings).map(([k, o]: [string, any]) => [k, { host: o.host, fills: o.fills }])), expectedOpenings(s));
  assert.equal(b.openings["O-0002"].host, "W-0006", "the window moved to the new half");
  for (const id of ["W-0002", "W-0003", "W-0004", "W-0005"]) assert.equal(b.walls[id].gid, a.walls[id].gid, `${id}: stable GlobalId`);
  assert.ok(Math.abs(b.walls["W-0001"].vol + b.walls["W-0006"].vol - a.walls["W-0001"].vol) < 1e-4, "the two halves have the original's volume (window void included)");
  await run("bim_merge_walls", { walls: ["W-0001", "W-0006"] });
  const c = probe(await S(), "merged");
  assert.deepEqual([c.errors, Object.keys(c.walls).length, c.badCoords], [0, 5, 0]);
  assert.equal(c.walls["W-0006"], undefined, "the merged-away wall is gone (its GlobalId is not kept)");
  for (const id of Object.keys(a.walls)) assert.equal(c.walls[id].gid, a.walls[id].gid);
  assert.ok(Math.abs(c.walls["W-0001"].vol - a.walls["W-0001"].vol) < 1e-5);
  void user; void quantities;
});
