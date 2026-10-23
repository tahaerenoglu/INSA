import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const ENTRY = path.join(ROOT, "apps/manager-mcp/src/index.ts");
const CLI = path.join(ROOT, "apps/manager-mcp/src/cli.ts");
const TSX = path.join(ROOT, "node_modules/.bin/tsx");

const clients: Client[] = [];
after(async () => { await Promise.all(clients.map((c) => c.close().catch(() => {}))); });

/** Child env is isolated: file store in a temp dir unless a test passes INSA_PG_URL itself. */
async function connect(env: Record<string, string>) {
  const { INSA_PG_URL: _pg, INSA_APPROVAL: _ap, INSA_PROJECT: _pr, ...base } = process.env;
  const transport = new StdioClientTransport({ command: TSX, args: [ENTRY], env: { ...base, ...env } as Record<string, string>, stderr: "pipe" });
  const client = new Client({ name: "test", version: "1" });
  await client.connect(transport);
  clients.push(client);
  return client;
}
const json = (r: any) => JSON.parse(r.content.find((c: any) => c.type === "text").text);
const call = async (c: Client, name: string, args: Record<string, unknown>) => {
  const r: any = await c.callTool({ name, arguments: args });
  if (r.isError) throw new Error(r.content[0].text);
  return r;
};

test("stdio MCP: build a building, look at it, export it", { timeout: 120000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "insa-"));
  const c = await connect({ INSA_DATA: data, INSA_PROJECT: "ofis" });
  const tools = (await c.listTools()).tools;
  const names = tools.map((t) => t.name);
  for (const n of ["platform_whoami", "platform_approve", "bim_create_walls", "bim_render_plan", "bim_export_ifc", "bim_export_frag"])
    assert.ok(names.includes(n), n);
  assert.equal(tools.find((t) => t.name === "bim_delete_elements")!.annotations?.destructiveHint, true);
  assert.ok((tools.find((t) => t.name === "bim_create_walls")!.inputSchema as any).properties.dry_run);

  await call(c, "bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }, { name: "01", elevation: 3 }] });
  await call(c, "bim_create_types", { types: [{ kind: "wall", name: "DD", layers: [
    { material: "Sıva", thickness: 0.02, function: "finish" }, { material: "Tuğla", thickness: 0.2 }] },
    { kind: "door", name: "K90", width: 0.9, height: 2.1 }] });
  const preview = json(await call(c, "bim_create_walls", { dry_run: true, walls: [{ storey: "00", type: "DD", points: [[0, 0], [8, 0], [8, 6], [0, 6]], closed: true }] }));
  assert.equal(preview.status, "preview");
  const w = json(await call(c, "bim_create_walls", { walls: [{ storey: "00", type: "DD", points: [[0, 0], [8, 0], [8, 6], [0, 6]], closed: true, location_line: "exterior_face" }] }));
  assert.equal(w.status, "applied"); assert.equal(w.summary.created.length, 4);
  await call(c, "bim_place_openings", { items: [{ kind: "door", host: "W-0001", along: 2, type: "K90" }] });
  const bad: any = await c.callTool({ name: "bim_place_openings", arguments: { items: [{ kind: "door", host: "W-0001", along: 2.3, type: "K90" }] } });
  assert.ok(bad.isError && /overlaps/.test(bad.content[0].text));

  const plan: any = await call(c, "bim_render_plan", { storey: "00" });
  assert.equal(plan.content[0].type, "image");
  assert.ok(Buffer.from(plan.content[0].data, "base64").subarray(1, 4).toString() === "PNG");
  const ifc = json(await call(c, "bim_export_ifc", {}));
  assert.equal(ifc.artifact.kind, "ifc"); assert.equal(ifc.path, undefined);
  assert.ok(fs.readFileSync(path.join(data, "ofis", "exports", ifc.artifact.id), "utf8").includes("IFCDOOR"));
  const frag = json(await call(c, "bim_export_frag", {}));
  assert.ok(frag.artifact.bytes > 1000);

  const hist = json(await call(c, "platform_history", {}));
  assert.equal(hist[0].tool, "bim_place_openings");
  await call(c, "platform_undo", {});
  assert.equal(json(await call(c, "bim_query_elements", { kind: "door" })).total, 0);
  await c.close();
});

test("stdio MCP governance: proposals need a human, roles are enforced", { timeout: 120000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "insa-"));
  const c = await connect({ INSA_DATA: data, INSA_APPROVAL: "ai" });
  const r = json(await call(c, "bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }] }));
  assert.equal(r.status, "proposed");
  const self: any = await c.callTool({ name: "platform_approve", arguments: { proposal_id: r.proposalId } });
  assert.ok(self.isError, "AI must not approve");
  // a human approves through the CLI
  const { INSA_PG_URL: _pg, ...cliEnv } = process.env;
  const out = execFileSync(TSX, [CLI, "approve", r.proposalId], { env: { ...cliEnv, INSA_DATA: data, INSA_USER_ID: "taha" } }).toString();
  assert.equal(JSON.parse(out).status, "applied");
  assert.equal(json(await call(c, "bim_model_summary", {})).storeys.length, 1);
  const audit = json(await call(c, "platform_audit_log", {}));
  assert.equal(audit[0].outcome, "approved");
  assert.equal(audit[0].actor, "taha");
  assert.ok(audit.some((a: any) => a.outcome === "proposed" && a.actor === "claude"));
  await c.close();

  const viewer = await connect({ INSA_DATA: data, INSA_ACTOR_ID: "guest", INSA_ACTOR_ROLES: "viewer" });
  const denied: any = await viewer.callTool({ name: "bim_create_storeys", arguments: { storeys: [{ name: "x", elevation: 9 }] } });
  assert.ok(denied.isError && /Permission denied/.test(denied.content[0].text));
  assert.equal(json(await call(viewer, "bim_model_summary", {})).storeys.length, 1);
  await viewer.close();
});
