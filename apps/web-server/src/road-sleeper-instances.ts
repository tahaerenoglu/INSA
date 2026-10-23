import {createHash} from 'node:crypto';
import {point3d,type Alignment3D, type roadGeometry} from '@insa/infra';
type P=[number,number,number];
/** Viewer-only instancing of sleepers. Authoritative swept solids/quantities stay untouched.
 * Reject a batch if an instance differs from its engineering vertices by >2 mm.
 */
export function sleeperInstances(road:string,layers:ReturnType<typeof roadGeometry>['layers'],a:Alignment3D,origin:P,convert:(p:P)=>P){
 const selected=layers.filter(l=>l.layer.role==='sleeper'&&l.layer.repeat&&l.parts?.length);if(!selected.length)return null;
 const groups=new Map<string,any>();let maxError=0;
 for(const layer of selected){const ring=layer.layer.profile!,cx=(Math.min(...ring.map(p=>p[0]))+Math.max(...ring.map(p=>p[0])))/2,profile=ring.map(([x,z])=>[x-cx,z]),shapeKey=JSON.stringify(profile.map(p=>p.map(v=>Math.round(v*1e9)/1e9))),key=layer.layer.id,first=layer.parts!.find(p=>p.stations.length===2);if(!first)return null;
  let group=groups.get(key);if(!group){const positions=[-.5,.5].flatMap(s=>profile.flatMap(([x,z])=>[-x,z,s])),indices=first.mesh.indices.slice();group={positions,indices,instances:[],layerIds:[],materialId:layer.layer.materialId,prototypeKey:createHash('sha256').update(shapeKey).digest('hex')};groups.set(key,group);}
  group.layerIds.push(layer.layer.id);
  for(const part of layer.parts!){const mid=(part.from+part.to)/2,p=point3d(a,mid),lo=point3d(a,part.from),hi=point3d(a,part.to),left:P=[-Math.sin(p.az),Math.cos(p.az),0],delta:P=[hi.x-lo.x,hi.y-lo.y,hi.z-lo.z],center:P=[p.x-cx*left[0],p.y-cx*left[1],p.z];
   for(let j=0;j<part.stations.length;j++)for(let k=0;k<profile.length;k++){const[x,z]=profile[k],sign=(part.stations[j]-mid)/(part.to-part.from),estimated=[center[0]-x*left[0]+sign*delta[0],center[1]-x*left[1]+sign*delta[1],center[2]+z+sign*delta[2]],index=(j*ring.length+k)*3,error=Math.hypot(...estimated.map((v,i)=>v-(part.mesh.positions[index+i]+origin[i])));maxError=Math.max(maxError,error);if(error>.002)return null;}
   const c=convert(center),axis=(v:P)=>convert(center.map((p,i)=>p+v[i]) as P).map((p,i)=>p-c[i]),x=axis(left),y=axis([0,0,1]),z=axis(delta);group.instances.push({id:part.id,matrix:[...x,0,...y,0,...z,0,...c,1]});
  }
 }
 return {groups:[...groups.values()],maxError,layerIds:selected.map(l=>l.layer.id)};
}
/** Other repeated structural components use the same path when the 2mm bound permits it.
 * A long curved footing can fall back independently without disabling other types.
 */
export function repeatedComponentInstances(road:string,layers:ReturnType<typeof roadGeometry>['layers'],a:Alignment3D,origin:P,convert:(p:P)=>P){
 const groups:any[]=[],layerIds:string[]=[];let maxError=0;
 for(const layer of layers){if(!layer.layer.repeat)continue;const result=sleeperInstances(road,[{...layer,layer:{...layer.layer,role:'sleeper'}}],a,origin,convert);if(!result)continue;maxError=Math.max(maxError,result.maxError);layerIds.push(...result.layerIds);groups.push(...result.groups.map(g=>({...g,role:layer.layer.role,name:layer.layer.name})));}
 return groups.length?{groups,layerIds,maxError}:null;
}
