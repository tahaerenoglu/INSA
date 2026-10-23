/** Phase 11 · the architecture tools executed through the real MCP stdio server: ceiling, flat roof, sloped roof, stair, railing. */
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

test("MCP: create types, ceiling, flat + sloped roof, stair, railing; query by category and engine; validate; dry run; structured refusals", { timeout: 120000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "insa-mcp-arch-"));
  const { INSA_PG_URL: _a, INSA_APPROVAL: _b, ...base } = process.env;
  const c = new Client({ name: "arch", version: "1" });
  await c.connect(new StdioClientTransport({ command: path.join(ROOT, "node_modules/.bin/tsx"), args: [path.join(ROOT, "apps/manager-mcp/src/index.ts")],
    env: { ...base, INSA_DATA: data, INSA_PROJECT: "ofis", INSA_ACTOR_KIND: "human", INSA_ACTOR_ID: "taha", INSA_ACTOR_ROLES: "bim_manager" } as Record<string, string>, stderr: "pipe" }));
  clients.push(c);
  const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
  const ok = async (name: string, args: Record<string, unknown>) => { const r = await call(name, args); assert.ok(!r.isError, r.content[0].text); return JSON.parse(r.content[0].text); };
  const events = () => fs.readFileSync(path.join(data, "ofis", "events.jsonl"), "utf8").split("\n").filter(Boolean).length;
  const tools = (await c.listTools()).tools;
  for (const n of ["bim_create_boundaries", "bim_create_stairs", "bim_create_path_elements", "bim_create_railings", "bim_split_wall", "bim_merge_walls", "bim_trim_wall", "bim_extend_wall"])
    assert.ok(tools.some((t) => t.name === n), n);

  await ok("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3.2 }] });
  await ok("bim_create_types", { types: [{ kind: "ceiling", name: "C13", layers: [{ material: "Alçıpan", thickness: 0.0125 }] }, { kind: "roof", name: "R20", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "stair", name: "S20", max_riser: 0.2, min_tread: 0.25, default_width: 1.2 }, { kind: "railing", name: "RL", height: 1.0, top_rail: { width: 0.05, depth: 0.04 }, post: { size: 0.04 }, max_post_spacing: 1.2 }] });
  const sq = [[0, 0], [10, 0], [10, 6], [0, 6]];
  // dry run first: the exact decision, nothing persisted
  let n = events();
  const dry = await ok("bim_create_stairs", { stairs: [{ storey: "L0", type: "S20", start: [1, 1], end: [5, 1], riser_count: 16 }], dry_run: true });
  assert.equal(events(), n);
  const ceil = await ok("bim_create_boundaries", { boundaries: [{ category: "architecture.ceiling", storey: "L0", type: "C13", outline: sq, offset: 2.7 }] });
  const flat = await ok("bim_create_boundaries", { boundaries: [{ category: "architecture.roof", storey: "L1", type: "R20", outline: sq, offset: 0 }] });
  const sloped = await ok("bim_create_boundaries", { boundaries: [{ category: "architecture.roof", storey: "L1", type: "R20", outline: sq, offset: 0, slope: { azimuth: 90, pitch: 30 } }] });
  const stair = await ok("bim_create_stairs", { stairs: [{ storey: "L0", type: "S20", start: [1, 1], end: [5, 1], riser_count: 16 }] });
  const rail = await ok("bim_create_railings", { railings: [{ storey: "L1", type: "RL", path: [[0, 0], [10, 0], [10, 6]] }] });
  assert.deepEqual([ceil.summary.created, flat.summary.created, sloped.summary.created, stair.summary.created, rail.summary.created], [["CE-0001"], ["RF-0001"], ["RF-0002"], ["STR-0001"], ["RL-0001"]]);
  assert.deepEqual(dry.preview.summary, stair.summary, "the preview was exactly the result");

  const rows = (await ok("bim_query_elements", {})).elements.map((e: any) => [e.id, e.category, e.engine]);
  assert.deepEqual(rows.sort(), [["CE-0001", "architecture.ceiling", "boundary"], ["RF-0001", "architecture.roof", "boundary"], ["RF-0002", "architecture.roof", "boundary"],
    ["RL-0001", "architecture.railing", "path"], ["STR-0001", "architecture.stair", "stair"]]);
  assert.deepEqual((await ok("bim_query_elements", { engine: "stair" })).elements.map((e: any) => e.id), ["STR-0001"]);
  assert.deepEqual((await ok("bim_query_elements", { engine: "path" })).elements.map((e: any) => e.id), ["RL-0001"]);
  const q1 = (await ok("bim_get_element", { id: "RF-0002" })).quantities, qs = (await ok("bim_get_element", { id: "STR-0001" })).quantities;
  assert.ok(Math.abs(q1.surface_area - 60 / Math.cos(Math.PI / 6)) < 1e-6 && q1.projected_area === 60 && q1.pitch === 30);
  assert.deepEqual([qs.total_rise, qs.riser_count, qs.width], [3.2, 16, 1.2]);
  assert.equal((await ok("bim_get_engine", { id: "stair" })).status, "implemented");
  assert.deepEqual((await ok("bim_get_engine", { id: "path" })).categories, ["architecture.railing"]);
  assert.deepEqual((await ok("bim_validate", {})).issues, []);

  n = events();
  for (const [tool, args, reason] of [
    ["bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L0", type: "C13", outline: sq }] }, "INVALID_REFERENCE"],
    ["bim_create_boundaries", { boundaries: [{ category: "architecture.roof", storey: "L1", type: "R20", outline: sq, slope: { azimuth: 0, pitch: 0 } }] }, "INVALID_ROOF_PLANE"],
    ["bim_create_stairs", { stairs: [{ storey: "L0", type: "S20", start: [1, 1], end: [5, 1], riser_count: 1 }] }, "INVALID_STAIR_GEOMETRY"],
    ["bim_create_stairs", { stairs: [{ storey: "L0", type: "S20", start: [1, 1], end: [5, 1], riser_count: 10 }] }, "STAIR_TYPE_LIMIT_EXCEEDED"],
    ["bim_create_railings", { railings: [{ storey: "L1", type: "RL", path: [[0, 0], [0, 0]] }] }, "INVALID_PATH_ELEMENT"],
    ["bim_create_railings", { railings: [{ storey: "L1", type: "S20", path: [[0, 0], [4, 0]] }] }, "INVALID_REFERENCE"]] as [string, any, string][]) {
    const r = await call(tool, args);
    assert.ok(r.isError && r.content[0].text.includes(`[${reason}]`), `${tool}: ${r.content[0].text}`);
  }
  assert.equal(events(), n, "refused commands leave no trace");
  const ifc = await call("bim_export_ifc", {});
  assert.ok(!ifc.isError);
});
