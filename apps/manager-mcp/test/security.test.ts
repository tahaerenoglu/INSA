/** Phase 1: the MCP adapter cannot bypass Core protections (real stdio server process). */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const TSX = path.join(ROOT, "node_modules/.bin/tsx");
const clients: Client[] = [];
after(async () => { await Promise.all(clients.map((c) => c.close().catch(() => {}))); });

async function connect(env: Record<string, string>) {
  const { INSA_PG_URL: _a, INSA_APPROVAL: _b, INSA_PROJECT: _c, ...base } = process.env;
  const c = new Client({ name: "sec", version: "1" });
  await c.connect(new StdioClientTransport({ command: TSX, args: [path.join(ROOT, "apps/manager-mcp/src/index.ts")],
                                             env: { ...base, ...env } as Record<string, string>, stderr: "pipe" }));
  clients.push(c);
  return c;
}
const text = (r: any) => r.content[0].text as string;
const ok = async (c: Client, name: string, args: Record<string, unknown>) => {
  const r: any = await c.callTool({ name, arguments: args });
  if (r.isError) throw new Error(text(r));
  return JSON.parse(text(r));
};
const tree = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
  d.isDirectory() ? [d.name + "/", ...tree(path.join(dir, d.name)).map((f) => `${d.name}/${f}`)] : [d.name]);

test("MCP: invalid project ids are rejected with INVALID_PROJECT_ID and never reach storage", { timeout: 120000 }, async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "insa-mcp-")), data = path.join(base, "data");
  const c = await connect({ INSA_DATA: data });
  for (const project of ["../escape", "..", "/tmp/abs", "a/b", "x\u0000", "", " "]) {
    for (const [tool, args] of [["bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }] }], ["bim_model_summary", {}], ["platform_history", {}]] as const) {
      const r: any = await c.callTool({ name: tool, arguments: { ...args, project } });
      assert.ok(r.isError && text(r).includes("[INVALID_PROJECT_ID]"), `${tool} ${JSON.stringify(project)}: ${text(r)}`);
    }
  }
  assert.deepEqual(fs.readdirSync(base), ["data"], "nothing created next to the data root");
  assert.deepEqual(fs.existsSync(data) ? tree(data) : [], [], "nothing created inside it either");
  assert.equal(fs.existsSync("/tmp/abs"), false);
});

test("MCP: exports refuse paths and traversal names; artifacts stay in the project's export storage", { timeout: 120000 }, async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "insa-mcp-")), data = path.join(base, "data");
  const c = await connect({ INSA_DATA: data, INSA_PROJECT: "ofis" });
  await ok(c, "bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }] });
  for (const args of [{ path: "/tmp/insa-mcp-pwned.ifc" }, { path: "../../pwned.ifc" }, { name: "../../pwned" }, { name: "/tmp/pwned" }]) {
    const r: any = await c.callTool({ name: "bim_export_ifc", arguments: args });
    assert.ok(r.isError && text(r).includes("[INVALID_EXPORT_PATH]"), JSON.stringify(args));
  }
  const res = await ok(c, "bim_export_ifc", { name: "teslim-01" });
  assert.equal(res.artifact.id, "teslim-01.ifc");
  assert.deepEqual(tree(base).filter((f) => !f.endsWith("/") && !f.endsWith(".jsonl") && !f.endsWith(".json")), ["data/ofis/exports/teslim-01.ifc"]);
  assert.equal(fs.existsSync("/tmp/insa-mcp-pwned.ifc"), false);
});

test("MCP: undo is governed — viewer denied; AI undo becomes a proposal; a human approves it", { timeout: 120000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "insa-mcp-"));
  const human = await connect({ INSA_DATA: data, INSA_ACTOR_ID: "taha", INSA_ACTOR_KIND: "human", INSA_ACTOR_ROLES: "bim_manager", INSA_APPROVAL: "ai" });
  await ok(human, "bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }] });
  const viewer = await connect({ INSA_DATA: data, INSA_ACTOR_ID: "guest", INSA_ACTOR_KIND: "human", INSA_ACTOR_ROLES: "viewer" });
  const denied: any = await viewer.callTool({ name: "platform_undo", arguments: {} });
  assert.ok(denied.isError && text(denied).startsWith("Permission denied [UNAUTHORIZED]"));
  const tools = (await viewer.listTools()).tools;
  assert.equal(tools.find((t) => t.name === "platform_undo")!.annotations?.destructiveHint, true);

  const claude = await connect({ INSA_DATA: data, INSA_APPROVAL: "ai" });        // default actor: AI
  const r = await ok(claude, "platform_undo", {});
  assert.equal(r.status, "proposed");
  assert.equal((await ok(claude, "bim_model_summary", {})).storeys.length, 1, "AI could not mutate committed state");
  const self: any = await claude.callTool({ name: "platform_approve", arguments: { proposal_id: r.proposalId } });
  assert.ok(self.isError);
  const { INSA_PG_URL: _pg, ...env } = process.env;
  const out = JSON.parse(execFileSync(TSX, [path.join(ROOT, "apps/manager-mcp/src/cli.ts"), "approve", r.proposalId],
                                      { env: { ...env, INSA_DATA: data, INSA_USER_ID: "taha" } }).toString());
  assert.equal(out.status, "applied");
  assert.equal((await ok(claude, "bim_model_summary", {})).storeys.length, 0);
  const hist = await ok(human, "platform_history", {});
  assert.equal(hist[0].tool, "platform_undo"); assert.equal(hist[0].proposalId, r.proposalId); assert.equal(hist[1].reverted, true);
});
