/**
 * Phase 8 · rooms, spaces and spatial boundaries (one spatial engine, boundaries derived from explicit topology).
 * Every rejection is checked to leave the event log and the committed state unchanged.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Platform, MemoryStores, FileStores, ArtifactStore, Actor, canonicalJson, PlatformLogger } from "@insa/core";
import { LEGACY_KIND_V3 } from "../src/index.js";
import { bimModule, BimState, toIfc, getCategory, listCategories, registerCategory, SpatialContext, resolveSpatialElement, storeyRegions, SpatialElement } from "../src/index.js";

/** The Phase 9 representation of a stored pre-Phase-9 state: the documented migration table, applied to the snapshot's own data. */
const toCanonical = (st: any) => ({ ...st, elements: Object.fromEntries(Object.entries(st.elements).map(([id, el]: [string, any]) => {
  const m = (LEGACY_KIND_V3 as any)[el.kind];
  if (!m) return [id, el];
  const { kind: _k, ...rest } = el;
  return [id, { ...rest, kind: m.kind, category: m.category, ...(m.placement ? { placement: m.placement } : {}) }];
})) });

const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "sp";
const quiet: PlatformLogger = { info: () => {}, warn: () => {} };
type Pt = [number, number];

async function setup(policy: { everyEvents: number; keep: number } | false = false) {
  const stores = new MemoryStores();
  const p = new Platform({ modules: [bimModule], stores, snapshotPolicy: policy, logger: quiet,
                           artifacts: new ArtifactStore(fs.mkdtempSync(path.join(os.tmpdir(), "insa-p8-"))) });
  const run = async (tool: string, input: unknown) => {
    const r: any = await p.execute(user, P, tool, input);
    assert.ok(r.status === "applied" || r.status === "ok", JSON.stringify(r));
    return r;
  };
  await run("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3 }, { name: "L2", elevation: 6.5 }] });
  await run("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "Tuğla", thickness: 0.2 }] },
    { kind: "door", name: "K", width: 1, height: 2.1 }, { kind: "window", name: "N", width: 1, height: 1.2 }] });
  const S = () => p.state<BimState>(P, "bim");
  /** A closed polyline loop whose corners are explicitly joined (join: false leaves them only touching). */
  const loop = async (pts: Pt[], o: { storey?: string; join?: boolean; skip?: number } = {}) => {
    const before = new Set(Object.keys((await S()).elements));
    await run("bim_create_walls", { walls: [{ storey: o.storey ?? "L0", type: "W", points: pts, closed: true, height: 3 }] });
    const ids = Object.keys((await S()).elements).filter((id) => !before.has(id)).sort();
    if (o.join !== false)
      for (let k = 0; k < ids.length; k++) if (k !== o.skip)
        await run("bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: ids[k], endpoint: "end" }, { wall: ids[(k + 1) % ids.length], endpoint: "start" }] });
    return ids;
  };
  /** A wall teed onto hosts at its start and / or end. */
  const partition = async (a: Pt, b: Pt, hostA?: string, hostB?: string, storey = "L0") => {
    const before = new Set(Object.keys((await S()).elements));
    await run("bim_create_walls", { walls: [{ storey, type: "W", start: a, end: b, height: 3 }] });
    const id = Object.keys((await S()).elements).find((x) => !before.has(x))!;
    if (hostA) await run("bim_join_walls", { kind: "endpoint_segment", endpoint: { wall: id, endpoint: "start" }, host: hostA });
    if (hostB) await run("bim_join_walls", { kind: "endpoint_segment", endpoint: { wall: id, endpoint: "end" }, host: hostB });
    return id;
  };
  return { p, stores, run, S, loop, partition };
}
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
const regions = async (p: Platform, storey = "L0") => (await q(p, "bim_detect_spatial_regions", { storey })).regions as any[];
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const R10x6: Pt[] = [[0, 0], [10, 0], [10, 6], [0, 6]];

