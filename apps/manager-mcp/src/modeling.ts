/** Universal intent tools. Domain state, geometry, events and export remain owned by existing modules. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DomainError, canonicalJson, can, type ModuleDef, type ToolContext, type CommandTool, type QueryTool } from '@insa/core';
import { bimModule, modelIssues, listEngines, engineOfKind, structuralConnectivity, type BimState } from '@insa/bim';
import { infraModule, type InfraState } from '@insa/infra';
import { filesModule } from '@insa/files';
import { reinforcementLayout, reinforcementGeometryIssues } from './modeling-rebar.js';
import { orthogonalRoute } from './modeling-routing.js';

const point = z.tuple([z.number().finite(), z.number().finite()]);
const source = z.object({ file: z.string(), version: z.number().int().positive(), reference: z.string(),
  status: z.enum(['Verified', 'Derived', 'Assumed', 'Missing', 'Conflicting', 'RequiresApproval']), value: z.unknown().optional(), unit: z.string().optional(),
  parameter: z.string().optional(), role: z.enum(['geometry', 'specification', 'boq']).default('geometry') }).strict();
const building = z.object({ kind: z.literal('building'), floors: z.number().int().min(1).max(30), totalArea: z.number().positive().max(100000),
  floorHeight: z.number().min(2).max(10).default(3), roofPitch: z.number().min(1).max(60).default(20) }).strict();
const reinforcement = z.object({ kind: z.literal('reinforcement'), hosts: z.array(z.string()).min(1).max(200), cover: z.number().positive(),
  diameter: z.number().positive(), stirrupDiameter: z.number().positive(), spacing: z.number().positive(), steelGrade: z.string().min(1) }).strict();
const network = z.object({ kind: z.literal('network'), name: z.string().min(1), domain: z.enum(['piping', 'hvac', 'electrical']),
  classification: z.string().min(1), diameter: z.number().positive(),
  shaft: point, terminals: z.array(z.object({ storey: z.string(), at: point, offset: z.number().finite() }).strict()).min(2).max(100),
  routingSpaceApproved: z.literal(true).describe('Explicitly authorized service zone; never infer permission to penetrate structural elements') }).strict();
const corridorTool = infraModule.tools.find(t => t.name === 'infra_create_road_corridor')!;
const corridor = z.object({ kind: z.literal('corridor'), definition: corridorTool.input }).strict();
const arrayLayout = z.object({ kind: z.literal('array'), type: z.string(), storey: z.string(), origin: point,
  rows: z.number().int().min(1).max(100), columns: z.number().int().min(1).max(100),
  spacing: z.tuple([z.number().positive(), z.number().positive()]), offset: z.number().default(0), rotation: z.number().default(0) }).strict();
export const ModelingInput = z.object({ intent: z.string().min(1).max(4000), requestId: z.string().min(1).max(80),
  requirements: z.object({ kind: z.string().min(1) }).catchall(z.unknown()).describe('Read project_analyze capability schemas; the selected engine validates its complete requirements object'),
  sources: z.array(source).max(100).default([]), planId: z.string().optional(),
  mode: z.literal('conceptual').default('conceptual') }).strict();
type Input = z.infer<typeof ModelingInput>;
type Step = { tool: string; input: unknown };
type Capability = { id: string; kind: string; input: z.ZodType; engines: string[]; compile(b: Builder, requirements: any): void };
const capabilities = new Map<string, Capability>();
type Issue = { id: string; reason: string; message: string };
type RulePack = { id: string; layer: 'universal' | 'discipline' | 'project-type' | 'standard'; status: 'implemented' | 'informational'; applies(kind: string): boolean; evaluate(s: BimState): Issue[] };
const rules = new Map<string, RulePack>();
export function registerModelingRulePack(pack: RulePack) {
  if (rules.has(pack.id)) throw new Error(`Rule pack already registered: ${pack.id}`);
  rules.set(pack.id, pack);
}
registerModelingRulePack({ id: 'universal-domain-invariants', layer: 'universal', status: 'implemented', applies: () => true, evaluate: modelIssues });
registerModelingRulePack({ id: 'rectangular-column-cover', layer: 'discipline', status: 'implemented', applies: () => true, evaluate: reinforcementGeometryIssues });
/** Extension point: a category is never used as an engine selector. */
export function registerModelingCapability(capability: Capability) {
  if (capabilities.has(capability.kind)) throw new Error(`Capability already registered: ${capability.kind}`);
  capabilities.set(capability.kind, capability);
}
const hash = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex').slice(0, 24);
const allModules = [bimModule, infraModule, filesModule];
class Builder {
  steps: Step[] = [];
  states: Map<string, any>;
  constructor(readonly ctx: ToolContext<any>) { this.states = new Map(structuredClone(ctx.states!)); }
  get bim(): BimState { return this.states.get('bim'); }
  add(name: string, input: unknown) {
    const tool = this.ctx.platform.tool(name);
    if (tool.kind !== 'command' || tool.expand) throw new DomainError('Invalid engine command', 'INVALID_COMPOSITION');
    const parsed = tool.input.parse(input), before = this.states.get(tool.module), mod = allModules.find(m => m.id === tool.module)!;
    const decision = tool.decide(structuredClone(before), parsed, { ...this.ctx, state: structuredClone(before), states: this.states });
    let after = structuredClone(before);
    for (const event of decision.events) after = mod.apply(after, { ...event, seq: 0, commandId: 'plan', actor: this.ctx.actor.id, module: mod.id, at: '1970-01-01T00:00:00Z' });
    mod.validate?.(after, before);
    this.states.set(tool.module, after);
    this.steps.push({ tool: name, input: parsed });
    return decision.summary as any;
  }
  type(def: any): string {
    // Reuse exact semantic definitions, never mutate an unrelated type merely because its name matches.
    const expected: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(def)) {
      if (key === 'name') continue;
      expected[key === 'steel_grade' ? 'steelGrade' : key] = key === 'layers' ? (value as any[]).map(l => ({
        material: this.bim.materials[l.material]?.id ?? Object.values(this.bim.materials).find(m => m.name === l.material)?.id ?? l.material,
        thickness: l.thickness, function: l.function ?? 'structure' })) : value;
    }
    const semantic = (t: any) => { const { id: _id, name: _name, ...value } = t; return value; };
    const match = Object.values(this.bim.types).find(t => canonicalJson(semantic(t)) === canonicalJson(expected));
    if (match) return match.id;
    const existing = Object.values(this.bim.types).find(t => t.kind === def.kind && t.name === def.name);
    if (existing) {
      throw new DomainError(`Type name ${def.name} has a different definition`, 'CONFLICTING_TYPE');
    }
    const before = new Set(Object.keys(this.bim.types));
    this.add('bim_create_types', { types: [def] });
    return Object.keys(this.bim.types).find(id => !before.has(id))!;
  }
  created(action: () => void): string[] {
    const before = new Set(Object.keys(this.bim.elements)); action();
    return Object.keys(this.bim.elements).filter(id => !before.has(id));
  }
}

