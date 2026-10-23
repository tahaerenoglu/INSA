/** Parametric pavement loft. Thickness is vertical; lateral x is right looking forward. */
import {point3d,sampleStations,hLength,GeometryError,type Alignment3D} from './alignment.js';
import {meshVolume,isClosedOriented,type Mesh} from './sweep.js';
import {profileGeometry,validateProfiles,type ProfilePart} from './road-profile.js';
export type RoadExtent='pavement'|'full'|number;
export interface RoadLayer {id:string;name:string;role:string;thickness:number;leftExtent:RoadExtent;rightExtent:RoadExtent;materialId:string;componentType?:string;profile?:[number,number][];repeat?:{anchor:number;spacing:number;length:number};}
export interface RoadSection {station:number;leftWidth:number;rightWidth:number;leftShoulder:number;rightShoulder:number;leftCrossfall:number;rightCrossfall:number;}
export interface RoadCorridor {id:string;name:string;alignment:string;from:number;to:number;sections:RoadSection[];layers:RoadLayer[];parentTunnel?:string;designBasis?:{status:string;notes:string[];sources:{title:string;reference:string}[]};}
export const ROAD_TOLERANCE=.002;
const fail=(message:string):never=>{throw new GeometryError(message);};
const fields=['leftWidth','rightWidth','leftShoulder','rightShoulder','leftCrossfall','rightCrossfall'] as const;
export function roadSectionAt(road:RoadCorridor,station:number):RoadSection{
 let i=0;while(i<road.sections.length-2&&station>=road.sections[i+1].station)i++;
 const a=road.sections[i],b=road.sections[i+1],f=(station-a.station)/(b.station-a.station);const out={station} as RoadSection;
 for(const key of fields)out[key]=a[key]+f*(b[key]-a[key]);return out;
}
export function roadExtent(extent:RoadExtent,section:RoadSection,left:boolean){return typeof extent==='number'?extent:left?section.leftWidth+(extent==='full'?section.leftShoulder:0):section.rightWidth+(extent==='full'?section.rightShoulder:0);}
export function roadRing(road:RoadCorridor,layerIndex:number,station:number){
 if(road.layers[layerIndex].profile)return road.layers[layerIndex].profile!;
 const s=roadSectionAt(road,station),layer=road.layers[layerIndex],L=roadExtent(layer.leftExtent,s,true),R=roadExtent(layer.rightExtent,s,false),offset=road.layers.slice(0,layerIndex).reduce((v,l)=>v+l.thickness,0),t=layer.thickness;
 // CCW polygon in section (right, up), with a real crown vertex on both boundaries.
 return [[-L,L*s.leftCrossfall-offset-t],[0,-offset-t],[R,R*s.rightCrossfall-offset-t],[R,R*s.rightCrossfall-offset],[0,-offset],[-L,L*s.leftCrossfall-offset]] as [number,number][];
}
export function validateRoad(road:RoadCorridor,a:Alignment3D){
 const start=a.h[0].s0,end=start+hLength(a.h);
 if(!Number.isFinite(road.from)||!Number.isFinite(road.to)||road.to-road.from<.01||road.to-road.from>20000||road.from<start-1e-8||road.to>end+1e-8)fail('Road station range must lie inside its alignment and be 0.01–20000 m long.');
 for(const e of a.h.slice(1))if(e.s0>road.from&&e.s0<road.to){const before=point3d(a,e.s0-1e-6),after=point3d(a,e.s0+1e-6),turn=Math.atan2(Math.sin(after.az-before.az),Math.cos(after.az-before.az));if(Math.abs(turn)>1e-5)fail('Road alignment has an abrupt tangent change; define a radius/clothoid at corners.');}
 if(road.sections.length<2||Math.abs(road.sections[0].station-road.from)>1e-8||Math.abs(road.sections.at(-1)!.station-road.to)>1e-8)fail('Road section stations must cover exactly the corridor endpoints.');
 for(const [i,s]of road.sections.entries()){
  if(!Number.isFinite(s.station)||i&&s.station<=road.sections[i-1].station)fail('Road section stations must strictly increase; duplicate/overlapping ownership is not permitted.');
  for(const key of fields)if(!Number.isFinite(s[key]))fail(`Road ${key} must be finite.`);
  if(s.leftWidth<.1||s.rightWidth<.1||s.leftWidth>50||s.rightWidth>50||s.leftShoulder<0||s.rightShoulder<0||s.leftShoulder>20||s.rightShoulder>20||Math.abs(s.leftCrossfall)>.15||Math.abs(s.rightCrossfall)>.15)fail('Road widths/shoulders/crossfalls are outside V0.1 limits.');
 }
 if(!road.layers.length||road.layers.length>64||new Set(road.layers.map(l=>l.id)).size!==road.layers.length)fail('Road needs 1–64 uniquely identified pavement layers.');
 for(const [i,l]of road.layers.entries()){
  if(!l.id||!l.name.trim()||!l.role.trim()||!/^M-\d+$/.test(l.materialId)||!Number.isFinite(l.thickness)||l.thickness<.001||l.thickness>3)fail('Invalid pavement layer identity, material reference or vertical thickness.');
  for(const e of [l.leftExtent,l.rightExtent])if(e!=='pavement'&&e!=='full'&&(typeof e!=='number'||!Number.isFinite(e)||e<.1||e>70))fail('Invalid pavement lateral extent.');
  for(const s of road.sections)if(!l.profile&&i&&(roadExtent(l.leftExtent,s,true)<roadExtent(road.layers[i-1].leftExtent,s,true)-1e-8||roadExtent(l.rightExtent,s,false)<roadExtent(road.layers[i-1].rightExtent,s,false)-1e-8))fail('A lower layer must cover the layer above it; unsupported overhang.');
 }
 validateProfiles(road);
}
const place=(a:Alignment3D,s:number,[x,z]:[number,number],origin:[number,number,number])=>{const q=point3d(a,s);return [q.x+x*Math.sin(q.az)-origin[0],q.y-x*Math.cos(q.az)-origin[1],q.z+z-origin[2]] as [number,number,number];};
function stationsFor(road:RoadCorridor,a:Alignment3D,tolerance:number){
 const seeds=[...new Set([...sampleStations(a,road.from,road.to,tolerance,10),...road.sections.map(s=>s.station)])].sort((x,y)=>x-y),out=[seeds[0]];
 const split=(s0:number,s1:number,depth:number)=>{
  const middle=(s0+s1)/2;let error=0;
  for(let li=0;li<road.layers.length;li++){const r0=roadRing(road,li,s0),rm=roadRing(road,li,middle),r1=roadRing(road,li,s1);
   for(let k=0;k<6;k++){const p0=place(a,s0,r0[k],[0,0,0]),pm=place(a,middle,rm[k],[0,0,0]),p1=place(a,s1,r1[k],[0,0,0]);error=Math.max(error,Math.hypot(...pm.map((v,i)=>v-(p0[i]+p1[i])/2)));}
  }
  if(error>tolerance){if(depth>22)fail('Road sampling failed to converge.');split(s0,middle,depth+1);split(middle,s1,depth+1);}else {out.push(s1);if(out.length>5000)fail('Road exceeds V0.1 sampling budget; split the corridor.');}
 };
 for(let i=0;i<seeds.length-1;i++)if(seeds[i+1]-seeds[i]>1e-8)split(seeds[i],seeds[i+1],0);
 if(out.length>5000)fail('Road exceeds V0.1 sampling budget; split the corridor.');return out;
}
function layeredRings(road:RoadCorridor,li:number,stations:number[]){
 const distinct=(left:boolean)=>{const entries:RoadExtent[]=[];for(const layer of road.layers.slice(0,li+1)){const extent=left?layer.leftExtent:layer.rightExtent;if(!entries.some(e=>road.sections.every(s=>Math.abs(roadExtent(e,s,left)-roadExtent(extent,s,left))<1e-9)))entries.push(extent);}return entries;};
 const left=distinct(true),right=distinct(false),offset=road.layers.slice(0,li).reduce((v,l)=>v+l.thickness,0),thickness=road.layers[li].thickness;
 return stations.map(station=>{const state=roadSectionAt(road,station),xs=[...left.map(e=>-roadExtent(e,state,true)).reverse(),0,...right.map(e=>roadExtent(e,state,false))],height=(x:number)=>Math.abs(x)*(x<0?state.leftCrossfall:state.rightCrossfall)-offset;
  return [...xs.map(x=>[x,height(x)-thickness] as [number,number]),...xs.slice().reverse().map(x=>[x,height(x)] as [number,number])];});
}
function loft(rings:[number,number][][],a:Alignment3D,stations:number[],origin:[number,number,number]){
 const positions:number[]=[],indices:number[]=[],faceGroups:number[]=[],n=rings[0].length,columns=n/2;
 for(let j=0;j<stations.length;j++)for(const p of rings[j])positions.push(...place(a,stations[j],p,origin));
 // Coincident lateral boundaries may meet (e.g. shoulder width zero). Weld only within a section.
 const representative=new Array<number>(positions.length/3);for(let j=0;j<stations.length;j++)for(let i=0;i<n;i++){let match=j*n+i;for(let k=0;k<i;k++)if(Math.hypot(rings[j][i][0]-rings[j][k][0],rings[j][i][1]-rings[j][k][1])<1e-10){match=j*n+k;break;}representative[j*n+i]=match;}
 const v=(j:number,i:number)=>representative[j*n+i%n];
 const triangle=(a:number,b:number,c:number,group:number)=>{if(a===b||b===c||a===c)return;indices.push(a,b,c);faceGroups.push(group);};
 for(let j=0;j<stations.length-1;j++)for(let i=0;i<n;i++){
  const A=v(j,i),B=v(j+1,i),C=v(j+1,i+1),D=v(j,i+1),x=(rings[j][i][0]+rings[j][(i+1)%n][0])/2;
  const group=i===columns-1?2:i===n-1?5:i<columns-1?(x<0?0:1):(x<0?4:3);
  // Upper and lower interface strips use the SAME spatial diagonal with opposite winding.
  if(i>=columns&&i<n-1){triangle(A,B,D,group);triangle(D,B,C,group);}else{triangle(A,C,D,group);triangle(A,B,C,group);}
 }
 for(let k=0;k<columns-1;k++)for(const [x,y,z]of [[k,k+1,n-2-k],[k,n-2-k,n-1-k]]){triangle(v(0,x),v(0,y),v(0,z),6);triangle(v(stations.length-1,x),v(stations.length-1,z),v(stations.length-1,y),7);}
 return {positions,indices,faceGroups};
}

