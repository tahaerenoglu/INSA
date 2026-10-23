import {createHash} from 'node:crypto';
/** Viewer-only packing. Engineering solids, resources and station sections stay unchanged. */
export function batchRoadView(resources:any[],objects:any[]){
 const byId=new Map(resources.map(r=>[r.id,r])),roads=new Map<string,any[]>(),other:any[]=[];
 for(const o of objects){const r=byId.get(o.id),road=r?.kind==='pavement_layer'?r.properties.road:undefined;const role=r?.properties.role??byId.get(r?.parent)?.properties.role;if(o.kind!=='mesh'||!road||role!=='sleeper'){other.push(o);continue;}const list=roads.get(road)??[];list.push(o);roads.set(road,list);}
 for(const [road,items]of roads){const positions:number[]=[],uvMetres:number[]=[],normalGroups:number[]=[],parts:any[]=[],materialGroups:any[]=[];let normalOffset=0;
  for(const o of items){const start=positions.length/3,r=byId.get(o.id),resourceId=r.properties.instanceId?r.parent:r.id;let group=materialGroups.at(-1);
   if(!group||group.resourceId!==resourceId){group={start,count:0,resourceId,color:o.color};materialGroups.push(group);}
   const indices=o.indices??Array.from({length:o.positions.length/3},(_,i)=>i),groups=new Map<number,number>();
   for(const index of indices){positions.push(o.positions[index*3],o.positions[index*3+1],o.positions[index*3+2]);uvMetres.push(o.uvMetres?.[index*2]??0,o.uvMetres?.[index*2+1]??0);const key=o.normalGroups?.[index]??index;if(!groups.has(key))groups.set(key,normalOffset++);normalGroups.push(groups.get(key)!);}
   const count=positions.length/3-start;group.count+=count;parts.push({id:o.id,parent:o.parent,start,count,materialIndex:materialGroups.length-1});
  }
  const id=`infra:${road}:sleepers`,layerIds=[...new Set(items.map(o=>byId.get(o.id).properties.layerId))];resources.push({id,parent:`infra:${road}`,label:'Traversler · toplu çizim',kind:'pavement_layer',properties:{road,role:'sleeper',layerId:layerIds[0],layerIds,componentCount:parts.length}});
  other.push({id,parent:`infra:${road}`,kind:'mesh-batch',positions,uvMetres,normalGroups,parts,materialGroups,color:'#b8c1ca',geometryKey:createHash('sha256').update(items.map(o=>o.geometryKey).join('|')).digest('hex')});
 }
 return other;
}