// ============================================================================ A
describe("A · taxonomy and spatial engine", () => {
  test("room and space are spatial categories; the registry is deeply immutable; spatial categories cannot be families", async () => {
    assert.deepEqual([getCategory("architecture.room").engine, getCategory("mechanical.space").engine], ["spatial", "spatial"]);
    assert.ok(getCategory("architecture.room").capabilities.includes("roomBoundingConsumer"));
    assert.deepEqual(listCategories().filter((c) => c.engine === "spatial").map((c) => c.id), ["architecture.room", "mechanical.space"]);
    const c = getCategory("architecture.furniture") as any;
    assert.throws(() => c.capabilities.push("hosted"), TypeError);
    assert.throws(() => (listCategories()[0] as any).placements.push("x"), TypeError);
    assert.throws(() => { c.engine = "native"; }, TypeError);
    assert.equal(getCategory("architecture.furniture").capabilities.includes("hosted" as any), false);
    assert.throws(() => registerCategory({ id: "generic.thing", name: "x", discipline: "generic", engine: "nope" as any, capabilities: [], placements: [] }), (e: any) => e.reason === "INVALID_CATEGORY");
    const { p } = await setup();
    await rejected(p, "bim_create_spatial_elements", { items: [{ category: "architecture.furniture", storey: "L0", x: 1, y: 1, allow_unbounded: true }] }, "INVALID_SPATIAL_CATEGORY");
    await rejected(p, "bim_create_families", { families: [{ name: "R", category: "architecture.room", parameters: [], representation: { kind: "box", width: "w", depth: "d", height: "h" } }] }, "CATEGORY_ENGINE_MISMATCH");
  });
});

