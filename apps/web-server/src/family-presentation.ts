import type {InfraState} from '@insa/infra';
import {boundaries,roadRing} from '@insa/infra';

/** Read-only presentation of persisted families; never merges engineering solids. */
export function familyPresentation(input:any[],s:InfraState){
 const resources=input.map(r=>({...r,properties:{...r.properties}}));
 for(const instance of Object.values(s.familyInstances??{})){
  const family=s.families?.[instance.family];if(!family)continue;
  const externalParents=[...new Set(instance.members.map(id=>resources.find(r=>r.id===`infra:${id}`)?.properties?.parentTunnel).filter(Boolean))];
  for(const member of instance.members){const root=resources.find(r=>r.id===`infra:${member}`);if(root)root.parent=`infra:${instance.id}`;}
  const current=instance.members.flatMap(id=>s.roads?.[id]?[{from:s.roads[id].from,to:s.roads[id].to}]:s.tunnels[id]?.ranges??[]);
  const from=current.length?Math.min(...current.map(r=>r.from)):instance.station,to=current.length?Math.max(...current.map(r=>r.to)):instance.station+family.length;
  resources.push({id:`infra:${instance.id}`,...(externalParents.length===1?{parent:`infra:${externalParents[0]}`}:{}) ,kind:'structure_family',label:instance.name,properties:{...instance,station:from,familyName:family.name,category:family.category,length:to-from,to}});
 }
 for(const root of resources.filter(r=>['structure_family','road_corridor','tunnel'].includes(r.kind))){
  const baseIds:string[]=root.kind==='structure_family'?root.properties.members:[root.properties.id];
  const ids=[...baseIds],seen=new Set(ids);
  for(let cursor=0;cursor<ids.length;cursor++){
   const parent=ids[cursor];
   for(const member of [...Object.values(s.roads??{}),...Object.values(s.tunnels)])if(member.parentTunnel===parent&&!seen.has(member.id)){seen.add(member.id);ids.push(member.id);}
  }
  const sections:any[]=[],quantities:any[]=[];
  for(const id of ids){
   const road=s.roads?.[id];if(road){
    const member=resources.find(r=>r.id===`infra:${id}`);quantities.push(...(member?.properties.quantities??[]));
    sections.push({id:road.id,name:road.name,station:road.from,polygons:road.layers.map((l,i)=>({id:l.id,name:l.name,materialId:l.materialId,typeId:l.componentType,thickness:l.thickness,points:roadRing(road,i,road.from)})),basis:road.designBasis});
   }
   const tunnel=s.tunnels[id];if(tunnel)for(const range of tunnel.ranges){
    const section=s.sections[range.section];if(!section)continue;const rings=boundaries(section,.01).rings;
    sections.push({id:section.id,name:section.name,station:range.from,basis:section.designBasis,polygons:section.layers.map((l,i)=>({id:l.id??`legacy-${i}`,name:l.name,materialId:l.materialId,materialText:l.material,typeId:section.id,thickness:l.thickness,points:rings[i+1],hole:rings[i]}))});
   }
  }
  root.properties.detailSections=sections;root.properties.quantities=quantities;
 }
 return resources;
}