registerModelingCapability({ id: 'conceptual-frame', kind: 'building', input: building, engines: ['wall', 'profile_member', 'boundary'], compile(b, r) {
  if (Object.keys(b.bim.elements).length || Object.keys(b.bim.storeys).length)
    throw new DomainError('Building generation requires an empty project; revise the existing model instead.', 'MODEL_ALREADY_EXISTS');
  const width = Math.sqrt(r.totalArea / r.floors), depth = width, outline = [[0, 0], [width, 0], [width, depth], [0, depth]];
  b.add('bim_create_storeys', { storeys: Array.from({ length: r.floors + 1 }, (_, i) => ({ name: `UMB-L${i}`, elevation: i * r.floorHeight })) });
  const column = b.type({ name: 'UMB-concept-column-400', kind: 'column', profile: { shape: 'rect', b: .4, h: .4 } });
  const beam = b.type({ name: 'UMB-concept-beam-300x500', kind: 'beam', profile: { shape: 'rect', b: .3, h: .5 } });
  // Materials are resolved by existing domain creation; these stable names are reused by subsequent calls.
  const wall = b.type({ name: 'UMB-concept-wall-200', kind: 'wall', layers: [{ material: 'UMB-concept-concrete', thickness: .2 }] });
  const slab = b.type({ name: 'UMB-concept-slab-200', kind: 'slab', layers: [{ material: 'UMB-concept-concrete', thickness: .2 }] });
  const roofType = b.type({ name: 'UMB-concept-roof-200', kind: 'roof', layers: [{ material: 'UMB-concept-concrete', thickness: .2 }] });
  for (let i = 0; i < r.floors; i++) {
    const storey = `UMB-L${i}`;
    b.add('bim_create_profile_members', { members: outline.map(at => ({ category: 'structure.column', storey, type: column, at, height: r.floorHeight })) });
    b.add('bim_create_profile_members', { members: outline.map((start, k) => ({ category: 'structure.framing', storey, type: beam, start, end: outline[(k + 1) % 4], z: r.floorHeight })) });
    const center = width / 4, half = Math.min(.5, width / 10);
    const shaft = [[center - half, center - half], [center + half, center - half], [center + half, center + half], [center - half, center + half]];
    b.add('bim_create_boundaries', { boundaries: [{ category: 'structure.slab', storey, type: slab, outline, holes: [shaft], offset: 0 }] });
    b.add('bim_create_walls', { walls: [{ storey, type: wall, points: outline, closed: true, height: r.floorHeight }] });
  }
  const roof = b.created(() => b.add('bim_create_boundaries', { boundaries: [{ category: 'architecture.roof', storey: `UMB-L${r.floors}`, type: roofType, outline, offset: .2 / Math.cos(r.roofPitch * Math.PI / 180), slope: { azimuth: 0, pitch: r.roofPitch } }] }))[0];
  const top = Object.values(b.bim.storeys).find(s => s.name === `UMB-L${r.floors - 1}`)!;
  b.add('bim_attach_walls_to_roof', { roof, walls: Object.values(b.bim.elements).filter(e => e.kind === 'wall' && e.storey === top.id).map(e => e.id) });
} });
registerModelingCapability({ id: 'hosted-rebar', kind: 'reinforcement', input: reinforcement, engines: ['reinforcement'], compile(b, r) {
  const main = b.type({ kind: 'rebar', name: `UMB-${r.steelGrade}-${r.diameter}`, diameter: r.diameter, steel_grade: r.steelGrade });
  const tie = b.type({ kind: 'rebar', name: `UMB-${r.steelGrade}-${r.stirrupDiameter}`, diameter: r.stirrupDiameter, steel_grade: r.steelGrade });
  for (const host of r.hosts) b.add('bim_create_reinforcement', { items: reinforcementLayout(b.bim, host, r, main, tie).map(item => ({ ...item, geometry_validation: 'rectangular_column' })) });
} });
registerModelingCapability({ id: 'service-network', kind: 'network', input: network, engines: ['mep_network'], compile(b, r) {
  if (Object.values(b.bim.mepSystems).some(s => s.name === r.name)) throw new DomainError('System already exists; revise it explicitly.', 'SYSTEM_ALREADY_EXISTS');
  const kind = r.domain === 'piping' ? 'pipe' : r.domain === 'hvac' ? 'duct' : 'cable_tray';
  const category = r.domain === 'piping' ? 'plumbing.pipe' : r.domain === 'hvac' ? 'mechanical.duct' : 'electrical.cable_tray';
  const def = kind === 'pipe' ? { kind, diameter: r.diameter } : kind === 'duct' ? { kind, shape: 'rectangular', width: r.diameter, height: r.diameter } : { kind, width: r.diameter, height: r.diameter };
  const segmentType = b.type({ ...def, name: `UMB-${r.name}-section` });
  b.add('bim_create_mep_systems', { systems: [{ name: r.name, domain: r.domain, classification: r.classification }] });
  const terminals = r.terminals.map((t: any) => {
    const storey = b.bim.storeys[t.storey] ?? Object.values(b.bim.storeys).find(s => s.name === t.storey);
    if (!storey) throw new DomainError('Terminal storey missing', 'RESOURCE_NOT_FOUND');
    return { ...t, storey: storey.id, z: storey.elevation + t.offset };
  }).sort((a: any, c: any) => a.z - c.z);
  if (terminals.some((t: any, i: number) => i && Math.abs(t.z - terminals[i - 1].z) < 1e-6))
    throw new DomainError('One terminal per distribution level is supported in this capability.', 'UNSUPPORTED_GEOMETRY');
  const nodes: { element: string; connector: string }[][] = terminals.map(() => []);
  const create = (route: any[]) => b.created(() => b.add('bim_create_mep_segments', { segments: [{ category, type: segmentType, system: r.name, route }] }))[0];
  terminals.forEach((t: any, i: number) => {
    const world = orthogonalRoute(b.bim, [r.shaft[0], r.shaft[1], t.z], [t.at[0], t.at[1], t.z], r.diameter / 2);
    const route = world.map(p => ({ storey: t.storey, at: [p[0], p[1]], offset: p[2] - b.bim.storeys[t.storey].elevation }));
    const branch = create(route); nodes[i].push({ element: branch, connector: 'start' });
    if (i) {
      const prev = terminals[i - 1];
      orthogonalRoute(b.bim, [r.shaft[0], r.shaft[1], prev.z], [r.shaft[0], r.shaft[1], t.z], r.diameter / 2);
      const riser = create([{ storey: prev.storey, at: r.shaft, offset: prev.offset }, { storey: t.storey, at: r.shaft, offset: t.offset }]);
      nodes[i - 1].push({ element: riser, connector: 'start' }); nodes[i].push({ element: riser, connector: 'end' });
    }
  });
  nodes.forEach(connectors => b.add('bim_connect_mep', { connectors }));
} });
registerModelingCapability({ id: 'alignment-corridor', kind: 'corridor', input: corridor, engines: ['alignment', 'corridor'], compile(b, r) {
  if (r.definition.layers.some((l: any) => !l.componentType)) throw new DomainError('Use existing shared componentType ids for corridor layers.', 'SHARED_TYPE_REQUIRED');
  b.add('infra_create_road_corridor', r.definition);
} });
registerModelingCapability({ id: 'shared-component-array', kind: 'array', input: arrayLayout, engines: ['point_component'], compile(b, r) {
  if (r.rows * r.columns > 1000) throw new DomainError('Array placement is limited to 1000 components per atomic request.', 'INVALID_INPUT');
  const t = b.bim.types[r.type] ?? Object.values(b.bim.types).find(t => t.name === r.type);
  if (!t || t.kind !== 'component') throw new DomainError('An existing shared component type is required.', 'RESOURCE_NOT_FOUND');
  b.add('bim_create_components', { components: Array.from({ length: r.rows * r.columns }, (_, i) => ({
    type: t.id, storey: r.storey, x: r.origin[0] + (i % r.columns) * r.spacing[0],
    y: r.origin[1] + Math.floor(i / r.columns) * r.spacing[1], offset: r.offset, rotation: r.rotation })) });
} });

