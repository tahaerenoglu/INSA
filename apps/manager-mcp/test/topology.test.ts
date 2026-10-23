/** Phase 6 · I: wall topology through the real MCP stdio server. */
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

test("MCP: detect -> join -> query -> propagate -> unjoin, structured rejections, no event on failure", { timeout: 120000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "insa-mcp-topo-"));
  const { INSA_PG_URL: _a, INSA_APPROVAL: _b, ...base } = process.env;
  const c = new Client({ name: "topo", version: "1" });
  await c.connect(new StdioClientTransport({ command: path.join(ROOT, "node_modules/.bin/tsx"), args: [path.join(ROOT, "apps/manager-mcp/src/index.ts")],
    env: { ...base, INSA_DATA: data, INSA_PROJECT: "ofis", INSA_ACTOR_KIND: "human", INSA_ACTOR_ID: "taha", INSA_ACTOR_ROLES: "bim_manager" } as Record<string, string>, stderr: "pipe" }));
  clients.push(c);
  const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
  const ok = async (name: string, args: Record<string, unknown>) => { const r = await call(name, args); assert.ok(!r.isError, r.content[0].text); return JSON.parse(r.content[0].text); };
  const events = () => fs.readFileSync(path.join(data, "ofis", "events.jsonl"), "utf8").split("\n").filter(Boolean).length;

  const tools = (await c.listTools()).tools;
  for (const t of ["bim_detect_wall_connections", "bim_join_walls", "bim_unjoin_walls", "bim_query_wall_topology", "bim_get_element_usage", "bim_rehost_opening"])
    assert.ok(tools.some((x) => x.name === t), t);
  assert.equal((tools.find((t) => t.name === "bim_join_walls")!.inputSchema as any).type, "object");

  await ok("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }] });
  await ok("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "Tuğla", thickness: 0.2 }] }] });
  await ok("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [6, 0], height: 3 }, { storey: "L0", type: "W", start: [6, 0], end: [6, 4], height: 3 },
                                         { storey: "L0", type: "W", start: [3, 0], end: [3, 3], height: 3 }] });
  const d = await ok("bim_detect_wall_connections", {});
  assert.deepEqual(d.candidates.map((x: any) => x.type), ["endpoint_endpoint", "endpoint_segment"]);
  assert.equal(events() > 0, true);
  const n0 = events();
  assert.deepEqual((await ok("bim_query_wall_topology", {})).joins, [], "detection did not join anything");
  assert.equal(events(), n0);

  const j = await ok("bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: "W-0001", endpoint: "end" }, { wall: "W-0002", endpoint: "start" }] });
  assert.deepEqual([j.summary.joinId, j.summary.kind, j.summary.affectedWalls], ["J-0001", "endpoint_endpoint", ["W-0001", "W-0002"]]);
  const t = await ok("bim_join_walls", { kind: "endpoint_segment", endpoint: { wall: "W-0003", endpoint: "start" }, host: "W-0001" });
  assert.equal(t.summary.joinId, "J-0002");
  const topo = await ok("bim_query_wall_topology", { component_of: "W-0003" });
  assert.deepEqual(topo.component.walls, ["W-0001", "W-0002", "W-0003"]);
  assert.deepEqual(topo.joins.map((x: any) => [x.id, x.kind]), [["J-0001", "endpoint_endpoint"], ["J-0002", "endpoint_segment"]]);

  const m = await ok("bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { end: [8, 0] } }] });
  assert.deepEqual(m.summary.propagated, ["W-0001", "W-0002", "W-0003"]);
  assert.deepEqual((await ok("bim_get_element", { id: "W-0002" })).start, [8, 0]);
  assert.deepEqual((await ok("bim_get_element", { id: "W-0003" })).start, [4, 0], "tee follows t = 0.5");

  let n = events();
  const del = await call("bim_delete_elements", { ids: ["W-0001"] });
  const txt = del.content[0].text as string;
  assert.ok(del.isError && txt.includes("[ELEMENT_IN_USE]"), txt);
  const details = JSON.parse(txt.split("details: ")[1]);
  assert.deepEqual([details.elementId, details.usageCount, details.dependentIds], ["W-0001", 2, "J-0001,J-0002"]);
  const tee = await call("bim_update_elements", { items: [{ id: "W-0003", kind: "wall", set: { start: [5, 1] } }] });
  assert.ok(tee.isError && tee.content[0].text.includes("[CONSTRAINED_ENDPOINT]"));
  assert.equal(events(), n, "no committed event");
  const usage = await ok("bim_get_element_usage", { id: "W-0001" });
  assert.deepEqual(usage.connectedWalls, ["W-0002", "W-0003"]);

  await ok("bim_unjoin_walls", { join: "J-0002" });
  await ok("bim_unjoin_walls", { endpoint: { wall: "W-0002", endpoint: "start" } });
  assert.deepEqual((await ok("bim_query_wall_topology", {})).joins, []);
  await ok("bim_delete_elements", { ids: ["W-0001"] });
});
