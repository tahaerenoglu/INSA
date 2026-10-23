/**
 * Phase 2 · BIM domain validation through the real command path (Platform.execute).
 * Every rejection is checked to leave the event log and the committed state untouched.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Platform, MemoryStores, ArtifactStore, Actor, DomainError } from "@insa/core";
import { bimModule, BimState, toIfc, validateCommand, checkElement, modelIssues, GEOMETRY_EPSILON as E } from "../src/index.js";

const user: Actor = { id: "taha", name: "Taha", kind: "human", roles: ["bim_manager"] };
const P = "x";

async function setup() {
  const p = new Platform({ modules: [bimModule], stores: new MemoryStores(), artifacts: new ArtifactStore(fs.mkdtempSync(path.join(os.tmpdir(), "insa-p2-"))) });
  const run = async (tool: string, input: unknown) => {
    const r: any = await p.execute(user, P, tool, input);
    assert.equal(r.status === "applied" || r.status === "ok", true, JSON.stringify(r));
    return r;
  };
  await run("bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }, { name: "01", elevation: 3.5 }] });
  await run("bim_create_types", { types: [
    { kind: "wall", name: "DD", layers: [{ material: "Sıva", thickness: 0.02, function: "finish" }, { material: "Tuğla", thickness: 0.2 }] },
    { kind: "slab", name: "D20", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "column", name: "C40", profile: { shape: "rect", b: 0.4, h: 0.4 } },
    { kind: "beam", name: "B30", profile: { shape: "rect", b: 0.3, h: 0.5 } },
    { kind: "door", name: "K100", width: 1, height: 2.1 }, { kind: "window", name: "P100", width: 1, height: 1 },
    { kind: "window", name: "P-TALL", width: 1, height: 3.2 }] });
  await run("bim_create_walls", { walls: [{ storey: "00", type: "DD", start: [0, 0], end: [10, 0], height: 3 },
                                          { storey: "00", type: "DD", start: [0, 6], end: [10, 6], height: 3 }] });
  await run("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 8, type: "P100" },
                                            { kind: "door", host: "W-0001", along: 2, type: "K100" }] });
  await run("bim_create_columns", { columns: [{ storey: "00", type: "C40", at: [5, 3], height: 3 }] });
  await run("bim_create_beams", { beams: [{ storey: "00", type: "B30", start: [0, 3], end: [10, 3] }] });
  await run("bim_create_slabs", { slabs: [{ storey: "01", type: "D20", outline: [[0, 0], [10, 0], [10, 6], [0, 6]], holes: [[[4, 2], [6, 2], [6, 4], [4, 4]]] }] });
  return { p, run };
}
const snapshot = async (p: Platform) => ({ events: (await p.store(P).readEvents()).length, state: JSON.stringify(await p.state<BimState>(P, "bim")) });
/** The command must fail with `reason` and leave events and state exactly as they were. */
async function rejected(p: Platform, tool: string, input: unknown, reason: string, details?: Record<string, unknown>) {
  const before = await snapshot(p);
  await assert.rejects(p.execute(user, P, tool, input), (e: any) => {
    assert.equal(e.reason, reason, `${tool} ${JSON.stringify(input).slice(0, 120)} -> ${e.reason}: ${e.message}`);
    for (const [k, v] of Object.entries(details ?? {})) assert.equal(e.details?.[k], v, `details.${k}`);
    return true;
  });
  assert.deepEqual(await snapshot(p), before, "no event and no state change after a rejected command");
}
const st = async (p: Platform) => p.state<BimState>(P, "bim");
const upd = (id: string, kind: string, set: Record<string, unknown>) => ({ items: [{ id, kind, set }] });
/** Domain authority: apply a raw change to a copy and run the command-time validator directly (no schema involved). */
async function domainRejects(p: Platform, mutate: (s: BimState) => void, reason: string) {
  const before = await st(p), after = structuredClone(before);
  mutate(after);
  assert.throws(() => validateCommand(after, before), (e: any) => e instanceof DomainError && e.reason === reason);
}

