import {z} from 'zod';
import {canonicalJson,DomainError,type ToolDef} from '@insa/core';
import type {InfraState,TunnelDef} from './module.js';
import type {RoadCorridor} from './road.js';

type RoadTemplate=Omit<RoadCorridor,'id'|'alignment'>;
type TunnelTemplate=Omit<TunnelDef,'id'|'alignment'>;
export interface InfrastructureFamily {id:string;name:string;category:string;length:number;members:({kind:'road';definition:RoadTemplate}|{kind:'tunnel';definition:TunnelTemplate})[];}
export interface FamilyInstance {id:string;name:string;family:string;alignment:string;station:number;members:string[];}
const next=(s:InfraState,p:string)=>`${p}-${String(s.counters[p]=(s.counters[p]??0)+1).padStart(3,'0')}`;
const layerRef=(l:RoadCorridor['layers'][number])=>{
 if(!l.componentType)throw new DomainError('Önce satır içi bileşenleri ortak componentType olarak tanımlayın.','INVALID_REFERENCE');
 return {id:l.id,componentType:l.componentType,...(l.repeat?{repeat:{anchor:l.repeat.anchor}}:{})} as typeof l;
};
export function validateFamilies(s:InfraState){
 const owned=new Set<string>();
 for(const f of Object.values(s.families??{}))for(const m of f.members){
  if(m.kind==='road')for(const l of m.definition.layers)if(!s.componentTypes?.[l.componentType!])throw new DomainError('Aile bileşen tipi eksik.','INVALID_REFERENCE');
  if(m.kind==='tunnel')for(const r of m.definition.ranges)if(!s.sections[r.section])throw new DomainError('Aile kesit tipi eksik.','INVALID_REFERENCE');
 }
 for(const i of Object.values(s.familyInstances??{})){
  if(!s.families?.[i.family]||!s.alignments[i.alignment])throw new DomainError('Aile veya güzergâh eksik.','INVALID_REFERENCE');
  for(const id of i.members){if(owned.has(id)||(!s.roads?.[id]&&!s.tunnels[id]))throw new DomainError('Yapı elemanı eksik veya başka aile yerleşiminde kullanılıyor.','INVALID_REFERENCE');owned.add(id);}
 }
}
type PlacementInput={family:string;alignment:string;station:number;name:string;parentTunnel?:string;length?:number};
function placeDefinition(s:InfraState,i:PlacementInput){const f=s.families?.[i.family];if(!f)throw new DomainError('Aile bulunamadı.','INVALID_REFERENCE');const events:any[]=[],ids:string[]=[],length=i.length??f.length,scale=length/f.length;
 if(scale!==1&&f.members.some(m=>m.kind==='road'||(m.kind==='tunnel'&&m.definition.ranges.length!==1)))throw new DomainError('Uzunluk uyarlaması yalnız tek aralıklı tünel bileşeni ailesinde desteklenir.','INVALID_INPUT');
 const placementParent=i.parentTunnel?s.tunnels[i.parentTunnel]:undefined;
 if(i.parentTunnel&&(!placementParent||placementParent.alignment!==i.alignment||!placementParent.ranges.some(r=>i.station>=r.from-1e-6&&i.station+length<=r.to+1e-6)))throw new DomainError('Aile yerleşimi ana tünelin kilometre aralığında olmalı.','INVALID_REFERENCE');
 for(const m of f.members)ids.push(next(s,m.kind==='road'?'RD':'TN'));
 const parentId=(ref:string|undefined)=>{if(!ref)return undefined;if(ref==='@placement-parent'){if(!placementParent)throw new DomainError('Bu aile için parentTunnel zorunludur.','INVALID_REFERENCE');return placementParent.id;}const match=/^@member:(\d+)$/.exec(ref);if(!match||!ids[Number(match[1])])throw new DomainError('Aile ana tünel başvurusu geçersiz.','INVALID_REFERENCE');return ids[Number(match[1])];};
 for(const [index,m] of f.members.entries()){const id=ids[index];
  if(m.kind==='road'){const r=structuredClone(m.definition);events.push({type:'RoadCorridorSet',payload:{...r,id,name:`${i.name} · ${r.name}`,alignment:i.alignment,parentTunnel:parentId(r.parentTunnel),from:r.from+i.station,to:r.to+i.station,sections:r.sections.map(k=>({...k,station:k.station+i.station})),layers:r.layers.map(l=>({...l,...(l.repeat?{repeat:{anchor:l.repeat.anchor+i.station}}:{})}))}});}
  else{const t=structuredClone(m.definition);events.push({type:'TunnelSet',payload:{...t,id,name:`${i.name} · ${t.name}`,alignment:i.alignment,parentTunnel:parentId(t.parentTunnel),ranges:t.ranges.map(r=>({...r,from:r.from*scale+i.station,to:r.to*scale+i.station}))}});}
 }
 const instance:FamilyInstance={id:next(s,'FI'),name:i.name,family:f.id,alignment:i.alignment,station:i.station,members:ids};
 return {events:[...events,{type:'FamilyInstanceSet',payload:instance}],instance};
}
export const familyTools:ToolDef<InfraState>[]=[{
 name:'infra_create_family',title:'Register reusable structure family',module:'infra',kind:'command',effect:'write',permission:'infra.write',
 description:'Capture existing road/tunnel members as one structure family and instance without changing geometry. Reuse existing componentType and section IDs; retain material/quantity semantics. Query families before capture; use infra_place_family for future instances.',
 input:z.object({name:z.string().min(1).max(200),category:z.string().min(1).max(60),members:z.array(z.string()).min(1).max(100)}),
 decide(s,input){const i=input as {name:string;category:string;members:string[]},ids=[...new Set(i.members)],owned=new Set(Object.values(s.familyInstances??{}).flatMap(x=>x.members));
  if(ids.some(id=>owned.has(id)))throw new DomainError('Eleman zaten bir yapı ailesine bağlı.','INVALID_REFERENCE');
  const resources=ids.map(id=>s.roads?.[id]??s.tunnels[id]);if(resources.some(x=>!x))throw new DomainError('Yapı elemanı bulunamadı.','INVALID_REFERENCE');
  const alignment=resources[0]!.alignment;if(resources.some(x=>x!.alignment!==alignment))throw new DomainError('Aile üyeleri aynı güzergâha bağlı olmalı.');
  const from=Math.min(...resources.map(x=>'from' in x!?x.from:Math.min(...x!.ranges.map(r=>r.from))));
  const to=Math.max(...resources.map(x=>'to' in x!?x.to:Math.max(...x!.ranges.map(r=>r.to))));
  const parentRef=(parent:string|undefined)=>{if(!parent)return undefined;const index=ids.indexOf(parent);if(index>=0)return `@member:${index}`;const external=s.tunnels[parent];if(!external||external.alignment!==alignment||!external.ranges.some(r=>from>=r.from-1e-6&&to<=r.to+1e-6))throw new DomainError('Aile alt bileşeninin ana tüneli bulunamadı veya kapsam dışı.','INVALID_REFERENCE');return '@placement-parent';};
  const members:InfrastructureFamily['members']=resources.map(x=>{
   if('layers' in x!){const {id,alignment,...r}=structuredClone(x);return {kind:'road',definition:{...r,parentTunnel:parentRef(r.parentTunnel),from:r.from-from,to:r.to-from,sections:r.sections.map(k=>({...k,station:k.station-from})),layers:r.layers.map(l=>{const ref=layerRef(l);if(ref.repeat)ref.repeat.anchor-=from;return ref;})}};}
   const {id,alignment,...t}=structuredClone(x!);return {kind:'tunnel',definition:{...t,parentTunnel:parentRef(t.parentTunnel),ranges:t.ranges.map(r=>({...r,from:r.from-from,to:r.to-from}))}};
  });
  const signature=(f:Pick<InfrastructureFamily,'members'|'category'>)=>canonicalJson({category:f.category,members:f.members.map(m=>({...m,definition:{...m.definition,name:undefined,designBasis:undefined}}))});
  const existing=Object.values(s.families??{}).find(f=>signature(f)===signature({members,category:i.category}));
  const family:InfrastructureFamily=existing??{id:next(s,'IF'),name:i.name,category:i.category,length:to-from,members};
  const instance:FamilyInstance={id:next(s,'FI'),name:i.name,family:family.id,alignment,station:from,members:ids};
  return {events:[...(!existing?[{type:'InfrastructureFamilySet',payload:family}]:[]),{type:'FamilyInstanceSet',payload:instance},{type:'CountersSet',payload:{...s.counters}}],summary:{family:family.id,instance:instance.id,reused:Boolean(existing)}};
 }
},{name:'infra_refresh_family_parents',title:'Synchronize structure family parent links',module:'infra',kind:'command',effect:'write',permission:'infra.write',
 description:'Update stored family templates to follow the already approved component-to-tunnel relationships. Preserves family ids, geometry, types and existing placements.',
 input:z.object({families:z.array(z.string()).min(1).max(100)}),
 decide(s,input){const events:any[]=[];for(const id of (input as {families:string[]}).families){const family=s.families?.[id];if(!family)throw new DomainError(`Family ${id} missing.`,'INVALID_REFERENCE');const instance=Object.values(s.familyInstances??{}).find(i=>i.family===id);if(!instance||instance.members.length!==family.members.length)throw new DomainError(`Family ${id} has no matching source placement.`,'INVALID_REFERENCE');const members=family.members.map((m,index)=>{const source=s.roads?.[instance.members[index]]??s.tunnels[instance.members[index]];if(!source)throw new DomainError(`Family ${id} member missing.`,'INVALID_REFERENCE');const parent=source.parentTunnel,parentIndex=parent?instance.members.indexOf(parent):-1;return {...m,definition:{...m.definition,parentTunnel:parent?parentIndex>=0?`@member:${parentIndex}`:'@placement-parent':undefined}};});events.push({type:'InfrastructureFamilySet',payload:{...family,members}});}return {events,summary:{families:(input as {families:string[]}).families}};}
},{name:'infra_place_family',title:'Place stored structure family',module:'infra',kind:'command',effect:'write',permission:'infra.write',
 description:'Place a stored structure family on an alignment at a station using its existing shared profiles and section IDs. No duplicate family or profile definition; normal road/tunnel geometry validation applies.',
 input:z.object({family:z.string(),alignment:z.string(),station:z.number().finite(),name:z.string().min(1).max(200),parentTunnel:z.string().optional(),length:z.number().positive().optional()}),
 decide(s,input){const placed=placeDefinition(s,input as PlacementInput);return {events:[...placed.events,{type:'CountersSet',payload:{...s.counters}}],summary:placed.instance};}
},{name:'infra_place_families',title:'Place multiple stored structure families',module:'infra',kind:'command',effect:'write',permission:'infra.write',
 description:'Place multiple tunnel component families in one governed change. Each placement refers to an existing parent tunnel and shared section/component types.',
 input:z.object({placements:z.array(z.object({family:z.string(),alignment:z.string(),station:z.number().finite(),name:z.string().min(1).max(200),parentTunnel:z.string().optional(),length:z.number().positive().optional()})).min(1).max(100)}),
 decide(s,input){const events:any[]=[],instances:FamilyInstance[]=[];for(const item of (input as {placements:PlacementInput[]}).placements){const placed=placeDefinition(s,item);events.push(...placed.events);instances.push(placed.instance);}return {events:[...events,{type:'CountersSet',payload:{...s.counters}}],summary:{instances:instances.map(i=>({id:i.id,family:i.family,station:i.station,members:i.members}))}};}
},{name:'infra_query_families',title:'Query reusable structure families',module:'infra',kind:'query',effect:'read',permission:'infra.read',input:z.object({}),
 description:'Read persisted structure definitions and placements. Reuse these family IDs instead of recreating geometry or component definitions.',
 run({state:s}){return Object.values(s.families??{}).map(f=>({...f,instances:Object.values(s.familyInstances??{}).filter(i=>i.family===f.id)}));}
}];