const triangleArea=(p:number[],ia:number,ib:number,ic:number,plan=false)=>{const a=ia*3,b=ib*3,c=ic*3,ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2],vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];return plan?Math.abs(ux*vy-uy*vx)/2:Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/2;};
/** Positive projected overlap is unsupported, including grade-separated crossings in V0.1. */
function checkPlanOverlap(quads:[number,number][][]){
 const bounds=quads.map(q=>({min:[Math.min(...q.map(p=>p[0])),Math.min(...q.map(p=>p[1]))],max:[Math.max(...q.map(p=>p[0])),Math.max(...q.map(p=>p[1]))]}));
 for(let i=0;i<quads.length;i++)for(let j=i+2;j<quads.length;j++){
  if(bounds[i].max.some((v,k)=>v<=bounds[j].min[k]+1e-8)||bounds[j].max.some((v,k)=>v<=bounds[i].min[k]+1e-8))continue;
  let separated=false;for(const q of [quads[i],quads[j]])for(let k=0;k<4;k++){const dx=q[(k+1)%4][0]-q[k][0],dy=q[(k+1)%4][1]-q[k][1],values=(r:[number,number][])=>r.map(p=>-dy*p[0]+dx*p[1]),x=values(quads[i]),y=values(quads[j]);if(Math.max(...x)<=Math.min(...y)+1e-8||Math.max(...y)<=Math.min(...x)+1e-8)separated=true;}
  if(!separated)fail('Road footprint self-intersects; junctions/grade-separated crossings are unsupported.');
 }
}
export function roadGeometry(road:RoadCorridor,a:Alignment3D,origin:[number,number,number],tolerance=ROAD_TOLERANCE){
 validateRoad(road,a);if(!Number.isFinite(tolerance)||tolerance<=0||tolerance>.05)fail('Invalid road approximation tolerance.');
 if(road.layers[0].profile)return profileGeometry(road,a,origin,tolerance);
 const stations=stationsFor(road,a,tolerance);
 for(const s of stations){const q=point3d(a,s),section=roadSectionAt(road,s);for(const l of road.layers){const L=roadExtent(l.leftExtent,section,true),R=roadExtent(l.rightExtent,section,false);if(Math.min(1-L*q.k,1+R*q.k)<.1)fail('Road width folds across the alignment curvature centre.');}}
 const widest=road.layers.length-1,rings=stations.map(s=>roadRing(road,widest,s)),plan=rings.map((r,j)=>[place(a,stations[j],r[5],origin),place(a,stations[j],r[3],origin)].map(p=>[p[0],p[1]] as [number,number]));
 checkPlanOverlap(plan.slice(0,-1).map((r,j)=>[r[0],plan[j+1][0],plan[j+1][1],r[1]]));
 const layers=road.layers.map((layer,li)=>{
  const rings=layeredRings(road,li,stations),mesh=loft(rings,a,stations,origin);
  if(!isClosedOriented(mesh)||meshVolume(mesh)<=0)fail('Invalid/non-manifold pavement loft.');
  for(let t=0;t<mesh.indices.length;t+=3)if(triangleArea(mesh.positions,...mesh.indices.slice(t,t+3) as [number,number,number])<1e-12)fail('Degenerate pavement triangle.');
  let projected=0,surface=0;
  for(let t=0;t<mesh.indices.length;t+=3)if(mesh.faceGroups[t/3]===3||mesh.faceGroups[t/3]===4){const triangle=mesh.indices.slice(t,t+3) as [number,number,number];projected+=triangleArea(mesh.positions,...triangle,true);surface+=triangleArea(mesh.positions,...triangle);}

  let integratedArea=0;for(let j=0;j<stations.length-1;j++){const lo=stations[j],hi=stations[j+1],mid=(lo+hi)/2,element=a.h.find(e=>mid>=e.s0&&mid<e.s0+e.length)!;const f=(s:number)=>{const state=roadSectionAt(road,s),L=roadExtent(layer.leftExtent,state,true),R=roadExtent(layer.rightExtent,state,false),k=element.k0+(element.k1-element.k0)*(s-element.s0)/element.length;return L+R+k*(R*R-L*L)/2;};integratedArea+=(hi-lo)/6*(f(lo)+4*f((lo+hi)/2)+f(hi));}
  return {layer,mesh,rings,parts:undefined as ProfilePart[]|undefined,quantity:{layerId:layer.id,name:layer.name,materialId:layer.materialId,from:road.from,to:road.to,vertical_thickness_m:layer.thickness,extent:{left:layer.leftExtent,right:layer.rightExtent},section_extents:road.sections.map(s=>({station:s.station,left_m:roadExtent(layer.leftExtent,s,true),right_m:roadExtent(layer.rightExtent,s,false)})),volume_m3:integratedArea*layer.thickness,mesh_volume_m3:meshVolume(mesh),integrated_volume_m3:integratedArea*layer.thickness,projected_plan_area_m2:integratedArea,mesh_projected_area_m2:projected,sloping_top_area_m2:surface,basis:'parametric Simpson integral t*(L+R+k*(R²-L²)/2); mesh volume and sloping top area from closed engineering loft; vertical thickness',tolerance_m:tolerance}};
 });
 return {stations,layers,tolerance_m:tolerance,origin};
}