// ===================================================================================== A
describe("A · type-safe updates", () => {
  test("A1 · negative wall height: rejected at the boundary and by the domain", async () => {
    const { p } = await setup();
    await rejected(p, "bim_update_elements", upd("W-0002", "wall", { height: -3 }), "INVALID_INPUT");
    await domainRejects(p, (s) => { (s.elements["W-0002"] as any).height = -3; }, "INVALID_DIMENSION");
  });
  test("A2 · zero wall thickness is rejected (type creation and domain)", async () => {
    const { p } = await setup();
    await rejected(p, "bim_create_types", { types: [{ kind: "wall", name: "Zero", layers: [{ material: "m", thickness: 0 }] }] }, "INVALID_DIMENSION");
    await domainRejects(p, (s) => { (s.types["WT-0001"] as any).layers = [{ material: "m", thickness: 0, function: "structure" }]; }, "INVALID_DIMENSION");
  });
  test("A3 · negative column height", async () => {
    const { p } = await setup();
    await rejected(p, "bim_update_elements", upd("C-0001", "column", { height: -2 }), "INVALID_INPUT");
    await domainRejects(p, (s) => { (s.elements["C-0001"] as any).height = -2; }, "INVALID_DIMENSION");
  });
  test("A4 · zero / negative opening dimensions", async () => {
    const { p } = await setup();
    await rejected(p, "bim_update_elements", upd("O-0001", "opening", { width: 0 }), "INVALID_INPUT");
    await rejected(p, "bim_update_elements", upd("O-0001", "opening", { height: -1 }), "INVALID_INPUT");
    await domainRejects(p, (s) => { (s.elements["O-0001"] as any).width = -1; }, "INVALID_DIMENSION");
    await domainRejects(p, (s) => { (s.elements["O-0001"] as any).height = E / 2; }, "INVALID_DIMENSION");
  });
  test("A5 · invalid beam dimensions and section", async () => {
    const { p } = await setup();
    await rejected(p, "bim_create_types", { types: [{ kind: "beam", name: "B0", profile: { shape: "rect", b: 0, h: 0.5 } }] }, "INVALID_INPUT");
    await domainRejects(p, (s) => { (s.types["BT-0001"] as any).profile.h = 0; }, "INVALID_DIMENSION");
    await rejected(p, "bim_update_elements", upd("B-0001", "beam", { z: Number.NaN }), "INVALID_INPUT");
    await domainRejects(p, (s) => { (s.elements["B-0001"] as any).z = Infinity; }, "INVALID_GEOMETRY");
  });
  test("A6 · immutable fields, kind mismatches and wrong value types are refused", async () => {
    const { p } = await setup();
    for (const [field, value] of [["storey", "ST-0002"], ["id", "W-9"], ["kind", "slab"], ["host", "W-0002"], ["prevDir", [1, 0]], ["props", {}], ["baseOffset", 1]] as const)
      await rejected(p, "bim_update_elements", upd("W-0001", "wall", { [field]: value }), "INVALID_ELEMENT_UPDATE", { field });
    await rejected(p, "bim_update_elements", upd("N-0001", "window", { host: "W-0002" }), "INVALID_ELEMENT_UPDATE", { field: "host" });
    await rejected(p, "bim_update_elements", upd("W-0001", "column", { height: 3 }), "INVALID_ELEMENT_UPDATE", { field: "kind" });
    await rejected(p, "bim_update_elements", upd("W-0001", "wall", {}), "INVALID_ELEMENT_UPDATE");
    await rejected(p, "bim_update_elements", upd("W-0001", "wall", { base_offset: "abc" }), "INVALID_INPUT");
    await rejected(p, "bim_update_elements", { items: [{ id: "W-0001", set: { height: 2.8 } }] }, "INVALID_INPUT");      // old untyped shape
    await rejected(p, "bim_update_elements", upd("W-9999", "wall", { height: 2 }), "ELEMENT_NOT_FOUND");
    await rejected(p, "bim_update_elements", upd("W-0001", "wall", { type: "D20" }), "INVALID_REFERENCE");             // slab type on a wall
  });
  test("A7 · valid updates succeed and keep related data in sync", async () => {
    const { p, run } = await setup();
    await run("bim_update_elements", { items: [
      { id: "W-0001", kind: "wall", set: { height: 3.2, base_offset: 0.1, name: "Güney" } },
      { id: "C-0001", kind: "column", set: { rotation: 15, at: [5, 2.5] } },
      { id: "B-0001", kind: "beam", set: { z: 2.8, end: [10, 4] } },
      { id: "N-0001", kind: "window", set: { along: 7.5, sill: 1 } },
      { id: "D-0001", kind: "door", set: { type: "K100" } },
      { id: "S-0001", kind: "slab", set: { offset: -0.05, outline: [[0, 0], [10, 0], [10, 6], [0, 6], [0, 0]] } }] });
    const s = await st(p);
    assert.equal((s.elements["W-0001"] as any).height, 3.2); assert.equal((s.elements["W-0001"] as any).baseOffset, 0.1);
    assert.deepEqual((s.elements["O-0001"] as any).along, 7.5); assert.equal((s.elements["O-0001"] as any).sill, 1);
    assert.equal((s.elements["S-0001"] as any).outline.length, 4, "explicit closing vertex normalised away");
    await run("bim_update_elements", upd("N-0001", "window", { type: "P-TALL", sill: 0 }));
    assert.equal((await st(p)).elements["O-0001"] && ((await st(p)).elements["O-0001"] as any).height, 3.2);
  });
});

