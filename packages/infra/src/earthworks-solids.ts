/** Derived cut/fill solids. Exact planar arrangement: source TIN × grading planes.
 * No cross-section vertex lofting. Unsupported non-planar grading is rejected.
 */
import {createHash} from 'node:crypto';
import {canonicalJson} from '@insa/core';
import {point3d,type Alignment3D} from './alignment.js';
import {formationAt,earthworksSection,zoneStatus,earthworksGeometryKey,type EarthworksDesign,type EarthworkZone} from './earthworks.js';
import type {RoadCorridor} from './road.js';
import type {PreparedTerrain,TerrainResource} from './terrain.js';
import {meshVolume,isClosedOriented,sweepSolid,frames,type Mesh} from './sweep.js';
type P=[number,number];type Plane=[number,number,number];
const EPS=1e-7,area=(p:P[])=>p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-a[1]*b[0];},0)/2;
const z=(p:Plane,q:P)=>p[0]*q[0]+p[1]*q[1]+p[2];
const key=(p:number[])=>p.map(v=>Math.round(v/EPS)).join(',');
const hash=(x:unknown)=>createHash('sha256').update(canonicalJson(x)).digest('hex').slice(0,20);
function clip(poly:P[],f:(p:P)=>number):P[]{const out:P[]=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],A=f(a),B=f(b);if(A>=-1e-10)out.push(a);if(A*B<0){const t=A/(A-B);out.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}}return out.filter((p,i)=>!i||Math.hypot(p[0]-out[i-1][0],p[1]-out[i-1][1])>EPS/10);}
function plane(p:[number,number,number][]):Plane{const [a,b,c]=p,D=(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);if(Math.abs(D)<1e-12)throw Error('Degenerate grading/TIN triangle.');const x=((b[2]-a[2])*(c[1]-a[1])-(c[2]-a[2])*(b[1]-a[1]))/D,y=((b[0]-a[0])*(c[2]-a[2])-(c[0]-a[0])*(b[2]-a[2]))/D;return [x,y,a[2]-x*a[0]-y*a[1]];}
type Cell={poly:P[];ground:Plane;design:Plane;kind:'cut'|'fill';face:number};
/** Topological checks supplement the construction's non-overlap proof. */
export function validateEarthworkMesh(m:Mesh){
 if(m.positions.some(v=>!Number.isFinite(v))||!m.indices.length||m.indices.length%3||m.indices.some(v=>!Number.isInteger(v)||v<0||v>=m.positions.length/3)||!isClosedOriented(m)||meshVolume(m)<=1e-9)throw Error('INVALID_SOLID: finite coordinates, closure, winding or positive volume failed.');
 const faces=new Set<string>(),fan=new Map<number,number[]>();for(let i=0;i<m.indices.length;i+=3){const ids=m.indices.slice(i,i+3),k=ids.slice().sort((a,b)=>a-b).join(',');if(faces.has(k))throw Error('INVALID_SOLID: duplicate face.');faces.add(k);const [a,b,c]=ids.map(j=>m.positions.slice(j*3,j*3+3)),u=b.map((v,j)=>v-a[j]),v=c.map((v,j)=>v-a[j]);if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-12)throw Error('INVALID_SOLID: zero-area triangle.');for(const n of ids){const list=fan.get(n)??[];list.push(i/3);fan.set(n,list);}}
 for(const incident of fan.values()){const visited=new Set<number>(),todo=[incident[0]];while(todo.length){const f=todo.pop()!;if(visited.has(f))continue;visited.add(f);const A=m.indices.slice(f*3,f*3+3);for(const other of incident)if(!visited.has(other)&&m.indices.slice(other*3,other*3+3).filter(n=>A.includes(n)).length===2)todo.push(other);}if(visited.size!==incident.length)throw Error('INVALID_SOLID: disconnected vertex fan.');}
 return {closed:true,outward:true,positiveVolume:true,uniqueFaces:true,nondegenerate:true,manifoldVertices:true};
}
/** Independent integral of an affine height difference on a convex XY cell. */
function integral(c:Cell){let v=0;for(let i=1;i<c.poly.length-1;i++){const tri=[c.poly[0],c.poly[i],c.poly[i+1]],A=Math.abs(area(tri));v+=A*tri.reduce((s,p)=>s+Math.abs(z(c.ground,p)-z(c.design,p)),0)/3;}return v;}
export interface EarthworkSolid {id:string;design:string;zone:string;classification:'cut'|'fill';from:number;to:number;lateralExtent:number[];volume_m3:number;geometryValidity:'valid';quantityValidity:'verified';method:string;tolerance_m:number;sourceGeometryHash:string;terrainRevision:number;terrainHash:string;designRevision:number;mesh:Mesh;origin:[number,number,number];diagnostics:string[];}
/** Assemble the boundary of a disjoint planar-cell complex, including contact lines.
 * Node ALL XY cell boundaries before triangulating; avoids T-junctions at TIN edges.
 */
