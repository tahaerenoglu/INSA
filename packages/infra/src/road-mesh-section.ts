/** Read-only triangle/plane intersections of the SAME roadGeometry solids used by the viewer.
 * No replacement profiles, station resampling, offsets or model events.
 */
import {point3d,GeometryError,type Alignment3D} from './alignment.js';
import {roadGeometry,type RoadCorridor} from './road.js';
import {localOrigin} from './tunnel.js';
import {isClosedOriented,meshVolume,type Mesh} from './sweep.js';
type P=[number,number,number];type Segment=[[number,number],[number,number]];
const dot=(a:P,b:P)=>a.reduce((v,n,i)=>v+n*b[i],0);
export function meshPlaneSegments(mesh:Mesh,center:P,normal:P,right:P){
 const segments:Segment[]=[],seen=new Set<string>(),epsilon=1e-8;let coplanar=0;
 const project=(p:P):[number,number]=>[dot(p.map((v,i)=>v-center[i]) as P,right),p[2]];
 const push=(a:P,b:P)=>{if(Math.hypot(...a.map((v,i)=>v-b[i]))<epsilon)return;const segment:Segment=[project(a),project(b)],keys=segment.map(p=>p.map(v=>Math.round(v/epsilon)).join(',')).sort().join('|');if(!seen.has(keys)){seen.add(keys);segments.push(segment);}};
 const coplanarEdges=new Map<string,{a:P;b:P;count:number}>();
 for(let t=0;t<mesh.indices.length;t+=3){const p=mesh.indices.slice(t,t+3).map(i=>mesh.positions.slice(i*3,i*3+3) as P),d=p.map(p=>dot(p.map((v,i)=>v-center[i]) as P,normal));
  if(d.every(v=>v>epsilon)||d.every(v=>v< -epsilon))continue;
  if(d.every(v=>Math.abs(v)<=epsilon)){coplanar++;for(let i=0;i<3;i++){const a=p[i],b=p[(i+1)%3],key=[a,b].map(p=>p.map(v=>Math.round(v/epsilon)).join(',')).sort().join('|'),old=coplanarEdges.get(key);coplanarEdges.set(key,{a,b,count:(old?.count??0)+1});}continue;}
  const hits:P[]=[];const add=(q:P)=>{if(!hits.some(p=>Math.hypot(...p.map((v,i)=>v-q[i]))<epsilon))hits.push(q);};
  for(let i=0;i<3;i++){const j=(i+1)%3;if(Math.abs(d[i])<=epsilon)add(p[i]);if(d[i]*d[j]<0){const f=d[i]/(d[i]-d[j]);add(p[i].map((v,k)=>v+f*(p[j][k]-v)) as P);}}
  if(hits.length===2)push(hits[0],hits[1]);
 }
 for(const e of coplanarEdges.values())if(e.count===1)push(e.a,e.b);
 return {segments,coplanarTriangles:coplanar};
}
export function sectionLevels(segments:Segment[],offset:number){
 const z:number[]=[];for(const [a,b]of segments){if(offset<Math.min(a[0],b[0])-1e-7||offset>Math.max(a[0],b[0])+1e-7)continue;
  if(Math.abs(b[0]-a[0])<1e-10)z.push(a[1],b[1]);else z.push(a[1]+(offset-a[0])/(b[0]-a[0])*(b[1]-a[1]));}
 return [...new Set(z.map(v=>Math.round(v*1e8)/1e8))].sort((a,b)=>a-b);
}
export function roadMeshSection(road:RoadCorridor,a:Alignment3D,station:number){
 if(!Number.isFinite(station)||station<road.from||station>road.to)throw new GeometryError('Mesh section station lies outside corridor.');
 const q=point3d(a,station),origin=localOrigin(a),center:P=[q.x-origin[0],q.y-origin[1],q.z-origin[2]],right:P=[Math.sin(q.az),-Math.cos(q.az),0],scale=Math.sqrt(1+q.grade*q.grade),normal:P=[Math.cos(q.az)/scale,Math.sin(q.az)/scale,q.grade/scale];
 const geometry=roadGeometry(road,a,origin),layers=geometry.layers.map(l=>{
  const cut=meshPlaneSegments(l.mesh,center,normal,right),segments=cut.segments.map(s=>s.map(([x,z])=>[x,z+origin[2]]) as Segment),points=segments.flat(),xs=points.map(p=>p[0]),zs=points.map(p=>p[1]);
  const nearest=l.parts?.length?l.parts.reduce((a,b)=>Math.abs((a.from+a.to)/2-station)<Math.abs((b.from+b.to)/2-station)?a:b):undefined;
  return {id:l.layer.id,name:l.layer.name,role:l.layer.role,materialId:l.layer.materialId,segments,closed:isClosedOriented(l.mesh),positiveVolume:meshVolume(l.mesh)>0,coplanarTriangles:cut.coplanarTriangles,measured:points.length?{minOffset:Math.min(...xs),maxOffset:Math.max(...xs),width:Math.max(...xs)-Math.min(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)}:null,nearestPiece:nearest?{id:nearest.id,from:nearest.from,to:nearest.to,center:(nearest.from+nearest.to)/2}:null};
 });
 const rails=layers.filter(l=>l.role==='rail'&&l.measured).sort((a,b)=>a.measured!.minOffset-b.measured!.minOffset),sleepers=layers.filter(l=>l.role==='sleeper'&&l.measured),ballast=layers.find(l=>l.role==='ballast'),subballast=layers.find(l=>l.role==='subballast'),base=layers.find(l=>l.role==='subbase');
 const levels=(l:typeof ballast,x:number)=>l?sectionLevels(l.segments,x):[],top=(l:typeof ballast,x:number)=>levels(l,x).at(-1)??null,bottom=(l:typeof ballast,x:number)=>levels(l,x)[0]??null,centers=rails.map(l=>(l.measured!.minOffset+l.measured!.maxOffset)/2),railTop=rails.length?rails.reduce((v,l)=>v+l.measured!.maxZ,0)/rails.length:null;
 const topPoints=ballast?.segments.flat().filter(p=>Math.abs(p[1]-ballast.measured!.maxZ)<1e-6)??[];
 const thickness=(l:typeof ballast,x:number)=>top(l,x)!-bottom(l,x)!;
 const measurements={platformWidth_m:base?.measured?.width??null,trackAxes_m:centers.length===4?[(centers[0]+centers[1])/2,(centers[2]+centers[3])/2]:[],sleeperLengths_m:sleepers.map(l=>l.measured!.width),ballastTopWidth_m:topPoints.length?Math.max(...topPoints.map(p=>p[0]))-Math.min(...topPoints.map(p=>p[0])):null,railTop_m:railTop,formationCenter_m:bottom(base,0),railToFormationCenter_m:railTop!==null&&bottom(base,0)!==null?railTop-bottom(base,0)!:null,railToFormationEdge_m:base?.measured&&railTop!==null?railTop-bottom(base,base.measured.maxOffset)!:null,crossfall_pct:base?.measured?(bottom(base,0)!-bottom(base,base.measured.maxOffset)!)/base.measured.maxOffset*100:null,ballastCenterThickness_m:ballast?thickness(ballast,0):null,subballastThickness_m:subballast?thickness(subballast,0):null,subbaseThickness_m:base?thickness(base,0):null,contacts:rails.map(l=>{const x=(l.measured!.minOffset+l.measured!.maxOffset)/2,sleeper=sleepers.find(s=>x>=s.measured!.minOffset&&x<=s.measured!.maxOffset);return {rail:l.id,railToSleeperGap_mm:sleeper?(bottom(l,x)!-top(sleeper,x)!)*1000:null,sleeperToBallastGap_mm:sleeper&&ballast?(bottom(sleeper,x)!-top(ballast,x)!)*1000:null};}),layerInterfaceGaps_mm:{ballastToSubballast:ballast&&subballast?(bottom(ballast,0)!-top(subballast,0)!)*1000:null,subballastToSubbase:subballast&&base?(bottom(subballast,0)!-top(base,0)!)*1000:null}};
 return {road:road.id,station,alignmentPoint:{x:q.x,y:q.y,z:q.z},plane:{point:[q.x,q.y,q.z],normal,right,definition:'normal = full 3D alignment tangent; offsets horizontal right, plotted elevation = global Z'},basis:'triangle-plane intersection of unchanged full-interval roadGeometry meshes; not roadRing or engineering profile reconstruction',tolerance_m:geometry.tolerance_m,layers,measurements};
}
