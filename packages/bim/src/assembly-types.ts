/** Persisted recipes in the owning BIM event stream. Occurrences keep their
 * member IDs; revisions update only explicitly managed fields. */
import {z} from 'zod';import {DomainError,canonicalJson,can,type CommandTool,type ToolContext} from '@insa/core';
import type {BimState} from './model.js';import {semanticRevision} from './semantic-model.js';import {regenerateColumnRebar} from './column-rebar-layout.js';
import {r} from './geo.js';import {normalizeRotation} from './family.js';
const n=z.union([z.number().finite(),z.object({parameter:z.string()}).strict()]);
const part=z.object({role:z.string().min(1),type:z.string(),at:z.tuple([n,n]).default([0,0]),offset:n.default(0),rotation:n.default(0),height:n.optional(),system:z.string().optional(),route:z.array(z.tuple([n,n,n])).min(2).optional()}).strict();
export const AssemblyDefinition=z.object({name:z.string().min(1),parameters:z.record(z.string(),z.number().finite()).default({}),parts:z.array(part).min(1).max(20),connections:z.array(z.array(z.object({role:z.string(),connector:z.string()}).strict()).min(2)).default([]),reinforcement:z.object({hostRole:z.string(),cover:n,diameter:n,stirrupDiameter:n,spacing:n,steelGrade:z.string()}).strict().optional(),sources:z.array(z.object({file:z.string(),version:z.number().int().positive(),reference:z.string()})).default([]),constraints:z.array(z.object({parameter:z.string(),min:z.number().optional(),max:z.number().optional()}).strict()).default([])}).strict();
export type AssemblyType= z.infer<typeof AssemblyDefinition>&{id:string;revision:string};
export type AssemblyBinding={type:string;revision:string;members:Record<string,string>;storey:string;at:[number,number];offset:number;rotation:number;overrides:Record<string,number>;managed:Record<string,Record<string,unknown>>};
function validateDefinition(s:BimState,def:z.infer<typeof AssemblyDefinition>,ctx:ToolContext<BimState>){
 if(new Set(def.parts.map(p=>p.role)).size!==def.parts.length)throw new DomainError('Duplicate assembly part role.','INVALID_INPUT');
 for(const part of def.parts)if(!s.types[part.type]||part.route&&part.height!==undefined)throw new DomainError('Canonical part type and unambiguous placement required.','INVALID_REFERENCE');
 for(const refs of def.connections)if(refs.some(r=>!def.parts.some(p=>p.role===r.role)))throw new DomainError('Connection role missing.','INVALID_REFERENCE');
 if(def.reinforcement&&!def.parts.some(p=>p.role===def.reinforcement!.hostRole))throw new DomainError('Reinforcement host role missing.','INVALID_REFERENCE');
 for(const source of def.sources){if(!can(ctx.actor,'files.read',ctx.platform.roles))throw new DomainError('Source references require files.read.','UNAUTHORIZED');const file=ctx.states?.get('files')?.files[source.file];if(!file||file.archived||!file.versions.some((v:any)=>v.version===source.version))throw new DomainError('Assembly source revision missing.','INVALID_SOURCE_REFERENCE');}
 for(const constraint of def.constraints)if(!(constraint.parameter in def.parameters)||constraint.min!==undefined&&constraint.max!==undefined&&constraint.min>constraint.max)throw new DomainError('Invalid assembly parameter constraint.','INVALID_INPUT');
}
export function materializeAssembly(type:AssemblyType,overrides:Record<string,number>={}){
 const parameters={...type.parameters,...overrides};for(const key of Object.keys(overrides))if(!(key in type.parameters))throw new DomainError('Unknown assembly parameter override: '+key,'INVALID_INPUT');
 for(const c of type.constraints){const value=parameters[c.parameter];if(value===undefined||c.min!==undefined&&value<c.min||c.max!==undefined&&value>c.max)throw new DomainError('Assembly parameter constraint failed: '+c.parameter,'INVALID_GEOMETRY');}
 const walk=(v:any):any=>Array.isArray(v)?v.map(walk):v&&typeof v==='object'?('parameter'in v?(()=>{const x=parameters[v.parameter];if(x===undefined)throw new DomainError('Missing assembly parameter: '+v.parameter,'INVALID_INPUT');return x;})():Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x)]))):v;
 return {parts:walk(type.parts) as {role:string;type:string;at:[number,number];offset:number;rotation:number;height?:number;system?:string;route?:[number,number,number][]}[],reinforcement:type.reinforcement?walk(type.reinforcement):undefined};
}
export function assemblyManagedFields(s:BimState,type:AssemblyType,binding:AssemblyBinding){
 const recipe=materializeAssembly(type,binding.overrides),a=binding.rotation*Math.PI/180,c=Math.cos(a),sn=Math.sin(a),fields:Record<string,Record<string,unknown>>={};
 for(const part of recipe.parts){const t=s.types[part.type],id=binding.members[part.role];if(!t||!id)throw new DomainError('Assembly part type or role missing.','INVALID_REFERENCE');const at:[number,number]=[binding.at[0]+part.at[0]*c-part.at[1]*sn,binding.at[1]+part.at[0]*sn+part.at[1]*c];
  if(part.route&&['pipe','duct','conduit','cable_tray'].includes(t.kind)&&part.system){const angle=(binding.rotation+part.rotation)*Math.PI/180,rc=Math.cos(angle),rs=Math.sin(angle),system=s.mepSystems[part.system]??Object.values(s.mepSystems).find(x=>x.name===part.system);if(!system)throw new DomainError('Assembly route system missing.','INVALID_REFERENCE');fields[id]={type:t.id,system:system.id,route:part.route.map(q=>({storey:binding.storey,at:[at[0]+q[0]*rc-q[1]*rs,at[1]+q[0]*rs+q[1]*rc],offset:binding.offset+part.offset+q[2]}))};}
  else if(t.kind==='component')fields[id]={type:t.id,placement:{kind:'level_point',x:r(at[0]),y:r(at[1]),offset:r(binding.offset+part.offset),rotation:normalizeRotation(binding.rotation+part.rotation)}};
  else if(t.kind==='column'&&part.height!==undefined)fields[id]={type:t.id,at,height:part.height,baseOffset:binding.offset+part.offset,rotation:binding.rotation+part.rotation};
  else throw new DomainError('Assembly type supports component and upright column parts.','UNSUPPORTED_CAPABILITY');
 }
 return fields;
}
const define:CommandTool<BimState>={name:'bim_define_assembly_type',title:'Define reusable assembly type',module:'bim',kind:'command',effect:'write',permission:'bim.write',description:'Persist an explicit reusable parametric assembly definition. Existing equivalent definitions are reused.',input:AssemblyDefinition,decide(s,input,ctx){
 const def=AssemblyDefinition.parse(input);validateDefinition(s,def,ctx);
 for(const part of def.parts)if(!s.types[part.type])throw new DomainError('Assembly part requires a canonical existing type ID.','INVALID_REFERENCE');
 if(def.reinforcement&&!def.parts.some(p=>p.role===def.reinforcement!.hostRole))throw new DomainError('Reinforcement host role missing.','INVALID_REFERENCE');
 const revision=semanticRevision({...def,name:undefined}),same=Object.values(s.assemblyTypes??{}).find(t=>t.revision===revision);
 if(same)throw new DomainError('Assembly type already exists: '+same.id,'DUPLICATE_RESOURCE');
 if(Object.values(s.assemblyTypes??{}).some(t=>t.name===def.name))throw new DomainError('Conflicting assembly type name.','CONFLICTING_TYPE');
 const counter=(s.counters.assembly_type??0)+1,id='AT-'+String(counter).padStart(4,'0'),type={...def,id,revision};materializeAssembly(type);
 return {events:[{type:'AssemblyTypeSet',payload:type},{type:'CountersSet',payload:{...s.counters,assembly_type:counter}}],summary:{id,revision}};
}};
const bind:CommandTool<BimState>={name:'bim_bind_assembly_type',title:'Bind assembly occurrence',module:'bim',kind:'command',effect:'write',permission:'bim.write',description:'Bind existing assembly members to an existing parametric type without replacing member identities.',input:z.object({assembly:z.string(),binding:z.object({type:z.string(),revision:z.string(),members:z.record(z.string(),z.string()),storey:z.string(),at:z.tuple([z.number(),z.number()]),offset:z.number(),rotation:z.number(),overrides:z.record(z.string(),z.number()).default({})}).strict()}).strict(),decide(s,i){
 const assembly=s.elements[i.assembly],type=s.assemblyTypes?.[i.binding.type];if(assembly?.kind!=='assembly'||!type||type.revision!==i.binding.revision)throw new DomainError('Assembly/type binding is invalid or stale.','INVALID_REFERENCE');
 if(assembly.storey!==i.binding.storey||Object.keys(i.binding.members).length!==type.parts.length||new Set(Object.values(i.binding.members)).size!==type.parts.length||type.parts.some(p=>!assembly.children.includes(i.binding.members[p.role])))throw new DomainError('Binding must cover each direct part exactly once.','INVALID_REFERENCE');
 const binding:AssemblyBinding={...i.binding,managed:assemblyManagedFields(s,type,i.binding as AssemblyBinding)};
 for(const [id,fields]of Object.entries(binding.managed))for(const [key,value]of Object.entries(fields))if(canonicalJson((s.elements[id] as any)[key])!==canonicalJson(value))throw new DomainError('Existing member does not match recipe placement.','CONFLICT');
 return {events:[{type:'ElementUpdated',payload:{id:assembly.id,changes:{assemblyBinding:binding}}}],summary:{id:assembly.id,type:type.id}};
}};
const revise:CommandTool<BimState>={name:'bim_update_assembly_type',title:'Revise assembly type',module:'bim',kind:'command',effect:'write',permission:'bim.write',description:'Atomically revise all bound occurrences, preserving overrides, members, hosts and source data. Conflicting manual managed-field edits are refused.',input:z.object({type:z.string(),expectedRevision:z.string(),definition:AssemblyDefinition}).strict(),decide(s,i,ctx){
 const old=s.assemblyTypes?.[i.type];if(!old||old.revision!==i.expectedRevision)throw new DomainError('Assembly type revision is stale.','STALE_MODEL_PLAN');
 const def=AssemblyDefinition.parse(i.definition);validateDefinition(s,def,ctx);if(Object.values(s.assemblyTypes??{}).some(t=>t.id!==old.id&&t.name===def.name))throw new DomainError('Assembly type name is in use.','CONFLICTING_TYPE');const next={...def,id:old.id,revision:semanticRevision({...def,name:undefined})};
 if(canonicalJson(old.parts.map(p=>[p.role,p.type]))!==canonicalJson(next.parts.map(p=>[p.role,p.type]))||canonicalJson(old.connections)!==canonicalJson(next.connections)||Boolean(old.reinforcement)!==Boolean(next.reinforcement)||old.reinforcement?.hostRole!==next.reinforcement?.hostRole)throw new DomainError('Topology/type reassignment needs a new assembly type; existing member IDs will not be replaced.','UNSUPPORTED_CAPABILITY');
 const before=structuredClone(s),events:any[]=[{type:'AssemblyTypeSet',payload:next}],affected:string[]=[];
 for(const assembly of Object.values(s.elements))if(assembly.kind==='assembly'&&assembly.assemblyBinding?.type===old.id){
  const binding=assembly.assemblyBinding;
  for(const [id,fields]of Object.entries(binding.managed))for(const [key,value]of Object.entries(fields))if(canonicalJson((s.elements[id] as any)?.[key])!==canonicalJson(value))throw new DomainError('Manual edit conflicts with assembly-managed field: '+id+'.'+key,'CONFLICT');
  const managed=assemblyManagedFields(s,next,binding);
  for(const [id,changes]of Object.entries(managed)){Object.assign(s.elements[id],changes);events.push({type:'ElementUpdated',payload:{id,changes}});}
  const reinforcement=materializeAssembly(next,binding.overrides).reinforcement,priorReinforcement=materializeAssembly(old,binding.overrides).reinforcement;
  if(reinforcement){const host=binding.members[reinforcement.hostRole];for(const e of Object.values(s.elements))if(e.kind==='reinforcement'&&e.host===host&&e.layout){if(e.cover!==priorReinforcement.cover||e.layout.spacing!==priorReinforcement.spacing)throw new DomainError('Manual reinforcement edit conflicts with assembly intent.','CONFLICT');const type=s.types[e.type];if(type?.kind!=='rebar'||type.diameter!==(e.layout.role==='longitudinal'?reinforcement.diameter:reinforcement.stirrupDiameter)||type.steelGrade!==reinforcement.steelGrade)throw new DomainError('Rebar type replacement requires a new explicit assembly type.','UNSUPPORTED_CAPABILITY');const changes={cover:reinforcement.cover,layout:{...e.layout,spacing:reinforcement.spacing}};Object.assign(e,changes);events.push({type:'ElementUpdated',payload:{id:e.id,changes}});}}
  const changes={assemblyBinding:{...binding,revision:next.revision,managed}};Object.assign(assembly,changes);events.push({type:'ElementUpdated',payload:{id:assembly.id,changes}});affected.push(assembly.id);
 }
 for(const change of regenerateColumnRebar(s,before))events.push({type:'ElementUpdated',payload:change});
 return {events,summary:{type:old.id,revision:next.revision,affected}};
}};
export const assemblyTypeTools=[define,bind,revise];
