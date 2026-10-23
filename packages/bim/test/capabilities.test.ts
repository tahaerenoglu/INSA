/** Phase 12 · 0A: capability metadata matches what the category's types can really hold. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { listCategories, hasCapability } from "../src/index.js";

test("hasMaterial is advertised exactly by the categories whose types carry a material reference (layers, profile / type / component material)", () => {
  const withMaterial = listCategories().filter((c) => hasCapability(c, "hasMaterial")).map((c) => c.id);
  for (const id of ["architecture.stair", "architecture.railing", "architecture.ceiling", "architecture.roof", "architecture.floor", "architecture.wall", "structure.column", "structure.framing"])
    assert.ok(withMaterial.includes(id), `${id} advertises hasMaterial`);
  for (const id of ["architecture.door", "architecture.window", "architecture.room", "mechanical.space"]) assert.ok(!withMaterial.includes(id), `${id}: its type / element carries no material`);
});
