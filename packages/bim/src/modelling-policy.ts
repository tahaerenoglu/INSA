/** Shared, deterministic modelling policy. No adapter, scene, or persisted meshes. */
import { DomainError } from '@insa/core';
import { BimState, Element, Wall, LayeredType, thickness, wallFrame, nextId, apply } from './model.js';
import { GEOMETRY_EPSILON as E, polygonSignedArea, distance2D } from './geometry.js';
import { P2, lineParams, r } from './geo.js';
import { topologyIndex, epKey, JOIN_TOLERANCE, removeJoin } from './topology.js';
import { duplicateSignature, resolveElementRepresentation } from './engines/dispatch.js';
import { memberWorldEnds } from './engines/profile-member.js';
import { componentBox } from './family.js';

const round = (n: number) => Math.round(n / E) * E;
const key = (v: unknown): string => JSON.stringify(v);
function ring(points: P2[]): P2[] {
  const p = points.map(v => v.map(round) as P2);
  if (p.length > 1 && key(p[0]) === key(p.at(-1))) p.pop();
  return [...p.map((_, i) => [...p.slice(i), ...p.slice(0, i)]), ...p.slice().reverse().map((_, i, a) => [...a.slice(i), ...a.slice(0, i)])].sort((a,b) => key(a).localeCompare(key(b)))[0] ?? [];
}
/** Winding, ring start and reversed member direction cannot hide a physical duplicate. */
export function physicalKey(s: BimState, e: Element): string | null {
  if (duplicateSignature(s,e) === null) return null;
  const z = 'storey' in e ? s.storeys[e.storey]?.elevation ?? 0 : 0;
  if (e.kind === 'wall') return key(['wall', ring(wallFrame(s,e).footprint), round(z+e.baseOffset), round(e.height)]);
  if (e.kind === 'boundary') return key(['boundary', e.category, ring(e.outline), e.holes.map(ring).map(key).sort(), round(z+e.offset), e.slope ?? null, thickness(s.types[e.type] as LayeredType)]);
  if (e.kind === 'profile_member') {
    const ends=memberWorldEnds(s,e), profile=(s.types[e.type] as any).profile;
    const rotation=profile.shape==='circle'||profile.shape==='chs'?0:((('rotation' in e?e.rotation:0)??0)%180+180)%180;
    return key(['member', [ends.start.map(round),ends.end.map(round)].sort((a,b)=>key(a).localeCompare(key(b))),profile,rotation,e.placement==='member_axis'?'top':'center']);
  }
  const normal = (v: any, field = ''): any => {
    if (typeof v === 'number') return round(v);
    if (Array.isArray(v)) return ['outer','outline','footprint'].includes(field) ? ring(v) : v.map(x=>normal(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().filter(k=>!['ends','storey'].includes(k)).map(k=>[k,normal(v[k],k)]));
    return v;
  };
  return key([e.kind, z, normal(resolveElementRepresentation(s,e))]);
}
export interface ModellingIssue { code: 'duplicate' | 'wall_overlap' | 'component_overlap'; ids: string[]; message: string; volume?:number; }
/** Positive-area intersection of convex wall footprints; face/edge contact has zero area. */
export function footprintIntersection(a: P2[], b: P2[]): P2[] {
  let out = a.map(p=>[...p] as P2); const sign = Math.sign(polygonSignedArea(b));
  for(let i=0;i<b.length && out.length;i++) {
    const p=b[i], q=b[(i+1)%b.length]; const side=(v:P2)=>sign*((q[0]-p[0])*(v[1]-p[1])-(q[1]-p[1])*(v[0]-p[0]));
    const input=out; out=[];
    for(let j=0;j<input.length;j++) { const u=input[j],v=input[(j+1)%input.length],su=side(u),sv=side(v);
      if(su>=0)out.push(u);
      if((su>=0)!==(sv>=0)){const t=su/(su-sv);out.push([u[0]+t*(v[0]-u[0]),u[1]+t*(v[1]-u[1])]);}
    }
  }
  return out;
}
export function verticalContact(s:BimState,a:Wall,b:Wall) {
  const az=s.storeys[a.storey].elevation+a.baseOffset,bz=s.storeys[b.storey].elevation+b.baseOffset;
  return Math.min(az+a.height,bz+b.height)-Math.max(az,bz)>E;
}
export function modellingIssues(s:BimState):ModellingIssue[] {
  const issues:ModellingIssue[]=[], seen=new Map<string,string>();
  const elements=Object.values(s.elements).sort((a,b)=>a.id.localeCompare(b.id));
  // Referential/shape errors are owned by modelIssues/checkElement. A malformed
  // historical object must not prevent that report by throwing in a secondary audit.
  for(const e of elements){let k:string|null;try{k=physicalKey(s,e);}catch{continue;}if(k===null)continue;const id=seen.get(k);if(id)issues.push({code:'duplicate',ids:[id,e.id],message:'The same physical geometry occurs twice.'});else seen.set(k,e.id);}
  const frames=new Map<string,ReturnType<typeof wallFrame>>();
  const walls=elements.filter((e):e is Wall=>e.kind==='wall').filter(w=>{try{if(!s.storeys[w.storey]||!Number.isFinite(w.height)||w.height<=E)return false;const f=wallFrame(s,w);if(!f.footprint.every(p=>p.every(Number.isFinite)))return false;frames.set(w.id,f);return true;}catch{return false;}});
  for(let i=0;i<walls.length;i++)for(let j=i+1;j<walls.length;j++){
    const a=walls[i],b=walls[j];if(!verticalContact(s,a,b))continue;
    const fa=frames.get(a.id)!,fb=frames.get(b.id)!;
    // Non-parallel axis crossings are handled by the authoring topology rule.
    // Explicit unjoin remains a supported intermediate authoring operation.
    if(Math.abs(fa.dir[0]*fb.dir[1]-fa.dir[1]*fb.dir[0])>E)continue;
    const overlap=Math.abs(polygonSignedArea(footprintIntersection(fa.footprint,fb.footprint)));
    if(overlap<=E*E)continue;
    // An explicitly joined junction owns a shared cut: it is not an independent duplicate.
    if(Object.values(s.joins).some(join=>join.kind==='endpoint_endpoint'?join.members.some(m=>m.wall===a.id)&&join.members.some(m=>m.wall===b.id):[join.endpoint.wall,join.host].includes(a.id)&&[join.endpoint.wall,join.host].includes(b.id)))continue;
    const az=s.storeys[a.storey].elevation+a.baseOffset,bz=s.storeys[b.storey].elevation+b.baseOffset;
    issues.push({code:'wall_overlap',ids:[a.id,b.id],volume:overlap*(Math.min(az+a.height,bz+b.height)-Math.max(az,bz)),message:'Wall solids overlap without an explicit junction.'});
  }
  // Generic components are exact oriented boxes, not their axis-aligned bounds.
  const components=elements.filter(e=>e.kind==='component').filter(e=>{try{componentBox(s,e);return true;}catch{return false;}});
  for(let i=0;i<components.length;i++)for(let j=i+1;j<components.length;j++){
    const a=componentBox(s,components[i]),b=componentBox(s,components[j]);
    const height=Math.min(a.zTop,b.zTop)-Math.max(a.zBottom,b.zBottom);if(height<=E)continue;
    const area=Math.abs(polygonSignedArea(footprintIntersection(a.corners,b.corners)));if(area<=E*E)continue;
    issues.push({code:'component_overlap',ids:[components[i].id,components[j].id],volume:area*height,message:'Component solids interpenetrate.'});
  }
  return issues;
}
/** Legacy defects may be repaired incrementally; no command can add or enlarge a defective pair. */
export function validateModellingPolicy(after:BimState,before:BimState) {
  const old=new Map(modellingIssues(before).map(i=>[key([i.code,i.ids]),i]));
  const bad=modellingIssues(after).find(i=>{const previous=old.get(key([i.code,i.ids]));return !previous||(i.volume??0)>(previous.volume??0)+E*E*E;});
  if(bad)throw new DomainError(bad.message,'INVALID_GEOMETRY',{rule:bad.code,elementId:bad.ids[0],otherElementId:bad.ids[1]});
}
/** Resolve only unambiguous free corners within the actual wall-thickness envelope.
 * This is not a proximity snap: distant openings, parallel walls, constrained ends and
 * vertically separate walls are never connected. The result remains governed events. */
export function healWallCorners(s:BimState,focus:Set<string>) {
  const idx=topologyIndex(s),walls=Object.values(s.elements).filter((e):e is Wall=>e.kind==='wall').sort((a,b)=>a.id.localeCompare(b.id));
  const choices=new Map<string,{wall:Wall;endpoint:'start'|'end';other:string;p:P2;score:number}[]>();
  for(let i=0;i<walls.length;i++)for(let j=i+1;j<walls.length;j++){
    const a=walls[i],b=walls[j];if(a.storey!==b.storey||!verticalContact(s,a,b)||(!focus.has(a.id)&&!focus.has(b.id)))continue;
    const lp=lineParams(a.start,a.end,b.start,b.end);if(!lp)continue;
    const sine=Math.abs((a.end[0]-a.start[0])*(b.end[1]-b.start[1])-(a.end[1]-a.start[1])*(b.end[0]-b.start[0]))/(distance2D(a.start,a.end)*distance2D(b.start,b.end));if(sine<.5)continue;
    const p:P2=[r(a.start[0]+lp.tA*(a.end[0]-a.start[0])),r(a.start[1]+lp.tA*(a.end[1]-a.start[1]))];
    const ea=lp.tA<.5?'start':'end',eb=lp.tB<.5?'start':'end';
    if ([a,b].some((w,i)=>[ea,eb][i]==='start'&&Object.values(s.elements).some(e=>e.kind==='opening'&&e.host===w.id))) continue;
    if(idx.byEndpoint.has(epKey({wall:a.id,endpoint:ea}))||idx.byEndpoint.has(epKey({wall:b.id,endpoint:eb})))continue;
    const da=distance2D(a[ea],p),db=distance2D(b[eb],p);
    const ha=thickness(s.types[a.type] as LayeredType)/2,hb=thickness(s.types[b.type] as LayeredType)/2;
    if(da>Math.min(.3,hb/sine)+JOIN_TOLERANCE||db>Math.min(.3,ha/sine)+JOIN_TOLERANCE||Math.max(da,db)<=JOIN_TOLERANCE)continue;
    for(const[w,e,o]of [[a,ea,b],[b,eb,a]] as const){const k=epKey({wall:w.id,endpoint:e});if(!choices.has(k))choices.set(k,[]);choices.get(k)!.push({wall:w,endpoint:e,other:epKey({wall:o.id,endpoint:o===a?ea:eb}),p,score:da+db});}
  }
  const best=(k:string)=>choices.get(k)?.sort((a,b)=>a.score-b.score||a.other.localeCompare(b.other))[0];
  const changes=new Map<string,Record<string,unknown>>();
  for(const[k,list]of choices){const c=best(k)!;if(best(c.other)?.other!==k)continue;
    // Do not silently reparameterise an opening when a host's start is moved.
    if(c.endpoint==='start'&&Object.values(s.elements).some(e=>e.kind==='opening'&&e.host===c.wall.id))continue;
    c.wall[c.endpoint]=c.p;if(!changes.has(c.wall.id))changes.set(c.wall.id,{});changes.get(c.wall.id)![c.endpoint]=c.p;
  }
  // A branch ending at a host face joins to its host axis; the derived tee cut
  // then brings the branch BACK to that face without penetrating the host.
  for(const w of walls) for(const endpoint of ['start','end'] as const) {
    const ek=epKey({wall:w.id,endpoint});
    if(idx.byEndpoint.has(ek)||changes.get(w.id)?.[endpoint])continue;
    if(endpoint==='start'&&Object.values(s.elements).some(e=>e.kind==='opening'&&e.host===w.id))continue;
    const options:{p:P2;distance:number}[]=[];
    for(const h of walls){if(h===w||h.storey!==w.storey||!verticalContact(s,w,h)||(!focus.has(w.id)&&!focus.has(h.id)))continue;
      const lp=lineParams(w.start,w.end,h.start,h.end);if(!lp||lp.tB<=.01||lp.tB>=.99)continue;
      const p:P2=[r(w.start[0]+lp.tA*(w.end[0]-w.start[0])),r(w.start[1]+lp.tA*(w.end[1]-w.start[1]))];
      const delta=distance2D(w[endpoint],p),half=thickness(s.types[h.type] as LayeredType)/2;
      if(delta>JOIN_TOLERANCE&&delta<=Math.min(.3,half)+JOIN_TOLERANCE)options.push({p,distance:delta});
    }
    options.sort((a,b)=>a.distance-b.distance);if(!options.length||options[1]&&Math.abs(options[1].distance-options[0].distance)<=JOIN_TOLERANCE)continue;
    w[endpoint]=options[0].p;if(!changes.has(w.id))changes.set(w.id,{});changes.get(w.id)![endpoint]=options[0].p;
  }
  return [...changes].map(([id,changes])=>({id,changes}));
}

/** Conservative reconciliation of redundant DWG face-pair walls. Only equal-height,
 * single-material parallel walls are eligible. Referenced objects are never deleted. */
export function reconcileRedundantWalls(s:BimState) {
  const events:{type:string;payload:any}[]=[],removed:string[]=[],split:string[]=[];
  const emit=(type:string,payload:any)=>{const e={type,payload};apply(s,e as any);events.push(e);};
  const referenced=(id:string)=>Object.values(s.elements).some(e=>('host' in e&&e.host===id)||(e.kind==='assembly'&&e.children.includes(id)));
  // Removing a redundant wall is a topology edit, never an orphaned raw delete.
  // Surviving neighbours are rejoined by the same command factory below.
  const detach=(id:string)=>{for(const j of [...(topologyIndex(s).byWall.get(id)??[])]){
    if(!s.joins[j.id])continue;const result=removeJoin(s,{join:j.id});
    for(const e of result.joinEvents)emit(e.type,e.payload);
    for(const change of result.wallChanges)emit('ElementUpdated',change);
  }};
  for(let pass=0;pass<500;pass++){
    let repaired=false;
    for(const issue of modellingIssues(s).filter(i=>i.code==='wall_overlap')) {
      let a=s.elements[issue.ids[0]] as Wall,b=s.elements[issue.ids[1]] as Wall;
      if(a.storey!==b.storey||Math.abs(a.baseOffset-b.baseOffset)>E||Math.abs(a.height-b.height)>E)continue;
      const fa=wallFrame(s,a),fb=wallFrame(s,b);
      if(Math.abs(fa.dir[0]*fb.dir[1]-fa.dir[1]*fb.dir[0])>E)continue;
      const ta=s.types[a.type] as LayeredType,tb=s.types[b.type] as LayeredType;
      if(ta.layers.length!==1||tb.layers.length!==1||ta.layers[0].material!==tb.layers[0].material)continue;
      const d=fa.dir,n:P2=[-d[1],d[0]],dot=(p:P2,v:P2)=>p[0]*v[0]+p[1]*v[1];
      const bounds=(w:Wall)=>{const f=wallFrame(s,w).footprint;return {lo:Math.min(dot(w.start,d),dot(w.end,d)),hi:Math.max(dot(w.start,d),dot(w.end,d)),left:Math.min(...f.map(p=>dot(p,n))),right:Math.max(...f.map(p=>dot(p,n)))};};
      const A=bounds(a),B=bounds(b),contains=(u:typeof A,v:typeof A)=>u.lo<=v.lo+E&&u.hi>=v.hi-E&&u.left<=v.left+E&&u.right>=v.right-E;
      if(contains(A,B)&&!referenced(b.id)){detach(b.id);emit('ElementDeleted',{id:b.id});removed.push(b.id);repaired=true;break;}
      if(contains(B,A)&&!referenced(a.id)){detach(a.id);emit('ElementDeleted',{id:a.id});removed.push(a.id);repaired=true;break;}
      if(Math.abs(A.lo-B.lo)<=E&&Math.abs(A.hi-B.hi)<=E&&!referenced(a.id)&&!referenced(b.id)) {
        detach(a.id);detach(b.id);
        const width=r(Math.max(A.right,B.right)-Math.min(A.left,B.left)),center=(Math.max(A.right,B.right)+Math.min(A.left,B.left))/2;
        let type=Object.values(s.types).find((t):t is LayeredType=>t.kind==='wall'&&t.layers.length===1&&t.layers[0].material===ta.layers[0].material&&Math.abs(thickness(t)-width)<=E);
        if(!type){const id=nextId(s,'wall_type');type={id,kind:'wall',name:`Reconciled wall ${Math.round(width*1000)} mm · ${ta.layers[0].material}`,layers:[{...ta.layers[0],thickness:width}]};emit('TypeCreated',type);}
        const p=(x:number):P2=>[r(d[0]*x+n[0]*center),r(d[1]*x+n[1]*center)];
        emit('ElementUpdated',{id:a.id,changes:{start:p(A.lo),end:p(A.hi),type:type.id,prevDir:null,nextDir:null}});emit('ElementDeleted',{id:b.id});removed.push(b.id);repaired=true;break;
      }
      // A thicker local return can replace a subinterval of an unreferenced thin wall.
      for(const [long,short,L,S]of [[a,b,A,B],[b,a,B,A]] as const){
        if(referenced(long.id)||S.left>L.left+E||S.right<L.right-E||S.lo<=L.lo+E||S.hi>=L.hi-E)continue;
        detach(long.id);
        const original=structuredClone(long),center=(L.left+L.right)/2,p=(x:number):P2=>[r(d[0]*x+n[0]*center),r(d[1]*x+n[1]*center)];
        emit('ElementUpdated',{id:long.id,changes:{start:p(L.lo),end:p(S.lo),prevDir:null,nextDir:null}});
        const id=nextId(s,'wall');emit('ElementCreated',{...original,id,start:p(S.hi),end:p(L.hi),prevDir:null,nextDir:null});split.push(long.id);repaired=true;break;
      }
      if(repaired)break;
    }
    if(!repaired)break;
  }
  if(events.length)emit('CountersSet',{...s.counters});
  return {events,removed,split};
}
