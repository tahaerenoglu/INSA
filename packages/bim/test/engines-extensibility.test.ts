/**
 * Phase 9 · a new category on an EXISTING engine needs only a registry entry: no element variant, validator,
 * move / delete / query code or IFC geometry. Test-only categories (this file runs in its own process).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Platform, MemoryStores, Actor } from "@insa/core";
import { bimModule, BimState, registerCategory, toIfc, engineIdOfElement, quantities } from "../src/index.js";

test("structure.test_brace (profile_member) and architecture.test_equipment (point_component): create / query / update / move / reassign / delete", async () => {
  registerCategory({ id: "structure.test_brace", name: "Test Braces", discipline: "structure", engine: "profile_member", placements: ["member_axis"], typeKinds: ["beam"],
                     capabilities: ["hasType", "levelBased", "curveBased", "movable", "profileBased"] });
  registerCategory({ id: "architecture.test_equipment", name: "Test Equipment", discipline: "architecture", engine: "point_component", placements: ["level_point"], typeKinds: ["component"],
                     capabilities: ["hasType", "levelBased", "pointPlaced", "movable"] });
  const u: Actor = { id: "t", name: "t", kind: "human", roles: ["bim_manager"] };
  const p = new Platform({ modules: [bimModule], stores: new MemoryStores(), snapshotPolicy: false });
  const x = (t: string, i: unknown) => p.execute(u, "ext", t, i) as Promise<any>;
  const S = () => p.state<BimState>("ext", "bim");
  await x("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3 }] });
  await x("bim_create_types", { types: [{ kind: "beam", name: "HEA", profile: { shape: "rect", b: 0.2, h: 0.2 } }] });
  const L = (key: string) => ({ key, name: key, scope: "type", dataType: "length", required: true });
  await x("bim_create_families", { families: [{ name: "Probe", category: "architecture.test_equipment", parameters: [L("w"), L("d"), L("h")], representation: { kind: "box", width: "w", depth: "d", height: "h" } }] });
  await x("bim_create_types", { types: [{ kind: "component", name: "P1", family: "Probe", parameters: { w: 0.5, d: 0.5, h: 1 } }] });
  const r = await x("bim_create_profile_members", { members: [{ category: "structure.test_brace", storey: "L0", type: "HEA", start: [0, 0], end: [3, 4], z: 2.5 }] });
  await x("bim_create_components", { components: [{ type: "P1", storey: "L0", x: 1, y: 1 }] });
  const id = r.summary.created[0];
  assert.match(id, /^PM-\d{4}$/, "engine default id prefix (never a material's M-)");
  let s = await S();
  assert.deepEqual([s.elements[id].kind, (s.elements[id] as any).category, engineIdOfElement(s, s.elements[id]), quantities(s, s.elements[id]).length], ["profile_member", "structure.test_brace", "profile_member", 5]);
  assert.deepEqual((await x("bim_query_elements", { category: "structure.test_brace" })).result.elements.map((e: any) => [e.id, e.engine]), [[id, "profile_member"]]);
  assert.deepEqual((await x("bim_query_elements", { engine: "point_component" })).result.elements.map((e: any) => e.category), ["architecture.test_equipment"]);
  await x("bim_update_elements", { items: [{ id, kind: "profile_member", set: { z: 2.8 } }] });
  await x("bim_move_elements", { ids: [id, "CO-0001"], vector: [1, 0] });
  await x("bim_reassign_storey", { items: [{ id, storey: "L1" }] });
  s = await S();
  assert.deepEqual([(s.elements[id] as any).z, (s.elements[id] as any).start, (s.elements["CO-0001"] as any).placement.x], [2.8, [1, 0], 2]);
  assert.match(toIfc(s, { projectKey: "ext" }), /IFCBUILDINGELEMENTPROXY\(/, "no IFC class for the test category: proxy, same sweep geometry");
  await assert.rejects(x("bim_create_profile_members", { members: [{ category: "structure.test_brace", storey: "L0", type: "HEA", at: [0, 0] }] }), (e: any) => e.reason === "INVALID_ENGINE_PLACEMENT");
  await x("bim_delete_elements", { ids: [id, "CO-0001"] });
  assert.equal(Object.keys((await S()).elements).length, 0);
});