// ============================================================================ B
describe("B · boundary graph and faces", () => {
  test("rectangle, triangle and L shape: one bounded face each, exterior excluded, exact area / perimeter", async () => {
    const { p, loop } = await setup();
    await loop(R10x6);
    await loop([[20, 0], [24, 0], [20, 3]]);
    await loop([[30, 0], [36, 0], [36, 3], [33, 3], [33, 6], [30, 6]]);
    const rs = (await regions(p)).map((r) => [+r.area.toFixed(9), +r.perimeter.toFixed(9), r.holes.length, r.boundaryLocation]).sort((a: any, b: any) => a[0] - b[0]);
    assert.deepEqual(rs, [[6, 12, 0, "wall_centerline"], [27, 24, 0, "wall_centerline"], [60, 32, 0, "wall_centerline"]]);
  });
  test("touching is not joining: a closed but UNJOINED loop, or one open corner, bounds nothing; joining it closes it", async () => {
    const { p, run, loop } = await setup();
    const ids = await loop(R10x6, { join: false });
    assert.equal((await regions(p)).length, 0);
    await loop([[20, 0], [26, 0], [26, 4], [20, 4]], { skip: 3 });
    assert.equal((await regions(p)).length, 0, "one corner left unjoined");
    for (let k = 0; k < 4; k++) await run("bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: ids[k], endpoint: "end" }, { wall: ids[(k + 1) % 4], endpoint: "start" }] });
    assert.deepEqual((await regions(p)).map((r) => r.area), [60]);
  });
  test("dangling branches and crossing walls without topology never create or split regions; disconnected loops are all found", async () => {
    const { p, loop, partition, S } = await setup();
    const w = await loop(R10x6);
    const sig = (await regions(p))[0].regionSignature;
    await partition([7, 0], [7, 2], w[0]);                                  // dangling tee
    await partition([-1, 3], [11, 3]);                                      // crosses the whole room, no topology
    const rs = await regions(p);
    assert.deepEqual(rs.map((r) => [r.area, r.regionSignature]), [[60, sig]], "same region, same signature");
    assert.equal(Object.values((await S()).elements).filter((e) => e.kind === "wall").length, 6);
    await loop([[20, 0], [24, 0], [24, 4], [20, 4]]);
    assert.deepEqual((await regions(p)).map((r) => r.area).sort((a: number, b: number) => a - b), [16, 60]);
  });
});

// ============================================================================ C + D + E
describe("C/D/E · T-junction segmentation, multi-wall junctions, holes", () => {
  test("a tee-joined partition splits the region; the host wall stays one wall with parametric boundary references; host moves are followed", async () => {
    const { p, run, loop, partition, S } = await setup();
    const w = await loop(R10x6);
    const host = structuredClone((await S()).elements[w[0]]);
    await partition([4, 0], [4, 6], w[0], w[2]);
    const rs = await regions(p);
    assert.deepEqual(rs.map((r) => r.area).sort((a: number, b: number) => a - b), [24, 36]);
    assert.deepEqual((await S()).elements[w[0]], host, "the host wall is not split or changed");
    const left = rs.find((r) => r.area === 24);
    assert.ok(left.boundarySegments.some((x: any) => x.wallId === w[0] && Math.min(x.fromT, x.toT) === 0 && Math.max(x.fromT, x.toT) === 0.4), "W@0..0.4");
    const sigs = rs.map((r) => r.regionSignature).sort();
    await run("bim_move_elements", { ids: [w[1]], vector: [2, 0] });            // east wall moves: tees follow t, regions follow walls
    const moved = await regions(p);
    assert.deepEqual(moved.map((r) => r.regionSignature).sort(), sigs, "signatures stable: same topology");
    const areas = moved.map((r) => r.area).sort((a: number, b: number) => a - b);
    assert.ok(near(areas[0], 28.8) && near(areas[1], 43.2), `derived areas (never stored), within 1e-9: ${areas}`);
  });
  test("a four-member junction (degree 4) with tees to the outer square gives four regions, no duplicates", async () => {
    const { p, run, loop, partition } = await setup();
    const w = await loop([[0, 0], [10, 0], [10, 10], [0, 10]]);
    const arms = [await partition([5, 5], [5, 0], undefined, w[0]), await partition([5, 5], [10, 5], undefined, w[1]),
                  await partition([5, 5], [5, 10], undefined, w[2]), await partition([5, 5], [0, 5], undefined, w[3])];
    await run("bim_join_walls", { kind: "endpoint_endpoint", endpoints: arms.map((a) => ({ wall: a, endpoint: "start" })) });
    const rs = await regions(p);
    assert.deepEqual(rs.map((r) => r.area), [25, 25, 25, 25]);
    assert.equal(new Set(rs.map((r) => r.regionSignature)).size, 4);
  });
  test("a nested closed loop is a hole: annular region area / perimeter, the core is its own region", async () => {
    const { p, loop } = await setup();
    await loop([[0, 0], [12, 0], [12, 8], [0, 8]]);
    await loop([[5, 3], [7, 3], [7, 5], [5, 5]]);
    const rs = (await regions(p)).sort((a, b) => a.area - b.area);
    assert.deepEqual(rs.map((r) => [r.area, r.perimeter, r.holes.length]), [[4, 8, 0], [92, 48, 1]]);
    const [x, y] = rs[1].representativePoint;
    assert.ok(!(x > 5 && x < 7 && y > 3 && y < 5), "representative point is in the annulus, not in the hole");
  });
});

// ============================================================================ F + G
describe("F/G · rooms and spaces", () => {
  test("create, number / name, move inside and across regions; duplicate number and occupancy refused; room + space coexist; undo", async () => {
    const { p, run, loop, partition, S } = await setup();
    const w = await loop(R10x6);
    await partition([4, 0], [4, 6], w[0], w[2]);
    const c = await run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 2, y: 3, number: "101", name: "Meeting" }] });
    assert.deepEqual([c.summary.created[0].id, c.summary.created[0].status, c.summary.created[0].area, c.summary.created[0].height, c.summary.created[0].volume], ["SP-0001", "bounded", 24, 3, 72]);
    assert.deepEqual(Object.keys((await p.store(P).readEvents()).filter((e) => e.type === "ElementCreated").at(-1)!.payload as object).sort(),
      ["category", "height", "id", "kind", "name", "number", "point", "storey", "vertical"], "intent only: no polygon, no area persisted");
    await rejected(p, "bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 3, y: 1 }] }, "SPATIAL_REGION_OCCUPIED", { occupyingElementId: "SP-0001" });
    await rejected(p, "bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 7, y: 3, number: "101" }] }, "DUPLICATE_SPATIAL_NUMBER", { existingId: "SP-0001" });
    await rejected(p, "bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 4, y: 3 }] }, "SPATIAL_POINT_ON_BOUNDARY");
    await rejected(p, "bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 50, y: 3 }] }, "SPATIAL_REGION_NOT_FOUND");
    await run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 7, y: 3, number: "102" }, { category: "mechanical.space", storey: "L0", x: 2, y: 2, number: "101" }] });
    await rejected(p, "bim_update_elements", { items: [{ id: "SP-0001", kind: "spatial", set: { category: "mechanical.space" } }] }, "INVALID_ELEMENT_UPDATE", { field: "category" });
    await rejected(p, "bim_update_elements", { items: [{ id: "SP-0001", kind: "spatial", set: { x: 8 } }] }, "SPATIAL_REGION_OCCUPIED");
    await run("bim_update_elements", { items: [{ id: "SP-0001", kind: "spatial", set: { x: 1, y: 1, name: "Board", number: "101A" } }] });
    await run("bim_move_elements", { ids: ["SP-0002"], vector: [0.5, 0.5] });
    await rejected(p, "bim_move_elements", { ids: ["SP-0002"], vector: [20, 0] }, "SPATIAL_REGION_NOT_FOUND");
    const s = await S();
    assert.deepEqual([(s.elements["SP-0001"] as SpatialElement).point, s.elements["SP-0001"].name, (s.elements["SP-0001"] as SpatialElement).number], [[1, 1], "Board", "101A"]);
    for (let k = 0; k < 3; k++) await run("platform_undo", {});
    const b = await S();
    assert.deepEqual([(b.elements["SP-0001"] as SpatialElement).point, (b.elements["SP-0001"] as SpatialElement).number, b.elements["SP-0003"]], [[2, 3], "101", undefined]);
  });
});

