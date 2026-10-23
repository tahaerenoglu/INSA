/**
 * Phase 9 closure · exact parity between the Platform tool registry and what the real manager MCP server
 * exposes over stdio (tools/list). Nothing is registered by hand in server.ts: this proves the generic contract
 *   Platform tool registry -> manager MCP tools/list
 * for the SAME Platform composition the stdio entry point uses (runtime.createPlatform).
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MemoryStores } from "@insa/core";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const clients: Client[] = [];
after(async () => { await Promise.all(clients.map((c) => c.close().catch(() => {}))); });

/** BIM tools that must be offered (the Phase 9 canonical tools and their compatibility wrappers). */
const REQUIRED_BIM_TOOLS = ["bim_create_walls", "bim_create_grids", "bim_create_profile_members", "bim_create_boundaries", "bim_create_beams", "bim_create_columns",
  "bim_create_slabs", "bim_place_openings", "bim_join_walls", "bim_create_components", "bim_create_spatial_elements",
  // Phase 10 authoring primitives (registered once in the shared BIM tool collection, never in server.ts)
  "bim_split_wall", "bim_merge_walls", "bim_trim_wall", "bim_extend_wall", "bim_rehost_opening",
  // Phase 11 architecture expansion
  "bim_create_boundaries", "bim_create_stairs", "bim_create_path_elements", "bim_create_railings",
  // Phase 12 structural expansion (canonical: bim_create_profile_members / bim_create_boundaries / bim_create_walls)
  "bim_create_profile_members", "bim_create_walls", "bim_create_braces", "bim_create_piles", "bim_create_footings", "bim_query_structural_connectivity",
  // Phase 13 MEP core
  "bim_create_mep_systems", "bim_query_mep_systems", "bim_get_mep_systems", "bim_update_mep_systems", "bim_delete_mep_systems", "bim_create_mep_segments", "bim_create_pipes", "bim_create_ducts",
  "bim_create_cable_trays", "bim_create_conduits", "bim_query_mep_connectors", "bim_connect_mep", "bim_disconnect_mep", "bim_query_mep_network",
  // Phase 14
  "bim_get_category_capabilities", "bim_create_mep_fittings", "bim_create_reinforcement", "bim_create_assemblies", "bim_create_ramps", "bim_create_curtain_walls", "bim_create_pitched_roofs",
  // Phase 14 · Milestone C
  "bim_create_spatial_units", "bim_query_spatial_units", "bim_update_spatial_units", "bim_delete_spatial_units", "bim_set_georeference", "bim_clear_georeference", "bim_get_coordinate_system", "bim_convert_coordinates"];

