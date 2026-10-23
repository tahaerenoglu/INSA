/** Phase 5 · 17: vertical constraints and storey reassignment through the real MCP stdio server. */
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

test("MCP: constrained creation, storey propagation, reassignment with hosted elements, structured rejections", { timeout: 120000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "insa-mcp-vert-"));
  const { INSA_PG_URL: _a, INSA_APPROVAL: _b, ...base } = process.env;
  const c = new Client({ name: "vert", version: "1" });
  await c.connect(new StdioClientTransport({ command: path.join(ROOT, "node_modules/.bin/tsx"), args: [path.join(ROOT, "apps/manager-mcp/src/index.ts")],
    env: { ...base, INSA_DATA: data, INSA_PROJECT: "ofis", INSA_ACTOR_KIND: "human", INSA_ACTOR_ID: "taha", INSA_ACTOR_ROLES: "bim_manager" } as Record<string, string>, stderr: "pipe" }));
  clients.push(c);
  const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
  const ok = async (name: string, args: Record<string, unknown>) => { const r = await call(name, args); assert.ok(!r.isError, r.content[0].text); return JSON.parse(r.content[0].text); };
  const events = () => fs.readFileSync(path.join(data, "ofis", "events.jsonl"), "utf8").split("\n").filter(Boolean).length;

  const tools = (await c.listTools()).tools;
  assert.ok(tools.some((t) => t.name === "bim_reassign_storey"));
  const upd = JSON.stringify(tools.find((t) => t.name === "bim_update_elements")!.inputSchema);
  assert.ok(upd.includes("top_storey") && upd.includes("target_storey"), "the update schema exposes the vertical intent fields");

  await ok("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3 }, { name: "L2", elevation: 6 }] });
  await ok("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "Tuğla", thickness: 0.2 }] }, { kind: "window", name: "N", width: 1, height: 1.2 }] });
  await ok("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [8, 0] }, { storey: "L0", type: "W", start: [0, 4], end: [8, 4], height: 2.8 }] });
  await ok("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 4, type: "N", sill: 1.5 }] });
  const constrained = await ok("bim_query_elements", { constrained_to: "L1" });
  assert.deepEqual(constrained.elements.map((e: any) => [e.id, e.vertical.mode, e.vertical.storey_name]), [["W-0001", "storey", "L1"]]);

  const r = await ok("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.2 } }] });
  assert.deepEqual(r.summary.propagated, ["W-0001"]);
  assert.equal((await ok("bim_get_element", { id: "W-0001" })).height, 3.2);
  assert.equal((await ok("bim_get_element", { id: "W-0002" })).height, 2.8);

  let n = events();
  const bad = await call("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 2.5 } }] });
  assert.ok(bad.isError && bad.content[0].text.includes("[DEPENDENT_ELEMENT_INVALID]") && bad.content[0].text.includes('"dependentId":"O-0001"'), bad.content[0].text);
  assert.equal(events(), n, "no committed event");

  const m = await ok("bim_reassign_storey", { items: [{ id: "W-0002", storey: "L1" }, { id: "W-0001", storey: "L0" }] });
  assert.deepEqual(m.summary.moved, ["W-0002"]);
  n = events();
  const hosted = await call("bim_reassign_storey", { items: [{ id: "O-0001", storey: "L1" }] });
  assert.ok(hosted.isError && hosted.content[0].text.includes("[INVALID_HOST_RELATION]"));
  const impossible = await call("bim_reassign_storey", { items: [{ id: "W-0001", storey: "L2" }] });
  assert.ok(impossible.isError && impossible.content[0].text.includes("[INVALID_VERTICAL_CONSTRAINT]"));
  assert.equal(events(), n);
  await ok("platform_undo", {});
  assert.equal((await ok("bim_get_element", { id: "W-0002" })).storey_name, "L0");
});
