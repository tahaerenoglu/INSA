/** Projections of existing resources and engine references, never a parallel family/relationship database. */
import {createHash} from 'node:crypto';
import {canonicalJson} from '@insa/core';
import type {BimState,Element} from './model.js';
import {engineOfKind,TYPE_FAMILY_OF_KIND} from './engines/registry.js';
import {handlersOf} from './engines/handlers.js';
import {connectorsOf} from './mep.js';
export const semanticRevision=(v:unknown)=>createHash('sha256').update(canonicalJson(v)).digest('hex').slice(0,16);
export type RelationKind='HostedBy'|'ConnectedTo'|'SupportedBy'|'PartOf'|'PartOfSystem'|'MemberOfAssembly'|'InstanceOfType'|'AlignedWith'|'DependsOn'|'Intersects'|'Penetrates'|'FollowsAlignment'|'ClippedBy';
export interface SemanticNode {id:string;localId:string;domain:string;kind:string;name:string;revision?:string;}
export interface SemanticEdge {id:string;source:string;target:string;relation:RelationKind;basis:'explicit'|'derived';evidence?:string;}
export function semanticEdge(source:string,target:string,relation:RelationKind,basis:SemanticEdge['basis']='explicit',evidence?:string):SemanticEdge{
 return {id:'REL-'+semanticRevision([source,relation,target]),source,target,relation,basis,...(evidence?{evidence}:{})};
}
export function nativeFamilyId(t:BimState['types'][string]){return t.kind==='component'?t.family:`native:${t.kind}:${'profile'in t?t.profile.shape:TYPE_FAMILY_OF_KIND[t.kind]??t.kind}`;}
export function bimFamilyCatalog(s:BimState){
 const uses=new Map<string,string[]>();for(const e of Object.values(s.elements))if('type'in e){const list=uses.get(e.type)??[];list.push(e.id);uses.set(e.type,list);}
 const types=Object.values(s.types).map(t=>({id:t.id,name:t.name,kind:t.kind,family:nativeFamilyId(t),revision:semanticRevision(t),definition:t,instances:uses.get(t.id)??[]}));
 const families=new Map<string,{id:string;name:string;origin:'stored'|'native-engine';revision:string;definition:unknown;types:string[];instances:string[]}>();
 for(const f of Object.values(s.families))families.set(f.id,{id:f.id,name:f.name,origin:'stored',revision:semanticRevision(f),definition:f,types:[],instances:[]});
 for(const t of types){let f=families.get(t.family);if(!f){f={id:t.family,name:`${t.kind} · ${'profile'in t.definition?t.definition.profile.shape:TYPE_FAMILY_OF_KIND[t.kind]??t.kind}`,origin:'native-engine',revision:semanticRevision([t.family,1]),definition:{kind:t.kind,parameterSource:'existing native type schema; edit through bim_update_types'},types:[],instances:[]};families.set(f.id,f);}f.types.push(t.id);f.instances.push(...t.instances);}
 return {families:[...families.values()],types,scope:'project',versioning:'content revision + existing governed event history',globalLibrary:false};
}
export function bimSemanticGraph(s:BimState){
 const catalog=bimFamilyCatalog(s),nodes:SemanticNode[]=[],edges:SemanticEdge[]=[];
 const node=(id:string,kind:string,name:string,revision?:string)=>nodes.push({id:'bim:'+id,localId:id,domain:'bim',kind,name,revision});
 const edge=(a:string,b:string,r:RelationKind,basis:SemanticEdge['basis']='explicit',evidence?:string)=>edges.push(semanticEdge('bim:'+a,'bim:'+b,r,basis,evidence));
 for(const f of catalog.families)node('family:'+f.id,'family',f.name,f.revision);
 for(const t of catalog.types){node('type:'+t.id,'type',t.name,t.revision);edge('type:'+t.id,'family:'+t.family,'PartOf','derived','existing type/family registry');}
 for(const st of Object.values(s.storeys))node('storey:'+st.id,'storey',st.name,semanticRevision(st));
 for(const system of Object.values(s.mepSystems))node('system:'+system.id,'system',system.name,semanticRevision(system));
 for(const e of Object.values(s.elements)){
  node(e.id,e.kind,e.name??e.id,semanticRevision(e));
  edge(e.id,'storey:'+e.storey,'PartOf');
  if('type'in e)edge(e.id,'type:'+e.type,'InstanceOfType');
  if('host'in e&&typeof e.host==='string')edge(e.id,e.host,'HostedBy');
  for(const dep of handlersOf(e).dependsOn?.(s,e)??[])edge(e.id,dep,'DependsOn','derived','engine dependency declaration');
  if(e.kind==='wall'&&e.topRoof)edge(e.id,e.topRoof,'ClippedBy');
  if(e.kind==='assembly')for(const child of e.children)edge(child,e.id,'MemberOfAssembly');
  if('system'in e&&typeof e.system==='string')edge(e.id,'system:'+e.system,'PartOfSystem');
 }
 for(const j of Object.values(s.joins)){const ids=j.kind==='endpoint_endpoint'?j.members.map(m=>m.wall):[j.endpoint.wall,j.host];for(let i=0;i<ids.length;i++)for(let k=i+1;k<ids.length;k++)edge(ids[i],ids[k],'ConnectedTo','explicit',j.id);}
 const connectorSystems=new Map<string,Set<string>>();
 for(const e of Object.values(s.elements))for(const c of connectorsOf(s,e))if(c.system){const systems=connectorSystems.get(e.id)??new Set<string>();systems.add(c.system);connectorSystems.set(e.id,systems);}
 // Equipment inherits system membership only across explicit junctions, never from proximity.
 let grew=true;while(grew){grew=false;for(const j of Object.values(s.mepJunctions)){const systems=new Set(j.members.flatMap(m=>[...(connectorSystems.get(m.element)??[])]));for(const m of j.members){const prior=connectorSystems.get(m.element)??new Set<string>();for(const id of systems)if(!prior.has(id)){prior.add(id);grew=true;}connectorSystems.set(m.element,prior);}}}
 for(const [id,systems]of connectorSystems)for(const system of systems)edge(id,'system:'+system,'PartOfSystem','derived','explicit connector graph');
 for(const j of Object.values(s.mepJunctions))for(let i=0;i<j.members.length;i++)for(let k=i+1;k<j.members.length;k++)edge(j.members[i].element,j.members[k].element,'ConnectedTo','explicit',j.id);
 // Hosted parts belong transitively to the host's assemblies, but retain independent IDs.
 const parents=new Map<string,string[]>();for(const e of edges.filter(e=>e.relation==='MemberOfAssembly'))parents.set(e.source,[...(parents.get(e.source)??[]),e.target]);
 for(const e of Object.values(s.elements))if('host'in e&&typeof e.host==='string')for(const assembly of parents.get('bim:'+e.host)??[])edges.push(semanticEdge('bim:'+e.id,assembly,'MemberOfAssembly','derived','host assembly membership'));
 return {nodes,edges:[...new Map(edges.map(e=>[e.id,e])).values()],catalog};
}
/** One tree identity per occurrence. A primary member presents an assembly without replacing its physical identity. */
export function bimSemanticHierarchy(s:BimState){
 const parent=new Map<string,string>(),assembly=new Map<string,string>(),suppressed=new Set<string>();
 for(const a of Object.values(s.elements))if(a.kind==='assembly'){
  if(a.primary)suppressed.add(a.id);
  for(const id of a.children){assembly.set(id,a.id);if(id!==a.primary)parent.set(id,a.primary??a.id);}
 }
 for(const e of Object.values(s.elements))if('host'in e&&typeof e.host==='string'&&s.elements[e.host]){parent.set(e.id,e.host);const owner=assembly.get(e.host);if(owner)assembly.set(e.id,owner);}
 for(const e of Object.values(s.elements))if(e.kind==='assembly'&&e.primary){const owner=parent.get(e.id);if(owner)parent.set(e.primary,owner);}
 // Nested assemblies may use another assembly as their primary member. Resolve
 // presentation aliases without emitting parents that the tree suppresses.
 const visible=(id:string)=>{const seen=new Set<string>();while(suppressed.has(id)&&!seen.has(id)){seen.add(id);const e=s.elements[id];if(e?.kind!=='assembly'||!e.primary)break;id=e.primary;}return id;};
 for(const [id,owner] of parent){const child=visible(id),host=visible(owner);if(child!==host)parent.set(child,host);else parent.delete(child);}
 return {parent,assembly,suppressed};
}
