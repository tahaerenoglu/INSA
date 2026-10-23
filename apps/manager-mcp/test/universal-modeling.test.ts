import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Platform, MemoryStores, canonicalJson, type Actor } from '@insa/core';
import { bimModule, wallRoof, toIfc, ifcToFrag, type BimState } from '@insa/bim';
import { infraModule } from '@insa/infra';
import { filesModule } from '@insa/files';
import { modelingModule, registerModelingCapability } from '../src/modeling.js';
import { z } from 'zod';
import { toolSpecs, runAgent, type ModelClient } from '@insa/agent';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/server.js';
import { buildApp } from '../../web-server/src/app.js';
const human: Actor = { id: 'modeler', name: 'Modeler', kind: 'human', roles: ['bim_manager'] };
const ai: Actor = { ...human, id: 'ai:modeler', kind: 'ai' };
const home = { intent: 'Üç katlı toplam 200 m² eğimli çatılı ev oluştur', requestId: 'house-1', requirements: { kind: 'building', floors: 3, totalArea: 200 } };
function setup(approvalMode: 'auto' | 'ai' = 'auto') {
  const stores = new MemoryStores();
  const modules = [bimModule, infraModule, filesModule, modelingModule];
  const p = new Platform({ modules, stores, approvalMode, snapshotPolicy: { everyEvents: 2, keep: 3 } });
  const ex = (tool: string, input: unknown, actor = human, dryRun = false) => p.execute(actor, 'universal', tool, input, { dryRun }) as Promise<any>;
  const state = () => p.state<BimState>('universal', 'bim');
  return { p, stores, modules, ex, state };
}
test('A/G: high-level building plan -> atomic generation -> live roof dependency -> IFC -> undo/replay/snapshot', async () => {
  const t = setup();
  const plan = await t.ex('model_plan', home);
  assert.ok(plan.result.summary.planId.startsWith('PLAN-'));
  assert.equal(Object.keys((await t.state()).elements).length, 0);
  const dry = await t.ex('model_generate', home, human, true);
  assert.equal(dry.status, 'preview');
  assert.equal(await t.p.seq('universal'), 0);
  const result = await t.ex('model_generate', { ...home, planId: plan.result.summary.planId });
  assert.equal(result.status, 'applied');
  let s = await t.state();
  assert.equal(Object.keys(s.elements).length, 40);
  const walls = Object.values(s.elements).filter(e => e.kind === 'wall' && e.topRoof);
  assert.equal(walls.length, 4);
  assert.ok(wallRoof(s, walls[0] as any));
  assert.match(toIfc(s, { projectKey: 'universal' }), /IFCBOOLEANCLIPPINGRESULT/);
  const live = canonicalJson(s);
  assert.equal(canonicalJson(await new Platform({ modules: t.modules, stores: t.stores, snapshotPolicy: false }).state('universal', 'bim')), live);
  assert.equal(canonicalJson(await new Platform({ modules: t.modules, stores: t.stores }).state('universal', 'bim')), live);
  await assert.rejects(t.ex('model_generate', home), (e: any) => e.reason === 'REQUEST_ALREADY_APPLIED');
  const roof = Object.values(s.elements).find(e => e.kind === 'boundary' && e.category === 'architecture.roof')!;
  const oldTop = wallRoof(s, walls[0] as any)!.maxHeight;
  await t.ex('model_revise', { changes: [{ tool: 'bim_update_elements', input: { items: [{ id: roof.id, kind: 'boundary', set: { offset: 1 } }] } }] });
  s = await t.state();
  assert.notEqual(wallRoof(s, s.elements[walls[0].id] as any)!.maxHeight, oldTop);
  await assert.rejects(t.ex('bim_delete_elements', { ids: [roof.id] }), (e: any) => e.reason === 'ELEMENT_IN_USE');
  await t.ex('platform_undo', {});
  assert.equal(canonicalJson(await t.state()), live);
  await t.ex('platform_undo', {});
  assert.equal(Object.keys((await t.state()).elements).length, 0);
});
test('B/C: network branches + multilevel risers are explicitly connected; column bar sets fit rotated hosts', async () => {
  const t = setup(); await t.ex('model_generate', home);
  const net = await t.ex('model_generate', { intent: 'Kavramsal temiz su', requestId: 'network-1', requirements: {
    kind: 'network', name: 'CW', domain: 'piping', classification: 'domestic_cold_water', diameter: .025,
    shaft: [2, 2], terminals: [0, 1, 2].map(i => ({ storey: `UMB-L${i}`, at: [4, 2], offset: 2.5 })), routingSpaceApproved: true } });
  assert.equal(net.status, 'applied');
  let s = await t.state();
  assert.equal(Object.values(s.elements).filter(e => e.kind === 'mep_segment').length, 5);
  assert.equal(Object.keys(s.mepJunctions).length, 3);
  const system = (await t.ex('project_query', { tool: 'bim_query_mep_systems', input: {} })).result.result[0];
  assert.equal(system.connected_component_count, 1);
  const rebar = await t.ex('model_generate', { intent: 'Kolon boyuna ve etriye donatısı', requestId: 'rebar-1', requirements: {
    kind: 'reinforcement', hosts: ['C-0001', 'C-0002'], cover: .03, diameter: .016, stirrupDiameter: .008, spacing: .15, steelGrade: 'B500B' } });
  assert.equal(rebar.status, 'applied'); s = await t.state();
  assert.equal(Object.values(s.elements).filter(e => e.kind === 'reinforcement').length, 4);
  assert.deepEqual((await t.ex('model_validate', {})).result.issues, []);
  assert.match(toIfc(s, { projectKey: 'universal' }), /IFCREINFORCINGBAR/);
  assert.match(toIfc(s, { projectKey: 'universal' }), /IFCREINFORCINGBARTYPE/);
});
test('IFC/Fragments: new attached-wall and reinforced-column geometry converts through unchanged viewer pipeline', async () => {
  const t = setup(); await t.ex('model_generate', home);
  await t.ex('model_generate', { intent: 'Column rebar', requestId: 'frag-rebar', requirements: { kind: 'reinforcement', hosts: ['C-0001'], cover: .03, diameter: .016, stirrupDiameter: .008, spacing: .3, steelGrade: 'B500B' } });
  const fragment = await ifcToFrag(toIfc(await t.state(), { projectKey: 'universal' }));
  assert.ok(fragment.byteLength > 1000);
});
test('governance: child permissions, AI approval, stale pinned plans, source conflicts and rollback', async () => {
  const t = setup('ai');
  const proposed = await t.ex('model_generate', home, ai);
  assert.equal(proposed.status, 'proposed'); assert.equal(await t.p.seq('universal'), 0);
  await assert.rejects(t.p.approve(ai, 'universal', proposed.proposalId));
  await t.p.approve({ ...human, id: 'reviewer' }, 'universal', proposed.proposalId);
  assert.equal(Object.keys((await t.state()).elements).length, 40);
  const fresh = setup();
  const readOnly: Actor = { ...human, roles: ['viewer'] };
  await assert.rejects(fresh.ex('model_generate', home, readOnly), (e: any) => e.reason === 'UNAUTHORIZED');
  assert.equal(await fresh.p.seq('universal'), 0);
  await assert.rejects(fresh.ex('model_generate', { ...home, sources: [{ file: 'F-0001', version: 1, reference: 'p1', status: 'Conflicting' }] }), (e: any) => e.reason === 'SOURCE_REQUIRES_REVIEW');
  assert.equal(await fresh.p.seq('universal'), 0);
  const stale = setup('ai'), pending = await stale.ex('model_generate', home, ai);
  await stale.ex('bim_create_storeys', { storeys: [{ name: 'Manual', elevation: 0 }] });
  const seq = await stale.p.seq('universal');
  await assert.rejects(stale.p.approve({ ...human, id: 'reviewer' }, 'universal', pending.proposalId), (e: any) => e.reason === 'STALE_MODEL_PLAN');
  assert.equal(await stale.p.seq('universal'), seq);
});
test('G: in-app LLM receives only shared high-level modeling tools and uses same platform chain', async () => {
  const t = setup(), specs = toolSpecs(t.p);
  assert.ok(specs.some(s => s.name === 'model_generate'));
  assert.ok(!specs.some(s => s.name.startsWith('bim_') || s.name.startsWith('infra_')));
  let turns = 0;
  const model: ModelClient = { async run(req) {
    assert.ok(req.tools.some(s => s.name === 'model_generate'));
    return ++turns === 1 ? { content: [{ type: 'tool_use', id: 'call', name: 'model_generate', input: home }], stop_reason: 'tool_use' } : { content: [{ type: 'text', text: 'Model oluşturuldu.' }], stop_reason: 'end_turn' };
  } };
  const events = []; for await (const e of runAgent({ platform: t.p, actor: ai, project: 'universal', model, history: [], userText: home.intent })) events.push(e);
  assert.ok(events.some(e => e.type === 'tool_result' && e.ok && e.status === 'applied'));
  assert.equal(Object.keys((await t.state()).elements).length, 40);
});
test('E: same model_generate delegates station-based corridor to existing alignment engine and shared component types', async () => {
  const t = setup();
  await t.ex('infra_create_alignment', { name: 'Rail', start_station: 1000, horizontal: [{ x: 0, y: 0 }, { x: 2000, y: 0 }], vertical: [{ station: 1000, z: 10 }, { station: 3000, z: 20 }] });
  await t.ex('bim_create_materials', { materials: [{ name: 'Formation concrete' }] });
  await t.ex('infra_create_component_types', { types: [{ name: 'Formation', layer: { name: 'Formation', role: 'subbase', thickness: .3, leftExtent: 3, rightExtent: 3, materialId: 'M-0001' } }] });
  const section = (station: number) => ({ station, leftWidth: 3, rightWidth: 3, leftShoulder: 0, rightShoulder: 0, leftCrossfall: 0, rightCrossfall: 0 });
  const generated = await t.ex('model_generate', { intent: 'KM 1+000–3+000 güzergâh koridoru', requestId: 'corridor-1', requirements: {
    kind: 'corridor', definition: { name: 'Rail formation', alignment: 'AL-001', from: 1000, to: 3000, sections: [section(1000), section(3000)], layers: [{ componentType: 'CT-001' }] } } });
  assert.equal(generated.status, 'applied'); assert.deepEqual(generated.summary.infrastructure, ['RD-001']);
  const state: any = await t.p.state('universal', 'infra');
  assert.equal(state.roads['RD-001'].layers[0].componentType, 'CT-001');
  assert.equal(state.roads['RD-001'].from, 1000); assert.equal(state.roads['RD-001'].to, 3000);
  await t.ex('platform_undo', {});
  assert.equal(Object.keys((await t.p.state<any>('universal', 'infra')).roads ?? {}).length, 0);
});
test('shared registry: actual MCP tools/call and authenticated HTTP reach the same governed universal tools', async () => {
  const t = setup('ai');
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(t.p, ai), client = new Client({ name: 'universal-test', version: '1' });
  await server.connect(serverTransport); await client.connect(clientTransport);
  const app = buildApp({ platform: t.p, model: null });
  try {
    const catalog = await client.listTools();
    for (const name of ['project_analyze', 'project_query', 'model_plan', 'model_generate', 'model_revise', 'model_validate', 'model_repair']) assert.ok(catalog.tools.some(t => t.name === name));
    const response: any = await client.callTool({ name: 'model_generate', arguments: { ...home, project: 'universal' } });
    assert.ok(!response.isError, JSON.stringify(response));
    const proposed = JSON.parse(response.content[0].text); assert.equal(proposed.status, 'proposed');
    assert.equal(await t.p.seq('universal'), 0);
    await t.p.approve({ ...human, id: 'reviewer' }, 'universal', proposed.proposalId);
    const token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { user: 'taha' } })).json().token;
    const validated = await app.inject({ method: 'POST', url: '/api/projects/universal/tools/model_validate', headers: { authorization: `Bearer ${token}` }, payload: { input: {} } });
    assert.equal(validated.statusCode, 200, validated.body); assert.deepEqual(validated.json().result.issues, []);
  } finally { await app.close(); await client.close(); await server.close(); }
});
test('safe refusal: obstructed service route and host shrink never leave partial elements or events', async () => {
  const t = setup(); await t.ex('model_generate', home);
  let before = await t.p.seq('universal');
  await assert.rejects(t.ex('model_generate', { intent: 'Route through wall', requestId: 'unsafe-network', requirements: {
    kind: 'network', name: 'Unsafe', domain: 'piping', classification: 'cold_water', diameter: .025, shaft: [0, 0],
    terminals: [{ storey: 'UMB-L0', at: [4, 2], offset: 2 }, { storey: 'UMB-L1', at: [4, 2], offset: 2 }], routingSpaceApproved: true } }), (e: any) => e.reason === 'INVALID_ROUTE');
  assert.equal(await t.p.seq('universal'), before);
  await t.ex('model_generate', { intent: 'Rebar', requestId: 'verified-rebar', requirements: { kind: 'reinforcement', hosts: ['C-0001'], cover: .03, diameter: .016, stirrupDiameter: .008, spacing: .15, steelGrade: 'B500B' } });
  before = await t.p.seq('universal');
  const s = await t.state(), host: any = s.elements['C-0001'];
  await assert.rejects(t.ex('bim_update_types', { items: [{ type: host.type, kind: 'column', set: { profile: { shape: 'rect', b: .2, h: .2 } } }] }), (e: any) => e.reason === 'DEPENDENT_ELEMENT_INVALID');
  assert.equal(await t.p.seq('universal'), before);
});
test('extension capability requires no public tool change; BIM+infra commit/replay/undo together and roll back on failure', async () => {
  registerModelingCapability({ id: 'integration-extension', kind: 'integration-extension', input: z.object({ kind: z.literal('integration-extension'), invalid: z.boolean().default(false) }), engines: ['alignment', 'levels'], compile(b, r) {
    b.add('bim_create_storeys', { storeys: [{ name: 'Integration base', elevation: 0 }] });
    b.add('infra_create_alignment', { name: 'Integration alignment', horizontal: [{ x: 0, y: 0 }, { x: r.invalid ? 0 : 100, y: 0 }], vertical: [{ station: 0, z: 0 }, { station: 100, z: 1 }] });
  } });
  const t = setup();
  const request = { intent: 'Mixed-module extension', requestId: 'mixed', requirements: { kind: 'integration-extension', invalid: true } };
  await assert.rejects(t.ex('model_generate', request)); assert.equal(await t.p.seq('universal'), 0);
  await t.ex('model_generate', { ...request, requirements: { ...request.requirements, invalid: false } });
  const events = await t.p.store('universal').readEvents();
  assert.equal(new Set(events.map(e => e.commandId)).size, 1);
  assert.ok(events.some(e => e.module === 'bim') && events.some(e => e.module === 'infra'));
  const replay = new Platform({ modules: t.modules, stores: t.stores, snapshotPolicy: false });
  assert.equal(canonicalJson(await replay.state('universal', 'bim')), canonicalJson(await t.state()));
  await t.ex('platform_undo', {});
  assert.equal(Object.keys((await t.state()).storeys).length, 0);
  assert.equal(Object.keys((await t.p.state<any>('universal', 'infra')).alignments).length, 0);
});
test('array capability places equipment from one existing shared type and preserves semantic category', async () => {
  const t = setup();
  await t.ex('bim_create_storeys', { storeys: [{ name: 'Equipment level', elevation: 0 }] });
  await t.ex('bim_create_families', { families: [{ name: 'Equipment box', category: 'mechanical.equipment', parameters: ['width', 'depth', 'height'].map(key => ({ key, name: key, scope: 'type', dataType: 'length', required: true })), representation: { kind: 'box', width: 'width', depth: 'depth', height: 'height' } }] });
  await t.ex('bim_create_types', { types: [{ kind: 'component', name: 'Equipment 1', family: 'Equipment box', parameters: { width: 1, depth: 1, height: 1 } }] });
  await t.ex('model_generate', { intent: 'Equipment grid', requestId: 'array', requirements: { kind: 'array', type: 'Equipment 1', storey: 'Equipment level', origin: [0, 0], rows: 2, columns: 3, spacing: [2, 2] } });
  const s = await t.state(), elements = Object.values(s.elements);
  assert.equal(elements.length, 6); assert.equal(new Set(elements.map((e: any) => e.type)).size, 1);
  assert.equal(Object.keys(s.types).length, 1);
  assert.deepEqual((await t.ex('model_validate', {})).result.issues, []);
});
