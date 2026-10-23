/**
 * Phase 11 · new categories on the path and boundary engines need only a registry entry: no new ElementKind, no category-specific
 * geometry / lifecycle / query code. Test-only categories (this file runs in its own process).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Platform, MemoryStores, Actor } from "@insa/core";
import { bimModule, BimState, registerCategory, toIfc, engineIdOfElement, quantities, engineOfKind, listEngines } from "../src/index.js";

test("architecture.test_path_feature (path) and architecture.test_canopy (boundary): create / query / update / move / reassign / duplicates / IFC / delete", async () => {
  const kinds = new Set(listEngines().map((e) => e.elementKind));
  registerCategory({ id: "architecture.test_path_feature", name: "Test Path Features", discipline: "architecture", engine: "path", placements: ["path"], typeKinds: ["railing"], capabilities: ["hasType", "levelBased", "movable"] });
  registerCategory({ id: "architecture.test_canopy", name: "Test Canopies", discipline: "architecture", engine: "boundary", placements: ["boundary"], typeKinds: ["ceiling"], thickness: "above", capabilities: ["hasType", "levelBased", "movable"] });
  const u: Actor = { id: "t", name: "t", kind: "human", roles: ["bim_manager"] };
  const p = new Platform({ modules: [bimModule], stores: new MemoryStores(), snapshotPolicy: false });
  const x = (t: string, i: unknown) => p.execute(u, "ext", t, i) as Promise<any>;
  const S = () => p.state<BimState>("ext", "bim");
  await x("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3 }] });
  await x("bim_create_types", { types: [{ kind: "railing", name: "RL", height: 1.0, top_rail: { width: 0.05, depth: 0.04 }, post: { size: 0.04 }, max_post_spacing: 1.2 },
    { kind: "ceiling", name: "C13", layers: [{ material: "Alçıpan", thickness: 0.0125 }] }] });
  const r = await x("bim_create_path_elements", { elements: [{ category: "architecture.test_path_feature", storey: "L0", type: "RL", path: [[0, 0], [6, 0], [6, 4]] }] });
  const c = await x("bim_create_boundaries", { boundaries: [{ category: "architecture.test_canopy", storey: "L0", type: "C13", outline: [[0, 0], [4, 0], [4, 3], [0, 3]], offset: 2.5 }] });
  const [pid, cid] = [r.summary.created[0], c.summary.created[0]];
  assert.match(pid, /^PE-\d{4}$/, "the path engine's default id prefix");
  let s = await S();
  assert.deepEqual([s.elements[pid].kind, engineIdOfElement(s, s.elements[pid]), s.elements[cid].kind, engineIdOfElement(s, s.elements[cid])], ["path", "path", "boundary", "boundary"]);
  assert.deepEqual([quantities(s, s.elements[pid]).path_length, quantities(s, s.elements[cid]).volume], [10, 12 * 0.0125]);
  assert.deepEqual((await x("bim_query_elements", { category: "architecture.test_path_feature" })).result.elements.map((e: any) => [e.id, e.engine]), [[pid, "path"]]);
  assert.deepEqual((await x("bim_query_elements", { engine: "path" })).result.elements.map((e: any) => e.id), [pid]);
  await x("bim_update_elements", { items: [{ id: pid, kind: "path", set: { offset: 0.2, height: 1.1 } }, { id: cid, kind: "boundary", set: { offset: 2.6 } }] });
  await x("bim_move_elements", { ids: [pid, cid], vector: [1, 1] });
  await x("bim_reassign_storey", { items: [{ id: pid, storey: "L1" }] });
  s = await S();
  assert.deepEqual([(s.elements[pid] as any).path[0], (s.elements[pid] as any).offset, (s.elements[cid] as any).outline[0]], [[1, 1], 0.2, [1, 1]]);
  const ifc = toIfc(s, { projectKey: "ext" });
  assert.equal((ifc.match(/IFCBUILDINGELEMENTPROXY\(/g) ?? []).length, 2, "no IFC class for the test categories: proxies with the engine's geometry");
  await x("bim_delete_elements", { ids: [pid, cid] });
  assert.equal(Object.keys((await S()).elements).length, 0);
  assert.deepEqual(new Set(listEngines().map((e) => e.elementKind)), kinds, "no engine / element kind was added for them");
  assert.deepEqual([engineOfKind("path")?.id, engineOfKind("stair")?.id], ["path", "stair"]);
});
