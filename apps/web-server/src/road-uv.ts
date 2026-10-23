import type {roadGeometry,Alignment3D} from '@insa/infra';import {point3d} from '@insa/infra';
/** Viewer seam adapter only: preserve engineering positions and metre-based transverse/longitudinal UVs. */
export function roadMetricUV(layer:ReturnType<typeof roadGeometry>['layers'][number],stations:number[],a:Alignment3D){
 let cursor=a.h[0].s0,distance=0,previous=point3d(a,cursor);
 const longitudinal=stations.map(target=>{while(cursor<target-1e-10){const next=Math.min(target,a.h[0].s0+Math.floor(cursor-a.h[0].s0+1e-8)+1),p=point3d(a,next);distance+=Math.hypot(p.x-previous.x,p.y-previous.y,p.z-previous.z);cursor=next;previous=p;}return distance;});
 const positions:number[]=[],uv:number[]=[],normalGroups:number[]=[],n=layer.rings[0].length,columns=n/2,p=layer.mesh.positions;
 for(let t=0;t<layer.mesh.indices.length;t+=3){const edge=layer.mesh.faceGroups[t/3];
  for(const index of layer.mesh.indices.slice(t,t+3)){const j=Math.floor(index/n),corner=index%n,[x,z]=layer.rings[j][corner];positions.push(...p.slice(index*3,index*3+3));normalGroups.push(edge*p.length+index);
   const center=layer.rings[j].slice(0,columns).findIndex(([x])=>x===0),topCenter=n-1-center;
   if(edge>=6)uv.push(x,z);else if(edge===2||edge===5)uv.push(longitudinal[j],z-layer.rings[j][topCenter][1]);else {const centerZ=corner<columns?layer.rings[j][center][1]:layer.rings[j][topCenter][1],fall=x===0?0:(z-centerZ)/Math.abs(x);uv.push(longitudinal[j],x*Math.sqrt(1+fall*fall));}
  }
 }
 return {positions,uv,normalGroups};
}

/** Explicit profile adapter: one metre along the alignment / section perimeter.
 * Split normals by polygon edge; reuse the authoritative solid's positions.
 */
export function roadProfileUV(part:NonNullable<ReturnType<typeof roadGeometry>['layers'][number]['parts']>[number]){
 const ring=part.rings[0],n=ring.length,cumulative=[0];
 for(let i=0;i<n;i++)cumulative.push(cumulative[i]+Math.hypot(ring[(i+1)%n][0]-ring[i][0],ring[(i+1)%n][1]-ring[i][1]));
 const positions:number[]=[],uv:number[]=[],normalGroups:number[]=[];
 for(let t=0;t<part.mesh.indices.length;t+=3){const edge=part.mesh.faceGroups[t/3];for(const index of part.mesh.indices.slice(t,t+3)){
  const j=Math.floor(index/n),corner=index%n;positions.push(...part.mesh.positions.slice(index*3,index*3+3));normalGroups.push(edge*part.mesh.positions.length+index);
  if(edge>=n)uv.push(...ring[corner]);else uv.push(part.stations[j]-part.from,corner===0&&edge===n-1?cumulative[n]:cumulative[corner]);
 }}return {positions,uv,normalGroups};
}