// ============================================================================ H + J
describe("H/J · unbounded lifecycle and room-bounding walls", () => {
  test("allow_unbounded; an unjoined corner makes a room unbounded (no event for the room, no fake area); rejoining restores the same element", async () => {
    const { p, run, loop, partition } = await setup();
    const w = await loop(R10x6);
    await partition([4, 0], [4, 6], w[0], w[2]);
    await run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 2, y: 3 }, { category: "architecture.room", storey: "L0", x: 7, y: 3 },
                                                       { category: "architecture.room", storey: "L0", x: 40, y: 40, allow_unbounded: true }] });
    const rows = async () => Object.fromEntries((await q(p, "bim_query_elements", { engine: "spatial" })).elements.map((e: any) => [e.id, [e.status, e.area]]));
    assert.deepEqual(await rows(), { "SP-0001": ["bounded", 24], "SP-0002": ["bounded", 36], "SP-0003": ["unbounded", null] });
    const corner = Object.values((await p.state<BimState>(P, "bim")).joins).find((j: any) => j.kind === "endpoint_endpoint" && j.members.some((m: any) => m.wall === w[0] && m.endpoint === "start"))!.id;
    const n = (await p.store(P).readEvents()).length;
    await run("bim_unjoin_walls", { join: corner });
    assert.ok((await p.store(P).readEvents()).slice(n).every((e) => !String((e.payload as any)?.id ?? "").startsWith("SP-")), "no spatial events");
    assert.deepEqual(await rows(), { "SP-0001": ["unbounded", null], "SP-0002": ["bounded", 36], "SP-0003": ["unbounded", null] });
    await run("bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: w[3], endpoint: "end" }, { wall: w[0], endpoint: "start" }] });
    assert.deepEqual((await rows())["SP-0001"], ["bounded", 24]);
  });
  test("room_bounding: false walls are ignored; merging two rooms by turning a wall off is refused; with one room it follows the merged region", async () => {
    const { p, run, loop, partition } = await setup();
    const w = await loop(R10x6);
    const part = await partition([4, 0], [4, 6], w[0], w[2]);
    assert.equal((await regions(p)).length, 2, "legacy-style walls (no flag) are room-bounding");
    await run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 2, y: 3 }, { category: "architecture.room", storey: "L0", x: 7, y: 3 }] });
    await rejected(p, "bim_update_elements", { items: [{ id: part, kind: "wall", set: { room_bounding: false } }] }, "SPATIAL_REGION_OCCUPIED");
    await run("bim_delete_elements", { ids: ["SP-0002"] });
    await run("bim_update_elements", { items: [{ id: part, kind: "wall", set: { room_bounding: false } }] });
    assert.equal((await regions(p)).length, 1);
    assert.equal((await q(p, "bim_get_element", { id: "SP-0001" })).spatial.area, 60, "the remaining room follows the merged region");
    await run("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, -5], end: [5, -5], height: 3, room_bounding: false }] });
    assert.equal(Object.values((await p.state<BimState>(P, "bim")).elements).find((e: any) => e.kind === "wall" && e.start[1] === -5 && (e as any).roomBounding === false) !== undefined, true);
    await run("platform_undo", {}); await run("platform_undo", {});
    assert.equal((await regions(p)).length, 2, "undo restores the partition's role");
  });
});

