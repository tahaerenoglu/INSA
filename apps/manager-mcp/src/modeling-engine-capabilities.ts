/** Thin capability adapters over registered specialists. Resource resolution is
 * shared; geometry, references and units remain owned by each domain schema. */
import {z} from 'zod';import {bimModule} from '@insa/bim';import {infraModule} from '@insa/infra';import type {registerModelingCapability} from './modeling.js';
const adapters=[
 ['storeys','bim_create_storeys','storey'],
 ['walls','bim_create_walls','wall'],['members','bim_create_profile_members','profile_member'],['surfaces','bim_create_boundaries','boundary'],['openings','bim_place_openings','hosted_component'],['stairs','bim_create_stairs','stair'],['ramps','bim_create_ramps','ramp_flight'],['curtain-walls','bim_create_curtain_walls','curtain_wall'],['roofs','bim_create_pitched_roofs','pitched_roof'],['explicit-reinforcement','bim_create_reinforcement','reinforcement'],['mep-routes','bim_create_mep_segments','mep_network'],['mep-fittings','bim_create_mep_fittings','mep_fitting'],
 ['alignment','infra_create_alignment','alignment'],['tunnel','infra_create_tunnel','tunnel'],['terrain','infra_import_terrain','terrain'],
];
export function registerEngineCapabilities(register:typeof registerModelingCapability){
 for(const [kind,name,engine]of adapters){const tool=[...bimModule.tools,...infraModule.tools].find(t=>t.name===name);if(!tool)continue;
 register({id:'registered-'+kind,kind,input:z.object({kind:z.literal(kind),families:z.array(z.record(z.string(),z.unknown())).default([]),types:z.array(z.record(z.string(),z.unknown())).default([]),definition:tool.input}).strict(),engines:[engine],compile(b,r){
  const familyAliases=new Map<string,string>();for(const family of r.families)familyAliases.set(String(family.name),b.family(family));
  const aliases=new Map<string,string>();for(const type of r.types)aliases.set(String(type.name),b.type({...type,...(familyAliases.has(String(type.family))?{family:familyAliases.get(String(type.family))}:{})}));
  const refs=(value:any,key=''):any=>typeof value==='string'&&key==='type'?(aliases.get(value)??value):Array.isArray(value)?value.map(x=>refs(x)):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,x])=>[k,refs(x,k)])):value;
  b.add(name,refs(r.definition));
 }});
 }
}
