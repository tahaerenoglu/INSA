/** Phase 12 · the structural tools executed through the real MCP stdio server. */
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

test("MCP: brace, pile, shear wall, structural slab, footing, foundation slab: create, query by category / engine, quantities, dry run, refusals, a Phase 10 edit", { timeout: 120000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "insa-mcp-str-"));
  const { INSA_PG_URL: _a, INSA_APPROVAL: _b, ...base } = process.env;
  const c = new Client({ name: "str", version: "1" });
  await c.connect(new StdioClientTransport({ command: path.join(ROOT, "node_modules/.bin/tsx"), args: [path.join(ROOT, "apps/manager-mcp/src/index.ts")],
    env: { ...base, INSA_DATA: data, INSA_PROJECT: "ofis", INSA_ACTOR_KIND: "human", INSA_ACTOR_ID: "taha", INSA_ACTOR_ROLES: "bim_manager" } as Record<string, string>, stderr: "pipe" }));
  clients.push(c);
  const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
  const ok = async (name: string, args: Record<string, unknown>) => { const r = await call(name, args); assert.ok(!r.isError, r.content[0].text); return JSON.parse(r.content[0].text); };
  const events = () => fs.readFileSync(path.join(data, "ofis", "events.jsonl"), "utf8").split("\n").filter(Boolean).length;
  const tools = (await c.listTools()).tools.map((t) => t.name);
  for (const n of ["bim_create_profile_members", "bim_create_boundaries", "bim_create_walls", "bim_create_braces", "bim_create_piles", "bim_create_footings"]) assert.ok(tools.includes(n), n);

  await ok("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }, { name: "L1", elevation: 3.2 }] });
  await ok("bim_create_types", { types: [{ kind: "wall", name: "SW", layers: [{ material: "Beton", thickness: 0.25 }] }, { kind: "slab", name: "D20", layers: [{ material: "Beton", thickness: 0.2 }] },
    { kind: "foundation_slab", name: "MAT", layers: [{ material: "Beton", thickness: 0.6 }] }, { kind: "footing", name: "PAD", footing_kind: "pad", layers: [{ material: "Beton", thickness: 0.5 }] },
    { kind: "column", name: "PILE", profile: { shape: "circle", d: 0.4 } }, { kind: "beam", name: "RHS", profile: { shape: "rhs", b: 0.2, h: 0.3, t: 0.01 } }] });
  let n = events();
  const dry = await ok("bim_create_braces", { braces: [{ storey: "L0", type: "RHS", start: [0, 0], end: [4, 3], end_storey: "L1" }], dry_run: true });
  assert.equal(events(), n, "a dry run writes nothing");
  const br = await ok("bim_create_braces", { braces: [{ storey: "L0", type: "RHS", start: [0, 0], end: [4, 3], end_storey: "L1" }] });
  assert.deepEqual(dry.preview.summary, br.summary);
  await ok("bim_create_piles", { piles: [{ storey: "L0", type: "PILE", at: [1, 1], length: 12 }] });
  await ok("bim_create_walls", { walls: [{ category: "structure.shear_wall", storey: "L0", type: "SW", start: [0, 6], end: [8, 6], height: 3 }] });
  await ok("bim_create_boundaries", { boundaries: [{ category: "structure.slab", storey: "L1", type: "D20", outline: [[0, 0], [8, 0], [8, 6], [0, 6]] }, { category: "structure.foundation_slab", storey: "L0", type: "MAT", outline: [[-1, -1], [9, -1], [9, 7], [-1, 7]], offset: -0.5 }] });
  await ok("bim_create_footings", { footings: [{ storey: "L0", type: "PAD", center: [1, 1], length: 1.2, width: 1.2, offset: -0.5 }] });
  const rows = (await ok("bim_query_elements", {})).elements.map((e: any) => [e.category, e.engine]).sort();
  assert.deepEqual(rows, [["structure.brace", "profile_member"], ["structure.footing", "boundary"], ["structure.foundation_slab", "boundary"], ["structure.pile", "profile_member"], ["structure.shear_wall", "wall"], ["structure.slab", "boundary"]]);
  assert.deepEqual((await ok("bim_query_elements", { category: "structure.brace" })).elements.map((e: any) => e.id), ["BR-0001"]);
  assert.equal((await ok("bim_query_elements", { engine: "profile_member" })).elements.length, 2);
  const b = await ok("bim_get_element", { id: "BR-0001" }), p = await ok("bim_get_element", { id: "PL-0001" });
  assert.deepEqual([b.world.end, p.world.end, p.length], [[4, 3, 3.2], [1, 1, -12], 12]);
  assert.ok(Math.abs(b.quantities.volume - 0.0096 * Math.hypot(4, 3, 3.2)) < 1e-9 && Math.abs(b.quantities.cross_section_area - 0.0096) < 1e-12);
  assert.deepEqual((await ok("bim_validate", {})).issues, []);
  const sp = await ok("bim_split_wall", { wall: "W-0001", t: 0.5 });                                   // Phase 10 on a shear wall
  assert.equal((await ok("bim_get_element", { id: sp.summary.walls[1] })).taxonomy.category, "structure.shear_wall");
  n = events();
  for (const [tool, args, reason] of [
    ["bim_create_braces", { braces: [{ storey: "L0", type: "RHS", start: [1, 1], end: [1, 1] }] }, "DEGENERATE_GEOMETRY"],
    ["bim_create_piles", { piles: [{ storey: "L0", type: "RHS", at: [1, 1], length: 5 }] }, "INVALID_REFERENCE"],
    ["bim_create_boundaries", { boundaries: [{ category: "structure.footing", storey: "L0", type: "MAT", outline: [[0, 0], [1, 0], [1, 1]] }] }, "INVALID_REFERENCE"],
    ["bim_create_types", { types: [{ kind: "beam", name: "bad", profile: { shape: "rhs", b: 0.2, h: 0.3, t: 0.2 } }] }, "INVALID_DIMENSION"],
    ["bim_reassign_storey", { items: [{ id: "BR-0001", storey: "L1" }] }, "INVALID_ENGINE_PLACEMENT"]] as [string, any, string][]) {
    const r = await call(tool, args);
    assert.ok(r.isError && r.content[0].text.includes(`[${reason}]`), `${tool}: ${r.content[0].text}`);
  }
  assert.equal(events(), n, "refused commands leave no trace");
  assert.ok(!(await call("bim_export_ifc", {})).isError);
});
