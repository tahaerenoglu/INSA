/**
 * Phase 9 closure · bim_validate duplicate detection is engine / placement aware.
 * False positives (hosted components in one wall, rooms / spaces) are gone; real duplicate physical
 * geometry is still reported; the spatial occupancy and opening-overlap invariants are untouched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Platform, MemoryStores, Actor } from "@insa/core";
import { bimModule, BimState, duplicateSignature } from "../src/index.js";

const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "dup";
type Pt = [number, number];

async function setup() {
  const p = new Platform({ modules: [bimModule], stores: new MemoryStores(), snapshotPolicy: false });
  const ex = async (tool: string, input: unknown) => (await p.execute(user, P, tool, input)) as any;
  await ex("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3 }] });
  await ex("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "m", thickness: 0.2 }] }, { kind: "slab", name: "D", layers: [{ material: "c", thickness: 0.2 }] },
    { kind: "column", name: "C", profile: { shape: "rect", b: 0.4, h: 0.4 } }, { kind: "beam", name: "B", profile: { shape: "rect", b: 0.3, h: 0.5 } },
    { kind: "door", name: "K", width: 1, height: 2.1 }, { kind: "window", name: "N", width: 1, height: 1.2 }] });
  /** a closed room: four walls, corners explicitly joined (touching is not joining) */
  const room = async (pts: Pt[], first: number) => {
    await ex("bim_create_walls", { walls: [{ storey: "L0", type: "W", points: pts, closed: true, height: 3 }] });
    for (let k = 0; k < 4; k++) await ex("bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: `W-${String(first + k).padStart(4, "0")}`, endpoint: "end" }, { wall: `W-${String(first + ((k + 1) % 4)).padStart(4, "0")}`, endpoint: "start" }] });
  };
  const validate = async () => (await ex("bim_validate", {})).result as { ok: boolean; issues: { severity: string; ids: string[]; issue: string }[] };
  const dups = async () => (await validate()).issues.filter((i) => /uplicate/.test(i.issue));
  return { p, ex, room, validate, dups, S: () => p.state<BimState>(P, "bim") };
}
const L = (key: string) => ({ key, name: key, scope: "type", dataType: "length", required: true });