// ============================================================================ I
describe("I · storeys and vertical extent", () => {
  test("storey isolation; reassignment keeps the point, re-resolves and recomputes a constrained height; fixed height kept", async () => {
    const { p, run, loop } = await setup();
    await loop(R10x6);
    await loop([[20, 0], [30, 0], [30, 6], [20, 6]], { storey: "L1" });
    await run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 25, y: 3, top_storey: "L2", allow_unbounded: true },
      { category: "architecture.room", storey: "L0", x: 5, y: 3 }, { category: "mechanical.space", storey: "L0", x: 5, y: 3, height: 2.6 }] });
    const get = async (id: string) => (await q(p, "bim_get_element", { id })).spatial;
    assert.equal((await get("SP-0001")).status, "unbounded", "L1 walls never bound an L0 room");
    assert.deepEqual([(await get("SP-0002")).height, (await get("SP-0003")).height], [3, 2.6], "next-storey constrained / fixed");
    await run("bim_reassign_storey", { items: [{ id: "SP-0001", storey: "L1" }] });
    const r1 = await get("SP-0001");
    assert.deepEqual([r1.status, r1.area, r1.height], ["bounded", 60, 3.5], "now on L1: resolves there; height = L2 - L1");
    await run("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.2 } }] });
    assert.deepEqual([(await get("SP-0002")).height, (await get("SP-0001")).height, (await get("SP-0003")).height], [3.2, 3.3, 2.6]);
    await run("platform_undo", {}); await run("platform_undo", {});
    assert.equal((await p.state<BimState>(P, "bim")).elements["SP-0001"].storey, Object.values((await p.state<BimState>(P, "bim")).storeys).find((s) => s.name === "L0")!.id);
    await rejected(p, "bim_reassign_storey", { items: [{ id: "SP-0002", storey: "L2" }] }, "INVALID_VERTICAL_CONSTRAINT");
  });
});