function compile(ctx: ToolContext<any>, input: Input) {
  const before = ctx.states!, files = before.get('files')?.files ?? {};
  for (const s of input.sources) {
    if (['Missing', 'Conflicting', 'RequiresApproval'].includes(s.status)) throw new DomainError('Unresolved source information', 'SOURCE_REQUIRES_REVIEW');
    if (!files[s.file]?.versions.some((v: any) => v.version === s.version)) throw new DomainError('Source revision missing from this project', 'INVALID_SOURCE_REFERENCE');
  }
  const ps = before.get('platform');
  if (ps?.commands.some((c: any) => !ps.reverted[c.commandId] && c.summary?.requestId === input.requestId))
    throw new DomainError('Request already applied; use a new requestId for a new operation.', 'REQUEST_ALREADY_APPLIED');
  const cap = capabilities.get(input.requirements.kind);
  if (!cap) throw new DomainError('Unsupported modeling capability', 'UNSUPPORTED_CAPABILITY');
  const parsed = cap.input.safeParse(input.requirements);
  if (!parsed.success) throw new DomainError(`Invalid ${cap.kind} requirements: ${parsed.error.message}`, 'INVALID_INPUT');
  const facts = new Map<string, string>();
  for (const source of input.sources) if (source.parameter && source.value !== undefined) {
    if (source.role === 'boq') throw new DomainError('BOQ is comparison evidence and cannot control geometric parameters.', 'SOURCE_REQUIRES_REVIEW');
    const scales: Record<string, number> = { m: 1, mm: .001, cm: .01, 'm²': 1, m2: 1 };
    if (source.unit && scales[source.unit] === undefined) throw new DomainError('Unsupported source unit; provide reviewed normalized parameters.', 'SOURCE_REQUIRES_REVIEW');
    const value = typeof source.value === 'number' ? source.value * (scales[source.unit ?? 'm'] ?? 1) : source.value;
    const serialized = canonicalJson(value);
    if (facts.has(source.parameter) && facts.get(source.parameter) !== serialized) throw new DomainError(`Conflicting source values: ${source.parameter}`, 'SOURCE_REQUIRES_REVIEW');
    const required = (parsed.data as Record<string, unknown>)[source.parameter];
    if (required === undefined || (typeof required === 'number' && typeof value === 'number' ? Math.abs(required - value) > 1e-8 : canonicalJson(required) !== serialized))
      throw new DomainError(`Source value disagrees with requested parameter: ${source.parameter}`, 'SOURCE_REQUIRES_REVIEW');
    facts.set(source.parameter, serialized);
  }
  const planId = 'PLAN-' + hash({ project: ctx.project, requirements: parsed.data, sources: input.sources, state: [...before].filter(([id]) => id !== 'modeling') });
  if (input.planId && input.planId !== planId) throw new DomainError('Model changed since preview; plan again.', 'STALE_MODEL_PLAN');
  const b = new Builder(ctx); cap.compile(b, parsed.data);
  const packs = [...rules.values()].filter(r => r.status === 'implemented' && r.applies(cap.kind));
  const validation = packs.flatMap(r => r.evaluate(b.bim));
  if (validation.length) throw new DomainError('Generated model failed validation.', 'MODEL_VALIDATION_FAILED', { issues: JSON.stringify(validation) });
  const old = before.get('bim') as BimState;
  return { steps: b.steps, permissions: ['bim.read', ...(input.sources.length ? ['files.read'] : []), ...(input.requirements.kind === 'corridor' ? ['infra.read'] : [])], summary: { planId, requestId: input.requestId, sources: input.sources, engines: cap.engines,
    created: Object.keys(b.bim.elements).filter(id => !old.elements[id]),
    infrastructure: Object.keys(b.states.get('infra')?.roads ?? {}).filter(id => !before.get('infra')?.roads?.[id]),
    assumptions: input.requirements.kind === 'building' ? ['Conceptual rectangular footprint; totalArea is summed gross floor area.', 'Example concrete sections and thicknesses; no structural adequacy calculation.', 'Reserved conceptual service shaft at one-quarter footprint in every slab.', 'Single-plane sloping roof; no sloping facade engine.'] : [],
    warnings: ['Conceptual model; no structural, hydraulic, electrical or code adequacy calculation.'], validation, rulePacks: packs.map(p => p.id),
    stages: b.steps.map((s, i) => ({ id: i + 1, tool: s.tool, dependsOn: i ? [i] : [] })) } };
}
async function context(ctx: ToolContext<any>): Promise<ToolContext<any>> {
  const states = new Map<string, any>();
  const snapshot = await ctx.platform.snapshot(ctx.project);
  for (const mod of [...allModules.map(m => m.id), 'platform']) {
    const permission = mod === 'platform' ? 'bim.read' : `${mod}.read`;
    if (!can(ctx.actor, permission, ctx.platform.roles)) continue;
    states.set(mod, structuredClone(snapshot.states.get(mod)));
  }
  return { ...ctx, states };
}
const query = (name: string, permission: string, input: z.ZodType, run: QueryTool<any>['run']): QueryTool<any> =>
  ({ name, title: name.replaceAll('_', '.'), module: 'modeling', kind: 'query', effect: 'read', permission, input, description: `Universal ${name.replaceAll('_', '.')} entry point.`, run });