test("1 · two windows in the SAME wall at different positions are not duplicates", async () => {
  const { ex, room, validate, dups } = await setup();
  await room([[0, 0], [10, 0], [10, 6], [0, 6]], 1);
  await ex("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 2, type: "N" }, { kind: "window", host: "W-0001", along: 7, type: "N" }] });
  assert.deepEqual(await dups(), []);
  const v = await validate();
  assert.equal(v.ok, true);
  assert.deepEqual(v.issues, []);
});

test("2 · two doors in the SAME wall at different positions are not duplicates", async () => {
  const { ex, room, validate, dups } = await setup();
  await room([[0, 0], [10, 0], [10, 6], [0, 6]], 1);
  await ex("bim_place_openings", { items: [{ kind: "door", host: "W-0003", along: 2, type: "K" }, { kind: "door", host: "W-0003", along: 7, type: "K" }] });
  assert.deepEqual(await dups(), []);
  assert.deepEqual((await validate()).issues, []);
});

test("3 · two rooms on the SAME storey in DIFFERENT bounded regions are not duplicates", async () => {
  const { ex, room, validate, dups, S } = await setup();
  await room([[0, 0], [10, 0], [10, 6], [0, 6]], 1);
  await room([[20, 0], [26, 0], [26, 6], [20, 6]], 5);
  await ex("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 5, y: 3, number: "1" }, { category: "architecture.room", storey: "L0", x: 23, y: 3, number: "2" }] });
  const s = await S();
  assert.equal(s.elements["SP-0001"].storey, s.elements["SP-0002"].storey, "same storey");
  assert.deepEqual(await dups(), []);
  assert.deepEqual((await validate()).issues, []);
});

test("4 · a room and a space in the SAME region stay valid (Phase 8 category occupancy), with no duplicate warning", async () => {
  const { ex, room, validate, dups } = await setup();
  await room([[0, 0], [10, 0], [10, 6], [0, 6]], 1);
  await ex("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 5, y: 3 }, { category: "mechanical.space", storey: "L0", x: 5, y: 3 }] });
  const rows = (await ex("bim_query_elements", { engine: "spatial" })).result.elements;
  assert.equal(rows[0].regionSignature, rows[1].regionSignature, "one physical region");
  assert.deepEqual(rows.map((r: any) => r.status), ["bounded", "bounded"]);
  assert.deepEqual(await dups(), []);
  assert.deepEqual((await validate()).issues, []);
});

test("5 · real duplicate physical geometry is still reported, per engine", async () => {
  const { ex, dups, S } = await setup();
  await ex("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [4, 0], height: 3 }, { storey: "L0", type: "W", start: [0, 0], end: [4, 0], height: 3 }] });
  await ex("bim_create_profile_members", { members: [
    { category: "structure.framing", storey: "L0", type: "B", start: [0, 2], end: [4, 2], z: 2.5 }, { category: "structure.framing", storey: "L0", type: "B", start: [0, 2], end: [4, 2], z: 2.5 },
    { category: "structure.column", storey: "L0", type: "C", at: [1, 1], height: 2.5 }, { category: "structure.column", storey: "L0", type: "C", at: [1, 1], height: 2.5 }] });
  await ex("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L1", type: "D", outline: [[0, 0], [3, 0], [3, 3]] }, { category: "architecture.floor", storey: "L1", type: "D", outline: [[0, 0], [3, 0], [3, 3]] }] });
  await ex("bim_create_families", { families: [{ name: "Chair", category: "architecture.furniture", parameters: [L("w"), L("d"), L("h")], representation: { kind: "box", width: "w", depth: "d", height: "h" } },
    { name: "Cabinet", category: "architecture.casework", parameters: [L("w"), L("d"), L("h")], representation: { kind: "box", width: "w", depth: "d", height: "h" } }] });
  await ex("bim_create_types", { types: [{ kind: "component", name: "C1", family: "Chair", parameters: { w: 0.5, d: 0.5, h: 1 } }, { kind: "component", name: "K1", family: "Cabinet", parameters: { w: 0.5, d: 0.5, h: 1 } }] });
  await ex("bim_create_components", { components: [{ type: "C1", storey: "L0", x: 8, y: 8 }, { type: "C1", storey: "L0", x: 8, y: 8 }, { type: "K1", storey: "L0", x: 8, y: 8 }] });
  const pairs = (await dups()).map((d) => d.ids.join("+")).sort();
  assert.deepEqual(pairs, ["B-0001+B-0002", "C-0001+C-0002", "CO-0001+CO-0002", "S-0001+S-0002", "W-0001+W-0002"],
    "walls, axis members, vertical members, boundaries and components; the cabinet (another category) at the same point is NOT a duplicate");
  assert.ok((await dups()).every((d) => d.issue === "Duplicate element (same category, storey and geometry)."));
  void S;
});

test("6 · a different storey, category or placement is never a duplicate", async () => {
  const { ex, dups } = await setup();
  await ex("bim_create_profile_members", { members: [
    { category: "structure.framing", storey: "L0", type: "B", start: [0, 2], end: [4, 2], z: 2.5 }, { category: "structure.framing", storey: "L1", type: "B", start: [0, 2], end: [4, 2], z: 2.5 },
    { category: "structure.framing", storey: "L0", type: "B", start: [0, 2], end: [4, 2], z: 2.6 },
    { category: "structure.column", storey: "L0", type: "C", at: [1, 1], height: 2.5 }, { category: "structure.column", storey: "L0", type: "C", at: [1, 1], height: 2.5, rotation: 45 }] });
  assert.deepEqual(await dups(), []);
});

test("7 · the signature helper: hosted components and spatial elements have none; openings compare host, position and size; the result is deterministic", async () => {
  const { ex, room, S } = await setup();
  await room([[0, 0], [10, 0], [10, 6], [0, 6]], 1);
  await ex("bim_place_openings", { items: [{ kind: "door", host: "W-0001", along: 2, type: "K" }, { kind: "window", host: "W-0001", along: 6, type: "N" }] });
  await ex("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 5, y: 3 }] });
  const s = await S();
  assert.equal(duplicateSignature(s, s.elements["D-0001"]), null);
  assert.equal(duplicateSignature(s, s.elements["N-0001"]), null);
  assert.equal(duplicateSignature(s, s.elements["SP-0001"]), null);
  const o1 = duplicateSignature(s, s.elements["O-0001"]), o2 = duplicateSignature(s, s.elements["O-0002"]);
  assert.ok(o1 && o2 && o1 !== o2, "different positions differ");
  const moved = structuredClone(s);
  (moved.elements["O-0002"] as any).along = (moved.elements["O-0001"] as any).along;
  (moved.elements["O-0002"] as any).width = (moved.elements["O-0001"] as any).width;
  (moved.elements["O-0002"] as any).height = (moved.elements["O-0001"] as any).height;
  (moved.elements["O-0002"] as any).sill = (moved.elements["O-0001"] as any).sill;
  assert.equal(duplicateSignature(moved, moved.elements["O-0002"]), duplicateSignature(moved, moved.elements["O-0001"]), "same host, position and size = same signature");
  assert.equal(duplicateSignature(s, s.elements["W-0001"]), duplicateSignature(structuredClone(s), s.elements["W-0001"]));
});

test("8 · the invariants that really govern these elements are untouched: same-category occupancy and overlapping openings are still refused", async () => {
  const { p, ex, room } = await setup();
  await room([[0, 0], [10, 0], [10, 6], [0, 6]], 1);
  await ex("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 5, y: 3 }] });
  await assert.rejects(ex("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 2, y: 2 }] }), (e: any) => e.reason === "SPATIAL_REGION_OCCUPIED");
  await ex("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 5, type: "N" }] });
  await assert.rejects(ex("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 5.4, type: "N" }] }), (e: any) => e.reason === "INVALID_HOST_RELATION");
  assert.equal(((await p.state<BimState>(P, "bim")).elements["N-0001"] as any).host, "W-0001");
});
