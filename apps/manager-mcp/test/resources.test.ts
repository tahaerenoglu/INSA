/** Phase 4 · G: resource lifecycle through the real MCP stdio server. */
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

test("G · MCP: update storey, query types, material usage, delete used type refused with structured RESOURCE_IN_USE", { timeout: 120000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "insa-mcp-res-"));
  const { INSA_PG_URL: _a, INSA_APPROVAL: _b, ...base } = process.env;
  const c = new Client({ name: "res", version: "1" });
  await c.connect(new StdioClientTransport({ command: path.join(ROOT, "node_modules/.bin/tsx"), args: [path.join(ROOT, "apps/manager-mcp/src/index.ts")],
    env: { ...base, INSA_DATA: data, INSA_PROJECT: "ofis", INSA_ACTOR_KIND: "human", INSA_ACTOR_ID: "taha", INSA_ACTOR_ROLES: "bim_manager" } as Record<string, string>, stderr: "pipe" }));
  clients.push(c);
  const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
  const ok = async (name: string, args: Record<string, unknown>) => { const r = await call(name, args); assert.ok(!r.isError, r.content[0].text); return JSON.parse(r.content[0].text); };
  const events = () => fs.readFileSync(path.join(data, "ofis", "events.jsonl"), "utf8").split("\n").filter(Boolean).length;

  const names = (await c.listTools()).tools.map((t) => t.name);
  for (const t of ["bim_query_storeys", "bim_update_storeys", "bim_delete_storeys", "bim_query_grids", "bim_update_grids", "bim_delete_grids",
                   "bim_query_materials", "bim_create_materials", "bim_update_materials", "bim_delete_materials",
                   "bim_query_types", "bim_update_types", "bim_delete_types", "bim_resource_usage"]) assert.ok(names.includes(t), t);
  const destructive = (await c.listTools()).tools.filter((t) => t.annotations?.destructiveHint).map((t) => t.name);
  for (const t of ["bim_delete_storeys", "bim_delete_grids", "bim_delete_materials", "bim_delete_types"]) assert.ok(destructive.includes(t), `${t} destructive`);

  await ok("bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }] });
  await ok("bim_create_types", { types: [{ kind: "wall", name: "DD", layers: [{ material: "Tuğla", thickness: 0.2 }] }] });
  await ok("bim_create_walls", { walls: [{ storey: "00", type: "DD", start: [0, 0], end: [8, 0], height: 3 }] });
  await ok("bim_update_storeys", { items: [{ storey: "00", set: { name: "Zemin", elevation: 0.15 } }] });
  assert.deepEqual((await ok("bim_query_storeys", {})).map((x: any) => [x.name, x.elevation, x.usageCount]), [["Zemin", 0.15, 1]]);
  assert.deepEqual((await ok("bim_query_types", { kind: "wall" })).map((t: any) => [t.name, t.usageCount]), [["DD", 1]]);
  const use = await ok("bim_resource_usage", { kind: "material", ref: "Tuğla" });
  assert.equal(use.usageCount, 1); assert.equal(use.usages[0].typeName, "DD");

  const n = events();
  const r = await call("bim_delete_types", { types: [{ type: "DD" }] });
  const text = r.content[0].text as string;
  assert.ok(r.isError && text.includes("[RESOURCE_IN_USE]"), text);
  const details = JSON.parse(text.split("details: ")[1]);
  assert.deepEqual([details.resourceKind, details.usageCount, details.sampleIds], ["type", 1, "W-0001"]);
  assert.equal(events(), n, "no committed event");
});
