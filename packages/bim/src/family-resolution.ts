/** Conservative semantic equivalence. Names/IDs are labels; all other properties
 * remain significant. SI normalization is explicit, never inferred from size. */
import {canonicalJson,DomainError} from '@insa/core';
import type {BimState} from './model.js';
const scales:Record<string,number>={m:1,mm:.001,cm:.01,ft:.3048,in:.0254};
const lengths=new Set(['width','height','depth','diameter','length','radius','thickness','wall_thickness','insulation_thickness','branch_length','max_riser','min_tread','default_width','max_post_spacing','max_panel_width','max_panel_height','panel_thickness','b','h','r','d','t','tw','tf']);
export function assertDefinitionKeys(input:any,parsed:any,path='definition'){
 if(Array.isArray(input)){input.forEach((value,i)=>assertDefinitionKeys(value,parsed?.[i],path+'['+i+']'));return;}
 if(input&&typeof input==='object')for(const [key,value]of Object.entries(input)){if(!parsed||!(key in parsed))throw new DomainError('Unsupported semantic field would be discarded: '+path+'.'+key,'INVALID_INPUT');assertDefinitionKeys(value,parsed[key],path+'.'+key);}
}
export function normalizeFamilyUnits(definition:Record<string,any>){const def=structuredClone(definition);for(const p of def.parameters??[])if(p.dataType==='length'&&p.unit){const scale=scales[p.unit];if(!scale)throw new DomainError('Unsupported family parameter length unit.','INVALID_INPUT');for(const key of ['default','min','max'])if(typeof p[key]==='number')p[key]=Number((p[key]*scale).toPrecision(12));p.unit='m';}return def;}
export function normalizeTypeUnits(s:BimState,definition:Record<string,any>){
 const {units='m',...def}=structuredClone(definition),scale=scales[units];
 if(!scale)throw new DomainError('Explicit supported length units required: m, mm, cm, ft, in.','INVALID_INPUT');
 const round=(v:number)=>Number((v*scale).toPrecision(12));
 function walk(v:any,key=''):any{if(typeof v==='number'&&lengths.has(key))return round(v);if(Array.isArray(v))return v.map(x=>walk(x,key));if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x,k)]));return v;}
 const out=walk(def);
 if(out.profile?.points)out.profile.points=def.profile.points.map((p:number[])=>p.map(round));
 if(out.connectors)out.connectors=out.connectors.map((c:any,i:number)=>({...c,position:def.connectors[i].position.map(round)}));
 if(out.kind==='component'){
  const family=s.families[out.family]??Object.values(s.families).find(f=>f.name===out.family);
  if(!family)throw new DomainError('Component family not found.','RESOURCE_NOT_FOUND');
  out.family=family.id;
  out.parameters={...(def.parameters??{})};
  for(const p of family.parameters)if(p.dataType==='length'&&typeof out.parameters?.[p.key]==='number')out.parameters[p.key]=round(def.parameters[p.key]);
 }
 return out;
}
export function definitionSignature(value:unknown){
 const visit=(v:any,key=''):any=>typeof v==='number'?Number(v.toPrecision(12)):Array.isArray(v)?(['parameters','connectors'].includes(key)?[...v].sort((a,b)=>String(a.key).localeCompare(String(b.key))):v).map(x=>visit(x)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x,k)])):v;
 const {id:_id,name:_name,...semantic}=value as Record<string,unknown>;
 return canonicalJson(visit(semantic));
}
export function typeEquivalenceSignature(s:BimState,value:Record<string,any>){return definitionSignature(value.kind==='component'&&s.families[value.family]?{...value,family:definitionSignature(s.families[value.family])}:value);}