// ============================================================================ K + L
describe("K/L · adjacency and queries", () => {
  test("rooms sharing a wall, door sides (interior / exterior), windows as boundary info; queries and detection outputs", async () => {
    const { p, run, loop, partition } = await setup();
    const w = await loop(R10x6);
    const part = await partition([4, 0], [4, 6], w[0], w[2]);
    await run("bim_place_openings", { items: [{ kind: "door", host: part, along: 3, type: "K" }, { kind: "door", host: w[0], along: 7, type: "K" }, { kind: "window", host: w[1], along: 3, type: "N" }] });
    await run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 2, y: 3, number: "1" }, { category: "architecture.room", storey: "L0", x: 7, y: 3, number: "2" },
                                                       { category: "mechanical.space", storey: "L0", x: 7, y: 3 }] });
    const [a] = await q(p, "bim_query_spatial_adjacency", { storey: "L0" });
    assert.deepEqual(a.adjacency.map((x: any) => [x.category, x.spatialElementA, x.spatialElementB, x.walls]), [["architecture.room", "SP-0001", "SP-0002", [{ wallId: part, intervals: [[0, 1]] }]]]);
    const inner = a.doors.find((d: any) => d.wallId === part), outer = a.doors.find((d: any) => d.wallId === w[0]);
    assert.deepEqual([inner.sides.length, inner.exteriorSide, inner.sides.flatMap((x: any) => x.spatialElements.map((e: any) => e.id)).sort()], [2, false, ["SP-0001", "SP-0002", "SP-0003"]]);
    assert.deepEqual([outer.sides.length, outer.exteriorSide, outer.sides[0].spatialElements.map((e: any) => e.id)], [1, true, ["SP-0002", "SP-0003"]]);
    assert.equal(a.windows.length, 1);
    assert.equal(a.adjacency.some((x: any) => x.walls.some((y: any) => y.wallId === w[1])), false, "a window creates no adjacency");
    // queries
    assert.deepEqual((await q(p, "bim_query_elements", { category: "architecture.room" })).elements.map((e: any) => [e.id, e.number, e.status, e.area, e.engine]),
      [["SP-0001", "1", "bounded", 24, "spatial"], ["SP-0002", "2", "bounded", 36, "spatial"]]);
    assert.equal((await q(p, "bim_query_elements", { discipline: "mechanical" })).elements.length, 1);
    const d = (await q(p, "bim_get_element", { id: "SP-0002" })).spatial;
    assert.deepEqual([d.status, d.boundaryLocation, d.outer.length, d.boundaryWalls.length, d.volume], ["bounded", "wall_centerline", 4, 4, 108]);
    assert.equal((await q(p, "bim_detect_spatial_regions", { include_occupied: false })).regions.length, 0);
    assert.equal((await q(p, "bim_detect_spatial_regions", { category: "mechanical.space" })).regions.find((r: any) => r.area === 24).occupiedBy.length, 0);
    const usage = await q(p, "bim_get_element_usage", { id: part });
    assert.equal(usage.usageCount, 3, "rooms are derived, not references: the partition's usage is its joins and opening only");
  });
});

// ============================================================================ M
test("M · a real Phase 7 project: no inferred rooms; its version-4 snapshot is ignored (state version 5), the replay equals what Phase 7 stored; detection finds the joined regions only", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "insa-p7fx-"));
  const src = path.join(import.meta.dirname, "fixtures/phase7-project");
  fs.cpSync(src, path.join(dir, "phase7"), { recursive: true });
  const raw = fs.readFileSync(path.join(dir, "phase7/events.jsonl"), "utf8");
  const lines: string[] = [];
  const p = new Platform({ modules: [bimModule], stores: new FileStores(dir), snapshotPolicy: { everyEvents: 1000, keep: 3 }, logger: { info: (e) => lines.push(e), warn: (e) => lines.push(e) } });
  const s = await p.state<BimState>("phase7", "bim");
  // Phase 9 (state version 5): the version-4 snapshot is ignored and the state rebuilt from the events
  assert.equal(p.metrics.snapshotsLoaded, 0);
  assert.equal(lines.includes("snapshot.ignored_incompatible"), true);
  const full = await new Platform({ modules: [bimModule], stores: new FileStores(dir), snapshotPolicy: false }).state<BimState>("phase7", "bim");
  assert.equal(canonicalJson(s), canonicalJson(full), "snapshot state == full replay under Phase 8 code");
  const stored = JSON.parse(JSON.parse(fs.readFileSync(path.join(src, "snapshots/000000000062.json"), "utf8")).body).state.bim;
  assert.deepEqual([full.mepSystems, full.mepJunctions], [{}, {}], "Phase 13: no MEP system / junction is ever inferred for an old project");
  assert.deepEqual(full.spatialUnits, {}, "Phase 14: no facility / facility part is ever inferred for an old project");
  const { mepSystems: _ms, mepJunctions: _mj, spatialUnits: _su, ...fullOld } = full;
  assert.equal(canonicalJson(fullOld), canonicalJson(toCanonical(stored)), "identical to what Phase 7 stored (Phase 9 representation)");
  assert.equal(Object.values(s.elements).some((e) => e.kind === "spatial"), false, "detection is not persistence");
  assert.equal(Object.keys(s.families).length, 1);
  const L0 = Object.values(s.storeys).find((x) => x.name === "L0")!.id;
  assert.deepEqual(storeyRegions(s, L0).map((r) => r.area).sort((a, b) => a - b), [24, 36], "the unjoined square encloses nothing");
  assert.ok(fs.readFileSync(path.join(dir, "phase7/events.jsonl"), "utf8") === raw, "event log unchanged");
});

