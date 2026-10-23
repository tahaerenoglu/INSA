/** Composes existing native engines; no independent element or family store. */
import {z} from 'zod';
import {DomainError} from '@insa/core';
import {semanticRevision,AssemblyDefinition,materializeAssembly,assemblyManagedFields,type AssemblyType,type AssemblyBinding} from '@insa/bim';
import type {Builder,registerModelingCapability} from './modeling.js';
import {reinforcementLayout} from './modeling-rebar.js';
const point=z.tuple([z.number().finite(),z.number().finite()]);
export const reinforcementParameters=z.object({cover:z.number().positive(),diameter:z.number().positive(),stirrupDiameter:z.number().positive(),spacing:z.number().positive(),steelGrade:z.string().min(1)}).strict();
const placement=z.object({at:point,height:z.number().positive().optional(),offset:z.number().default(0),rotation:z.number().default(0),parameters:z.record(z.string(),z.union([z.string(),z.number(),z.boolean()])).default({})}).strict();
const instanceInput=z.object({kind:z.literal('instances'),storey:z.string(),type:z.string().optional(),definition:z.record(z.string(),z.unknown()).optional(),familyDefinition:z.record(z.string(),z.unknown()).optional(),placements:z.array(placement).min(1).max(1000),reinforcement:reinforcementParameters.optional()}).strict();
const assemblyInput=z.object({kind:z.literal('assembly'),name:z.string(),members:z.array(z.string()).min(1).max(200),primary:z.string().optional()}).strict();
const part=z.object({role:z.string().min(1),type:z.string(),at:point.default([0,0]),offset:z.number().default(0),rotation:z.number().default(0),height:z.number().positive().optional(),system:z.string().optional(),route:z.array(z.tuple([z.number(),z.number(),z.number()])).min(2).optional()}).strict();
const assemblyArray=z.object({kind:z.literal('assembly-array'),name:z.string(),recipe:z.string().min(1),storey:z.string(),parts:z.array(part).min(1).max(20),placements:z.array(placement).min(1).max(200),connections:z.array(z.array(z.object({role:z.string(),connector:z.string()}).strict()).min(2)).default([])}).strict();
function resolveType(b:Builder,ref:string){const t=b.bim.types[ref]??Object.values(b.bim.types).find(t=>t.name===ref);if(!t)throw new DomainError(`Type ${ref} missing.`,'RESOURCE_NOT_FOUND');return t;}
function checkPlacement(kind:string,p:z.infer<typeof placement>){
 if(kind==='component'&&p.height!==undefined)throw new DomainError('Component height is a family/type parameter; placement height is only supported for columns.','INVALID_INPUT');
 if(kind==='column'&&Object.keys(p.parameters).length)throw new DomainError('Native column placements do not support component instance parameters.','INVALID_INPUT');
}
function place(b:Builder,type:string,storey:string,p:z.infer<typeof placement>,name?:string){
 const t=resolveType(b,type);
 checkPlacement(t.kind,p);
 if(t.kind==='component')return b.created(()=>b.add('bim_create_components',{components:[{type:t.id,storey,x:p.at[0],y:p.at[1],offset:p.offset,rotation:p.rotation,parameters:p.parameters,name}]}))[0];
 if(t.kind==='column'&&p.height)return b.created(()=>b.add('bim_create_profile_members',{members:[{category:'structure.column',type:t.id,storey,at:p.at,height:p.height,base_offset:p.offset,rotation:p.rotation,name}]}))[0];
 throw new DomainError('This placement capability supports point component types and upright columns with explicit height.','UNSUPPORTED_CAPABILITY');
}
export function addReinforcementAssembly(b:Builder,r:z.infer<typeof reinforcementParameters>&{hosts:string[]}){
 const main=b.type({kind:'rebar',name:`UMB-${r.steelGrade}-${r.diameter}`,diameter:r.diameter,steel_grade:r.steelGrade}),tie=b.type({kind:'rebar',name:`UMB-${r.steelGrade}-${r.stirrupDiameter}`,diameter:r.stirrupDiameter,steel_grade:r.steelGrade});
 for(const host of r.hosts){
  if(Object.values(b.bim.elements).some(e=>e.kind==='reinforcement'&&e.host===host&&e.layout))throw new DomainError('Host already has parametric reinforcement; revise its existing definition.','MODEL_ALREADY_EXISTS');
  b.add('bim_create_reinforcement',{items:reinforcementLayout(b.bim,host,r,main,tie).map(item=>({...item,geometry_validation:'rectangular_column'}))});
  // Hosted parts are transitively members. IFC remains Assembly -> Column -> all individual reinforcing products.
  if(!Object.values(b.bim.elements).some(e=>e.kind==='assembly'&&e.children.includes(host)))b.add('bim_create_assemblies',{items:[{children:[host],primary:host,name:`Reinforced column ${host}`}]});
 }
}
export function registerAssemblyCapabilities(register:typeof registerModelingCapability){
 register({id:'parametric-assembly-type',kind:'assembly-type',input:z.object({kind:z.literal('assembly-type'),type:z.string().optional(),definition:AssemblyDefinition.optional(),storey:z.string().optional(),placements:z.array(placement.extend({overrides:z.record(z.string(),z.number()).default({})})).max(200).default([])}).strict(),engines:['assembly','point_component','profile_member','reinforcement'],compile(b,r){
  if(Boolean(r.type)===Boolean(r.definition))throw new DomainError('Provide an existing assembly type or explicit definition.','INVALID_INPUT');
  let type:AssemblyType|undefined;
  if(r.definition){const def=AssemblyDefinition.parse({...r.definition,parts:r.definition.parts.map((p:any)=>({...p,type:resolveType(b,p.type).id}))}),{name:_name,...shape}=def;
   type=Object.values(b.bim.assemblyTypes??{}).find(t=>t.revision===semanticRevision({...shape,name:undefined}));
   if(!type){const result=b.add('bim_define_assembly_type',def);type=b.bim.assemblyTypes![result.id];}
  }else type=b.bim.assemblyTypes?.[r.type!]??Object.values(b.bim.assemblyTypes??{}).find(t=>t.name===r.type);
  if(!type)throw new DomainError('Assembly type missing.','RESOURCE_NOT_FOUND');
  if(r.placements.length&&!r.storey)throw new DomainError('Assembly placement storey required.','INVALID_INPUT');
  for(const p of r.placements){
   if(p.height!==undefined||Object.keys(p.parameters).length)throw new DomainError('Use explicit assembly parameter overrides.','INVALID_INPUT');
   const recipe=materializeAssembly(type,p.overrides),a=p.rotation*Math.PI/180,c=Math.cos(a),sn=Math.sin(a),members:Record<string,string>={};
   const storey=b.bim.storeys[r.storey!]?.id??Object.values(b.bim.storeys).find(s=>s.name===r.storey)?.id;if(!storey)throw new DomainError('Assembly storey missing.','RESOURCE_NOT_FOUND');
   const fields=assemblyManagedFields(b.bim,type,{type:type.id,revision:type.revision,members:Object.fromEntries(recipe.parts.map(p=>[p.role,p.role])),storey,at:p.at,offset:p.offset,rotation:p.rotation,overrides:p.overrides,managed:{}});
   for(const part of recipe.parts){if(part.route){const t=resolveType(b,part.type),categories:Record<string,string>={pipe:'plumbing.pipe',duct:'mechanical.duct',conduit:'electrical.conduit',cable_tray:'electrical.cable_tray'};members[part.role]=b.created(()=>b.add('bim_create_mep_segments',{segments:[{...fields[part.role],category:categories[t.kind],name:part.role}]}))[0];}else members[part.role]=place(b,part.type,r.storey!,{at:[p.at[0]+part.at[0]*c-part.at[1]*sn,p.at[1]+part.at[0]*sn+part.at[1]*c],height:part.height,offset:p.offset+part.offset,rotation:p.rotation+part.rotation,parameters:{}},part.role);}
   for(const refs of type.connections)b.add('bim_connect_mep',{connectors:refs.map(ref=>({element:members[ref.role],connector:ref.connector}))});
   const ids=Object.values(members),assembly=b.created(()=>b.add('bim_create_assemblies',{items:[{children:ids,primary:ids[0],name:type!.name}]}))[0];
   if(recipe.reinforcement){const {hostRole,...parameters}=recipe.reinforcement;addReinforcementAssembly(b,{...parameters,hosts:[members[hostRole]]});}
   b.add('bim_bind_assembly_type',{assembly,binding:{type:type.id,revision:type.revision,members,storey:b.bim.elements[assembly].storey,at:p.at,offset:p.offset,rotation:p.rotation,overrides:p.overrides}});
  }
 }});
 register({id:'shared-resource-definitions',kind:'definitions',input:z.object({kind:z.literal('definitions'),families:z.array(z.record(z.string(),z.unknown())).default([]),types:z.array(z.record(z.string(),z.unknown())).default([])}).strict(),engines:[],compile(b,r){
  if(!r.families.length&&!r.types.length)throw new DomainError('At least one family or type definition is required.','INVALID_INPUT');
  const aliases=new Map<string,string>();for(const f of r.families)aliases.set(String(f.name),b.family(f));
  for(const def of r.types){const familyId=aliases.get(String(def.family));const family=def.family?b.bim.families[familyId??String(def.family)]??Object.values(b.bim.families).find(f=>f.name===def.family):undefined;b.type({...def,...(family?{family:family.id}:{})});}
 }});
 register({id:'shared-typed-instances',kind:'instances',input:instanceInput,engines:['profile_member','point_component','assembly'],compile(b,r){
  if(Boolean(r.type)===Boolean(r.definition))throw new DomainError('Provide an existing type or an explicit new definition.','INVALID_INPUT');
  let definition=r.definition;
  if(r.familyDefinition){if(!definition||definition.kind!=='component')throw new DomainError('Family definition requires a component type definition.','INVALID_INPUT');definition={...definition,family:b.family(r.familyDefinition)};}
  const type=r.type?resolveType(b,r.type).id:b.type(definition),t=resolveType(b,type);
  for(const p of r.placements)checkPlacement(t.kind,p);
  let ids:string[];
  if(t.kind==='column'){
   if(r.placements.some((p:any)=>!p.height))throw new DomainError('Column height is required.','INVALID_INPUT');
   ids=b.created(()=>b.add('bim_create_profile_members',{members:r.placements.map((p:any)=>({category:'structure.column',storey:r.storey,type,at:p.at,height:p.height,base_offset:p.offset,rotation:p.rotation}))}));
  }else if(t.kind==='component')ids=b.created(()=>b.add('bim_create_components',{components:r.placements.map((p:any)=>({type,storey:r.storey,x:p.at[0],y:p.at[1],offset:p.offset,rotation:p.rotation,parameters:p.parameters}))}));
  else throw new DomainError('Unsupported instance placement for this type kind.','UNSUPPORTED_CAPABILITY');
  if(r.reinforcement)addReinforcementAssembly(b,{...r.reinforcement,hosts:ids});
 }});
 register({id:'engineering-assembly',kind:'assembly',input:assemblyInput,engines:['assembly'],compile(b,r){b.add('bim_create_assemblies',{items:[{children:r.members,primary:r.primary,name:r.name}]});}});
 register({id:'repeated-engineering-assembly',kind:'assembly-array',input:assemblyArray,engines:['point_component','profile_member','mep_network','assembly'],compile(b,r){
  if(new Set(r.parts.map((p:any)=>p.role)).size!==r.parts.length||r.parts.length*r.placements.length>1000)throw new DomainError('Part roles must be unique and request size <=1000 parts.','INVALID_INPUT');
  const recipeRevision=semanticRevision({parts:r.parts,connections:r.connections});
  for(const [index,p]of (r.placements as z.infer<typeof placement>[]).entries()){
   if(p.height!==undefined||Object.keys(p.parameters).length)throw new DomainError('Assembly placement accepts position, offset and rotation; dimensions belong to explicit parts and their types.','INVALID_INPUT');
   const a=p.rotation*Math.PI/180,c=Math.cos(a),sn=Math.sin(a),xy=(q:[number,number]):[number,number]=>[p.at[0]+q[0]*c-q[1]*sn,p.at[1]+q[0]*sn+q[1]*c],ids=new Map<string,string>();
   for(const item of r.parts as z.infer<typeof part>[]){const t=resolveType(b,item.type);let id:string;
    if(item.route){
     const categories:Record<string,string>={pipe:'plumbing.pipe',duct:'mechanical.duct',conduit:'electrical.conduit',cable_tray:'electrical.cable_tray'};
     if(!categories[t.kind]||!item.system)throw new DomainError('Route part requires a supported MEP type and explicit system.','INVALID_INPUT');
     if(item.height!==undefined)throw new DomainError('Route height is defined by its explicit route points.','INVALID_INPUT');
     const angle=item.rotation*Math.PI/180,rc=Math.cos(angle),rs=Math.sin(angle);
     id=b.created(()=>b.add('bim_create_mep_segments',{segments:[{category:categories[t.kind],type:t.id,system:item.system,name:item.role,route:item.route!.map(q=>({storey:r.storey,at:xy([item.at[0]+q[0]*rc-q[1]*rs,item.at[1]+q[0]*rs+q[1]*rc]),offset:p.offset+item.offset+q[2]}))}]}))[0];
    }else id=place(b,t.id,r.storey,{at:xy(item.at),offset:p.offset+item.offset,rotation:p.rotation+item.rotation,height:item.height,parameters:{}},item.role);
    ids.set(item.role,id);
   }
   for(const connection of r.connections){const connectors=connection.map((ref:any)=>{const id=ids.get(ref.role);if(!id)throw new DomainError('Unknown connection part role.','INVALID_INPUT');return {element:id,connector:ref.connector};});b.add('bim_connect_mep',{connectors});}
   const members=[...ids.values()],assembly=b.created(()=>b.add('bim_create_assemblies',{items:[{name:`${r.name} ${index+1}`,children:members,primary:members[0]}]}))[0];
   b.add('bim_set_properties',{items:[{ids:[assembly],pset:'INSA_Assembly',values:{recipe:r.recipe,recipeRevision,assumption:'Explicit geometric assembly; no capacity or standard adequacy calculation.'}}]});
  }
 }});
}
