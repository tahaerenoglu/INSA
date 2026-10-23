import { test } from "node:test";
import assert from "node:assert/strict";
import Ajv from "ajv";
import { Platform, MemoryStores, Actor } from "@insa/core";
import { bimModule, BimState } from "@insa/bim";
import { runAgent, toolSpecs, projectToolSpecs, compact, ModelClient, AgentEvent, Message } from "../src/index.js";

/** Plays back a fixed list of model turns and records what the model was sent. */
class Scripted implements ModelClient {
  sent: any[] = [];
  constructor(private turns: { text?: string; tools?: { name: string; input: any }[] }[]) {}
  async run(req: any, onText: (d: string) => void) {
    this.sent.push(structuredClone(req));
    const t = this.turns.shift() ?? { text: "bitti" };
    const content: any[] = [];
    if (t.text) { for (const w of t.text.split(" ")) onText(w + " "); content.push({ type: "text", text: t.text }); }
    (t.tools ?? []).forEach((u, i) => content.push({ type: "tool_use", id: `tu_${this.sent.length}_${i}`, name: u.name, input: u.input }));
    return { content, stop_reason: t.tools?.length ? "tool_use" : "end_turn" };
  }
}
const collect = async (it: AsyncGenerator<AgentEvent>) => { const out: AgentEvent[] = []; for await (const e of it) out.push(e); return out; };
const aiOf = (roles: string[]): Actor => ({ id: "ai:taha", name: "Asistan (Taha)", kind: "ai", roles });
const BUILD = [
  { text: "Orijini sol alt dış köşe kabul ediyorum.", tools: [
    { name: "bim_create_storeys", input: { storeys: [{ name: "00", elevation: 0 }, { name: "01", elevation: 3 }] } },
    { name: "bim_create_types", input: { types: [{ kind: "wall", name: "DD", layers: [{ material: "Sıva", thickness: 0.02, function: "finish" }, { material: "Tuğla", thickness: 0.2 }] }] } }] },
  { tools: [{ name: "bim_create_walls", input: { walls: [{ storey: "00", type: "DD", points: [[0, 0], [10, 0], [10, 8], [0, 8]], closed: true, location_line: "exterior_face" }] } }] },
  { tools: [{ name: "bim_render_plan", input: { storey: "00" } }] },
  { text: "Zemin katın dört dış duvarı hazır." },
];

test("tool specs: every schema is valid draft-7 JSON Schema; approval tools are hidden", () => {
  const p = new Platform({ modules: [bimModule], stores: new MemoryStores() });
  const specs = toolSpecs(p);
  const ajv = new Ajv({ strict: false });
  for (const s of specs) assert.ok(ajv.validateSchema(s.input_schema), `${s.name}: ${ajv.errorsText()}`);
  const names = specs.map((s) => s.name);
  assert.ok(!names.includes("platform_approve") && !names.includes("platform_reject"));
  assert.ok((specs.find((s) => s.name === "bim_create_walls")!.input_schema as any).properties.dry_run);
  assert.ok(specs.every((s) => s.name.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(s.name)));
});

test("project tool catalog keeps shared BIM tools and hides discipline tools on infrastructure projects", () => {
  const p = new Platform({ modules: [bimModule], stores: new MemoryStores() });
  const names = projectToolSpecs(p, "infrastructure").map((tool) => tool.name);
  assert.ok(names.includes("bim_model_summary"));
  assert.ok(names.includes("bim_set_georeference"));
  assert.ok(!names.includes("bim_create_walls"));
  assert.ok(!names.includes("bim_create_mep_systems"));
});

