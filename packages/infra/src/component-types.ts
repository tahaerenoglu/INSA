/** Shared component definitions on the existing infra module/registry.
 * Road layers are projections of their type; the type remains authoritative on replay.
 * Station anchors belong to placements, not the reusable profile.
 */
import {z} from 'zod';
import {DomainError,type ToolDef} from '@insa/core';
import type {InfraState} from './module.js';
import type {RoadLayer} from './road.js';
import {validateProfiles} from './road-profile.js';
import {roadLayerSchema} from './road-schema.js';
export interface ComponentType {id:string;name:string;layer:Omit<RoadLayer,'id'|'componentType'|'repeat'> & {repeat?:{spacing:number;length:number}};}
const typeSchema=z.object({name:z.string().min(1).max(120),layer:roadLayerSchema.omit({id:true,componentType:true}).extend({repeat:z.object({spacing:z.number().min(.05).max(100),length:z.number().min(.01).max(100)}).optional()})});
export function resolveComponent(s:InfraState,layer:any):RoadLayer{
 if(!layer.componentType)return layer;
 const type=s.componentTypes?.[layer.componentType];if(!type)throw new DomainError(`Component type ${layer.componentType} is missing or in use.`,'INVALID_REFERENCE');
 const repeat=type.layer.repeat?{...type.layer.repeat,anchor:layer.repeat?.anchor??0}:undefined;
 return {...structuredClone(type.layer),id:layer.id,componentType:type.id,...(repeat?{repeat}:{} )} as RoadLayer;
}
export function projectComponentTypes(s:InfraState){for(const r of Object.values(s.roads??{}))r.layers=r.layers.map(l=>resolveComponent(s,l));}
function validateType(t:ComponentType){const l={...t.layer,id:'type',...(t.layer.repeat?{repeat:{...t.layer.repeat,anchor:0}}:{})} as RoadLayer;validateProfiles({layers:[l],from:0,to:1} as any);if(l.repeat&&l.repeat.length>l.repeat.spacing)throw new DomainError('Component length exceeds repeat spacing.');}
export const componentTypeTools:ToolDef<InfraState>[]=[{
 kind:'command',effect:'write',module:'infra',name:'infra_create_component_types',title:'Define reusable corridor components',permission:'infra.write',
 description:'Define each rail, sleeper, layer or structural profile once. Place it through infra_create_road_corridor layers using {componentType: ID, repeat:{anchor}}. All placements follow type updates; profiles/materials must be edited on the type. Existing inline layers stay compatible.',
 input:z.object({types:z.array(typeSchema).min(1).max(64)}),decide(s,input){const events:any[]=[],ids:string[]=[];for(const t of (input as {types:z.infer<typeof typeSchema>[]}).types){if(Object.values(s.componentTypes??{}).some(x=>x.name.toLowerCase()===t.name.toLowerCase())||events.some(x=>x.payload.name.toLowerCase()===t.name.toLowerCase()))throw new DomainError('Component type already exists; reuse or update it.');s.counters.CT=(s.counters.CT??0)+1;const d={...t,id:`CT-${String(s.counters.CT).padStart(3,'0')}`};validateType(d);events.push({type:'ComponentTypeSet',payload:d});ids.push(d.id);}return {events:[...events,{type:'CountersSet',payload:{...s.counters}}],summary:{ids}};}
},{kind:'command',effect:'write',module:'infra',name:'infra_update_component_type',title:'Update shared component definition',permission:'infra.write',description:'Update one shared profile/material/repeat definition; every referencing placement updates through normal validation, events and undo.',input:z.object({type:z.string(),...typeSchema.shape}),decide(s,input){const i=input as any,old=s.componentTypes?.[i.type];if(!old)throw new DomainError('Component type not found.');const d={id:old.id,name:i.name,layer:i.layer};validateType(d);return {events:[{type:'ComponentTypeSet',payload:d}],summary:{id:d.id,placements:Object.values(s.roads??{}).filter(r=>r.layers.some(l=>l.componentType===d.id)).map(r=>r.id)}};}
},{kind:'query',effect:'read',module:'infra',name:'infra_query_component_types',title:'Query shared components and placements',permission:'infra.read',description:'List reusable component definitions and their referencing corridor/layer IDs.',input:z.object({}),run({state:s}){return Object.values(s.componentTypes??{}).map(t=>({...t,placements:Object.values(s.roads??{}).flatMap(r=>r.layers.filter(l=>l.componentType===t.id).map(l=>({road:r.id,layer:l.id})))}));}}];
