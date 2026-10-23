import {point3d,type Alignment3D,type Mesh,type UV} from '@insa/infra';
/** UV metres, independent of georeference. Duplicate only viewer vertices at seams/caps. */
export function tunnelMetricUV(mesh:Mesh,stations:number[],rings:[UV[],UV[]],a:Alignment3D){
 const no=rings[0].length,ni=rings[1].length,stride=no+ni,perimeters=rings.map(r=>{const c=[0];for(let i=0;i<r.length;i++)c.push(c[i]+Math.hypot(r[(i+1)%r.length][0]-r[i][0],r[(i+1)%r.length][1]-r[i][1]));return c;});
 // Deterministic 1 m integration from the alignment origin keeps adjacent ranges continuous.
 const start=a.h[0].s0;let station=start,total=0;let previous=point3d(a,start);
 const longitudinal=stations.map(target=>{while(station<target-1e-10){const next=Math.min(target,start+Math.floor(station-start+1e-8)+1);const p=point3d(a,next);total+=Math.hypot(p.x-previous.x,p.y-previous.y,p.z-previous.z);station=next;previous=p;}return total;});
 const positions:number[]=[],uv:number[]=[],normalGroups:number[]=[];
 for(let t=0;t<mesh.indices.length;t+=3){const triangle=mesh.indices.slice(t,t+3),js=triangle.map(v=>Math.floor(v/stride)),cap=js.every(j=>j===js[0]);
  const local=(v:number)=>v%stride,sideOf=(v:number)=>local(v)<no?0:1,indexOf=(v:number)=>local(v)-(sideOf(v)?no:0);
  for(const v of triangle){positions.push(...mesh.positions.slice(v*3,v*3+3));normalGroups.push(cap?mesh.positions.length+v:v);const j=Math.floor(v/stride),side=sideOf(v),i=indexOf(v),n=rings[side].length,seam=triangle.some(w=>sideOf(w)===side&&indexOf(w)===0)&&triangle.some(w=>sideOf(w)===side&&indexOf(w)===n-1);
   if(cap)uv.push(...rings[side][i]);else uv.push(longitudinal[j],perimeters[side][seam&&i===0?n:i]);
  }
 }
 return {positions,uv,normalGroups};
}