function assemble(cells:Cell[],origin:[number,number,number]){
 const all=new Map<string,P>();for(const c of cells)for(const p of c.poly)all.set(key(p),p);
 if(all.size>5000)throw Error('RESOURCE_LIMIT: more than 5000 arrangement vertices; split zone.');
 for(const c of cells){const noded:P[]=[];for(let i=0;i<c.poly.length;i++){const a=c.poly[i],b=c.poly[(i+1)%c.poly.length],dx=b[0]-a[0],dy=b[1]-a[1],L=dx*dx+dy*dy;if(L<EPS*EPS)continue;const pts=[...all.values()].map(p=>({p,t:((p[0]-a[0])*dx+(p[1]-a[1])*dy)/L})).filter(({p,t})=>t>=-1e-9&&t<1-1e-9&&Math.abs(dx*(p[1]-a[1])-dy*(p[0]-a[0]))<EPS*Math.sqrt(L)).sort((a,b)=>a.t-b.t);noded.push(...pts.map(v=>v.p));}c.poly=noded;}
 const edges=new Map<string,{a:P;b:P;c:Cell;count:number}>();for(const c of cells)for(let i=0;i<c.poly.length;i++){const a=c.poly[i],b=c.poly[(i+1)%c.poly.length],k=[key(a),key(b)].sort().join('|'),old=edges.get(k);if(old){old.count++;if(old.count>2)throw Error('Non-manifold XY arrangement.');}else edges.set(k,{a,b,c,count:1});}
 const mesh:Mesh={positions:[],indices:[]},vertices=new Map<string,number>();
 const vertex=(p:P,h:number)=>{const q=[p[0],p[1],h-origin[2]],k=key(q);let i=vertices.get(k);if(i===undefined){i=mesh.positions.length/3;mesh.positions.push(...q);vertices.set(k,i);}return i;};
 const tri=(a:number,b:number,c:number)=>{if(new Set([a,b,c]).size<3)return;const p=mesh.positions,u=[0,1,2].map(k=>p[3*b+k]-p[3*a+k]),v=[0,1,2].map(k=>p[3*c+k]-p[3*a+k]);if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-12)return;mesh.indices.push(a,b,c);};
 for(const c of cells){const center=c.poly.reduce((s,p)=>[s[0]+p[0]/c.poly.length,s[1]+p[1]/c.poly.length] as P,[0,0] as P),top=c.kind==='cut'?c.ground:c.design,bottom=c.kind==='cut'?c.design:c.ground,ct=vertex(center,z(top,center)),cb=vertex(center,z(bottom,center));for(let i=0;i<c.poly.length;i++){const a=c.poly[i],b=c.poly[(i+1)%c.poly.length];tri(ct,vertex(a,z(top,a)),vertex(b,z(top,b)));tri(cb,vertex(b,z(bottom,b)),vertex(a,z(bottom,a)));}}
 for(const e of edges.values())if(e.count===1){const {a,b,c}=e,top=c.kind==='cut'?c.ground:c.design,bottom=c.kind==='cut'?c.design:c.ground,A=vertex(a,z(top,a)),B=vertex(b,z(top,b)),C=vertex(a,z(bottom,a)),D=vertex(b,z(bottom,b));tri(A,C,D);tri(A,D,B);}
 // Face components are connected by shared edges, not mere contact vertices.
 const edgeFaces=new Map<string,number[]>(),adj=Array.from({length:mesh.indices.length/3},()=>new Set<number>());
 for(let f=0;f<adj.length;f++)for(let j=0;j<3;j++){const k=[mesh.indices[f*3+j],mesh.indices[f*3+(j+1)%3]].sort((a,b)=>a-b).join(',');const list=edgeFaces.get(k)??[];list.push(f);edgeFaces.set(k,list);}
 for(const faces of edgeFaces.values()){if(faces.length!==2)throw Error('INVALID_SOLID: unmatched or non-manifold mesh edge.');adj[faces[0]].add(faces[1]);adj[faces[1]].add(faces[0]);}
 const result:Mesh[]=[],seen=new Set<number>();for(let f=0;f<adj.length;f++)if(!seen.has(f)){const stack=[f],ids:number[]=[];while(stack.length){const t=stack.pop()!;if(seen.has(t))continue;seen.add(t);ids.push(...mesh.indices.slice(t*3,t*3+3));stack.push(...adj[t]);}const used=[...new Set(ids)],map=new Map(used.map((n,i)=>[n,i])),m={positions:used.flatMap(i=>mesh.positions.slice(i*3,i*3+3)),indices:ids.map(i=>map.get(i)!)};
  if(!isClosedOriented(m)||meshVolume(m)<=1e-9)throw Error('INVALID_SOLID: closure, winding or positive volume failed.');
  // A closed orientable manifold must also have a connected face fan at each vertex.
  for(let v=0;v<used.length;v++){const incident=m.indices.flatMap((n,i)=>n===v?[Math.floor(i/3)]:[]),vis=new Set<number>(),todo=[incident[0]];while(todo.length){const t=todo.pop()!;if(vis.has(t))continue;vis.add(t);const T=m.indices.slice(t*3,t*3+3);for(const other of incident)if(!vis.has(other)&&m.indices.slice(other*3,other*3+3).filter(n=>T.includes(n)).length===2)todo.push(other);}if(vis.size!==incident.length)throw Error('INVALID_SOLID: disconnected vertex fan.');}
  const faces=new Set<string>();for(let i=0;i<m.indices.length;i+=3){const k=m.indices.slice(i,i+3).sort((a,b)=>a-b).join(',');if(faces.has(k))throw Error('INVALID_SOLID: duplicate triangle.');faces.add(k);}result.push(m);
 }return result;
}
export function earthworkZoneSolids(d:EarthworksDesign,r:RoadCorridor,a:Alignment3D,t:TerrainResource,terrain:PreparedTerrain,zone:EarthworkZone,sourceHash?:string){
 const started=performance.now(),signature=sourceHash??earthworksGeometryKey(d,r,a,t),base={zone:zone.id,design:d.id,from:zone.from,to:zone.to,sourceGeometryHash:signature,terrainRevision:t.revision,terrainHash:t.sourceHash,designRevision:d.revision,method:'original-TIN / planar-grading XY arrangement + closed boundary / local tetrahedra; independent affine integral',tolerance_m:EPS};
 try{
  const status=zoneStatus(zone,d,signature);if(status.reconciliation!=='current')throw Error(`STALE_ZONE: ${status.reconciliation}`);
  if(zone.side!=='both')throw Error('UNSUPPORTED_SIDE: solid zones currently require both sides.');
  if(zone.to-zone.from>1000||terrain.indices.length/3>10000)throw Error('RESOURCE_LIMIT: zone ≤1000 m, TIN ≤10000 triangles.');
  const h=a.h.filter(h=>h.s0<zone.to-1e-8&&h.s0+h.length>zone.from+1e-8);if(h.some(h=>h.kind!=='line'))return circularSolids(d,r,a,t,terrain,zone,base,started);if(h.some(element=>Math.abs(element.az0-h[0].az0)>1e-9))throw Error('UNSUPPORTED_HEADING: split zone at alignment corners.');
  if(a.v.some(v=>v.curve))throw Error('UNSUPPORTED_VERTICAL_CURVE: split into certified linear grades.');
  const q=point3d(a,zone.from),origin:[number,number,number]=[q.x,q.y,q.z],C=Math.cos(q.az),S=Math.sin(q.az),local=(x:number,y:number):P=>[(x-q.x)*C+(y-q.y)*S,(x-q.x)*S-(y-q.y)*C];
  // Local XY uses station-distance and LEFT, preserving positive orientation.
  const localLeft=(p:P):P=>[p[0],-p[1]];
  const faces=Array.from({length:terrain.indices.length/3},(_,f)=>{const pts=terrain.indices.slice(f*3,f*3+3).map(i=>{const p=terrain.positions.slice(3*i,3*i+3),xy=localLeft(local(p[0],p[1]));return [...xy,p[2]] as [number,number,number];});return {poly:pts.map(p=>[p[0],p[1]] as P),plane:plane(pts),face:terrain.faceSources[f]};});
  const events=new Set([zone.from,zone.to,...d.sections.map(s=>s.station).filter(s=>s>zone.from&&s<zone.to),...a.v.map(s=>s.station).filter(s=>s>zone.from&&s<zone.to)]),allCells:Cell[]=[];
  const cross=(station:number)=>earthworksSection(d,r,a,t,terrain,station);
  // All terrain-edge crossings of formation center/edges are station events.
  const controls=[...events].sort((a,b)=>a-b);for(let i=1;i<controls.length;i++){const sa=controls[i-1],sb=controls[i],A=formationAt(d,sa),B=formationAt(d,sb);if(['leftSlope','rightSlope'].some(k=>Math.abs((A as any)[k]-(B as any)[k])>1e-10))throw Error('UNSUPPORTED_WARP: changing crossfall creates non-planar grading; split at constant-slope controls.');
   const offsets=(p:typeof A)=>[p.centerOffset-p.leftWidth,p.centerOffset,p.centerOffset+p.rightWidth];
   for(let role=0;role<3;role++){const ax=sa-zone.from,ay=-offsets(A)[role],dx=sb-sa,dy=-offsets(B)[role]-ay;
    for(const f of faces)for(let j=0;j<3;j++){const p=f.poly[j],q=f.poly[(j+1)%3],ex=q[0]-p[0],ey=q[1]-p[1],D=dx*ey-dy*ex;if(Math.abs(D)<1e-12)continue;const t=((p[0]-ax)*ey-(p[1]-ay)*ex)/D,u=((p[0]-ax)*dy-(p[1]-ay)*dx)/D;if(t>EPS/dx&&t<1-EPS/dx&&u>=-1e-9&&u<=1+1e-9)events.add(sa+t*dx);}
   }
  }
  // Add exact sign transitions at formation edges / center, within linear intervals.
  let breaks=[...events].sort((a,b)=>a-b);for(let i=1;i<breaks.length;i++){const A=cross(breaks[i-1]),B=cross(breaks[i]);for(let j=0;j<3;j++){const ground=(s:typeof A)=>{const p=s.formation[j];const seg=s.comparison.ground.segments.find(g=>p.offset_m>=g.from-EPS&&p.offset_m<=g.to+EPS);return seg?seg.zFrom+(p.offset_m-seg.from)/(seg.to-seg.from)*(seg.zTo-seg.zFrom):null;},ga=ground(A),gb=ground(B);if(ga===null||gb===null)throw Error('INCOMPLETE_TERRAIN: no terrain at formation edge.');const da=A.formation[j].elevation_m-ga,db=B.formation[j].elevation_m-gb;if(da*db<0)events.add(breaks[i-1]+(breaks[i]-breaks[i-1])*da/(da-db));}}
  breaks=[...events].sort((a,b)=>a-b);if(breaks.length*faces.length>200000)throw Error('RESOURCE_LIMIT: arrangement candidate budget exceeded; split zone or TIN.');if(breaks.length>256)throw Error('RESOURCE_LIMIT: more than 256 engineering intervals.');
  for(let i=1;i<breaks.length;i++){
   const sa=breaks[i-1],sb=breaks[i];if(sb-sa<EPS)continue;const mid=cross((sa+sb)/2),A=cross(sa),B=cross(sb);
   for(const s of [A,mid,B])if(s.areas.status!=='complete-cross-section'||s.sides.some(v=>v.candidates.length>1||v.status==='ambiguous'))throw Error('INCOMPLETE_DAYLIGHT: missing/ambiguous terrain intersection; no partial quantity accepted.');
   const patches:{poly:P[];plane:Plane;side?:number}[]=[];
   const make=(lo:number,hi:number,ha:number,hb:number,fall:number,loB=lo,hiB=hi)=>{const x0=sa-zone.from,x1=sb-zone.from,p:[[number,number,number],[number,number,number],[number,number,number]]=[[x0,-lo,ha],[x1,-loB,hb],[x0,-hi,ha+fall*(hi-lo)]];return {poly:[[x0,-hi],[x1,-hiB],[x1,-loB],[x0,-lo]] as P[],plane:plane(p)};};
   for(let j=0;j<2;j++)patches.push(make(A.formation[j].offset_m,A.formation[j+1].offset_m,A.formation[j].elevation_m,B.formation[j].elevation_m,(A.formation[j+1].elevation_m-A.formation[j].elevation_m)/(A.formation[j+1].offset_m-A.formation[j].offset_m),B.formation[j].offset_m,B.formation[j+1].offset_m));
   for(const side of [0,1]){const p=mid.sides[side],index=side===0?0:2,sign=side===0?-1:1,edge=A.formation[index].offset_m,fall=sign*(p.classification==='cut'?1:-1)/(p.ratioH??d.slopes[side===0?'left':'right'].fillH),lo=side===0?edge-d.searchLimit:edge,hi=side===0?edge:edge+d.searchLimit,pa=make(lo,hi,A.formation[index].elevation_m+fall*(lo-edge),B.formation[index].elevation_m+fall*(lo-edge),fall,lo+B.formation[index].offset_m-edge,hi+B.formation[index].offset_m-edge);patches.push({...pa,side});}
   for(const patch of patches){let covered=0;const patchArea=Math.abs(area(patch.poly));for(const f of faces){let poly=f.poly;for(let j=0;j<4&&poly.length;j++){const p=patch.poly[j],q=patch.poly[(j+1)%4];poly=clip(poly,x=>(q[0]-p[0])*(x[1]-p[1])-(q[1]-p[1])*(x[0]-p[0]));}if(poly.length<3||Math.abs(area(poly))<1e-10)continue;covered+=Math.abs(area(poly));
     for(const kind of ['cut','fill'] as const){if(patch.side!==undefined&&mid.sides[patch.side].classification!==kind)continue;const sign=kind==='fill'?1:-1,part=clip(poly,p=>sign*(z(patch.plane,p)-z(f.plane,p)));if(part.length<3||Math.abs(area(part))<1e-10)continue;const cell={poly:part,ground:f.plane,design:patch.plane,kind,face:f.face};if(integral(cell)<1e-10)continue;
      if(patch.side!==undefined){const far=patch.side===0?A.formation[0].offset_m-d.searchLimit:A.formation[2].offset_m+d.searchLimit;if(part.some(p=>Math.abs(p[1]+far+(B.formation[patch.side===0?0:2].offset_m-A.formation[patch.side===0?0:2].offset_m)*(p[0]-(sa-zone.from))/(sb-sa))<EPS&&Math.abs(z(patch.plane,p)-z(f.plane,p))>EPS))throw Error('INCOMPLETE_DAYLIGHT: grading reaches search limit.');}
      allCells.push(cell);
     }
    }
    // Entire formation footprint needs source coverage. Side patches extend past daylight;
    // require full search strip coverage as a conservative, explicit support constraint.
    if(Math.abs(covered-patchArea)>Math.max(1e-5,patchArea*1e-9))throw Error('INCOMPLETE_TERRAIN: TIN hole/outside coverage in grading search strip.');
   }
  }
  if(allCells.length>2500)throw Error('RESOURCE_LIMIT: more than 2500 clipped grading cells.');
  // Prove side topology at every arrangement vertex event (not dense sampling).
  const stations=[...new Set(allCells.flatMap(c=>c.poly.map(p=>p[0]+zone.from)))].sort((a,b)=>a-b);for(let i=0;i<stations.length;i++){for(const s of [stations[i],...(i?[.5*(stations[i-1]+stations[i])]:[])]){const section=cross(Math.max(zone.from,Math.min(zone.to,s)));if(section.areas.status!=='complete-cross-section'||section.sides.some(v=>v.candidates.length>1||v.status==='ambiguous'))throw Error('UNSUPPORTED_TOPOLOGY: multiple roots or missing coverage at exact arrangement event.');}}
  const solids:EarthworkSolid[]=[];for(const kind of ['cut','fill'] as const){const cells=allCells.filter(c=>c.kind===kind);if(!cells.length)continue;const meshes=assemble(cells,origin),integrated=cells.reduce((s,c)=>s+integral(c),0),measured=meshes.reduce((s,m)=>s+meshVolume(m),0);if(Math.abs(integrated-measured)>Math.max(1e-6,integrated*1e-8))throw Error('INVALID_QUANTITY: independent affine integral disagrees with tetrahedral volume.');
   for(const mesh of meshes){const xs=mesh.positions.filter((_,i)=>i%3===0),ys=mesh.positions.filter((_,i)=>i%3===1),bounds=[Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)],id=`${zone.id}:${kind}:${hash([signature,bounds.map(v=>Number(v.toFixed(5)))])}`;solids.push({...base,id,classification:kind,from:zone.from+bounds[0],to:zone.from+bounds[1],lateralExtent:[-bounds[3],-bounds[2]],volume_m3:meshVolume(mesh),geometryValidity:'valid',quantityValidity:'verified',mesh:{positions:mesh.positions.flatMap((_,i,arr)=>i%3===0?[arr[i]*C-arr[i+1]*S,arr[i]*S+arr[i+1]*C,arr[i+2]]:[]),indices:mesh.indices},origin,diagnostics:['Closed oriented edge pairs, connected vertex fans, unique nondegenerate faces, positive volume; disjoint XY arrangement and ordered height fields prevent self/inter-solid overlap.']});}
  }
  return {...base,status:'verified' as const,classification:solids.some(s=>s.classification==='cut')&&solids.some(s=>s.classification==='fill')?'mixed':solids[0]?.classification??'at-grade',cut_m3:solids.filter(s=>s.classification==='cut').reduce((v,s)=>v+s.volume_m3,0),fill_m3:solids.filter(s=>s.classification==='fill').reduce((v,s)=>v+s.volume_m3,0),solids,diagnostics:[],metrics:{generationMs:performance.now()-started,cells:allCells.length,triangles:solids.reduce((v,s)=>v+s.mesh.indices.length/3,0),vertices:solids.reduce((v,s)=>v+s.mesh.positions.length/3,0)}};
 }catch(e){return {...base,status:'incomplete' as const,classification:'unknown',cut_m3:null,fill_m3:null,solids:[] as EarthworkSolid[],diagnostics:[(e as Error).message],metrics:{generationMs:performance.now()-started,cells:0,triangles:0,vertices:0}};}
}
/** Certified bounded family: one circular arc, level terrain and constant section.
 * Independent sector/Jacobian integral controls mesh convergence. Nonplanar TIN
 * on a curved alignment is deliberately rejected rather than sampled as exact.
 */
