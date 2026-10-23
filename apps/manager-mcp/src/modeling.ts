/** Universal intent tools. Domain state, geometry, events and export remain owned by existing modules. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DomainError, canonicalJson, can, type ModuleDef, type ToolContext, type CommandTool, type QueryTool } from '@insa/core';
import { bimModule, modelIssues, listEngines, engineOfKind, coordinateModel,handlersOf,normalizeTypeUnits,normalizeFamilyUnits,assertDefinitionKeys,definitionSignature,typeEquivalenceSignature, type BimState } from '@insa/bim';
import { infraModule, type InfraState } from '@insa/infra';
import { filesModule } from '@insa/files';
import { reinforcementLayout, reinforcementGeometryIssues } from './modeling-rebar.js';
import { orthogonalRoute } from './modeling-routing.js';
import {registerAssemblyCapabilities,addReinforcementAssembly} from './modeling-assemblies.js';
import {projectSemantics,PROJECT_ARCHETYPES} from './modeling-semantics.js';
import {workflowInput,orderedOperations,resolveIntent,planningDetails,archetypeKnowledge} from './modeling-planner.js';
import {registerDocumentCapabilities,registerDocumentSetCapability,documentRequirements,DocumentSetRequest,documentUnderstanding,DocumentRequest} from './modeling-documents.js';
import {registerEngineCapabilities} from './modeling-engine-capabilities.js';

const point = z.tuple([z.number().finite(), z.number().finite()]);
const source = z.object({ file: z.string(), version: z.number().int().positive(), reference: z.string(),
  status: z.enum(['Verified', 'Derived', 'Assumed', 'Missing', 'Conflicting', 'RequiresApproval']), value: z.unknown().optional(), unit: z.string().optional(),
  parameter: z.string().optional(), role: z.enum(['geometry', 'specification', 'boq']).default('geometry') }).strict();
const building = z.object({ kind: z.literal('building'), floors: z.number().int().min(1).max(30), totalArea: z.number().positive().max(100000),
  floorHeight: z.number().min(2).max(10).default(3), roofPitch: z.number().min(1).max(60).default(20),
  roofForm: z.enum(['mono','gable','hip']).default('mono'), roofOverhang: z.number().min(0).max(3).default(.3) }).strict();
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
  requirements: z.object({ kind: z.string().min(1) }).catchall(z.unknown()).default({kind:'request'}).describe('Explicit capability or workflow operations; omit for bounded intent planning with missing-input reporting'),
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
export class Builder {
  extraPermissions=new Set<string>();sourceEvidence:unknown[]=[];
  steps: Step[] = [];
  states: Map<string, any>;
  constructor(readonly ctx: ToolContext<any>) { this.states = new Map(structuredClone(ctx.states!)); }
  get bim(): BimState { return this.states.get('bim'); }
  family(def:any):string {
    const normalized=normalizeFamilyUnits(def),parsed=(this.ctx.platform.tool('bim_create_families').input.parse({families:[normalized]}) as any).families[0];assertDefinitionKeys(normalized,parsed);
    const {name:_name,...shape}=parsed;
    const match=Object.values(this.bim.families).find(f=>{const {id:_id,name:_n,...value}=f;return definitionSignature(value)===definitionSignature(shape);});
    if(match)return match.id;
    if(Object.values(this.bim.families).some(f=>f.name===parsed.name))throw new DomainError('Family name has a conflicting definition.','CONFLICTING_TYPE');
    const before=new Set(Object.keys(this.bim.families));this.add('bim_create_families',{families:[parsed]});return Object.keys(this.bim.families).find(id=>!before.has(id))!;
  }
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
    const normalized=normalizeTypeUnits(this.bim,def),tool=this.ctx.platform.tool('bim_create_types');
    const input:any=tool.input.parse({types:[normalized]});assertDefinitionKeys(normalized,input.types[0]);
    if(tool.kind!=='command'||tool.expand)throw new Error('Native type command required');
    const decision=tool.decide(structuredClone(this.bim),input,{...this.ctx,state:structuredClone(this.bim),states:this.states});
    const candidate:any=decision.events.find(e=>e.type==='TypeCreated')?.payload;
    if(!candidate)throw new Error('Type normalization produced no type');
    const match=Object.values(this.bim.types).find(t=>typeEquivalenceSignature(this.bim,t)===typeEquivalenceSignature(this.bim,candidate));
    if(match)return match.id;
    if(Object.values(this.bim.types).some(t=>t.kind===candidate.kind&&t.name===candidate.name))throw new DomainError('Type name has a conflicting semantic definition.','CONFLICTING_TYPE');
    const before=new Set(Object.keys(this.bim.types));this.add('bim_create_types',input);
    return Object.keys(this.bim.types).find(id=>!before.has(id))!;
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
  const offset=.2/Math.cos(r.roofPitch*Math.PI/180);
  const roof = b.created(() => r.roofForm==='mono'
    ? b.add('bim_create_boundaries', { boundaries: [{ category: 'architecture.roof', storey: `UMB-L${r.floors}`, type: roofType, outline, offset, slope: { azimuth: 0, pitch: r.roofPitch } }] })
    : b.add('bim_create_pitched_roofs',{roofs:[{storey:`UMB-L${r.floors}`,type:roofType,outline,form:r.roofForm,ridge:'long',pitch:r.roofPitch,overhang:r.roofOverhang,offset}]}))[0];
  const top = Object.values(b.bim.storeys).find(s => s.name === `UMB-L${r.floors - 1}`)!;
  b.add('bim_attach_walls_to_roof', { roof, walls: Object.values(b.bim.elements).filter(e => e.kind === 'wall' && e.storey === top.id).map(e => e.id) });
} });
registerModelingCapability({ id: 'hosted-rebar', kind: 'reinforcement', input: reinforcement, engines: ['reinforcement'], compile(b, r) {
  addReinforcementAssembly(b,r);
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

registerAssemblyCapabilities(registerModelingCapability);
registerDocumentCapabilities(registerModelingCapability);
registerDocumentSetCapability(registerModelingCapability);
registerEngineCapabilities(registerModelingCapability);
registerModelingCapability({id:'universal-project-workflow',kind:'workflow',input:workflowInput,engines:[],compile(b,r){
 archetypeKnowledge(r.archetype,r.systems);
 for(const operation of orderedOperations(r)){const cap=capabilities.get(operation.requirements.kind);if(!cap)throw new DomainError('Unsupported operation capability: '+operation.requirements.kind,'UNSUPPORTED_CAPABILITY');const parsed=cap.input.safeParse(operation.requirements);if(!parsed.success)throw new DomainError(`Operation ${operation.id}: ${parsed.error.message}`,'INVALID_INPUT');cap.compile(b,parsed.data);}
}});
function compile(ctx: ToolContext<any>, request: Input) {
  const resolved=resolveIntent(request.intent,request.requirements);
  if(resolved.missing.length)throw new DomainError('Planning requires explicit missing inputs.','PLAN_REQUIRES_INPUT',{missing:JSON.stringify(resolved.missing)});
  const input={...request,requirements:resolved.requirements};
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
  // Coordinate only newly created elements and their neighbors. Safe fixes become ordinary governed child commands.
  const old = before.get('bim') as BimState,created=Object.keys(b.bim.elements).filter(id=>!old.elements[id]);
  const attempted=new Set<string>();let repairIterations=0;
  for(let iteration=0;iteration<2&&created.length;iteration++){
    const safe=coordinateModel(b.bim,{ids:created}).issues.filter(i=>i.repair&&!attempted.has(i.id));
    if(!safe.length)break;
    for(const issue of safe){attempted.add(issue.id);b.add(issue.repair!.tool,issue.repair!.input);}
    repairIterations++;
  }
  const coordination=coordinateModel(b.bim,{ids:created});
  if(coordination.issues.some(i=>i.severity==='error'))throw new DomainError('Generated geometry has unresolved coordination errors. Nothing was committed.','MODEL_VALIDATION_FAILED',{issues:JSON.stringify(coordination.issues.filter(i=>i.severity==='error'))});
  const packs = [...rules.values()].filter(r => r.status === 'implemented' && r.applies(cap.kind));
  const validation = packs.flatMap(r => r.evaluate(b.bim));
  if (validation.length) throw new DomainError('Generated model failed validation.', 'MODEL_VALIDATION_FAILED', { issues: JSON.stringify(validation) });
  return { steps: b.steps, permissions: ['bim.read',...b.extraPermissions, ...(input.sources.length ? ['files.read'] : []), ...(input.requirements.kind === 'corridor' ? ['infra.read'] : [])], summary: { planId, requestId: input.requestId, sources: input.sources,documentEvidence:b.sourceEvidence, engines: cap.engines,
    ...planningDetails(ctx,input,before,b.states,b.steps),created,coordination,semantics:semanticSummary(b.bim,b.states.get('infra')),constraints:constraintReport(b.bim,coordination,cap.kind),repair:{maxIterations:2,iterations:repairIterations,attemptedIssues:[...attempted]},
    infrastructure: Object.keys(b.states.get('infra')?.roads ?? {}).filter(id => !before.get('infra')?.roads?.[id]),
    assumptions: input.requirements.kind === 'building' ? ['Conceptual rectangular footprint; totalArea is summed gross floor area.', 'Example concrete sections and thicknesses; no structural adequacy calculation.', 'Reserved conceptual service shaft at one-quarter footprint in every slab.', `Roof form ${(parsed.data as z.infer<typeof building>).roofForm}; no sloping facade engine.`] : [],
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
  const mutated=Object.keys(b.bim.elements).filter(id=>canonicalJson(b.bim.elements[id])!==canonicalJson(old.elements[id])),affected=new Set(mutated);
  const changedTypes=new Set(Object.keys(b.bim.types).filter(id=>canonicalJson(b.bim.types[id])!==canonicalJson(old.types[id]))),changedFamilies=new Set(Object.keys(b.bim.families).filter(id=>canonicalJson(b.bim.families[id])!==canonicalJson(old.families[id]))),changedStoreys=new Set(Object.keys(b.bim.storeys).filter(id=>canonicalJson(b.bim.storeys[id])!==canonicalJson(old.storeys[id])));
  for(const e of Object.values(b.bim.elements))if(changedStoreys.has(e.storey)||handlersOf(e).storeysOf?.(e).some(id=>changedStoreys.has(id))||'type'in e&&(changedTypes.has(e.type)||e.kind==='component'&&changedFamilies.has((b.bim.types[e.type] as any).family)))affected.add(e.id);
  let grew=true;while(grew){const n=affected.size;for(const e of Object.values(b.bim.elements))if(handlersOf(e).dependsOn?.(b.bim,e).some(id=>affected.has(id)))affected.add(e.id);grew=n!==affected.size;}
  const changed=[...affected];
  const coordination=coordinateModel(b.bim,{ids:changed}),priorErrors=new Set(coordinateModel(old,{ids:changed}).issues.filter(i=>i.severity==='error').map(i=>i.id));
  const newErrors=coordination.issues.filter(i=>i.severity==='error'&&!priorErrors.has(i.id));
  if(newErrors.length)throw new DomainError('Revision introduces coordination errors; nothing was committed.','MODEL_VALIDATION_FAILED',{issues:JSON.stringify(newErrors)});
  const engines = new Set(changed.map(id => engineOfKind(b.bim.elements[id].kind)?.id).filter((id): id is NonNullable<typeof id> => !!id));
  const infraEngines = b.steps.filter(s => ctx.platform.tool(s.tool).module === 'infra').map(s => s.tool.includes('alignment') ? 'alignment' : s.tool.includes('component') ? 'shared_component' : 'corridor');
  return { steps: b.steps, summary: { planId: 'PLAN-' + hash({ project: ctx.project, steps: b.steps, before: [...ctx.states!] }),
    engines: [...new Set([...engines, ...infraEngines])], sources: [], assumptions: [], warnings: [], validation, changed,coordination,
    typeImpact:Object.keys(b.bim.types).filter(id=>canonicalJson(b.bim.types[id])!==canonicalJson(old.types[id])).map(id=>({type:id,instances:Object.values(b.bim.elements).filter(e=>'type'in e&&e.type===id).map(e=>e.id)})),
    regenerated:mutated.filter(id=>b.bim.elements[id].kind==='reinforcement'),semantics:semanticSummary(b.bim,b.states.get('infra')),constraints:constraintReport(b.bim,coordination) } };
}
function semanticSummary(bim:BimState,infra?:InfraState){const graph=projectSemantics(bim,infra);return {families:graph.library.families.map(f=>({id:f.id,name:f.name,origin:f.origin,typeIds:f.types,instanceCount:f.instances.length})),types:graph.library.types.map(t=>({id:t.id,family:t.family,revision:t.revision,instanceCount:t.instances.length})),relationships:graph.edges.length,assemblies:Object.values(bim.elements).filter(e=>e.kind==='assembly').map(e=>({id:e.id,children:e.children,primary:e.primary})),archetypesAreAdvisory:true};}
function constraintReport(s:BimState,coordination:ReturnType<typeof coordinateModel>,kind?:string){
 const results=[...rules.values()].filter(r=>r.status==='implemented'&&(!kind||r.applies(kind))).flatMap(r=>r.evaluate(s).map(i=>({rule:r.id,elements:[i.id],reason:i.reason,severity:'error',message:i.message})));
 results.push(...coordination.issues.filter(i=>i.severity!=='info').map(i=>({rule:'universal-indexed-coordination',elements:i.elements,reason:i.kind,severity:i.severity,message:i.message})));
 const graph=projectSemantics(s),nodes=new Set(graph.nodes.map(n=>n.id));
 for(const edge of graph.edges)if(!nodes.has(edge.source)||!nodes.has(edge.target))results.push({rule:'universal-relationship-integrity',elements:[edge.source,edge.target],reason:'INVALID_REFERENCE',severity:'error',message:`Dangling ${edge.relation} relationship.`});
 return {quality:{evidenceLevel:Object.values(s.elements).some(e=>e.props?.INSA_Source)?'SOURCE-BASED':'CONCEPTUAL',coordination:{status:results.some(r=>r.severity==='error')?'FAILED':results.some(r=>r.severity==='warning')?'REQUIRES_REVIEW':'CHECKED_WITH_LIMITED_COVERAGE',scope:'BIM rules listed in checkedRules; not an engineering adequacy certificate'},components:Object.values(s.elements).map(e=>({id:e.id,evidenceLevel:e.props?.INSA_Source?'SOURCE-BASED':'CONCEPTUAL',verificationStatus:e.props?.INSA_Source?.verificationStatus??'Assumed',issues:results.filter(r=>r.elements.includes(e.id)).map(r=>r.reason)})),promotionToCoordinated:'Requires reviewed source/assumption acceptance and all relevant discipline checks; automatic promotion disabled'},results,expectedInterfaces:coordination.issues.filter(i=>i.severity==='info').length,checkedRules:[...[...rules.values()].filter(r=>r.status==='implemented'&&(!kind||r.applies(kind))).map(r=>r.id),'universal-indexed-coordination','universal-relationship-integrity'],coverage:{universal:{geometry:'IMPLEMENTED',identity:'IMPLEMENTED',host:'IMPLEMENTED',dependencies:'IMPLEMENTED',connections:'IMPLEMENTED',units:'Explicit SI schemas; requested type units normalized; no guessed units',coordinates:'Existing domain/storey/georeference invariants',clearance:'Only when explicit clearance threshold requested'},disciplines:{structural:'Geometric/domain invariants; no capacity calculation',reinforcement:'Explicit paths and rectangular-column cover/parametric layout',MEP:'Explicit connector geometry and system consistency; no sizing',steel:'Native profiles and generic assemblies; no connection design',infrastructure:'Existing domain validators; BIM coordination does not prove infrastructure interference',energy:'Generic components/assemblies only; no electrical design',industrial:'Generic equipment/assemblies only; no process engineering'},standards:{status:'NOT IMPLEMENTED',reason:'No verified standard profile selected'}},engineeringAdequacy:false};
}
const revise: CommandTool<any> = { name: 'model_revise', title: 'model.revise', module: 'modeling', kind: 'command', effect: 'write', permission: 'bim.read',
  input: z.object({ changes: z.array(z.object({ tool: z.enum(['bim_update_elements', 'bim_update_storeys', 'bim_update_types','bim_update_families','bim_create_types','bim_set_properties','bim_update_assembly_type', 'infra_update_alignment', 'infra_update_road_corridor', 'infra_update_component_type']), input: z.record(z.string(), z.unknown()) }).strict()).min(1).max(50) }).strict(),
  description: 'Controlled atomic revision through registered domain editors; dependent validation and authorization remain enforced.',
  decide() { throw new Error('Composite command'); }, expand(ctx, i) { return revision(ctx, i.changes); } };
const repair: CommandTool<any> = { ...revise, name: 'model_repair', title: 'model.repair', input: z.object({ roof: z.string().optional(), walls: z.array(z.string()).min(1).optional(),
  issueIds:z.array(z.string()).min(1).max(200).optional(),maxAttempts:z.number().int().min(1).max(3).default(2) }).strict(),
  description: 'Preview or atomically repair unique compatible connector pairs, unjoined wall endpoints and adjacent roof attachments detected by model.validate. Bounded revalidation; hard clashes and ambiguous alternatives require design decisions.',
  expand(ctx, i) {
    if(i.roof||i.walls){if(!i.roof||!i.walls||i.issueIds)throw new DomainError('Provide roof + walls, or issueIds, not a mixture.','INVALID_INPUT');return revision(ctx,[{tool:'bim_attach_walls_to_roof',input:{roof:i.roof,walls:i.walls}}]);}
    const b=new Builder(ctx),initial=coordinateModel(b.bim),selected=i.issueIds?new Set<string>(i.issueIds):undefined;
    if(selected&&[...selected].some(id=>!initial.issues.some(issue=>issue.id===id)))throw new DomainError('A selected issue no longer exists; validate again.','STALE_MODEL_PLAN');
    const attempted=new Set<string>(),repaired:string[]=[];let iterations=0;
    for(let attempt=0;attempt<i.maxAttempts;attempt++){
      const before=b.steps.length;
      for(const issue of coordinateModel(b.bim).issues)if(issue.repair&&(!selected||selected.has(issue.id))&&!attempted.has(issue.id)){
        attempted.add(issue.id);b.add(issue.repair.tool,issue.repair.input);repaired.push(issue.id);
      }
      if(b.steps.length===before)break;
      iterations++;
    }
    if(!b.steps.length)throw new DomainError('No unique safe repair is available; explicit engineering selection is required.','UNSUPPORTED_CAPABILITY');
    const after=coordinateModel(b.bim),oldErrors=new Set(initial.issues.filter(i=>i.severity==='error').map(i=>i.id));
    if(after.issues.some(i=>i.severity==='error'&&!oldErrors.has(i.id)))throw new DomainError('Repair would introduce a new coordination error. Nothing was committed.','MODEL_VALIDATION_FAILED');
    const result=revision(ctx,b.steps);
    return {...result,summary:{...result.summary,repaired:repaired.map(id=>({id,status:after.issues.some(i=>i.id===id)?'unresolved':'verified'})),remaining:after.issues.filter(i=>i.severity!=='info'),iterations,attemptedRepairs:attempted.size,maxAttempts:i.maxAttempts}};
  } };
export const modelingModule: ModuleDef = { id: 'modeling', title: 'Universal Modeling Brain', initialState: () => ({}), apply: s => s, tools: [
  query('project_analyze', 'files.read', z.object({capabilityKinds:z.array(z.string()).max(50).optional(),queryNames:z.array(z.string()).max(100).optional()}).strict(), async (ctx,selection) => {
    const c = await context(ctx);
    return { project: ctx.project, model: c.states?.get('bim')?.project, storeys: Object.values(c.states?.get('bim')?.storeys ?? {}),
      documents: Object.values(c.states?.get('files')?.files ?? {}), capabilities: [...capabilities.values()].filter(c=>!selection.capabilityKinds||selection.capabilityKinds.includes(c.kind)).map(({ compile: _compile, input, ...c }) => ({ ...c, requirementsSchema: z.toJSONSchema(input, { target: 'draft-7', unrepresentable: 'any' }) })),
      rulePacks: [...rules.values()].map(({ applies: _applies, evaluate: _evaluate, ...p }) => p),
      engines: listEngines(),semantics:semanticSummary(c.states!.get('bim'),c.states!.get('infra')),archetypes:PROJECT_ARCHETYPES,
      semanticQueries:[{tool:'semantic.library',input:{}},{tool:'semantic.graph',input:{ids:'optional qualified node ID array'}},{tool:'documents.requirements',input:{sources:'reviewed source/revision/role/field mappings',reviewedMapping:true}},{tool:'documents.understand',input:{file:'registered source ID',version:'explicit integer revision',sheet:'optional worksheet'}}],planningKnowledge:archetypeKnowledge(),standardProfile: { status: 'Missing', engineeringAdequacy: false },
      queries: ctx.platform.listTools().filter(t => (!selection.queryNames||selection.queryNames.includes(t.name)) && t.kind === 'query' && ['bim', 'infra', 'files'].includes(t.module) && !/export|upload|render/.test(t.name) && can(ctx.actor, t.permission, ctx.platform.roles))
        .map(t => ({ name: t.name, description: t.description, input: z.toJSONSchema(t.input, { target: 'draft-7', unrepresentable: 'any' }) })),
      knowledgeStates: ['Verified', 'Derived', 'Assumed', 'Missing', 'Conflicting', 'RequiresApproval'] };
  }),
  query('project_query', 'bim.read', z.object({ tool: z.string(), input: z.record(z.string(), z.unknown()).default({}) }).strict(), async (ctx, i) => {
    if(i.tool==='documents.requirements')return documentRequirements(await context(ctx),DocumentSetRequest.parse(i.input));
    if(i.tool==='documents.understand')return documentUnderstanding(await context(ctx),DocumentRequest.parse(i.input));
    if(i.tool==='semantic.library'||i.tool==='semantic.graph'){
      const input=z.object({ids:z.array(z.string()).max(1000).optional(),includeGeometry:z.boolean().default(false)}).strict().parse(i.input),c=await context(ctx),bim=c.states!.get('bim') as BimState,graph=projectSemantics(bim,c.states!.get('infra'),input.includeGeometry?coordinateModel(bim):undefined);
      if(i.tool==='semantic.library')return graph.library;
      const selected=input.ids?new Set(input.ids):undefined,edges=selected?graph.edges.filter(e=>selected.has(e.source)||selected.has(e.target)):graph.edges,ids=new Set(edges.flatMap(e=>[e.source,e.target]));
      return {nodes:selected?graph.nodes.filter(n=>ids.has(n.id)||selected.has(n.id)):graph.nodes,edges,revision:graph.revision};
    }
    const t = ctx.platform.tool(i.tool);
    if (t.kind !== 'query' || !['bim', 'infra', 'files'].includes(t.module) || /export|upload|render/.test(t.name)) throw new DomainError('Only evidence/model queries are allowed.', 'INVALID_QUERY');
    return ctx.platform.execute(ctx.actor, ctx.project, t.name, i.input);
  }),
  query('model_plan', 'bim.read', ModelingInput, async (ctx, i) => {const c=await context(ctx),resolved=resolveIntent(i.intent,i.requirements);if(resolved.missing.length)return {steps:[],summary:{planId:'PLAN-'+hash({project:ctx.project,input:i,state:[...c.states!]}),projectId:ctx.project,userIntent:i.intent,status:'REQUIRES_INPUT',projectType:resolved.archetype??'unspecified',knowledge:archetypeKnowledge(resolved.archetype),missing:resolved.missing,basis:resolved.basis,approvalRequirements:{required:false,reason:'No executable plan'},validationSteps:[]}};return compile(c,i);}), generate, revise,
  query('model_validate', 'bim.read', z.object({ids:z.array(z.string()).min(1).optional(),tolerance:z.number().positive().max(.01).default(.0001),clearance:z.number().min(0).max(10).default(0)}).strict(), async (ctx,input) => {
    const s = await ctx.platform.state<BimState>(ctx.project, 'bim');
    const issues = [...modelIssues(s), ...reinforcementGeometryIssues(s)];
    const checkedModules = ['bim'];
    if (can(ctx.actor, 'infra.read', ctx.platform.roles)) {
      const state = await ctx.platform.state<InfraState>(ctx.project, 'infra');
      try { infraModule.validate?.(structuredClone(state), state); checkedModules.push('infra'); }
      catch (e) { if (!(e instanceof DomainError)) throw e; issues.push({ id: 'infra', reason: e.reason, message: e.message }); }
    }
    const coordination=coordinateModel(s,input);
    issues.push(...coordination.issues.filter(i=>i.severity!=='info').map(i=>({...i,reason:i.kind})));
    return { issues, checkedModules,coordination,constraints:constraintReport(s,coordination),expectedStructuralConnections:coordination.issues.filter(i=>i.kind==='ExpectedStructuralIntersection'),
      checks: ['domain-invariants', 'host-relations', 'MEP-junction-consistency', 'piecewise-wall-roof','indexed-polyhedral-coordination'],
      unsupported:coordination.coverage.unsupported };
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
