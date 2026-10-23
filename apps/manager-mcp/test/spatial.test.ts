/** Phase 8 · O: rooms and spaces through the real MCP stdio server. */
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

test("MCP: detect regions -> room + space -> query -> move -> occupancy refused -> unbounded after unjoin", { timeout: 120000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "insa-mcp-sp-"));
  const { INSA_PG_URL: _a, INSA_APPROVAL: _b, ...base } = process.env;
  const c = new Client({ name: "sp", version: "1" });
  await c.connect(new StdioClientTransport({ command: path.join(ROOT, "node_modules/.bin/tsx"), args: [path.join(ROOT, "apps/manager-mcp/src/index.ts")],
    env: { ...base, INSA_DATA: data, INSA_PROJECT: "ofis", INSA_ACTOR_KIND: "human", INSA_ACTOR_ID: "taha", INSA_ACTOR_ROLES: "bim_manager" } as Record<string, string>, stderr: "pipe" }));
  clients.push(c);
  const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
  const ok = async (name: string, args: Record<string, unknown>) => { const r = await call(name, args); assert.ok(!r.isError, r.content[0].text); return JSON.parse(r.content[0].text); };
  const events = () => fs.readFileSync(path.join(data, "ofis", "events.jsonl"), "utf8").split("\n").filter(Boolean).length;

  const names = (await c.listTools()).tools.map((t) => t.name);
  for (const t of ["bim_detect_spatial_regions", "bim_create_spatial_elements", "bim_query_spatial_adjacency"]) assert.ok(names.includes(t), t);
  assert.equal(names.filter((n) => /room|_space/.test(n)).length, 0, "no room- or space-specific tools");

  await ok("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3 }] });
  await ok("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "Tuğla", thickness: 0.2 }] }] });
  await ok("bim_create_walls", { walls: [{ storey: "L0", type: "W", points: [[0, 0], [8, 0], [8, 5], [0, 5]], closed: true }] });
  assert.equal((await ok("bim_detect_spatial_regions", {})).total, 0, "touching is not joining");
  for (const [a, b] of [["W-0001", "W-0002"], ["W-0002", "W-0003"], ["W-0003", "W-0004"], ["W-0004", "W-0001"]])
    await ok("bim_join_walls", { kind: "endpoint_endpoint", endpoints: [{ wall: a, endpoint: "end" }, { wall: b, endpoint: "start" }] });
  const d = await ok("bim_detect_spatial_regions", { storey: "L0" });
  assert.deepEqual([d.total, d.regions[0].area, d.regions[0].perimeter, d.regions[0].boundaryLocation, d.regions[0].occupiedBy], [1, 40, 26, "wall_centerline", []]);

  const r = await ok("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 2, y: 2, number: "101", name: "Office" },
                                                             { category: "mechanical.space", storey: "L0", x: 2, y: 2, number: "101" }] });
  assert.deepEqual(r.summary.created.map((x: any) => [x.id, x.category, x.status, x.area, x.volume]), [["SP-0001", "architecture.room", "bounded", 40, 120], ["SP-0002", "mechanical.space", "bounded", 40, 120]]);
  const rows = await ok("bim_query_elements", { engine: "spatial" });
  assert.deepEqual(rows.elements.map((e: any) => [e.id, e.kind, e.category, e.number, e.status]), [["SP-0001", "spatial", "architecture.room", "101", "bounded"], ["SP-0002", "spatial", "mechanical.space", "101", "bounded"]]);
  await ok("bim_move_elements", { ids: ["SP-0001"], vector: [3, 1] });
  assert.deepEqual((await ok("bim_get_element", { id: "SP-0001" })).point, [5, 3]);

  let n = events();
  const dup = await call("bim_create_spatial_elements", { items: [{ category: "architecture.room", storey: "L0", x: 6, y: 4 }] });
  const txt = dup.content[0].text as string;
  assert.ok(dup.isError && txt.includes("[SPATIAL_REGION_OCCUPIED]"), txt);
  assert.equal(JSON.parse(txt.split("details: ")[1]).occupyingElementId, "SP-0001");
  const edge = await call("bim_update_elements", { items: [{ id: "SP-0001", kind: "spatial", set: { x: 8 } }] });
  assert.ok(edge.isError && edge.content[0].text.includes("[SPATIAL_POINT_ON_BOUNDARY]"));
  assert.equal(events(), n, "no committed event");

  const topo = await ok("bim_query_wall_topology", { wall: "W-0001" });
  await ok("bim_unjoin_walls", { join: topo.joins[0].id });
  const after1 = await ok("bim_get_element", { id: "SP-0001" });
  assert.deepEqual([after1.spatial.status, after1.spatial.area, after1.spatial.volume], ["unbounded", null, null]);
  await ok("platform_undo", {});
  assert.equal((await ok("bim_get_element", { id: "SP-0001" })).spatial.status, "bounded");
});