function circularSolids(d:EarthworksDesign,r:RoadCorridor,a:Alignment3D,t:TerrainResource,terrain:PreparedTerrain,zone:EarthworkZone,base:any,started:number):any{
 const hs=a.h.filter(h=>h.s0<zone.to-EPS&&h.s0+h.length>zone.from+EPS);
 if(hs.length!==1||hs[0].kind!=='arc'||Math.abs(hs[0].k0-hs[0].k1)>1e-12)throw Error('UNSUPPORTED_CURVATURE: circular constant-section family only; clothoids/transitions rejected.');
 const A=formationAt(d,zone.from),B=formationAt(d,zone.to),k=hs[0].k0,L=zone.to-zone.from;
 if(d.sections.some(s=>s.station>zone.from&&s.station<zone.to)||Object.keys(A).filter(k=>k!=='station').some(key=>Math.abs((A as any)[key]-(B as any)[key])>1e-10)||a.v.some(p=>p.curve)||Math.abs(point3d(a,zone.from).z-point3d(a,zone.to).z)>EPS||Math.abs(k*L)>Math.PI)throw Error('UNSUPPORTED_CURVE_GRADING: require constant formation and level vertical alignment, arc ≤180 degrees.');
 const z0=terrain.positions[2];if(terrain.positions.some((p,i)=>i%3===2&&Math.abs(p-z0)>EPS))throw Error('UNSUPPORTED_CURVED_TIN: only flat validated TIN certified for circular solids.');
 const sec=earthworksSection(d,r,a,t,terrain,(zone.from+zone.to)/2);if(sec.areas.status!=='complete-cross-section')throw Error('INCOMPLETE_DAYLIGHT: curved cross-section has no valid ground.');
 const extent=Math.max(...sec.sides.map(s=>Math.abs(s.point!.offset_m)));if(Math.abs(k)*extent>.5)throw Error('UNSUPPORTED_FOLD: offset/curvature Jacobian too small.');
 const origin=sec.section.centerline_xyz as [number,number,number],solids:EarthworkSolid[]=[];
 // Full bounding rectangle coverage is conservative but proves no hole beneath
 // the exact arc, including its chord-error envelope; no invented source ground.
 const samples=Array.from({length:257},(_,i)=>{const q=point3d(a,zone.from+L*i/256);return [q.x,q.y];}),margin=extent+Math.abs(k)*(L/256)**2;
 const x0=Math.min(...samples.map(p=>p[0]))-margin,x1=Math.max(...samples.map(p=>p[0]))+margin,y0=Math.min(...samples.map(p=>p[1]))-margin,y1=Math.max(...samples.map(p=>p[1]))+margin;
 let covered=0;for(let f=0;f<terrain.indices.length;f+=3){let p=terrain.indices.slice(f,f+3).map(i=>[terrain.positions[3*i]-x0,terrain.positions[3*i+1]-y0] as P);for(const fn of [(p:P)=>p[0],(p:P)=>x1-x0-p[0],(p:P)=>p[1],(p:P)=>y1-y0-p[1]])p=clip(p,fn);if(p.length>2)covered+=Math.abs(area(p));}if(Math.abs(covered-(x1-x0)*(y1-y0))>1e-5)throw Error('INCOMPLETE_TERRAIN: circular envelope not fully covered by original TIN.');
 let largestError=0;
 for(const kind of ['cut','fill'] as const){const regions=sec.regions.filter(p=>p.classification===kind).sort((a,b)=>a.from-b.from),groups:typeof regions[]=[];for(const p of regions){const g=groups.at(-1);if(g&&Math.abs(g.at(-1)!.to-p.from)<EPS)g.push(p);else groups.push([p]);}
  for(const group of groups){let reference=0;for(const reg of group){const lo=reg.from,hi=reg.to,h0=Math.abs(reg.design[0].elevation_m-reg.ground[0].elevation_m),h1=Math.abs(reg.design[1].elevation_m-reg.ground[1].elevation_m),m=(h1-h0)/(hi-lo),c=h0-m*lo;reference+=L*(reg.area_m2+k*(m*(hi**3-lo**3)/3+c*(hi**2-lo**2)/2));}
   const line=[group[0].design[0],...group.map(g=>g.design[1])],ring:P[]=[...line.map(p=>[p.offset_m,p.elevation_m-origin[2]] as P),[group.at(-1)!.to,z0-origin[2]] as P,[group[0].from,z0-origin[2]] as P].filter((p,i,arr)=>!i||Math.hypot(p[0]-arr[i-1][0],p[1]-arr[i-1][1])>EPS);
   if(Math.hypot(ring[0][0]-ring.at(-1)![0],ring[0][1]-ring.at(-1)![1])<EPS)ring.pop();if(area(ring)<0)ring.reverse();
   let n=16,mesh:Mesh,err:number;do{const stations=Array.from({length:n+1},(_,i)=>zone.from+L*i/n);mesh=sweepSolid(frames(a,stations,origin),ring);err=Math.abs(meshVolume(mesh)-reference);if(err<=Math.max(1e-5,reference*1e-6))break;n*=2;}while(n<=2048);
   if(err!>Math.max(1e-5,reference*1e-6)||!isClosedOriented(mesh!)||meshVolume(mesh!)<=0)throw Error('INVALID_CURVED_SOLID: sector convergence/closure failed.');
   validateEarthworkMesh(mesh!);largestError=Math.max(largestError,err!);solids.push({...base,id:`${zone.id}:${kind}:${hash([base.sourceGeometryHash,group[0].from,group.at(-1)!.to])}`,classification:kind,from:zone.from,to:zone.to,lateralExtent:[group[0].from,group.at(-1)!.to],volume_m3:meshVolume(mesh!),geometryValidity:'valid',quantityValidity:'verified',method:'circular sweep; independent integral L∫h(u)(1+k*u)du; relative volume error ≤1e-6',tolerance_m:Math.abs(1/k)*(1-Math.cos(k*L/n/2)),mesh:mesh!,origin,diagnostics:[`Independent curved-sector volume ${reference}; absolute mesh error ${err!} m3; ${n} arc intervals.`, 'Flat source TIN envelope fully covered; injective circular offsets and simple section guarantee non-self-intersection.']});
  }
 }
 return {...base,status:'verified',classification:solids.some(s=>s.classification==='cut')&&solids.some(s=>s.classification==='fill')?'mixed':solids[0]?.classification??'at-grade',cut_m3:solids.filter(s=>s.classification==='cut').reduce((v,s)=>v+s.volume_m3,0),fill_m3:solids.filter(s=>s.classification==='fill').reduce((v,s)=>v+s.volume_m3,0),solids,diagnostics:[`Circular family numerical approximation; maximum independent volume error ${largestError} m3.`],metrics:{generationMs:performance.now()-started,cells:0,triangles:solids.reduce((v,s)=>v+s.mesh.indices.length/3,0),vertices:solids.reduce((v,s)=>v+s.mesh.positions.length/3,0)}};
}

