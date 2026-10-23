/** Derived engineering solids for coordination. No persistence or viewer state lives here. */
import { ShapeUtils, Vector2 } from 'three';
import type { BimState, Element, LayeredType, ProfileType } from './model.js';
import { thickness, wallFrame } from './model.js';
import { wallRoof } from './wall-roof.js';
import { planeHeight } from './arch.js';
import { componentBox } from './family.js';
import { memberRepresentation } from './engines/profile-member.js';
import { roofGeometry } from './engines/pitched-roof.js';
import { findCategory } from './taxonomy.js';
export type V3 = [number,number,number];
export type P2 = [number,number];
export const add3=(a:V3,b:V3):V3=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
export const sub3=(a:V3,b:V3):V3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
export const mul3=(a:V3,k:number):V3=>[a[0]*k,a[1]*k,a[2]*k];
export const dot3=(a:V3,b:V3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export const cross3=(a:V3,b:V3):V3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const len3=(a:V3)=>Math.hypot(...a);
export const unit3=(a:V3):V3=>mul3(a,1/len3(a));
export type Bounds3={min:V3;max:V3};
export type ConvexCell={points:V3[];faces:number[][]};
export const bounds3=(points:V3[]):Bounds3=>({min:[0,1,2].map(i=>Math.min(...points.map(p=>p[i]))) as V3,max:[0,1,2].map(i=>Math.max(...points.map(p=>p[i]))) as V3});
export function ringCell(bottom:V3[],top:V3[]):ConvexCell {
  const n=bottom.length;
  return {points:[...bottom,...top],faces:[Array.from({length:n},(_,i)=>n-1-i),Array.from({length:n},(_,i)=>n+i),...bottom.map((_,i)=>[i,(i+1)%n,(i+1)%n+n,i+n])]};
}
export function triangulatePlan(outline:P2[],holes:P2[][]=[]):P2[][] {
  const rings=[outline,...holes].map(r=>r.map(p=>new Vector2(...p)));
  const faces=ShapeUtils.triangulateShape(rings[0],rings.slice(1)),points=rings.flat();
  return faces.map(face=>face.map(i=>[points[i].x,points[i].y] as P2));
}
const planCells=(outline:P2[],holes:P2[][],bottom:(p:P2)=>V3,top:(p:P2)=>V3)=>triangulatePlan(outline,holes).map(tri=>ringCell(tri.map(bottom),tri.map(top)));
/** Exact polyhedral cells, including holes and piecewise roof clipping. Unsupported curved shapes are explicit. */
export function elementSolid(s:BimState,e:Element,openingHosts?:ReadonlySet<string>):{cells:ConvexCell[];unsupported?:string} {
  const z=s.storeys[e.storey]?.elevation??0;
  if(e.kind==='wall') {
    if(openingHosts?openingHosts.has(e.id):Object.values(s.elements).some(o=>o.kind==='opening'&&o.host===e.id))return {cells:[],unsupported:'wall with hosted voids (coordination decomposition unavailable)'};
    const f=wallFrame(s,e),roof=wallRoof(s,e);
    const patches=roof?.patches??[{polygon:f.footprint,heights:f.footprint.map(()=>e.baseOffset+e.height)}];
    return {cells:patches.map(p=>ringCell(p.polygon.map(q=>[q[0],q[1],z+e.baseOffset]),p.polygon.map((q,i)=>[q[0],q[1],z+p.heights[i]])))};
  }
  if(e.kind==='component') {const b=componentBox(s,e);return {cells:[ringCell(b.corners.map(p=>[...p,b.zBottom]),b.corners.map(p=>[...p,b.zTop]))]};}
  if(e.kind==='profile_member') {
    const r=memberRepresentation(s,e),p=(s.types[e.type] as ProfileType).profile;
    if(p.shape!=='rect')return {cells:[],unsupported:`profile ${p.shape}`};
    const y=cross3(r.axisDir,r.refDir),origin=add3(r.origin,[0,0,z]);
    const at=(x:number,v:number,l:number)=>add3(add3(origin,mul3(r.axisDir,l)),add3(mul3(r.refDir,x+r.profileCenter[0]),mul3(y,v+r.profileCenter[1])));
    const ring=[[-p.b/2,-p.h/2],[p.b/2,-p.h/2],[p.b/2,p.h/2],[-p.b/2,p.h/2]];
    return {cells:[ringCell(ring.map(([x,y])=>at(x,y,0)),ring.map(([x,y])=>at(x,y,r.length)))]};
  }
  if(e.kind==='boundary') {
    const t=thickness(s.types[e.type] as LayeredType),a=(e.slope?.azimuth??0)*Math.PI/180,p=(e.slope?.pitch??0)*Math.PI/180;
    const n:V3=[-Math.sin(p)*Math.cos(a),-Math.sin(p)*Math.sin(a),Math.cos(p)],sign=findCategory(e.category)?.thickness==='above'?1:-1;
    const ref=(q:P2):V3=>[q[0],q[1],z+planeHeight(e,q)],shift=(q:P2)=>add3(ref(q),mul3(n,sign*t));
    return {cells:planCells(e.outline,e.holes,sign>0?ref:shift,sign>0?shift:ref)};
  }
  if(e.kind==='pitched_roof') {
    const g=roofGeometry(s,e);
    return {cells:g.planes.map(p=>ringCell(p.polygon.map(v=>add3(add3(v,[0,0,z]),mul3(p.normal,-g.thickness))),p.polygon.map(v=>add3(v,[0,0,z]))))};
  }
  return {cells:[],unsupported:e.kind};
}
export function cellEdges(c:ConvexCell):[V3,V3][] {
  const keys=new Set<string>(),out:[V3,V3][]=[];
  for(const f of c.faces)for(let i=0;i<f.length;i++){const a=f[i],b=f[(i+1)%f.length],k=a<b?`${a}:${b}`:`${b}:${a}`;if(!keys.has(k)){keys.add(k);out.push([c.points[a],c.points[b]]);}}
  return out;
}
/** Separating axis theorem: face normals and edge cross products, never an AABB overlap assertion. */
export function convexContact(a:ConvexCell,b:ConvexCell) {
  const axes:V3[]=[],edgesA=cellEdges(a),edgesB=cellEdges(b);
  for(const c of [a,b])for(const f of c.faces)axes.push(cross3(sub3(c.points[f[1]],c.points[f[0]]),sub3(c.points[f[2]],c.points[f[0]])));
  for(const [p,q]of edgesA)for(const [u,v]of edgesB)axes.push(cross3(sub3(q,p),sub3(v,u)));
  let gap=-Infinity,overlap=Infinity;
  for(const raw of axes){if(len3(raw)<1e-10)continue;const axis=unit3(raw),A=a.points.map(p=>dot3(p,axis)),B=b.points.map(p=>dot3(p,axis));const separation=Math.max(Math.min(...A)-Math.max(...B),Math.min(...B)-Math.max(...A));gap=Math.max(gap,separation);overlap=Math.min(overlap,-separation);}
  return {gap,overlap};
}
export function pointInCell(p:V3,c:ConvexCell,tolerance=1e-7):boolean {
  const center=mul3(c.points.reduce((v,p)=>add3(v,p),[0,0,0] as V3),1/c.points.length);
  for(const face of c.faces){let n=cross3(sub3(c.points[face[1]],c.points[face[0]]),sub3(c.points[face[2]],c.points[face[0]]));if(len3(n)<1e-10)continue;n=unit3(n);if(dot3(n,sub3(center,c.points[face[0]]))>0)n=mul3(n,-1);if(dot3(n,sub3(p,c.points[face[0]]))>tolerance)return false;}
  return true;
}
/** Convex clipping of a finite segment. A nonempty interior interval proves centerline penetration. */
export function segmentCellInterval(a:V3,b:V3,c:ConvexCell):[number,number]|null {
  let lo=0,hi=1;
  const center=mul3(c.points.reduce((v,p)=>add3(v,p),[0,0,0] as V3),1/c.points.length),direction=sub3(b,a);
  for(const f of c.faces){let n=cross3(sub3(c.points[f[1]],c.points[f[0]]),sub3(c.points[f[2]],c.points[f[0]]));if(len3(n)<1e-10)continue;n=unit3(n);if(dot3(n,sub3(center,c.points[f[0]]))>0)n=mul3(n,-1);
    const distance=dot3(n,sub3(a,c.points[f[0]])),rate=dot3(n,direction);
    if(Math.abs(rate)<1e-12){if(distance>1e-9)return null;continue;}
    const t=-distance/rate;if(rate>0)hi=Math.min(hi,t);else lo=Math.max(lo,t);if(lo>hi)return null;
  }
  return [lo,hi];
}
/** Segment-to-segment distance with clamped endpoints (also handles points). */
export function segmentDistance3(p:V3,q:V3,r:V3,t:V3):number {
  const u=sub3(q,p),v=sub3(t,r),w=sub3(p,r),a=dot3(u,u),b=dot3(u,v),c=dot3(v,v),d=dot3(u,w),e=dot3(v,w),D=a*c-b*b;
  if(a<1e-20&&c<1e-20)return len3(w);
  if(a<1e-20)return len3(sub3(w,mul3(v,Math.max(0,Math.min(1,e/c)))));
  if(c<1e-20)return len3(add3(w,mul3(u,Math.max(0,Math.min(1,-d/a)))));
  let sn=D<1e-20?0:b*e-c*d,sd=D<1e-20?1:D,tn=D<1e-20?e:a*e-b*d,td=D<1e-20?c:D;
  if(sn<0){sn=0;tn=e;td=c;}else if(sn>sd){sn=sd;tn=e+b;td=c;}
  if(tn<0){tn=0;sn=Math.max(0,Math.min(a,-d));sd=a;}else if(tn>td){tn=td;sn=Math.max(0,Math.min(a,b-d));sd=a;}
  return len3(sub3(add3(w,mul3(u,sn/sd)),mul3(v,tn/td)));
}
function pointTriangleDistance(p:V3,a:V3,b:V3,c:V3):number {
  const n=cross3(sub3(b,a),sub3(c,a)),nn=dot3(n,n);
  if(nn<1e-20)return Math.min(segmentDistance3(p,p,a,b),segmentDistance3(p,p,b,c),segmentDistance3(p,p,c,a));
  const projected=sub3(p,mul3(n,dot3(sub3(p,a),n)/nn));
  if([ [a,b],[b,c],[c,a] ].every(([u,v])=>dot3(cross3(sub3(v,u),sub3(projected,u)),n)>=-1e-10))return len3(sub3(p,projected));
  return Math.min(segmentDistance3(p,p,a,b),segmentDistance3(p,p,b,c),segmentDistance3(p,p,c,a));
}
export function convexDistance(a:ConvexCell,b:ConvexCell):number {
  if(convexContact(a,b).gap<=0)return 0;
  let d=Infinity;
  for(const [x,y]of [[a,b],[b,a]])for(const p of x.points)for(const f of y.faces)for(let i=1;i<f.length-1;i++)d=Math.min(d,pointTriangleDistance(p,y.points[f[0]],y.points[f[i]],y.points[f[i+1]]));
  for(const [p,q]of cellEdges(a))for(const [r,t]of cellEdges(b))d=Math.min(d,segmentDistance3(p,q,r,t));
  return d;
}
