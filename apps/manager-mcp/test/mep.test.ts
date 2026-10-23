/** Phase 13 · the MEP tools executed through the real MCP stdio server (no Platform shortcut). */
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

test("MCP: types, systems, routes, connectors, explicit connect, tee, equipment, network, validate, storey change, IFC; structured refusals leave no trace", { timeout: 150000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "insa-mcp-mep-"));
  const { INSA_PG_URL: _a, INSA_APPROVAL: _b, ...base } = process.env;
  const c = new Client({ name: "mep", version: "1" });
  await c.connect(new StdioClientTransport({ command: path.join(ROOT, "node_modules/.bin/tsx"), args: [path.join(ROOT, "apps/manager-mcp/src/index.ts")],
    env: { ...base, INSA_DATA: data, INSA_PROJECT: "ofis", INSA_ACTOR_KIND: "human", INSA_ACTOR_ID: "taha", INSA_ACTOR_ROLES: "bim_manager" } as Record<string, string>, stderr: "pipe" }));
  clients.push(c);
  const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
  const ok = async (name: string, args: Record<string, unknown>) => { const r = await call(name, args); assert.ok(!r.isError, r.content[0].text); return JSON.parse(r.content[0].text); };
  const refuse = async (name: string, args: Record<string, unknown>, reason: string) => { const r = await call(name, args); assert.ok(r.isError && r.content[0].text.includes(`[${reason}]`), `${name}: ${r.content[0].text}`); };
  const events = () => fs.readFileSync(path.join(data, "ofis", "events.jsonl"), "utf8").split("\n").filter(Boolean).length;
  const tools = (await c.listTools()).tools.map((t) => t.name);
  for (const n of ["bim_create_mep_systems", "bim_query_mep_systems", "bim_create_mep_segments", "bim_query_mep_connectors", "bim_connect_mep", "bim_disconnect_mep", "bim_query_mep_network", "bim_create_pipes", "bim_create_ducts", "bim_create_cable_trays", "bim_create_conduits"]) assert.ok(tools.includes(n), n);
  const R = (x: number, y: number, offset: number, storey = "L0") => ({ storey, at: [x, y], offset });

  await ok("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3.2 }] });
  await ok("bim_create_types", { types: [{ kind: "pipe", name: "P25", diameter: 0.025 }, { kind: "duct", name: "DR", shape: "rectangular", width: 0.4, height: 0.2 }, { kind: "cable_tray", name: "TR", width: 0.3, height: 0.1 }, { kind: "conduit", name: "CN", diameter: 0.02 }] });
  await ok("bim_create_mep_systems", { systems: [{ name: "DCW", domain: "piping", classification: "domestic_cold_water" }, { name: "SA", domain: "hvac", classification: "supply_air" }, { name: "PWR", domain: "electrical", classification: "power" }] });
  await ok("bim_create_mep_segments", { segments: [{ category: "plumbing.pipe", type: "P25", system: "DCW", route: [R(0, 0, 0.5), R(4, 0, 0.5)] }, { category: "plumbing.pipe", type: "P25", system: "DCW", route: [R(4, 0, 0.5), R(6, 0, 0.5)] },
    { category: "plumbing.pipe", type: "P25", system: "DCW", route: [R(4, 0, 0.5), R(4, 0, 0.5, "L1")] }] });
  await ok("bim_create_ducts", { ducts: [{ type: "DR", system: "SA", route: [R(0, 5, 2.5), R(6, 5, 2.5)] }] });
  await ok("bim_create_cable_trays", { cable_trays: [{ type: "TR", system: "PWR", route: [R(0, 7, 2.8), R(5, 7, 2.8)] }] });
  await ok("bim_create_conduits", { conduits: [{ type: "CN", system: "PWR", route: [R(0, 8, 2.8), R(5, 8, 2.8)] }] });
  const net0 = await ok("bim_query_mep_network", { system: "DCW" });
  assert.equal(net0.components.length, 3, "touching != connected");
  const cons = await ok("bim_query_mep_connectors", { element: "ME-0003" });
  assert.deepEqual([cons.map((x: any) => x.position), cons[1].direction], [[[4, 0, 0.5], [4, 0, 3.7]], [0, 0, 1]]);
  const tee = await ok("bim_connect_mep", { connectors: [{ element: "ME-0001", connector: "end" }, { element: "ME-0002", connector: "start" }, { element: "ME-0003", connector: "start" }] });
  assert.equal(tee.summary.kind, "tee");
  await ok("bim_create_families", { families: [{ name: "Tap", category: "plumbing.fixture", parameters: [{ key: "w", name: "w", scope: "type", dataType: "length", required: true }], representation: { kind: "box", width: "w", depth: "w", height: "w" } }] });
  await ok("bim_create_types", { types: [{ kind: "component", name: "Basin", family: "Tap", parameters: { w: 0.3 }, connectors: [{ key: "cold", domain: "piping", position: [0.5, 0, 0.1], direction: [1, 0, 0], flow: "in", shape: "round", diameter: 0.025 }] }] });
  await ok("bim_create_components", { components: [{ type: "Basin", storey: "L0", x: 5.5, y: 0, offset: 0.4 }] });
  await ok("bim_connect_mep", { connectors: [{ element: "ME-0002", connector: "end" }, { element: "CO-0001", connector: "cold" }] });
  const net = await ok("bim_query_mep_network", { system: "DCW" });
  assert.deepEqual([net.components.length, net.junctions.map((j: any) => j.kind), net.openConnectors.map((x: any) => `${x.element}#${x.connector}`)], [1, ["tee", "coupling"], ["ME-0001#start", "ME-0003#end"]]);
  const sys = await ok("bim_query_mep_systems", {});
  assert.deepEqual(sys.map((x: any) => [x.name, x.element_count, x.junction_count]), [["DCW", 3, 2], ["PWR", 2, 0], ["SA", 1, 0]]);
  assert.deepEqual((await ok("bim_validate", {})).issues.filter((i: any) => i.severity === "error"), []);
  await ok("bim_update_storeys", { items: [{ storey: "L1", set: { elevation: 3.6 } }] });
  const el3 = await ok("bim_get_element", { id: "ME-0003" });
  assert.deepEqual([el3.world_route[1][2], Math.round(el3.length * 100) / 100, el3.system.name, el3.connectors.length], [4.1, 3.6, "DCW", 2]);
  const dry = await ok("bim_create_pipes", { pipes: [{ type: "P25", system: "DCW", route: [R(9, 9, 0.5), R(9, 12, 0.5)] }], dry_run: true });
  assert.ok(dry.preview.summary.created.length === 1);
  const n = events();
  await refuse("bim_create_pipes", { pipes: [{ type: "P25", system: "DCW", route: [R(0, 0, 0)] }] }, "INVALID_ROUTE");
  await refuse("bim_create_ducts", { ducts: [{ type: "DR", system: "DCW", route: [R(0, 0, 0), R(1, 0, 0)] }] }, "MEP_SYSTEM_DOMAIN_MISMATCH");
  await refuse("bim_connect_mep", { connectors: [{ element: "ME-0001", connector: "start" }, { element: "ME-0002", connector: "end" }] }, "MEP_CONNECTION_DISTANCE");
  await refuse("bim_connect_mep", { connectors: [{ element: "ME-0001", connector: "end" }, { element: "ME-0004", connector: "start" }] }, "MEP_DOMAIN_MISMATCH");
  await refuse("bim_move_elements", { ids: ["ME-0001"], vector: [1, 0] }, "MEP_CONNECTED_ELEMENT_MOVE_CONFLICT");
  await refuse("bim_delete_elements", { ids: ["ME-0002"] }, "ELEMENT_IN_USE");
  await refuse("bim_delete_mep_systems", { systems: ["DCW"] }, "RESOURCE_IN_USE");
  await refuse("bim_reassign_storey", { items: [{ id: "ME-0003", storey: "L1" }] }, "INVALID_ENGINE_PLACEMENT");
  assert.equal(events(), n, "refused commands leave no trace");
  await ok("bim_disconnect_mep", { connectors: [{ element: "CO-0001", connector: "cold" }] });
  await ok("bim_move_elements", { ids: ["CO-0001"], vector: [0, 1] });
  assert.ok(!(await call("bim_export_ifc", {})).isError);
});
