/** Phase 9 · P: universal engines through the real MCP stdio server. */
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

test("MCP: engines, categories, generic member / boundary creation, compatibility wrappers, query by engine, structured rejections", { timeout: 120000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "insa-mcp-eng-"));
  const { INSA_PG_URL: _a, INSA_APPROVAL: _b, ...base } = process.env;
  const c = new Client({ name: "eng", version: "1" });
  await c.connect(new StdioClientTransport({ command: path.join(ROOT, "node_modules/.bin/tsx"), args: [path.join(ROOT, "apps/manager-mcp/src/index.ts")],
    env: { ...base, INSA_DATA: data, INSA_PROJECT: "ofis", INSA_ACTOR_KIND: "human", INSA_ACTOR_ID: "taha", INSA_ACTOR_ROLES: "bim_manager" } as Record<string, string>, stderr: "pipe" }));
  clients.push(c);
  const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
  const ok = async (name: string, args: Record<string, unknown>) => { const r = await call(name, args); assert.ok(!r.isError, r.content[0].text); return JSON.parse(r.content[0].text); };
  const events = () => fs.readFileSync(path.join(data, "ofis", "events.jsonl"), "utf8").split("\n").filter(Boolean).length;

  const tools = (await c.listTools()).tools;
  for (const t of ["bim_list_engines", "bim_get_engine", "bim_create_profile_members", "bim_create_boundaries", "bim_create_beams", "bim_create_columns", "bim_create_slabs"])
    assert.ok(tools.some((x) => x.name === t), t);
  for (const t of tools) assert.equal((t.inputSchema as any).type, "object", t.name);
  const engines = await ok("bim_list_engines", {});
  assert.deepEqual(engines.filter((e: any) => e.status === "reserved").map((e: any) => e.id), ["proxy"]);       // Phase 11 activated path
  assert.deepEqual(engines.find((e: any) => e.id === "profile_member").categories, ["structure.brace", "structure.caisson_foundation", "structure.column", "structure.deep_foundation", "structure.framing", "structure.pile"]);   // Phase 12: braces and piles
  assert.equal((await ok("bim_get_category", { id: "architecture.door" })).engine, "hosted_component");

  await ok("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3 }] });
  await ok("bim_create_types", { types: [{ kind: "beam", name: "B", profile: { shape: "rect", b: 0.3, h: 0.5 } }, { kind: "column", name: "C", profile: { shape: "rect", b: 0.4, h: 0.4 } },
                                         { kind: "slab", name: "D", layers: [{ material: "Beton", thickness: 0.2 }] }] });
  await ok("bim_create_profile_members", { members: [{ category: "structure.framing", storey: "L0", type: "B", start: [0, 0], end: [5, 0] }, { category: "structure.column", storey: "L0", type: "C", at: [1, 1] }] });
  await ok("bim_create_beams", { beams: [{ storey: "L0", type: "B", start: [0, 2], end: [5, 2] }] });
  await ok("bim_create_columns", { columns: [{ storey: "L0", type: "C", at: [2, 2] }] });
  await ok("bim_create_boundaries", { boundaries: [{ category: "architecture.floor", storey: "L1", type: "D", outline: [[0, 0], [5, 0], [5, 3]] }] });
  await ok("bim_create_slabs", { slabs: [{ storey: "L1", type: "D", outline: [[6, 0], [9, 0], [9, 3]] }] });
  const rows = (await ok("bim_query_elements", { engine: "profile_member" })).elements;
  assert.deepEqual(rows.map((e: any) => [e.id, e.kind, e.category, e.engine]), [["B-0001", "profile_member", "structure.framing", "profile_member"], ["B-0002", "profile_member", "structure.framing", "profile_member"],
    ["C-0001", "profile_member", "structure.column", "profile_member"], ["C-0002", "profile_member", "structure.column", "profile_member"]]);
  assert.deepEqual((await ok("bim_query_elements", { engine: "boundary" })).elements.map((e: any) => e.id), ["S-0001", "S-0002"]);
  const d = await ok("bim_get_element", { id: "B-0002" });
  assert.deepEqual([d.engine, d.representation.kind, d.representation.length, d.placement_info.kind], ["profile_member", "profile_sweep", 5, "member_axis"]);

  const n = events();
  const bad1 = await call("bim_create_profile_members", { members: [{ category: "architecture.furniture", storey: "L0", type: "B", start: [0, 0], end: [1, 0] }] });
  assert.ok(bad1.isError && bad1.content[0].text.includes("[CATEGORY_ENGINE_MISMATCH]"), bad1.content[0].text);
  const bad2 = await call("bim_create_profile_members", { members: [{ category: "structure.framing", storey: "L0", type: "D", start: [0, 0], end: [1, 0] }] });
  assert.ok(bad2.isError && bad2.content[0].text.includes("[INVALID_REFERENCE]"));
  const bad3 = await call("bim_get_engine", { id: "teleport" });
  assert.ok(bad3.isError && bad3.content[0].text.includes("[UNKNOWN_ENGINE]"));
  assert.equal(events(), n, "no committed event");
});
