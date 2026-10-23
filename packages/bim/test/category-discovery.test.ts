/** Phase 14 · J4: an external caller can discover what each category GENUINELY supports. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bimModule } from "../src/index.js";
import { IFC_CLASS_DATA } from "../src/ifc-schema-data.js";
import { setup } from "./authoring-fixture.js";

test("bim_list_categories filters by ifc_class / min_level / engine / capability and carries the level and the creation tool; bim_get_category_capabilities states real limits", async () => {
  const t = await setup();
  const list = async (i: Record<string, unknown>) => (await t.ex("bim_list_categories", i)).result as any[];
  const boiler = await list({ ifc_class: "IfcBoiler" });
  assert.deepEqual(boiler.map((c) => [c.id, c.engine, c.authoring_level]), [["mechanical.boiler", "point_component", 1]]);
  assert.ok(boiler[0].ifcPredefinedValues.includes("STEAM") && boiler[0].creation_tool.includes("bim_create_components"));
  assert.ok((await list({ min_level: 3 })).every((c) => c.engine === "wall") && (await list({ min_level: 3 })).length >= 3, "only the wall engine is level 3");
  assert.ok((await list({ engine: "mep_fitting" })).map((c) => c.id).sort().join() === "electrical.cable_carrier_fitting,electrical.cable_fitting,mechanical.duct_fitting,plumbing.pipe_fitting");
  assert.ok((await list({ capability: "systemConnectable", discipline: "plumbing" })).length >= 4);
  assert.deepEqual(await list({ ifc_class: "IfcNoSuchThing" }), []);
  const cap = (await t.ex("bim_get_category_capabilities", { category: "plumbing.pipe_fitting" })).result;
  assert.deepEqual([cap.engine.id, cap.engine.authoring_level, cap.placements, cap.type_kinds, cap.mep_domain, cap.ifc.class], ["mep_fitting", 2, ["fitting_point"], ["mep_fitting"], "piping", "IfcPipeFitting"]);
  assert.match(cap.creation_tool, /^bim_create_mep_fittings/);
  assert.ok(cap.ifc.valid_predefined_types.includes("BEND") && cap.ifc.schemas.includes("IFC4"));
  const gen = (await t.ex("bim_get_category_capabilities", { category: "mechanical.boiler" })).result;
  assert.ok(gen.limits.some((l: string) => /generic family box/.test(l)), "a Level 1 category states its limit");
  assert.ok(gen.supplies.some((x: string) => /predefined_type/.test(x)));
  const only43 = (await list({})).find((c) => c.ifcClass && IFC_CLASS_DATA[c.ifcClass] && !IFC_CLASS_DATA[c.ifcClass].in_ifc4);
  assert.deepEqual((await t.ex("bim_get_category_capabilities", { category: only43.id })).result.ifc.schemas, ["IFC4X3_ADD2"]);
  await t.rejected("bim_get_category_capabilities", { category: "no.such" }, "RESOURCE_NOT_FOUND").catch(() => t.rejected("bim_get_category_capabilities", { category: "no.such" }, "INVALID_CATEGORY"));
  const d = JSON.stringify(bimModule.tools.find((x) => x.name === "bim_list_categories"));
  assert.equal(/native \|/.test(d) || /native = specialised/.test(d), false, "no legacy 'native' engine wording");
});