test("assistant builds, looks at the plan, answers; history stays well-formed", async () => {
  const p = new Platform({ modules: [bimModule], stores: new MemoryStores(), approvalMode: "auto" });
  const model = new Scripted(structuredClone(BUILD));
  const ev = await collect(runAgent({ platform: p, actor: aiOf(["bim_manager"]), project: "x", model, history: [], userText: "10x8 m tek katlı bir yapı kur" }));
  const kinds = ev.map((e) => e.type);
  assert.ok(kinds.includes("text") && kinds.at(-1) === "done");
  const results = ev.filter((e): e is Extract<AgentEvent, { type: "tool_result" }> => e.type === "tool_result");
  assert.deepEqual(results.map((r) => [r.name, r.ok, r.status]), [
    ["bim_create_storeys", true, "applied"], ["bim_create_types", true, "applied"], ["bim_create_walls", true, "applied"], ["bim_render_plan", true, "ok"]]);
  assert.ok(results[3].image && results[3].image.length > 1000, "plan image returned to the model");
  // the model received the plan as an image block in the following request
  const lastReq = model.sent.at(-1);
  const imgSent = lastReq.messages.at(-1).content.some((b: any) => b.type === "tool_result" && b.content.some((c: any) => c.type === "image"));
  assert.ok(imgSent);
  const s = await p.state<BimState>("x", "bim");
  assert.equal(Object.values(s.elements).filter((e) => e.kind === "wall").length, 4);
  // every tool_use is answered by a tool_result with the same id in the next message
  const done = ev.at(-1) as Extract<AgentEvent, { type: "done" }>;
  const msgs = done.messages;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role !== "assistant" || typeof m.content === "string") continue;
    const ids = (m.content as any[]).filter((b) => b.type === "tool_use").map((b) => b.id);
    if (!ids.length) continue;
    const next = msgs[i + 1].content as any[];
    assert.deepEqual(next.map((b) => b.tool_use_id), ids);
  }
  // audit trail shows the assistant identity, distinct from the human
  const hist = await p.history("x");
  assert.ok(hist.every((h) => h.actor === "ai:taha"));
});

test("approval mode: assistant writes become proposals and the model is told so", async () => {
  const p = new Platform({ modules: [bimModule], stores: new MemoryStores(), approvalMode: "ai" });
  const model = new Scripted([{ tools: [{ name: "bim_create_storeys", input: { storeys: [{ name: "00", elevation: 0 }] } }] }, { text: "Onay bekliyor." }]);
  const ev = await collect(runAgent({ platform: p, actor: aiOf(["admin"]), project: "x", model, history: [], userText: "kat ekle" }));
  const r = ev.find((e) => e.type === "tool_result") as any;
  assert.equal(r.status, "proposed");
  const fed = JSON.parse(model.sent[1].messages.at(-1).content[0].content[0].text);
  assert.equal(fed.status, "proposed");
  assert.equal(Object.keys((await p.state<BimState>("x", "bim")).storeys).length, 0);
  const props = await p.store("x").readProposals();
  assert.equal(props[0].actor, "ai:taha");
});

test("assistant never exceeds the user: viewer's assistant cannot write; approval tools are refused", async () => {
  const p = new Platform({ modules: [bimModule], stores: new MemoryStores() });
  const model = new Scripted([{ tools: [
    { name: "bim_create_storeys", input: { storeys: [{ name: "00", elevation: 0 }] } },
    { name: "platform_approve", input: { proposal_id: "P-1" } }] }, { text: "Yetkim yok." }]);
  const ev = await collect(runAgent({ platform: p, actor: aiOf(["viewer"]), project: "x", model, history: [], userText: "kat ekle" }));
  const res = ev.filter((e) => e.type === "tool_result") as any[];
  assert.equal(res[0].ok, false); assert.match(res[0].summary, /lacks 'bim.write'/);
  assert.equal(res[1].ok, false); assert.match(res[1].summary, /not available/);
  const errBlocks = model.sent[1].messages.at(-1).content;
  assert.ok(errBlocks.every((b: any) => b.is_error === true));
});

test("compact keeps only the latest images and truncates huge tool outputs", () => {
  const img = (n: number): Message => ({ role: "user", content: [{ type: "tool_result", tool_use_id: `t${n}`,
    content: [{ type: "text", text: "x".repeat(n === 0 ? 30000 : 10) }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] }] });
  const out = compact([img(0), img(1), img(2), img(3)]);
  const images = out.flatMap((m) => (m.content as any[]).flatMap((b) => b.content)).filter((c: any) => c.type === "image");
  assert.equal(images.length, 2);
  assert.ok(((out[0].content as any[])[0].content[0].text as string).endsWith("[truncated]"));
});
