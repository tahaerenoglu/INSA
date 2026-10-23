/** Phase 2 · F: the MCP path cannot bypass BIM domain validation (real stdio server process). */
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

test("F · MCP: typed updates, no zero-length geometry, structured errors, no committed event on failure", { timeout: 120000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "insa-mcp-val-"));
  const { INSA_PG_URL: _a, INSA_APPROVAL: _b, ...base } = process.env;
  const c = new Client({ name: "val", version: "1" });
  await c.connect(new StdioClientTransport({ command: path.join(ROOT, "node_modules/.bin/tsx"), args: [path.join(ROOT, "apps/manager-mcp/src/index.ts")],
    env: { ...base, INSA_DATA: data, INSA_PROJECT: "ofis", INSA_ACTOR_KIND: "human", INSA_ACTOR_ID: "taha", INSA_ACTOR_ROLES: "bim_manager" } as Record<string, string>, stderr: "pipe" }));
  clients.push(c);
  const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
  const ok = async (name: string, args: Record<string, unknown>) => { const r = await call(name, args); assert.ok(!r.isError, r.content[0].text); return JSON.parse(r.content[0].text); };
  const events = () => fs.readFileSync(path.join(data, "ofis", "events.jsonl"), "utf8").split("\n").filter(Boolean).length;
  const fails = async (name: string, args: Record<string, unknown>, reason: string, detail?: string) => {
    const n = events();
    const r = await call(name, args);
    const text = r.content[0].text as string;
    // schema violations may already be refused by the MCP SDK against the published input schema (-32602, isError result)
    const sdkSchemaRefusal = reason === "INVALID_INPUT" && /-32602/.test(text) && /Input validation error/.test(text);
    assert.ok(r.isError && (text.includes(`[${reason}]`) || sdkSchemaRefusal), `${name}: ${text}`);
    if (detail) assert.ok(text.includes(detail), `details missing in: ${text}`);
    assert.ok(!/at .*\.ts:\d+|node_modules|\/home\//.test(text), "no stack traces or server paths");
    assert.equal(events(), n, "no committed event");
  };

  await ok("bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }] });
  await ok("bim_create_types", { types: [{ kind: "wall", name: "DD", layers: [{ material: "Tuğla", thickness: 0.2 }] }, { kind: "beam", name: "B", profile: { shape: "rect", b: 0.3, h: 0.5 } },
                                         { kind: "window", name: "P", width: 1, height: 1 }] });
  await ok("bim_create_walls", { walls: [{ storey: "00", type: "DD", start: [0, 0], end: [10, 0], height: 3 }] });
  await ok("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 8, type: "P" }] });

  const schema = (await c.listTools()).tools.find((t) => t.name === "bim_update_elements")!.inputSchema as any;
  assert.ok(JSON.stringify(schema).includes("\"kind\""), "the MCP schema is per kind");

  await fails("bim_update_elements", { items: [{ id: "W-0001", set: { height: -3 } }] }, "INVALID_INPUT");                       // old untyped shape
  await fails("bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { height: -3 } }] }, "INVALID_INPUT");
  await fails("bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { storey: "x" } }] }, "INVALID_ELEMENT_UPDATE", "\"field\":\"storey\"");
  await fails("bim_create_walls", { walls: [{ storey: "00", type: "DD", start: [3, 3], end: [3, 3], height: 3 }] }, "DEGENERATE_GEOMETRY");
  await fails("bim_create_beams", { beams: [{ storey: "00", type: "B", start: [1, 1], end: [1, 1.00001] }] }, "DEGENERATE_GEOMETRY");
  await fails("bim_update_elements", { items: [{ id: "W-0001", kind: "wall", set: { end: [8.2, 0] } }] }, "DEPENDENT_ELEMENT_INVALID", "\"dependentId\":\"O-0001\"");
  await fails("bim_create_slabs", { slabs: [{ storey: "00", type: "DD", outline: [[0, 0], [5, 5], [5, 0], [0, 5]] }] }, "INVALID_REFERENCE");
  assert.equal((await ok("bim_model_summary", {})).elements, 3, "only the valid elements exist");
});
