import { test } from "node:test";
import assert from "node:assert/strict";
import { Platform, MemoryStores } from "@insa/core";
import { bimModule, BimState } from "@insa/bim";
import type { ModelClient } from "@insa/agent";
import { buildApp } from "../src/app.js";

class Scripted implements ModelClient {
  constructor(private turns: any[]) {}
  async run(_req: any, onText: (d: string) => void) {
    const t = this.turns.shift() ?? { text: "Tamam." };
    if (t.text) onText(t.text);
    const content: any[] = [...(t.text ? [{ type: "text", text: t.text }] : []),
      ...(t.tools ?? []).map((u: any, i: number) => ({ type: "tool_use", id: `tu${i}${Math.random()}`, name: u.name, input: u.input }))];
    return { content, stop_reason: t.tools ? "tool_use" : "end_turn" };
  }
}
const parse = (body: string) => body.split("\n\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));

test("assistant endpoint streams text, tool calls and results; writes as ai:<user>", async () => {
  const platform = new Platform({ modules: [bimModule], stores: new MemoryStores(), approvalMode: "ai" });
  const model = new Scripted([
    { text: "Kat ekliyorum.", tools: [{ name: "bim_create_storeys", input: { storeys: [{ name: "00", elevation: 0 }] } }] },
    { text: "Öneri onayınızı bekliyor." }]);
  const app = buildApp({ platform, model });
  const token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { user: "taha" } })).json().token;
  const h = { authorization: `Bearer ${token}` };
  assert.deepEqual((await app.inject({ method: "GET", url: "/api/assistant/status", headers: h })).json(), { enabled: true, model: "custom" });
  const r = await app.inject({ method: "POST", url: "/api/projects/ofis/assistant", headers: h, payload: { message: "zemin kat ekle", history: [] } });
  assert.equal(r.headers["content-type"], "text/event-stream");
  const ev = parse(r.body);
  assert.deepEqual([...new Set(ev.map((e) => e.type))], ["text", "tool_call", "tool_result", "telemetry", "done"]);
  const tr = ev.find((e) => e.type === "tool_result");
  assert.equal(tr.status, "proposed");
  const done = ev.at(-1);
  assert.equal(done.messages.length, 4); // user, assistant(tool_use), user(tool_result), assistant(text)
  const props = (await app.inject({ method: "GET", url: "/api/projects/ofis/proposals", headers: h })).json();
  assert.equal(props[0].actor, "ai:taha");
  // the human approves the assistant's proposal on the web
  const ok = await app.inject({ method: "POST", url: `/api/projects/ofis/proposals/${props[0].id}/approve`, headers: h });
  assert.equal(ok.json().status, "applied");
  assert.equal(Object.keys((await platform.state<BimState>("ofis", "bim")).storeys).length, 1);
});

test("assistant disabled without a model -> 503; history is accepted for follow-up turns", async () => {
  const platform = new Platform({ modules: [bimModule], stores: new MemoryStores() });
  const app = buildApp({ platform, model: null });
  const token = (await app.inject({ method: "POST", url: "/api/auth/login", payload: { user: "taha" } })).json().token;
  const r = await app.inject({ method: "POST", url: "/api/projects/ofis/assistant", headers: { authorization: `Bearer ${token}` }, payload: { message: "x" } });
  assert.equal(r.statusCode, 503);
  const app2 = buildApp({ platform, model: new Scripted([{ text: "Merhaba tekrar." }]) });
  const t2 = (await app2.inject({ method: "POST", url: "/api/auth/login", payload: { user: "viewer" } })).json().token;
  const history = [{ role: "user", content: "merhaba" }, { role: "assistant", content: [{ type: "text", text: "Merhaba!" }] }];
  const ev = parse((await app2.inject({ method: "POST", url: "/api/projects/ofis/assistant", headers: { authorization: `Bearer ${t2}` }, payload: { message: "nasılsın", history } })).body);
  assert.equal(ev.at(-1).messages.length, 4);
});