// ===================================================================================== B
describe("B · wall and beam geometry", () => {
  test("B1-B3 · zero and near-zero walls are rejected, valid walls accepted", async () => {
    const { p, run } = await setup();
    await rejected(p, "bim_create_walls", { walls: [{ storey: "00", type: "DD", start: [1, 1], end: [1, 1], height: 3 }] }, "DEGENERATE_GEOMETRY");
    await rejected(p, "bim_create_walls", { walls: [{ storey: "00", type: "DD", start: [1, 1], end: [1 + E / 2, 1], height: 3 }] }, "DEGENERATE_GEOMETRY");
    await rejected(p, "bim_create_walls", { walls: [{ storey: "00", type: "DD", points: [[0, 10], [5, 10], [5, 10], [5, 15]], height: 3 }] }, "DEGENERATE_GEOMETRY");
    await run("bim_create_walls", { walls: [{ storey: "00", type: "DD", start: [1, 1], end: [1, 1 + 10 * E], height: 3 }] });
  });
  test("B4-B6 · zero and near-zero beams are rejected, valid beams accepted", async () => {
    const { p, run } = await setup();
    await rejected(p, "bim_create_beams", { beams: [{ storey: "00", type: "B30", start: [2, 2], end: [2, 2] }] }, "DEGENERATE_GEOMETRY");
    await rejected(p, "bim_create_beams", { beams: [{ storey: "00", type: "B30", start: [2, 2], end: [2, 2 + E / 3] }] }, "DEGENERATE_GEOMETRY");
    await run("bim_create_beams", { beams: [{ storey: "00", type: "B30", start: [2, 2], end: [7, 5] }] });
  });
  test("B7-B8 · updates cannot collapse a wall or a beam", async () => {
    const { p } = await setup();
    await rejected(p, "bim_update_elements", upd("W-0002", "wall", { end: [0, 6] }), "DEGENERATE_GEOMETRY", { elementId: "W-0002" });
    await rejected(p, "bim_update_elements", upd("W-0002", "wall", { start: [10, 6 + E / 2] }), "DEGENERATE_GEOMETRY");
    await rejected(p, "bim_update_elements", upd("B-0001", "beam", { start: [10, 3] }), "DEGENERATE_GEOMETRY", { elementId: "B-0001" });
  });
});

