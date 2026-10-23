/** Deterministic planning over existing capabilities. Natural language supplies goals,
 * never authority, hidden dimensions, routing permission or engineering calculations. */
import {z} from 'zod';
import {DomainError} from '@insa/core';
import {PROJECT_ARCHETYPES} from './modeling-semantics.js';
export const workflowInput=z.object({kind:z.literal('workflow'),archetype:z.string().optional(),systems:z.array(z.string()).default([]),operations:z.array(z.object({id:z.string().min(1).max(80),dependsOn:z.array(z.string()).default([]),requirements:z.object({kind:z.string()}).catchall(z.unknown())}).strict()).min(1).max(50)}).strict();
export function orderedOperations(input:z.infer<typeof workflowInput>){
 const providers=new Map<string,string[]>(),provided=new Map<string,Set<string>>();
 const provide=(operation:string,key:string)=>{providers.set(key,[...(providers.get(key)??[]),operation]);const set=provided.get(operation)??new Set<string>();set.add(key);provided.set(operation,set);};
 for(const o of input.operations){const r=o.requirements as any;
  for(const t of r.types??[])provide(o.id,'type:'+t.name);
  for(const f of r.families??[])provide(o.id,'family:'+f.name);
  if(r.kind==='definitions')continue;
  if(r.kind==='instances'&&r.definition?.name)provide(o.id,'type:'+r.definition.name);
  if(r.familyDefinition?.name)provide(o.id,'family:'+r.familyDefinition.name);
  if(r.kind==='storeys')for(const st of r.definition?.storeys??[])provide(o.id,'storey:'+st.name);
  if(r.kind==='building'&&Number.isInteger(r.floors))for(let i=0;i<=r.floors;i++)provide(o.id,'storey:UMB-L'+i);
 }
 const operations=input.operations.map(o=>{const dependencies=new Set(o.dependsOn);const scan=(value:any,key='')=>{if(typeof value==='string'){
   const resource=['type','family','storey','top_storey','end_storey'].includes(key)?(key.includes('storey')?'storey':key)+':'+value:undefined;
   if(resource&&!provided.get(o.id)?.has(resource)){const owners=providers.get(resource)??[];if(owners.length>1)throw new DomainError('Ambiguous resource providers for '+resource,'INVALID_PLAN');if(owners[0]&&owners[0]!==o.id)dependencies.add(owners[0]);}
  }else if(Array.isArray(value))value.forEach(v=>scan(v,key));else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value))scan(v,k);};scan(o.requirements);return {...o,dependsOn:[...dependencies].sort()};});
 const byId=new Map(operations.map(o=>[o.id,o]));
 if(byId.size!==input.operations.length)throw new DomainError('Operation IDs must be unique.','INVALID_PLAN');
 for(const o of operations)if(o.requirements.kind==='workflow'||o.requirements.kind==='request'||o.dependsOn.some(id=>!byId.has(id)||id===o.id))throw new DomainError('Invalid operation dependency or nested workflow.','INVALID_PLAN');
 const done=new Set<string>(),out:typeof input.operations=[];
 while(out.length<operations.length){const ready=operations.filter(o=>!done.has(o.id)&&o.dependsOn.every(id=>done.has(id))).sort((a,b)=>a.id.localeCompare(b.id));if(!ready.length)throw new DomainError('Operation graph contains a cycle.','INVALID_PLAN');for(const o of ready){done.add(o.id);out.push(o);}}
 return out;
}
type Archetype={id:string;systems:string[];capabilities:string[];missing?:string[]};
const archetypes=new Map<string,Archetype>(PROJECT_ARCHETYPES.map(a=>[a.id,a]));
export function registerProjectArchetype(a:Archetype){if(archetypes.has(a.id))throw new Error('Duplicate project archetype: '+a.id);archetypes.set(a.id,structuredClone(a));}
export function archetypeKnowledge(id?:string,requestedSystems:string[]=[]){
 const selected=id?archetypes.get(id):undefined;
 if(id&&!selected)throw new DomainError('Unknown project archetype.','UNSUPPORTED_ARCHETYPE');
 return {selected:selected?.id??null,available:[...archetypes.values()],possibleSystems:selected?.systems??[],requestedSystems,unselectedSystems:(selected?.systems??[]).filter(s=>!requestedSystems.includes(s)),prerequisites:['Explicit source geometry or reviewed conceptual parameters','Resolved project units and coordinates','Existing family/type search','Explicit routing/connection authorization where required'],missingSpecialistCapabilities:selected?.missing??[],automaticWholeProjectDesign:false};
}
export function resolveIntent(intent:string,requirements:Record<string,any>){
 if(requirements.kind!=='request')return {requirements,missing:[] as string[],basis:'explicit-structured-intent',archetype:requirements.archetype??(requirements.kind==='building'?'residential':undefined)};
 const request=z.object({kind:z.literal('request'),projectType:z.string().optional(),parameters:z.record(z.string(),z.unknown()).default({})}).strict().parse(requirements);
 const text=intent.toLocaleLowerCase('tr-TR'),building=/\b(building|bina|konut|katlı|katli)\b/u.test(text);
 const archetype=request.projectType??(/metro/u.test(text)?'metro-station':/demiryolu|railway/u.test(text)?'railway':/ges|solar/u.test(text)?'solar-plant':/köprü|bridge/u.test(text)?'bridge':/endüstri|industrial/u.test(text)?'industrial':building?'residential':undefined);
 if(archetype)archetypeKnowledge(archetype);
 if(!building)return {requirements,missing:['requirements.kind: select an available capability and provide its explicit geometry/placement inputs'],basis:'unresolved-user-goal',archetype};
 const floors=text.match(/(\d+)\s*(?:katlı|katli|kat|storey|story|floors?)/u),area=text.match(/(\d+(?:[.,]\d+)?)\s*(?:m²|m2|square\s*met)/u);
 const parameters={...(floors?{floors:Number(floors[1])}:{}),...(area?{totalArea:Number(area[1].replace(',','.'))}:{}),...request.parameters};
 // The user must identify total gross area; a number labelled footprint is ambiguous.
 const areaAmbiguous=area&&/taban|footprint|net\s*alan|net\s*area/u.test(text)&&request.parameters.totalArea===undefined;
 return {requirements:{kind:'building',...parameters},missing:[...(parameters.floors===undefined?['floors']:[]),...(parameters.totalArea===undefined||areaAmbiguous?['totalArea: total gross area across all storeys in m²']:[])],basis:'bounded-intent-parser; conceptual building only',archetype};
}
export function planningDetails(ctx:{project:string;actor:any;platform:any},input:{intent:string;sources:unknown[];requirements:any},before:any,after:any,steps:{tool:string;input:any}[]){
 const old=before.get('bim'),bim=after.get('bim'),newTypes=Object.values(bim.types).filter((t:any)=>!old.types[t.id]) as any[],created=Object.values(bim.elements).filter((e:any)=>!old.elements[e.id]) as any[];
 const usedTypes=new Set<string>(created.filter(e=>'type'in e).map(e=>e.type));
 const operations=input.requirements.kind==='workflow'?orderedOperations(workflowInput.parse(input.requirements)): [{id:'model',dependsOn:[],requirements:input.requirements}];
 const archetype=input.requirements.archetype??(input.requirements.kind==='building'?'residential':undefined);
 return {projectId:ctx.project,userIntent:input.intent,projectType:archetype??'unspecified',knowledge:archetypeKnowledge(archetype,input.requirements.systems??[]),requiredAssemblies:created.filter(e=>e.kind==='assembly').map(e=>({id:e.id,members:e.children})),requiredFamilies:[...new Set([...usedTypes].map(id=>bim.types[id]?.family??bim.types[id]?.kind))],reusedTypes:[...usedTypes].filter(id=>old.types[id]),newTypes:newTypes.map(t=>({id:t.id,kind:t.kind,name:t.name})),requiredInstances:created.map(e=>({id:e.id,kind:e.kind,type:e.type})),capabilitySelection:operations.map(o=>({operation:o.id,kind:o.requirements.kind})),dependencies:operations.map(o=>({id:o.id,dependsOn:o.dependsOn})),sourceReferences:input.sources,approvalRequirements:{required:steps.some(s=>ctx.platform.needsApproval(ctx.actor,ctx.platform.tool(s.tool))),authority:'existing Platform child permissions and human approval'},validationSteps:['domain-invariants','relationship-integrity','indexed-coordination','bounded-safe-repair','atomic-commit'],status:steps.length?'READY':'NO_CHANGE'};
}
