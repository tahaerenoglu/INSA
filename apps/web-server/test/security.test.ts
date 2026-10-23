/** Phase 1: the HTTP adapter uses the Core rules (project ids, undo governance, exports, error hygiene). */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Platform, MemoryStores, ArtifactStore, Actor } from "@insa/core";
import { bimModule } from "@insa/bim";
import { buildApp } from "../src/app.js";

const ai: Actor = { id: "claude", name: "Claude", kind: "ai", roles: ["ai_agent"] };

async function setup(opts: { artifacts?: boolean; mode?: "auto" | "ai" } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "insa-web-"));
  const platform = new Platform({ modules: [bimModule], stores: new MemoryStores(), approvalMode: opts.mode ?? "auto",
                                  artifacts: opts.artifacts === false ? undefined : new ArtifactStore(dir) });
  const app = buildApp({ platform, model: null });
  const login = async (user: string) => (await app.inject({ method: "POST", url: "/api/auth/login", payload: { user } })).json().token as string;
  const call = (t: string, method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as any, headers: { authorization: `Bearer ${t}` } });
  return { platform, app, login, call, dir };
}

test("HTTP: invalid project ids -> 400 INVALID_PROJECT_ID (same Core rule), valid ids unchanged", async () => {
  const { login, call } = await setup();
  const t = await login("taha");
  // pure dot segments are removed by URL normalisation before routing: they never reach a project handler
  for (const p of ["..", "%2E%2E"]) assert.equal((await call(t, "GET", `/api/projects/${p}/summary`)).statusCode, 404, p);
  for (const p of ["..%2F..%2Fetc", "a%2Fb", "con", "-x", ".hidden", "x..y", "%20", "x%00y"]) {
    const r = await call(t, "GET", `/api/projects/${p}/summary`);
    assert.equal(r.statusCode, 400, p); assert.equal(r.json().reason, "INVALID_PROJECT_ID", p);
    const w = await call(t, "POST", `/api/projects/${p}/tools/bim_create_storeys`, { input: { storeys: [{ name: "00", elevation: 0 }] } });
    assert.equal(w.statusCode, 400, p);
  }
  for (const p of ["ofis", "ornek-ofis", "%C4%B0stanbul.v2"]) assert.equal((await call(t, "GET", `/api/projects/${p}/summary`)).statusCode, 200, p);
});

test("HTTP: undo is governed — viewer 403, AI proposal stays pending, human undo applies", async () => {
  const { platform, login, call } = await setup({ mode: "ai" });
  const t = await login("taha"), v = await login("viewer");
  await call(t, "POST", "/api/projects/ofis/tools/bim_create_storeys", { input: { storeys: [{ name: "00", elevation: 0 }] } });
  const denied = await call(v, "POST", "/api/projects/ofis/undo", {});
  assert.equal(denied.statusCode, 403); assert.equal(denied.json().reason, "UNAUTHORIZED");
  const viaTool = await call(v, "POST", "/api/projects/ofis/tools/platform_undo", { input: {} });
  assert.equal(viaTool.statusCode, 403);
  const proposal: any = await platform.execute(ai, "ofis", "platform_undo", {});
  assert.equal(proposal.status, "proposed");
  assert.equal((await call(t, "GET", "/api/projects/ofis/summary")).json().storeys.length, 1);
  const undo = await call(t, "POST", "/api/projects/ofis/undo", {});
  assert.equal(undo.json().status, "applied");
  assert.equal((await call(t, "GET", "/api/projects/ofis/summary")).json().storeys.length, 0);
  const again = await call(t, "POST", "/api/projects/ofis/undo", {});
  assert.equal(again.statusCode, 400); assert.equal(again.json().reason, "NOTHING_TO_UNDO");
});

test("HTTP: exports are artifacts — path argument refused, downloads only within the project", async () => {
  const { login, call, dir } = await setup();
  const t = await login("taha");
  await call(t, "POST", "/api/projects/ofis/tools/bim_create_storeys", { input: { storeys: [{ name: "00", elevation: 0 }] } });
  const bad = await call(t, "POST", "/api/projects/ofis/tools/bim_export_ifc", { input: { path: "/tmp/insa-web-pwned.ifc" } });
  assert.equal(bad.statusCode, 400); assert.equal(bad.json().reason, "INVALID_EXPORT_PATH");
  const okr = await call(t, "POST", "/api/projects/ofis/tools/bim_export_ifc", { input: { name: "teslim" } });
  assert.equal(okr.json().result.artifact.id, "teslim.ifc");
  assert.deepEqual((await call(t, "GET", "/api/projects/ofis/exports")).json().map((a: any) => a.id), ["teslim.ifc"]);
  const dl = await call(t, "GET", "/api/projects/ofis/exports/teslim.ifc");
  assert.equal(dl.statusCode, 200); assert.match(dl.body, /IFC4/);
  for (const id of ["..%2F..%2Fx.ifc", "..%5Cx.ifc", "x.txt"]) {
    const r = await call(t, "GET", `/api/projects/ofis/exports/${id}`);
    assert.equal(r.statusCode, 400, id); assert.equal(r.json().reason, "INVALID_EXPORT_PATH", id);
  }
  assert.equal((await call(t, "GET", "/api/projects/other/exports/teslim.ifc")).json().reason, "ARTIFACT_NOT_FOUND");
  assert.equal(fs.existsSync("/tmp/insa-web-pwned.ifc"), false);
  assert.ok(fs.existsSync(path.join(dir, "ofis", "exports", "teslim.ifc")));
});

test("HTTP: internal errors are not leaked to clients", async () => {
  const { login, call } = await setup({ artifacts: false });
  const t = await login("taha");
  await call(t, "POST", "/api/projects/ofis/tools/bim_create_storeys", { input: { storeys: [{ name: "00", elevation: 0 }] } });
  const r = await call(t, "POST", "/api/projects/ofis/tools/bim_export_ifc", { input: {} });
  assert.equal(r.statusCode, 500);
  assert.equal(r.json().reason, "INTERNAL_ERROR");
  assert.ok(!r.body.includes("PlatformOptions"), r.body);
});