// ============================================================================ N
test("N · mixed history: live == full replay == snapshot + tail, and the derived regions of every spatial element agree", async () => {
  const { p, stores, run, loop, partition } = await setup({ everyEvents: 4, keep: 2 });
  const w = await loop(R10x6);
  const L = (key: string) => ({ key, name: key, scope: "type", dataType: "length", required: true });
  await run("bim_create_families", { families: [{ name: "Desk", category: "architecture.furniture", parameters: [L("w"), L("d"), L("h")], representation: { kind: "box", width: "w", depth: "d", height: "h" } }] });
  await run("bim_create_types", { types: [{ kind: "component", name: "D", family: "Desk", parameters: { w: 1.6, d: 0.8, h: 0.75 } }] });
  let part = "";
  const steps: [string, () => Promise<unknown>][] = [
    ["room + space", () => run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 2, y: 3, number: "1" }, { category: "mechanical.space", storey: "L0", x: 6.5, y: 4 }] })],
    ["component", () => run("bim_create_components", { components: [{ type: "D", storey: "L0", x: 6, y: 2 }] })],
    ["wall move", () => run("bim_move_elements", { ids: [w[1]], vector: [1.5, 0] })],
    ["partition", async () => { part = await partition([5, 0], [5, 6], w[0], w[2]); }],
    ["room 2", () => run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 8, y: 3, number: "2" }] })],
    ["move room", () => run("bim_update_elements", { items: [{ id: "SP-0001", kind: "spatial", set: { x: 1.5 } }] })],
    ["unjoin corner", async () => { const j = Object.values((await p.state<BimState>(P, "bim")).joins).find((x: any) => x.kind === "endpoint_endpoint" && x.members.some((m: any) => m.wall === w[0] && m.endpoint === "start"))!; await run("bim_unjoin_walls", { join: j.id }); }],
    ["rejoin", () => run("bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: w[3], endpoint: "end" }, { wall: w[0], endpoint: "start" }] })],
    ["storey", () => run("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.3 } }] })],
    ["undo", () => run("platform_undo", {})], ["undo", () => run("platform_undo", {})], ["undo", () => run("platform_undo", {})],
  ];
  const derived = (s: BimState) => canonicalJson(Object.values(s.elements).filter((e): e is SpatialElement => e.kind === "spatial").sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((e) => { const r = resolveSpatialElement(new SpatialContext(s), e); return [e.id, r.status, r.regionSignature, r.area, r.volume]; }));
  for (const [label, step] of steps) {
    await step();
    const full = await new Platform({ modules: [bimModule], stores, snapshotPolicy: false }).state<BimState>(P, "bim");
    const fromSnap = await new Platform({ modules: [bimModule], stores, snapshotPolicy: { everyEvents: 4, keep: 2 }, logger: quiet }).state<BimState>(P, "bim");
    const live = await p.state<BimState>(P, "bim");
    assert.equal(canonicalJson(fromSnap), canonicalJson(full), `state after ${label}`);
    assert.equal(canonicalJson(live), canonicalJson(full));
    assert.equal(derived(fromSnap), derived(full), `derived after ${label}`);
    assert.equal(derived(live), derived(full));
  }
  assert.ok(p.metrics.snapshotsWritten > 0 && part);
});

// ============================================================================ P
const hasIfcOpenShell = (() => { try { execFileSync("python3", ["-c", "import ifcopenshell, ifcopenshell.geom, ifcopenshell.validate"], { stdio: "ignore" }); return true; } catch { return false; } })();
test("P · IFC: IfcSpace for rooms / spaces (aggregated by the storey, region body with a hole, quantities as INSA properties), unbounded without geometry (IfcOpenShell)", { skip: !hasIfcOpenShell }, async () => {
  const { p, run, loop } = await setup();
  await loop([[0, 0], [12, 0], [12, 8], [0, 8]], { storey: "L1" });
  await loop([[5, 3], [7, 3], [7, 5], [5, 5]], { storey: "L1" });
  const L = (key: string) => ({ key, name: key, scope: "type", dataType: "length", required: true });
  await run("bim_create_families", { families: [{ name: "Desk", category: "architecture.furniture", parameters: [L("w"), L("d"), L("h")], representation: { kind: "box", width: "w", depth: "d", height: "h" } }] });
  await run("bim_create_types", { types: [{ kind: "component", name: "D", family: "Desk", parameters: { w: 1.6, d: 0.8, h: 0.75 } }] });
  await run("bim_create_components", { components: [{ type: "D", storey: "L1", x: 2, y: 2 }] });
  await run("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L1", x: 1, y: 1, number: "201", name: "Office" },
    { category: "mechanical.space", storey: "L1", x: 6, y: 4, number: "S1" }, { category: "architecture.room", storey: "L0", x: 1, y: 1, allow_unbounded: true }] });
  const s = await p.state<BimState>(P, "bim");
  const ifc = toIfc(s, { projectKey: P });
  assert.equal(/NaN|Infinity/.test(ifc), false);
  const reps = (txt: string) => [...txt.matchAll(/IFCSPACE\('[^']*',\$,'[^']*',\$,'[^']*',#\d+,(\$|#\d+),/g)].map((m) => m[1]);
  assert.deepEqual(reps(ifc).map((x) => x === "$"), [false, false, true], "bounded spaces have a body, the unbounded one none");
  assert.deepEqual(reps(toIfc(s, { projectKey: P, spaceGeometry: false })), ["$", "$", "$"], "viewer variant: spaces without body");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "insa-ifc8-")), "m.ifc");
  fs.writeFileSync(file, ifc);
  const py = `
import json, sys, ifcopenshell, ifcopenshell.geom, ifcopenshell.validate, ifcopenshell.util.element as ue, ifcopenshell.util.shape as us
f = ifcopenshell.open(sys.argv[1]); log = ifcopenshell.validate.json_logger(); ifcopenshell.validate.validate(f, log)
st = ifcopenshell.geom.settings(); st.set("use-world-coords", True); out = {}
for e in f.by_type("IfcSpace"):
    agg = ue.get_aggregate(e); ps = ue.get_psets(e).get("INSA_Spatial", {})
    row = { "storey": agg.Name if agg else None, "name": e.Name, "long": e.LongName, "status": ps.get("Status"), "area": ps.get("Area"), "volume": ps.get("Volume"), "category": ps.get("Category") }
    if e.Representation:
        g = ifcopenshell.geom.create_shape(st, e).geometry; zs = g.verts[2::3]
        row.update({ "vol": round(us.get_volume(g), 6), "zmin": round(min(zs), 6), "zmax": round(max(zs), 6) })
    out[ue.get_psets(e)["INSA_Identity"]["Id"]] = row
print(json.dumps({ "errors": len(log.statements), "spaces": out }))`;
  const res = JSON.parse(execFileSync("python3", ["-c", py, file]).toString());
  assert.equal(res.errors, 0, "IfcOpenShell schema validation");
  const room = res.spaces["SP-0001"], space = res.spaces["SP-0002"], loose = res.spaces["SP-0003"];
  assert.deepEqual([room.storey, room.name, room.long, room.status, room.area, room.category], ["L1", "201", "Office", "bounded", 92, "architecture.room"]);
  assert.ok(near(room.vol, 92 * 3.5) && near(room.volume, 92 * 3.5) && near(room.zmin, 3) && near(room.zmax, 6.5), JSON.stringify(room));
  assert.deepEqual([space.area, space.storey, space.category], [4, "L1", "mechanical.space"]);
  assert.ok(near(space.vol, 4 * 3.5));
  assert.deepEqual([loose.storey, loose.status, loose.vol, loose.area], ["L0", "unbounded", undefined, null], "semantic IfcSpace: no body, no area property");
});
