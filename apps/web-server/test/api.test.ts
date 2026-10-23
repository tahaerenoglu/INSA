import { test } from "node:test";
import assert from "node:assert/strict";
import * as http from "node:http";
import { Platform, MemoryStores, Actor } from "@insa/core";
import { bimModule } from "@insa/bim";
import { buildApp } from "../src/app.js";

const ai: Actor = { id: "claude", name: "Claude", kind: "ai", roles: ["ai_agent"] };

async function setup(mode: "auto" | "ai" = "auto") {
  const platform = new Platform({ modules: [bimModule], stores: new MemoryStores(), approvalMode: mode });
  const app = buildApp({ platform });
  const login = async (user: string) => (await app.inject({ method: "POST", url: "/api/auth/login", payload: { user } })).json().token as string;
  const call = async (token: string, method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({ method, url, payload: payload as any, headers: { authorization: `Bearer ${token}` } });
  return { platform, app, login, call };
}

async function sample(call: any, t: string, project = "ofis") {
  const tool = async (name: string, input: unknown) => {
    const r = await call(t, "POST", `/api/projects/${project}/tools/${name}`, { input });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  await tool("bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }, { name: "01", elevation: 3 }] });
  await tool("bim_create_types", { types: [{ kind: "wall", name: "DD", layers: [{ material: "Sıva", thickness: 0.02, function: "finish" }, { material: "Tuğla", thickness: 0.2 }] },
                                           { kind: "window", name: "P150", width: 1.5, height: 1.5 }] });
  await tool("bim_create_walls", { walls: [{ storey: "00", type: "DD", points: [[0, 0], [10, 0], [10, 8], [0, 8]], closed: true, location_line: "exterior_face" }] });
  await tool("bim_place_openings", { items: [{ kind: "window", host: "W-0001", along: 5, type: "P150" }] });
}

test("auth, tools catalogue and the same governed tools over HTTP", async () => {
  const { app, login, call } = await setup();
  assert.equal((await app.inject({ method: "GET", url: "/api/projects" })).statusCode, 401);
  const t = await login("taha");
  const tools = (await call(t, "GET", "/api/tools")).json();
  assert.ok(tools.length >= 27 && tools.every((x: any) => x.schema?.type === "object"));
  await sample(call, t);
  assert.deepEqual((await call(t, "GET", "/api/projects")).json(), ["ofis"]);
  const tree = (await call(t, "GET", "/api/projects/ofis/tree")).json();
  assert.equal(tree[0].groups.wall.length, 4); assert.equal(tree[0].groups.window.length, 1);
  assert.equal(tree[0].groups.wall[0].global_id.length, 22);
  const el = (await call(t, "GET", "/api/projects/ofis/elements/W-0001")).json();
  assert.equal(el.openings.length, 1); assert.ok(el.quantities.net_volume > 0);
  // domain errors -> 400, unknown element -> 400, bad dry-run preview
  const bad = await call(t, "POST", "/api/projects/ofis/tools/bim_place_openings", { input: { items: [{ kind: "window", host: "W-0001", along: 9.9, type: "P150" }] } });
  assert.equal(bad.statusCode, 400); assert.match(bad.json().error, /exceeds wall/);
  const prev = await call(t, "POST", "/api/projects/ofis/tools/bim_delete_elements", { input: { ids: ["W-0001"], cascade_hosted: true }, dry_run: true });
  assert.equal(prev.json().status, "preview"); assert.deepEqual(prev.json().preview.summary.deleted.sort(), ["N-0001", "O-0001", "W-0001"]); // wall + its opening + window
});

test("viewer role: can look, cannot change (403)", async () => {
  const { login, call } = await setup();
  await sample(call, await login("taha"));
  const v = await login("viewer");
  assert.equal((await call(v, "GET", "/api/projects/ofis/summary")).statusCode, 200);
  const r = await call(v, "POST", "/api/projects/ofis/tools/bim_delete_elements", { input: { ids: ["W-0001"] } });
  assert.equal(r.statusCode, 403);
});

test("viewer endpoints: .frag cached per model version, IFC, plan PNG", async () => {
  const { login, call } = await setup();
  const t = await login("taha");
  await sample(call, t);
  const f1 = await call(t, "GET", "/api/projects/ofis/model.frag");
  assert.equal(f1.statusCode, 200); assert.ok(f1.rawPayload.length > 1000);
  const seq1 = f1.headers["x-insa-seq"];
  const t0 = Date.now(); await call(t, "GET", "/api/projects/ofis/model.frag"); assert.ok(Date.now() - t0 < 200, "cache hit");
  const upd = await call(t, "POST", "/api/projects/ofis/tools/bim_update_elements", { input: { items: [{ id: "W-0001", kind: "wall", set: { height: 2.8 } }] } });
  assert.equal(upd.statusCode, 200, upd.body);
  const f2 = await call(t, "GET", "/api/projects/ofis/model.frag");
  assert.notEqual(f2.headers["x-insa-seq"], seq1);
  assert.match((await call(t, "GET", "/api/projects/ofis/model.ifc")).body, /IFCWINDOW/);
  const png = await call(t, "GET", "/api/projects/ofis/plan/00.png");
  assert.equal(png.headers["content-type"], "image/png"); assert.equal(png.rawPayload.subarray(1, 4).toString(), "PNG");
});

test("AI proposes (MCP side), human approves on the web, browser gets a live change event", async () => {
  const { platform, app, login, call } = await setup("ai");
  const t = await login("taha");
  // the AI works through the platform (as the MCP server process would)
  const r: any = await platform.execute(ai, "ofis", "bim_create_storeys", { storeys: [{ name: "00", elevation: 0 }] });
  assert.equal(r.status, "proposed");
  const pending = (await call(t, "GET", "/api/projects/ofis/proposals?status=pending")).json();
  assert.equal(pending[0].id, r.proposalId); assert.equal(pending[0].actor, "claude");

  await app.listen({ port: 0 });
  try {
  const port = (app.server.address() as any).port;
  const events: string[] = [];
  const req = http.get({ port, path: `/api/projects/ofis/stream?token=${t}` }, (res) => res.on("data", (c) => events.push(String(c))));
  await new Promise((res) => setTimeout(res, 200));
  const ok = await call(t, "POST", `/api/projects/ofis/proposals/${r.proposalId}/approve`);
  assert.equal(ok.json().status, "applied");
  await new Promise((res) => setTimeout(res, 200));
  req.destroy();
  assert.ok(events.join("").match(/event: change/g)!.length >= 2, events.join("")); // initial + after approval
  const hist = (await call(t, "GET", "/api/projects/ofis/history")).json();
  assert.equal(hist[0].actor, "claude"); assert.equal(hist[0].proposalId, r.proposalId);
  const audit = (await call(t, "GET", "/api/projects/ofis/audit")).json();
  assert.equal(audit[0].outcome, "approved"); assert.equal(audit[0].actor, "taha");
  const undo = await call(t, "POST", "/api/projects/ofis/undo", {});
  assert.equal(undo.json().status, "applied");
  assert.equal(undo.json().summary.reverted, ok.json().commandId);
  } finally { await app.close(); }
});
