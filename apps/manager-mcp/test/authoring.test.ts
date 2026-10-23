/** Phase 10 · the authoring primitives executed through the real MCP stdio server (not just listed). */
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

test("MCP: split / merge / trim / extend / rehost run, return structured results, honour dry_run and refuse invalid edits without a trace", { timeout: 120000 }, async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "insa-mcp-auth-"));
  const { INSA_PG_URL: _a, INSA_APPROVAL: _b, ...base } = process.env;
  const c = new Client({ name: "auth", version: "1" });
  await c.connect(new StdioClientTransport({ command: path.join(ROOT, "node_modules/.bin/tsx"), args: [path.join(ROOT, "apps/manager-mcp/src/index.ts")],
    env: { ...base, INSA_DATA: data, INSA_PROJECT: "ofis", INSA_ACTOR_KIND: "human", INSA_ACTOR_ID: "taha", INSA_ACTOR_ROLES: "bim_manager" } as Record<string, string>, stderr: "pipe" }));
  clients.push(c);
  const call = (name: string, args: Record<string, unknown>) => c.callTool({ name, arguments: args }) as Promise<any>;
  const ok = async (name: string, args: Record<string, unknown>) => { const r = await call(name, args); assert.ok(!r.isError, r.content[0].text); return JSON.parse(r.content[0].text); };
  const events = () => fs.readFileSync(path.join(data, "ofis", "events.jsonl"), "utf8").split("\n").filter(Boolean).length;
  const tools = (await c.listTools()).tools;
  for (const n of ["bim_split_wall", "bim_merge_walls", "bim_trim_wall", "bim_extend_wall"]) {
    const t = tools.find((x) => x.name === n)!;
    assert.ok(t, n);
    assert.equal(t.annotations?.destructiveHint, true, `${n} is a governed (destructive) edit`);
    assert.ok(JSON.stringify(t.inputSchema).includes("dry_run"), `${n} offers dry_run`);
  }

  await ok("bim_create_storeys", { storeys: [{ name: "L0", elevation: 0 }] });
  await ok("bim_create_types", { types: [{ kind: "wall", name: "W", layers: [{ material: "Tuğla", thickness: 0.2 }] }, { kind: "window", name: "N", width: 1, height: 1.2 }] });
  await ok("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 0], end: [10, 0], height: 3 }, { storey: "L0", type: "W", start: [4, 0], end: [4, 5], height: 3 },
                                         { storey: "L0", type: "W", start: [0, 8], end: [3, 8], height: 3 }, { storey: "L0", type: "W", start: [6, 3], end: [10, 3], height: 3 }, { storey: "L0", type: "W", start: [7, 0], end: [7, 6], height: 3 }] });
  await ok("bim_join_walls", { kind: "endpoint_segment", endpoint: { wall: "W-0002", endpoint: "start" }, host: "W-0001" });
  await ok("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 8, type: "N" }] });

  // dry run: the full result, nothing persisted
  let n = events();
  const dry = await ok("bim_split_wall", { wall: "W-0001", t: 0.5, dry_run: true });
  assert.equal(dry.preview.summary.splitT, 0.5);
  assert.equal(events(), n, "a dry run writes nothing");
  // split: structured result; the original id keeps the start; the T and the window are transferred
  const sp = await ok("bim_split_wall", { wall: "W-0001", t: 0.5 });
  assert.deepEqual(dry.preview.summary, sp.summary, "the preview was exactly the result");
  assert.deepEqual([sp.summary.walls, sp.summary.splitPoint, sp.summary.transferredOpenings.map((o: any) => [o.opening, o.to, o.newAlong])], [["W-0001", "W-0006"], [5, 0], [["O-0001", "W-0006", 3]]]);
  // a split through the window is refused with structured details and writes nothing
  n = events();
  const cross = await call("bim_split_wall", { wall: "W-0006", t: 0.6 });                      // x = 8: the window spans 7.5 .. 8.5
  assert.ok(cross.isError && cross.content[0].text.includes("[SPLIT_INTERSECTS_HOSTED_OPENING]"), cross.content[0].text);
  assert.equal(JSON.parse(cross.content[0].text.split("details: ")[1]).openingId, "O-0001");
  assert.equal(events(), n, "no committed event for the refused split");
  // merge it back
  const mg = await ok("bim_merge_walls", { walls: ["W-0001", "W-0006"] });
  assert.deepEqual([mg.summary.survivor, mg.summary.removed, mg.summary.mergedLength], ["W-0001", "W-0006", 10]);
  assert.equal((await ok("bim_get_element", { id: "O-0001" })).along, 8);
  // trim: W-0004 [6,3]->[10,3] against the vertical W-0005 at x = 7 : trim its START
  const tr = await ok("bim_trim_wall", { wall: "W-0004", endpoint: "start", target: "W-0005" });
  assert.deepEqual([tr.summary.wall, tr.summary.newPoint, tr.summary.join.kind], ["W-0004", [7, 3], "endpoint_segment"]);
  // extend: W-0003 [0,8]->[3,8] to W-0002 is parallel/short: refused; extend W-0003's end to the vertical W-0005 is a miss (it stops at y 6)
  n = events();
  const miss = await call("bim_extend_wall", { wall: "W-0003", endpoint: "end", target: "W-0005" });
  assert.ok(miss.isError && miss.content[0].text.includes("[INVALID_EXTEND_TARGET]"), miss.content[0].text);
  assert.equal(events(), n);
  const ext = await ok("bim_extend_wall", { wall: "W-0002", endpoint: "end", target: "W-0003" }).catch(() => null);
  assert.equal(ext, null, "W-0002 ends at y = 5, W-0003 lies at y = 8 and only spans x 0..3: nothing to extend to");
  // rehost with the structured result
  await ok("bim_create_walls", { walls: [{ storey: "L0", type: "W", start: [0, 12], end: [8, 12], height: 3 }] });
  const rh = await ok("bim_rehost_opening", { opening: "O-0001", host: "W-0006", along: 4 }).catch(() => null);
  assert.equal(rh, null, "W-0006 was merged away");
  const rh2 = await ok("bim_rehost_opening", { opening: "O-0001", host: "W-0007", along: 4 });
  assert.deepEqual([rh2.summary.from, rh2.summary.to, rh2.summary.fill, rh2.summary.oldAlong, rh2.summary.newAlong], ["W-0001", "W-0007", "N-0001", 8, 4]);
  await ok("platform_undo", {});
  assert.equal((await ok("bim_get_element", { id: "O-0001" })).host, "W-0001");
  const issues = await ok("bim_validate", {});
  assert.deepEqual(issues.issues.filter((i: any) => i.severity === "error"), []);
});
