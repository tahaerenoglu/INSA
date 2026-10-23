/** Explicit corridor sections use the existing alignment frames and solid sweep.
 * Coordinates are metres: right of alignment / vertically above its profile.
 * Repeated pieces retain an absolute chainage anchor when querying subintervals.
 */
import {GeometryError,point3d,sampleStations,type Alignment3D} from './alignment.js';
import {frames,sweepSolid,earClip,isClosedOriented,meshVolume,type Mesh} from './sweep.js';
import {signedArea,type UV} from './section.js';
import type {RoadCorridor,RoadLayer} from './road.js';
export interface ProfilePart {id:string;from:number;to:number;stations:number[];rings:UV[][];mesh:Mesh&{faceGroups:number[]};}
const fail=(message:string):never=>{throw new GeometryError(message);};
export function validateProfiles(road:RoadCorridor){
 const count=road.layers.filter(l=>l.profile).length;
 if(count&&count!==road.layers.length)fail('Explicit profiles and stacked pavement layers cannot be mixed in one corridor.');
 for(const l of road.layers){
  if(l.repeat&&!l.profile)fail('Repeated components require an explicit section profile.');
  if(!l.profile)continue;
  const p=l.profile;
  if(p.length<3||p.length>128||p.some(v=>v.length!==2||!v.every(Number.isFinite)||Math.abs(v[0])>70||Math.abs(v[1])>20))fail('Profile requires 3–128 finite right/up points within 70/20 m.');
  if(p.some((v,i)=>Math.hypot(v[0]-p[(i+1)%p.length][0],v[1]-p[(i+1)%p.length][1])<1e-8)||signedArea(p)<=1e-8||earClip(p).length!==p.length-2)fail('Profile must be a simple counterclockwise polygon without duplicate vertices.');
  // Reject nonadjacent edge intersections, including touching/collinear overlaps.
  const cross=(a:UV,b:UV,c:UV)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  for(let i=0;i<p.length;i++)for(let j=i+2;j<p.length;j++){
   if(i===0&&j===p.length-1)continue;
   const a=p[i],b=p[(i+1)%p.length],c=p[j],d=p[(j+1)%p.length];
   if(Math.max(a[0],b[0])<Math.min(c[0],d[0])-1e-10||Math.max(c[0],d[0])<Math.min(a[0],b[0])-1e-10||Math.max(a[1],b[1])<Math.min(c[1],d[1])-1e-10||Math.max(c[1],d[1])<Math.min(a[1],b[1])-1e-10)continue;
   if(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0)fail('Profile edges intersect.');
  }
  const r=l.repeat;if(r&&(![r.anchor,r.spacing,r.length].every(Number.isFinite)||r.spacing<.05||r.length<.01||r.length>r.spacing||r.spacing>100||Math.ceil((road.to-road.from)/r.spacing)>5000))fail('Repeated pieces need finite anchor, 0.01 <= length <= spacing, spacing 0.05–100 m and at most 5000 pieces per layer.');
 }
}
export function profileIntervals(layer:RoadLayer,from:number,to:number){
 if(!layer.repeat)return [{id:layer.id,from,to}];
 const r=layer.repeat,out:{id:string;from:number;to:number}[]=[];
 const first=Math.ceil((from-r.anchor-r.length/2)/r.spacing),last=Math.floor((to-r.anchor+r.length/2)/r.spacing);
 for(let i=first;i<=last;i++){const center=r.anchor+i*r.spacing,lo=Math.max(from,center-r.length/2),hi=Math.min(to,center+r.length/2);if(hi-lo>1e-8)out.push({id:`${layer.id}-${i}`,from:lo,to:hi});}
 return out;
}
export function profileGeometry(road:RoadCorridor,a:Alignment3D,origin:[number,number,number],tolerance:number){
 const stations=sampleStations(a,road.from,road.to,tolerance,5);
 const layers=road.layers.map(layer=>{
  const ring=layer.profile!,n=ring.length;
  const parts:ProfilePart[]=profileIntervals(layer,road.from,road.to).map(interval=>{
   const ss=sampleStations(a,interval.from,interval.to,tolerance,5);
   for(const s of ss){const q=point3d(a,s);if(ring.some(([x])=>1+x*q.k<.1))fail('Corridor profile folds across alignment curvature centre.');}
   const mesh=sweepSolid(frames(a,ss,origin),ring),faceGroups:number[]=[];
   for(let j=0;j<ss.length-1;j++)for(let edge=0;edge<n;edge++)faceGroups.push(edge,edge);
   for(let i=0;i<n-2;i++)faceGroups.push(n,n+1);
   if(!isClosedOriented(mesh)||meshVolume(mesh)<=0)fail('Invalid explicit corridor solid.');
   return {...interval,stations:ss,rings:ss.map(()=>ring),mesh:{...mesh,faceGroups}};
  });
  const mesh={positions:[] as number[],indices:[] as number[],faceGroups:[] as number[]};
  let surface=0,projected=0;
  for(const part of parts){const offset=mesh.positions.length/3;for(const v of part.mesh.positions)mesh.positions.push(v);for(const v of part.mesh.indices)mesh.indices.push(v+offset);mesh.faceGroups.push(...part.mesh.faceGroups);
   for(let t=0;t<part.mesh.indices.length;t+=3){const edge=part.mesh.faceGroups[t/3];if(edge>=n||ring[(edge+1)%n][0]>=ring[edge][0])continue;
    const [A,B,C]=part.mesh.indices.slice(t,t+3).map(i=>part.mesh.positions.slice(i*3,i*3+3)),u=B.map((v,i)=>v-A[i]),v=C.map((v,i)=>v-A[i]),c=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    surface+=Math.hypot(...c)/2;projected+=Math.abs(c[2])/2;
   }
  }
  const volume=parts.reduce((v,p)=>v+meshVolume(p.mesh),0),xs=ring.map(p=>p[0]);
  return {layer,parts,mesh,rings:stations.map(()=>ring),quantity:{layerId:layer.id,name:layer.name,materialId:layer.materialId,from:road.from,to:road.to,vertical_thickness_m:Math.max(...ring.map(p=>p[1]))-Math.min(...ring.map(p=>p[1])),extent:{left:layer.leftExtent,right:layer.rightExtent},section_extents:road.sections.map(s=>({station:s.station,left_m:-Math.min(...xs),right_m:Math.max(...xs)})),volume_m3:volume,mesh_volume_m3:volume,integrated_volume_m3:volume,projected_plan_area_m2:projected,mesh_projected_area_m2:projected,sloping_top_area_m2:surface,basis:'Closed existing sweepSolid meshes; explicit right/up profile relative to alignment elevation; repeated pieces clipped by absolute station anchor',tolerance_m:tolerance,component_count:parts.length}};
 });
 return {stations,layers,tolerance_m:tolerance,origin};
}
