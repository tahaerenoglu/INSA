/**
 * Phase 7 · Task 51: a new component category needs NO new element model.
 * A test-only category is registered (this file runs in its own process; production registry untouched)
 * and goes through the same Family -> ComponentType -> Component tools as every built-in category.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Platform, MemoryStores, Actor } from "@insa/core";
import { bimModule, BimState, registerCategory, listCategories, toIfc } from "../src/index.js";

test("registering generic.test_equipment is enough: create / query / move / reassign / delete through the generic tools", async () => {
  registerCategory({ id: "generic.test_equipment", name: "Test Equipment", discipline: "generic", engine: "point_component",
                     capabilities: ["hasType", "levelBased", "pointPlaced", "rotatable", "movable"], placements: ["level_point"] });
  assert.ok(listCategories().some((c) => c.id === "generic.test_equipment"));
  const u: Actor = { id: "t", name: "t", kind: "human", roles: ["bim_manager"] };
  const p = new Platform({ modules: [bimModule], stores: new MemoryStores(), snapshotPolicy: false });
  const x = (t: string, i: unknown) => p.execute(u, "ext", t, i) as Promise<any>;
  const L = (key: string) => ({ key, name: key, scope: "type", dataType: "length", required: true });
  await x("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 4 }] });
  await x("bim_create_families", { families: [{ name: "Probe", category: "generic.test_equipment", parameters: [L("w"), L("d"), L("h")], representation: { kind: "box", width: "w", depth: "d", height: "h" } }] });
  await x("bim_create_types", { types: [{ kind: "component", name: "P1", family: "Probe", parameters: { w: 0.5, d: 0.4, h: 0.3 } }] });
  const c = await x("bim_create_components", { components: [{ type: "P1", storey: "L0", x: 1, y: 1 }] });
  assert.deepEqual([c.summary.created[0].category, c.summary.created[0].discipline], ["generic.test_equipment", "generic"]);
  assert.deepEqual((await x("bim_query_elements", { category: "generic.test_equipment" })).result.elements.map((e: any) => e.id), ["CO-0001"]);
  await x("bim_move_elements", { ids: ["CO-0001"], vector: [2, 0] });
  await x("bim_reassign_storey", { items: [{ id: "CO-0001", storey: "L1" }] });
  const s = await p.state<BimState>("ext", "bim");
  assert.deepEqual([s.elements["CO-0001"].kind, (s.elements["CO-0001"] as any).placement.x], ["component", 3]);
  assert.match(toIfc(s, { projectKey: "ext" }), /IFCBUILDINGELEMENTPROXY\(/, "unknown-to-IFC categories export as proxies");
  await x("bim_delete_elements", { ids: ["CO-0001"] });
  assert.equal(Object.keys((await p.state<BimState>("ext", "bim")).elements).length, 0);
});
