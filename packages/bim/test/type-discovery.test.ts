/** Phase 12 closure (A1-A3): compatibility-aware type discovery and terminology. */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalJson } from "@insa/core";
import { bimModule } from "../src/index.js";
import { setup } from "./authoring-fixture.js";

test("bim_query_types: category stays the HOME filter; compatible_category finds shared structural types through the central chain; derived compatible_categories", async () => {
  const t = await setup();
  await t.run("bim_create_types", { types: [{ kind: "wall", name: "W25", layers: [{ material: "Beton", thickness: 0.25 }] }, { kind: "slab", name: "D20", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "roof", name: "R20", layers: [{ material: "Beton", thickness: 0.2 }] }, { kind: "footing", name: "PAD", footing_kind: "pad", layers: [{ material: "Beton", thickness: 0.5 }] },
    { kind: "beam", name: "B30", profile: { shape: "rect", b: 0.3, h: 0.5 } }, { kind: "column", name: "C40", profile: { shape: "rect", b: 0.4, h: 0.4 } }] });
  const names = async (i: Record<string, unknown>) => (await t.ex("bim_query_types", i)).result.map((x: any) => x.name).sort();
  const has = async (cat: string, ...yes: string[]) => { const n = await names({ compatible_category: cat }); for (const y of yes) assert.ok(n.includes(y), `${cat} should return ${y}: ${n}`); return n; };
  const hasNot = async (cat: string, ...no: string[]) => { const n = await names({ compatible_category: cat }); for (const y of no) assert.ok(!n.includes(y), `${cat} must not return ${y}: ${n}`); };
  assert.deepEqual(await names({ category: "structure.brace" }), [], "home category: no type has structure.brace as its home");
  await has("structure.brace", "B30"); await hasNot("structure.brace", "C40", "W25", "R20", "PAD");
  await has("structure.framing", "B30");
  await has("structure.pile", "C40"); await hasNot("structure.pile", "B30", "W25");
  await has("structure.column", "C40");
  await has("structure.shear_wall", "W25"); await hasNot("structure.shear_wall", "D20", "R20", "B30");
  await has("architecture.wall", "W25");
  await has("structure.slab", "D20"); await has("architecture.floor", "D20"); await hasNot("structure.slab", "R20", "W25");
  await has("structure.footing", "PAD"); await hasNot("structure.footing", "R20", "D20", "W25", "B30");   // a roof type is NOT returned for footings
  await has("architecture.roof", "R20"); await hasNot("architecture.roof", "D20", "PAD");
  assert.deepEqual(await names({ compatible_category: "no.such.category" }), []);
  const rows = (await t.ex("bim_query_types", {})).result as any[];
  assert.deepEqual(rows.find((x) => x.name === "B30").compatible_categories, ["structure.brace", "structure.framing"]);
  assert.deepEqual(rows.find((x) => x.name === "C40").compatible_categories, ["structure.caisson_foundation", "structure.column", "structure.deep_foundation", "structure.pile"]);
  assert.deepEqual(rows.find((x) => x.name === "R20").compatible_categories, ["architecture.pitched_roof", "architecture.roof"]);   // Phase 14: the layered roof type also serves gable / hip roofs
  assert.deepEqual(rows.find((x) => x.name === "B30").category, "structure.framing", "the home category is unchanged");
  // the rule agrees with element validation: every advertised category really accepts the type, and a non-advertised one does not
  await t.run("bim_create_braces", { braces: [{ storey: "L0", type: "B30", start: [0, 0], end: [2, 2] }] });
  await t.rejected("bim_create_braces", { braces: [{ storey: "L0", type: "C40", start: [0, 0], end: [2, 2] }] }, "INVALID_REFERENCE");
  // derived: the persisted state carries no compatibility list
  assert.equal(/compatible/i.test(canonicalJson(await t.S())), false);
});

test("terminology: no 'native' engine in the MCP instructions or in the type query documentation; the concrete engines are taught", async () => {
  const srv = fs.readFileSync(path.join(import.meta.dirname, "../../../apps/manager-mcp/src/server.ts"), "utf8");
  assert.equal(/are native/.test(srv), false);
  for (const w of ["CATEGORY", "ENGINE", "Wall", "Boundary", "Profile Member", "Hosted Component", "Point Component", "Spatial", "Stair", "Path", "compatible_category"]) assert.ok(srv.includes(w), w);
  const desc = JSON.stringify(bimModule.tools.find((x) => x.name === "bim_query_types"));
  assert.equal(/native \|/.test(desc), false);
  assert.ok(/bim_list_engines/.test(desc) && /compatible_category/.test(desc));
});