const generate: CommandTool<any> = { name: 'model_generate', title: 'model.generate', module: 'modeling', kind: 'command', effect: 'write', permission: 'bim.read',
  input: ModelingInput, description: 'Generate from one discipline-independent intent: conceptual building, hosted reinforcement, connected service network or alignment corridor. Backend selects engines. Preview using dry_run. All child permissions, approval, events and undo apply.',
  decide() { throw new Error('Composite command'); }, expand: compile,
  pin(_s, input, ctx) { return { ...input, planId: compile(ctx!, input).summary.planId }; } };
function revision(ctx: ToolContext<any>, steps: Step[]) {
  const b = new Builder(ctx);
  for (const step of steps) b.add(step.tool, step.input);
  const validation = [...rules.values()].filter(p => p.status === 'implemented').flatMap(p => p.evaluate(b.bim));
  if (validation.length) throw new DomainError('Revision failed model validation.', 'MODEL_VALIDATION_FAILED', { issues: JSON.stringify(validation) });
  const old = ctx.states!.get('bim') as BimState;
  const changed = Object.keys(b.bim.elements).filter(id => canonicalJson(b.bim.elements[id]) !== canonicalJson(old.elements[id]));
  const engines = new Set(changed.map(id => engineOfKind(b.bim.elements[id].kind)?.id).filter((id): id is NonNullable<typeof id> => !!id));
  const infraEngines = b.steps.filter(s => ctx.platform.tool(s.tool).module === 'infra').map(s => s.tool.includes('alignment') ? 'alignment' : s.tool.includes('component') ? 'shared_component' : 'corridor');
  return { steps: b.steps, summary: { planId: 'PLAN-' + hash({ project: ctx.project, steps: b.steps, before: [...ctx.states!] }),
    engines: [...new Set([...engines, ...infraEngines])], sources: [], assumptions: [], warnings: [], validation, changed } };
}
const revise: CommandTool<any> = { name: 'model_revise', title: 'model.revise', module: 'modeling', kind: 'command', effect: 'write', permission: 'bim.read',
  input: z.object({ changes: z.array(z.object({ tool: z.enum(['bim_update_elements', 'bim_update_storeys', 'bim_update_types', 'infra_update_alignment', 'infra_update_road_corridor', 'infra_update_component_type']), input: z.record(z.string(), z.unknown()) }).strict()).min(1).max(50) }).strict(),
  description: 'Controlled atomic revision through registered domain editors; dependent validation and authorization remain enforced.',
  decide() { throw new Error('Composite command'); }, expand(ctx, i) { return revision(ctx, i.changes); } };