// ===================================================================================== C
const sq = (x: number, y: number, w: number) => [[x, y], [x + w, y], [x + w, y + w], [x, y + w]];
const slab = (outline: unknown, holes: unknown = []) => ({ slabs: [{ storey: "00", type: "D20", outline, holes }] });
describe("C · slab polygons and holes", () => {
  test("C1-C2 · rectangle and triangle accepted", async () => {
    const { run } = await setup();
    await run("bim_create_slabs", slab(sq(0, 0, 10)));
    await run("bim_create_slabs", slab([[0, 0], [3, 0], [0, 4]]));
  });
  test("C3-C6 · collinear, zero-area, duplicate and self-intersecting outlines rejected", async () => {
    const { p } = await setup();
    await rejected(p, "bim_create_slabs", slab([[0, 0], [5, 0], [10, 0]]), "DEGENERATE_GEOMETRY");
    await rejected(p, "bim_create_slabs", slab([[0, 0], [10, 0], [10, E / 2], [0, E / 2]]), "DEGENERATE_GEOMETRY");
    await rejected(p, "bim_create_slabs", slab([[0, 0], [10, 0], [10, 0], [10, 10]]), "DEGENERATE_GEOMETRY", { vertexIndex: 1, segmentIndex: 1 });
    await rejected(p, "bim_create_slabs", slab([[0, 0], [10, 10], [10, 0], [0, 10]]), "SELF_INTERSECTING_POLYGON");
    await rejected(p, "bim_update_elements", upd("S-0001", "slab", { outline: [[0, 0], [10, 6], [10, 0], [0, 6]] }), "SELF_INTERSECTING_POLYGON");
  });
  test("C7-C14 · valid hole accepted; outside, partly outside, crossing, overlapping, intersecting, degenerate and self-intersecting holes rejected", async () => {
    const { p, run } = await setup();
    await run("bim_create_slabs", slab(sq(0, 0, 10), [sq(2, 2, 2), sq(6, 6, 2)]));
    const cases: [unknown[], string][] = [
      [[sq(20, 20, 2)], "outside_outline"], [[sq(9, 4, 2)], "crosses_or_touches_outline"],
      [[[[5, 5], [15, 5], [15, 6], [5, 6]]], "crosses_or_touches_outline"], [[sq(0, 4, 2)], "crosses_or_touches_outline"],
      [[sq(2, 2, 3), sq(3, 3, 3)], "holes_intersect"], [[sq(1, 1, 6), sq(2, 2, 2)], "holes_overlap"], [[sq(2, 2, 2), sq(4, 2, 2)], "holes_intersect"],
      [[[[2, 2], [4, 2], [6, 2]]], "DEGENERATE_GEOMETRY"], [[[[2, 2], [4, 4], [4, 2], [2, 4]]], "SELF_INTERSECTING_POLYGON"]];
    for (const [holes, problem] of cases)
      await rejected(p, "bim_create_slabs", slab(sq(0, 0, 10), holes), "INVALID_SLAB_HOLE", { problem });
    await rejected(p, "bim_update_elements", upd("S-0001", "slab", { holes: [sq(9, 1, 3)] }), "INVALID_SLAB_HOLE");
  });
  test("C15 · shrinking the outline under an existing hole is rejected and nothing changes", async () => {
    const { p } = await setup();
    await rejected(p, "bim_update_elements", upd("S-0001", "slab", { outline: sq(0, 0, 3) }), "INVALID_SLAB_HOLE");
    await rejected(p, "bim_move_elements", { ids: ["S-0001"], vector: [Number.POSITIVE_INFINITY, 0] }, "INVALID_INPUT");
  });
});

