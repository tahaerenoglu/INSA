/** Phase 7 · K: taxonomy, families and generic components through the real MCP stdio server. */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const clients: Client[] = [];
after(async () => { await Promise.all(clients.map((c) => c.close().catch(() => {}))); });

test("MCP: categories -> family -> type -> components; query by category; move; reassign; structured rejections", { timeout: 120000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "insa-mcp-comp-"));
  const { INSA_PG_URL: _a, INSA_APPROVAL: _b, ...base } = process.env;
  const c = new Client({ name: "comp", version: "1" });
  await c.connect(new StdioClientTransport({ command: path.join(ROOT, "node_modules/.bin/tsx"), args: [path.join(ROOT, "apps/manager-mcp/src/index.ts")],
    env: { ...base, INSA_DATA: data, INSA_PROJECT: "ofis", INSA_ACTOR_KIND: "human", INSA_ACTOR_ID: "taha", INSA_ACTOR_ROLES: "bim_manager" } as Record<string, string>, stderr: "pipe" }));
  clients.push(c);
  const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
  const ok = async (name: string, args: Record<string, unknown>) => { const r = await call(name, args); assert.ok(!r.isError, r.content[0].text); return JSON.parse(r.content[0].text); };
  const events = () => fs.readFileSync(path.join(data, "ofis", "events.jsonl"), "utf8").split("\n").filter(Boolean).length;

  const names = (await c.listTools()).tools.map((t) => t.name);
  for (const t of ["bim_list_disciplines", "bim_list_categories", "bim_get_category", "bim_category_usage", "bim_create_families", "bim_query_families",
                   "bim_update_families", "bim_delete_families", "bim_create_components"]) assert.ok(names.includes(t), t);
  assert.equal(names.filter((n) => /furniture|equipment|fixture|casework/.test(n)).length, 0, "no category-specific tools");
  for (const t of (await c.listTools()).tools) assert.equal((t.inputSchema as any).type, "object", t.name);

  const cats = await ok("bim_list_categories", { engine: "component" });
  assert.ok(cats.length >= 8 && cats.every((x: any) => x.engine === "point_component"));
  await ok("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3 }] });
  const L = (key: string) => ({ key, name: key, scope: "type", dataType: "length", required: true });
  const fam = await ok("bim_create_families", { families: [
    { name: "Desk", category: "architecture.furniture", parameters: [L("width"), L("depth"), L("height")], representation: { kind: "box", width: "width", depth: "depth", height: "height" } },
    { name: "Pump", category: "mechanical.equipment", parameters: [L("width"), L("depth"), L("height")], representation: { kind: "box", width: "width", depth: "depth", height: "height" } }] });
  assert.deepEqual(fam.summary.created.map((f: any) => f.category), ["architecture.furniture", "mechanical.equipment"]);
  await ok("bim_create_types", { types: [{ kind: "component", name: "D160", family: "Desk", parameters: { width: 1.6, depth: 0.8, height: 0.75 } },
                                         { kind: "component", name: "P1", family: "Pump", parameters: { width: 0.5, depth: 0.4, height: 0.6 } }] });
  const created = await ok("bim_create_components", { components: [{ type: "D160", storey: "L0", x: 2, y: 2 }, { type: "P1", storey: "L0", x: 5, y: 1 }] });
  assert.deepEqual(created.summary.created.map((x: any) => [x.category, x.family.name]), [["architecture.furniture", "Desk"], ["mechanical.equipment", "Pump"]]);
  const furn = await ok("bim_query_elements", { category: "architecture.furniture" });
  assert.deepEqual(furn.elements.map((e: any) => [e.id, e.kind, e.category]), [["CO-0001", "component", "architecture.furniture"]]);
  await ok("bim_move_elements", { ids: ["CO-0002"], vector: [1, 1] });
  await ok("bim_reassign_storey", { items: [{ id: "CO-0002", storey: "L1" }] });
  const el = await ok("bim_get_element", { id: "CO-0002" });
  assert.deepEqual([el.placement.x, el.placement.y, el.storey_name, el.taxonomy.category, el.taxonomy.discipline], [6, 2, "L1", "mechanical.equipment", "mechanical"]);

  const n = events();
  const bad = await call("bim_create_types", { types: [{ kind: "component", name: "Bad", family: "Desk", parameters: { width: 1, depth: 1, height: 1, color: "red" } }] });
  assert.ok(bad.isError && bad.content[0].text.includes("[UNKNOWN_PARAMETER]") && bad.content[0].text.includes('"parameterKey":"color"'), bad.content[0].text);
  const inUse = await call("bim_delete_families", { families: ["Desk"] });
  const txt = inUse.content[0].text as string;
  assert.ok(inUse.isError && txt.includes("[RESOURCE_IN_USE]"), txt);
  assert.deepEqual([JSON.parse(txt.split("details: ")[1]).resourceKind, JSON.parse(txt.split("details: ")[1]).usageCount], ["family", 1]);
  const swap = await call("bim_update_elements", { items: [{ id: "CO-0001", kind: "component", set: { type: "P1" } }] });
  assert.ok(swap.isError && swap.content[0].text.includes("[INCOMPATIBLE_COMPONENT_TYPE]"));
  assert.equal(events(), n, "no committed event");
  assert.deepEqual((await ok("bim_category_usage", {})).map((u: any) => [u.category, u.instances]), [["architecture.furniture", 1], ["mechanical.equipment", 1]]);
});