const repair: CommandTool<any> = { ...revise, name: 'model_repair', title: 'model.repair', input: z.object({ roof: z.string(), walls: z.array(z.string()).min(1) }).strict(),
  description: 'Attach explicitly selected walls to one single-plane roof. Geometry follows subsequent roof edits. Ambiguous structural or routing decisions are refused.',
  expand(ctx, i) { return revision(ctx, [{ tool: 'bim_attach_walls_to_roof', input: i }]); } };
export const modelingModule: ModuleDef = { id: 'modeling', title: 'Universal Modeling Brain', initialState: () => ({}), apply: s => s, tools: [
  query('project_analyze', 'files.read', z.object({}), async ctx => {
    const c = await context(ctx);
    return { project: ctx.project, model: c.states?.get('bim')?.project, storeys: Object.values(c.states?.get('bim')?.storeys ?? {}),
      documents: Object.values(c.states?.get('files')?.files ?? {}), capabilities: [...capabilities.values()].map(({ compile: _compile, input, ...c }) => ({ ...c, requirementsSchema: z.toJSONSchema(input, { target: 'draft-7', unrepresentable: 'any' }) })),
      rulePacks: [...rules.values()].map(({ applies: _applies, evaluate: _evaluate, ...p }) => p),
      engines: listEngines(), standardProfile: { status: 'Missing', engineeringAdequacy: false },
      queries: ctx.platform.listTools().filter(t => t.kind === 'query' && ['bim', 'infra', 'files'].includes(t.module) && !/export|upload|render/.test(t.name) && can(ctx.actor, t.permission, ctx.platform.roles))
        .map(t => ({ name: t.name, description: t.description, input: z.toJSONSchema(t.input, { target: 'draft-7', unrepresentable: 'any' }) })),
      knowledgeStates: ['Verified', 'Derived', 'Assumed', 'Missing', 'Conflicting', 'RequiresApproval'] };
  }),
  query('project_query', 'bim.read', z.object({ tool: z.string(), input: z.record(z.string(), z.unknown()).default({}) }).strict(), async (ctx, i) => {
    const t = ctx.platform.tool(i.tool);
    if (t.kind !== 'query' || !['bim', 'infra', 'files'].includes(t.module) || /export|upload|render/.test(t.name)) throw new DomainError('Only evidence/model queries are allowed.', 'INVALID_QUERY');
    return ctx.platform.execute(ctx.actor, ctx.project, t.name, i.input);
  }),
  query('model_plan', 'bim.read', ModelingInput, async (ctx, i) => compile(await context(ctx), i)), generate, revise,
  query('model_validate', 'bim.read', z.object({}), async ctx => {
    const s = await ctx.platform.state<BimState>(ctx.project, 'bim');
    const issues = [...modelIssues(s), ...reinforcementGeometryIssues(s)];
    const checkedModules = ['bim'];
    if (can(ctx.actor, 'infra.read', ctx.platform.roles)) {
      const state = await ctx.platform.state<InfraState>(ctx.project, 'infra');
      try { infraModule.validate?.(structuredClone(state), state); checkedModules.push('infra'); }
      catch (e) { if (!(e instanceof DomainError)) throw e; issues.push({ id: 'infra', reason: e.reason, message: e.message }); }
    }
    return { issues, checkedModules, expectedStructuralConnections: structuralConnectivity(s),
      checks: ['domain-invariants', 'host-relations', 'MEP-junction-consistency', 'attached-wall-roof'],
      unsupported: ['general solid-solid clash detection', 'engineering adequacy', 'automatic obstacle rerouting'] };
  }), repair,
  query('model_export', 'bim.export', z.object({ format: z.enum(['ifc', 'frag']).default('ifc'), scope: z.enum(['bim', 'infra']).default('bim'), allowPartial: z.boolean().default(false) }), async (ctx, i) => {
    if (i.scope === 'infra') {
      if (i.format !== 'ifc') throw new DomainError('Infrastructure Fragments export is unsupported.', 'UNSUPPORTED_CAPABILITY');
      const state: any = await ctx.platform.state(ctx.project, 'infra');
      if (!i.allowPartial && ['roads', 'terrains', 'earthworks', 'earthworkZones', 'profileReferences'].some(k => Object.keys(state?.[k] ?? {}).length))
        throw new DomainError('Legacy infrastructure IFC exports alignments/tunnels but omits corridor/terrain resources. Explicit allowPartial is required.', 'UNSUPPORTED_CAPABILITY');
      return ctx.platform.execute(ctx.actor, ctx.project, 'infra_export_ifc', {});
    }
    return ctx.platform.execute(ctx.actor, ctx.project, `bim_export_${i.format}`, {});
  }),
] };