test("Platform.listTools() == the manager MCP server's tools/list, exactly (names, order-independent), including every required BIM tool", { timeout: 120000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "insa-mcp-parity-"));
  process.env.INSA_DATA = data;                                    // runtime.ts reads it at import: keep the data dir out of the repo
  const { createPlatform } = await import("../src/runtime.js");
  const platform = createPlatform(new MemoryStores());              // the composition apps/manager-mcp/src/index.ts uses
  const registry = platform.listTools();
  const registryNames = registry.map((t) => t.name);
  assert.equal(new Set(registryNames).size, registryNames.length, "the Platform registry has no duplicate tool names");

  const { INSA_PG_URL: _a, INSA_APPROVAL: _b, ...base } = process.env;
  const c = new Client({ name: "parity", version: "1" });
  await c.connect(new StdioClientTransport({ command: path.join(ROOT, "node_modules/.bin/tsx"), args: [path.join(ROOT, "apps/manager-mcp/src/index.ts")],
    env: { ...base, INSA_DATA: data, INSA_PROJECT: "ofis", INSA_ACTOR_KIND: "human", INSA_ACTOR_ID: "taha", INSA_ACTOR_ROLES: "bim_manager" } as Record<string, string>, stderr: "pipe" }));
  clients.push(c);
  const listed: Awaited<ReturnType<Client["listTools"]>>["tools"] = [];
  let cursor: string | undefined;
  do { const page = await c.listTools(cursor ? { cursor } : undefined); listed.push(...page.tools); cursor = page.nextCursor; } while (cursor);
  const mcpNames = listed.map((t) => t.name);
  assert.equal(new Set(mcpNames).size, mcpNames.length, "tools/list has no duplicate names");

  const sorted = (a: string[]) => [...a].sort();
  // Intended for MCP exposure == everything in the registry: buildServer filters nothing. That includes the governance
  // tools (platform_approve / platform_reject): they are listed, and refused at EXECUTION time (platform.approve
  // permission, never by the proposal's author: security.test.ts). Only the embedded web agent hides them (packages/agent).
  assert.deepEqual(sorted(mcpNames), sorted(registryNames), "tools/list == Platform.listTools()");
  assert.equal(mcpNames.length, registryNames.length);

  for (const name of REQUIRED_BIM_TOOLS) {
    assert.ok(registryNames.includes(name), `${name} is in the Platform registry`);
    assert.ok(mcpNames.includes(name), `${name} is exposed by the MCP server`);
  }

  // the registry's metadata reaches MCP unchanged: read-only vs write vs destructive
  const byName = new Map(listed.map((t) => [t.name, t]));
  for(const name of ["infra_import_terrain","infra_query_terrain","infra_upsert_earthworks_design","infra_query_earthworks","infra_upsert_earthwork_zones"])assert.ok(byName.has(name),`${name} is exposed by actual MCP tools/list`);
  const roadQuery = byName.get("infra_query_road_corridor")!;
  assert.ok(byName.has('infra_review_cad'));assert.ok(byName.has('infra_query_cad'));assert.ok(byName.get('infra_create_alignment')!.inputSchema.properties?.cad,'MCP exposes governed CAD conversion inputs');assert.ok(byName.get('infra_query_cad')!.inputSchema.properties?.conversion,'MCP exposes read-only conversion preview');const diagnostic:any=await c.callTool({name:'infra_create_alignment',arguments:{name:'MCP CAD schema check',cad:{drawing:'missing',region:'missing',reviewRevision:1,sourceHash:'a'.repeat(64),direction:'forward',sourceStart:[0,0],startStation:0,directionConfirmed:true,coordinateCrs:'LOCAL:TEST',coordinateConfirmed:true,georefHash:'b'.repeat(64),previewHash:'c'.repeat(64)}}});assert.equal(diagnostic.isError,true);assert.match(diagnostic.content[0].text,/CAD source not found/,'real MCP tools/call carries cad through object schema into authoritative conversion');
  const earthworkQuery=byName.get('infra_query_earthworks')!;
  assert.ok(earthworkQuery.inputSchema.properties?.solids,'MCP exposes optional closed-solid quantities');
  assert.ok(earthworkQuery.inputSchema.properties?.zone,'MCP exposes optional engineering zone filter');
  assert.deepEqual(earthworkQuery.inputSchema.required,['design'],'legacy earthworks query remains compatible');
  assert.ok(roadQuery.inputSchema.properties?.station, "MCP exposes optional engineering station");
  assert.ok(roadQuery.inputSchema.properties?.terrain, "MCP exposes optional terrain comparison");
  assert.ok(roadQuery.inputSchema.properties?.comparisonExtent, "MCP exposes bounded comparison extent");
  assert.ok(roadQuery.inputSchema.properties?.interval, "MCP exposes optional quantity interval");
  assert.deepEqual(roadQuery.inputSchema.required, ["road"], "old road-only query remains compatible");
  for (const t of registry) {
    const m = byName.get(t.name)!;
    assert.equal(m.annotations?.readOnlyHint, t.kind === "query", `${t.name} readOnlyHint`);
    assert.equal(m.annotations?.destructiveHint, t.kind === "command" && t.effect === "destructive", `${t.name} destructiveHint`);
    assert.equal((m.inputSchema as { type?: string }).type, "object", `${t.name} input schema is an object`);
  }
});