/** All-or-nothing totals: overlapping/stale/incomplete zones never masquerade as zero. */
export function earthworksSolidResults(d:EarthworksDesign,r:RoadCorridor,a:Alignment3D,t:TerrainResource,p:PreparedTerrain,zones:EarthworkZone[],signature:string){
 const sorted=zones.filter(z=>z.design===d.id).sort((a,b)=>a.from-b.from||a.id.localeCompare(b.id)),overlap=sorted.some((z,i)=>i>0&&z.from<sorted[i-1].to-EPS);
 const results=sorted.map(z=>earthworkZoneSolids(d,r,a,t,p,z,signature)),valid=!overlap&&results.length>0&&results.every(q=>q.status==='verified');
 return {status:valid?'verified':'incomplete',zones:results,cut_m3:valid?results.reduce((s,q)=>s+q.cut_m3!,0):null,fill_m3:valid?results.reduce((s,q)=>s+q.fill_m3!,0):null,coverage:sorted.map(z=>[z.from,z.to]),coverageStatus:sorted.length&&Math.abs(sorted[0].from-d.from)<EPS&&Math.abs(sorted.at(-1)!.to-d.to)<EPS&&sorted.every((z,i)=>!i||Math.abs(z.from-sorted[i-1].to)<EPS)?'full-design':'selected-partial-ranges',diagnostics:overlap?['OVERLAPPING_ZONES: zone totals cannot be added.']:results.length?[]:['No engineering zones.'],componentIdentity:'Derived IDs include engineering source signature and component domain; source/topology edits invalidate component selection. Zone IDs remain unchanged; no automatic correspondence is asserted.'};
}