// ===================================================================================== D
describe("D · hosted openings, doors and windows", () => {
  test("D1-D3 · valid opening accepted; outside the wall or missing host rejected", async () => {
    const { p, run } = await setup();
    await run("bim_place_openings", { items: [{ kind: "opening", host: "W-0002", along: 5, width: 1.2, height: 2, sill: 0.5 }] });
    await rejected(p, "bim_place_openings", { items: [{ kind: "opening", host: "W-0002", along: 9.8, width: 1, height: 1 }] }, "INVALID_HOST_RELATION");
    await rejected(p, "bim_place_openings", { items: [{ kind: "window", host: "W-0002", along: 2, type: "P-TALL" }] }, "INVALID_HOST_RELATION");
    await rejected(p, "bim_place_openings", { items: [{ kind: "window", host: "W-9999", along: 2, type: "P100" }] }, "INVALID_HOST_RELATION", { hostId: "W-9999" });
  });
  test("D4-D7 · updates cannot move or enlarge hosted elements out of their wall", async () => {
    const { p } = await setup();
    await rejected(p, "bim_update_elements", upd("O-0001", "opening", { along: 9.9 }), "INVALID_HOST_RELATION", { elementId: "O-0001", hostId: "W-0001" });
    await rejected(p, "bim_update_elements", upd("O-0001", "opening", { width: 4.5 }), "INVALID_HOST_RELATION");
    await rejected(p, "bim_update_elements", upd("O-0001", "opening", { along: 2.4 }), "INVALID_HOST_RELATION", { other: "O-0002" });   // onto the door
    await rejected(p, "bim_update_elements", upd("D-0001", "door", { along: -0.2 }), "INVALID_HOST_RELATION");
    await rejected(p, "bim_update_elements", upd("N-0001", "window", { type: "P-TALL" }), "INVALID_HOST_RELATION");      // 0.9 + 3.2 > 3.0
    await rejected(p, "bim_update_elements", upd("N-0001", "window", { sill: 2.5 }), "INVALID_HOST_RELATION");
  });
  test("D8-D9 · a host change that would invalidate its dependents is rejected; host and dependents unchanged", async () => {
    const { p } = await setup();
    await rejected(p, "bim_update_elements", upd("W-0001", "wall", { end: [8.2, 0] }), "DEPENDENT_ELEMENT_INVALID", { dependentId: "O-0001", cause: "INVALID_HOST_RELATION" });
    await rejected(p, "bim_update_elements", upd("W-0001", "wall", { height: 1.5 }), "DEPENDENT_ELEMENT_INVALID", { dependentId: "O-0001" });
    const s = await st(p);
    assert.deepEqual((s.elements["W-0001"] as any).end, [10, 0]); assert.equal((s.elements["O-0001"] as any).along, 8);
  });
  test("D · moving a wall keeps its hosted elements valid; deleting cascades", async () => {
    const { p, run } = await setup();
    await run("bim_move_elements", { ids: ["W-0001"], vector: [0, -1] });
    await run("bim_update_elements", upd("W-0001", "wall", { end: [9, -1] }));            // still long enough for the window
    await run("bim_delete_elements", { ids: ["W-0001"], cascade_hosted: true });          // Phase 6: cascading is explicit
    assert.equal(Object.values((await st(p)).elements).filter((e) => e.kind === "opening").length, 0);
  });
});

// ===================================================================================== E
describe("E · batch atomicity", () => {
  test("E1 · a valid multi-element update succeeds", async () => {
    const { p, run } = await setup();
    await run("bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { height: 3.3 } }, { id: "W-0002", kind: "wall", set: { height: 3.3 } },
                                              { id: "C-0001", kind: "column", set: { height: 3.3 } }] });
    const s = await st(p);
    assert.deepEqual(["W-0001", "W-0002", "C-0001"].map((id) => (s.elements[id] as any).height), [3.3, 3.3, 3.3]);
  });
  test("E2-E4 · one invalid item rejects the whole batch: same event count, identical state", async () => {
    const { p } = await setup();
    await rejected(p, "bim_update_elements", { items: [
      { id: "W-0001", kind: "wall", set: { height: 3.3 } }, { id: "W-0002", kind: "wall", set: { end: [0, 6] } }, { id: "C-0001", kind: "column", set: { height: 3.3 } }] }, "DEGENERATE_GEOMETRY");
    await rejected(p, "bim_create_slabs", { slabs: [{ storey: "00", type: "D20", outline: sq(20, 0, 5) }, { storey: "00", type: "D20", outline: [[0, 0], [5, 5], [5, 0], [0, 5]] }] }, "SELF_INTERSECTING_POLYGON");
    await rejected(p, "bim_create_beams", { beams: [{ storey: "00", type: "B30", start: [0, 0], end: [1, 1] }, { storey: "00", type: "B30", start: [3, 3], end: [3, 3] }] }, "DEGENERATE_GEOMETRY");
  });
});

// ===================================================================================== Task 11
test("history accepted under older rules still replays; it only blocks commands that touch it", async () => {
  const { p, run } = await setup();
  // a pre-Phase-2 event: an update that wrote a negative column height (allowed by the old generic update)
  const store = p.store(P);
  await store.appendEvents([{ module: "platform", type: "CommandApplied", payload: { tool: "bim_update_elements", summary: { legacy: true } }, commandId: "CMD-legacy", actor: "old", at: new Date().toISOString() },
                            { module: "bim", type: "ElementUpdated", payload: { id: "C-0001", changes: { height: -2 } }, commandId: "CMD-legacy", actor: "old", at: new Date().toISOString() }], await store.lastSeq());
  const fresh = new Platform({ modules: [bimModule], stores: (p as any).stores });               // replay from the log, no validation
  assert.equal(((await fresh.state<BimState>(P, "bim")).elements["C-0001"] as any).height, -2);
  const report: any = (await fresh.execute(user, P, "bim_validate", {}) as any).result;
  assert.ok(JSON.stringify(report).includes("C-0001"), "the legacy problem is reported by bim_validate");
  await run("bim_update_elements", upd("W-0002", "wall", { height: 3.1 }));                     // unrelated work is not blocked
  await rejected(p, "bim_update_elements", upd("C-0001", "column", { rotation: 10 }), "INVALID_DIMENSION");   // touching it requires fixing it
  await run("bim_update_elements", upd("C-0001", "column", { height: 3, rotation: 10 }));
  assert.deepEqual(modelIssues(await st(p)), []);
});

// ===================================================================================== G
test("G · IFC export of a representative valid model: no NaN/Infinity, no zero or non-finite directions", async () => {
  const { p, run } = await setup();
  await run("bim_create_walls", { walls: [{ storey: "01", type: "DD", points: [[0, 0], [12, 0], [12, 7], [3, 9.5], [0, 7]], closed: true, location_line: "exterior_face", height: 3 }] });
  await run("bim_create_beams", { beams: [{ storey: "01", type: "B30", start: [1, 1], end: [9.37, 6.21], z: 2.6 }] });
  await run("bim_create_columns", { columns: [{ storey: "01", type: "C40", at: [3, 3], height: 3, rotation: 33 }] });
  await run("bim_place_openings", { items: [{ kind: "opening", host: "W-0003", along: 6, width: 1, height: 1, sill: 1 }] });
  await run("bim_update_elements", upd("W-0002", "wall", { end: [10, 9] }));                    // moved end point
  const res: any = (await p.execute(user, P, "bim_export_ifc", { name: "smoke" }) as any).result;
  const ifc = fs.readFileSync(p.requireArtifacts().resolve(P, res.artifact.id).path, "utf8");
  assert.equal(/NaN|Infinity/.test(ifc), false);
  const dirs = [...ifc.matchAll(/IFCDIRECTION\(\(([^)]*)\)\)/g)].map((m) => m[1].split(",").map(Number));
  assert.ok(dirs.length > 10);
  for (const d of dirs) assert.ok(d.every(Number.isFinite) && Math.hypot(...d) > 1e-9, `direction ${d}`);
  for (const m of ifc.matchAll(/IFCCARTESIANPOINT\(\(([^)]*)\)\)/g)) assert.ok(m[1].split(",").map(Number).every(Number.isFinite));
  for (const kind of ["IFCWALL", "IFCBEAM", "IFCCOLUMN", "IFCSLAB", "IFCOPENINGELEMENT", "IFCDOOR", "IFCWINDOW"]) assert.match(ifc, new RegExp(kind + "\\("), kind);
  const frag: any = (await p.execute(user, P, "bim_export_frag", { name: "smoke" }) as any).result;
  assert.ok(frag.artifact.bytes > 1000);
});

test("G · the exporter refuses degenerate geometry instead of writing NaN or zero directions (last line of defence)", async () => {
  const { p } = await setup();
  const s = structuredClone(await st(p));
  (s.elements["B-0001"] as any).end = [0, 3];
  assert.throws(() => toIfc(s, { projectKey: P }), /invalid direction|Non-finite/);
  assert.throws(() => checkElement(s, s.elements["B-0001"]), (e: any) => e.reason === "DEGENERATE_GEOMETRY");
});
