/** Spatially indexed broad phase + exact polyhedral narrow phase; all relationships are derived from existing state. */
import { createHash } from 'node:crypto';
import { DomainError } from '@insa/core';
import type { BimState, Element, ConnectorRef } from './model.js';
import { modelIssues } from './invariants.js';
import { categoryIdOfElement, findCategory } from './taxonomy.js';
import { physicalKey } from './modelling-policy.js';
import { memberWorldEnds } from './engines/profile-member.js';
import { connectorsOf, junctionProblem, mepNetwork, routeWorld, crossSection } from './mep.js';
import { bounds3, convexContact, convexDistance, elementSolid, pointInCell, segmentCellInterval, type Bounds3, type ConvexCell, type V3 } from './solid-geometry.js';
import { wallRoof } from './wall-roof.js';
import { pointInPolygon } from './geometry.js';
import { wallFrame } from './model.js';
export type CoordinationKind='HardClash'|'ClearanceClash'|'ExpectedStructuralIntersection'|'MissingConnection'|'DisconnectedSystem'|'InvalidHostRelationship'|'DuplicateOverlappingElement'|'InvalidPenetration';
export type SafeRepair={tool:'bim_connect_mep'|'bim_attach_walls_to_roof'|'bim_join_walls';input:Record<string,unknown>};
export interface CoordinationIssue {
  id:string;elements:string[];disciplines:string[];kind:CoordinationKind;position:V3;region?:Bounds3;
  severity:'info'|'warning'|'error';tolerance:number;message:string;suggestedFix:string;
  autoRepairable:boolean;repair?:SafeRepair;verification:'detected'|'requires_design';geometry:'exact-polyhedron'|'centerline-solid-proof'|'connectivity'|'domain-validation';
}
export interface CoordinationOptions {ids?:string[];tolerance?:number;clearance?:number;includeExpected?:boolean;}
type Record3={id:string;element:Element;cells:ConvexCell[];bounds:Bounds3;route?:V3[]};
const center=(b:Bounds3):V3=>b.min.map((v,i)=>(v+b.max[i])/2) as V3;
function expectedJoint(s:BimState,a:Record3,b:Record3,tol:number):boolean {
  const x=a.element,y=b.element;
  if(x.kind==='wall'&&x.topRoof===y.id||y.kind==='wall'&&y.topRoof===x.id)return true;
  if(x.kind==='wall'&&y.kind==='wall')return Object.values(s.joins).some(j=>j.kind==='endpoint_endpoint'?j.members.some(m=>m.wall===x.id)&&j.members.some(m=>m.wall===y.id):[j.endpoint.wall,j.host].includes(x.id)&&[j.endpoint.wall,j.host].includes(y.id));
  for(const [wall,other]of [[a,b],[b,a]])if(wall.element.kind==='wall'){
    if(other.element.kind==='profile_member') {
      const ends=memberWorldEnds(s,other.element);if([ends.start,ends.end].some(p=>wall.cells.some(c=>pointInCell(p,c,tol))))return true;
      // Existing IFC ownership trims infill walls against beams at their head, but not arbitrary mid-height crossings.
      if(other.element.placement==='member_axis'&&wall.bounds.max[2]>=other.bounds.min[2]-tol&&wall.bounds.max[2]<=other.bounds.max[2]+tol&&[ends.start,ends.end].some(p=>pointInPolygon([p[0],p[1]],wallFrame(s,wall.element as any).footprint)!=='outside'))return true;
    }
    if(other.element.kind==='boundary'&&findCategory(other.element.category)?.discipline==='structure')
      if([wall.bounds.min[2],wall.bounds.max[2]].some(z=>z>=other.bounds.min[2]-tol&&z<=other.bounds.max[2]+tol))return true;
  }
  const sx=findCategory(categoryIdOfElement(s,x)??'')?.discipline==='structure',sy=findCategory(categoryIdOfElement(s,y)??'')?.discipline==='structure';
  if(!sx||!sy)return false;
  for(const [member,target]of [[a,b],[b,a]])if(member.element.kind==='profile_member'){
    const ends=memberWorldEnds(s,member.element);
    if([ends.start,ends.end].some(p=>target.cells.some(c=>pointInCell(p,c,tol))))return true;
  }
  // A shear wall resting on / terminating at a structural floor or footing is an expected geometric interface.
  for(const [wall,boundary]of [[a,b],[b,a]])if(wall.element.kind==='wall'&&boundary.element.kind==='boundary'){
    return [wall.bounds.min[2],wall.bounds.max[2]].some(z=>z>=boundary.bounds.min[2]-tol&&z<=boundary.bounds.max[2]+tol);
  }
  return false;
}
export function coordinateModel(s:BimState,options:CoordinationOptions={}) {
  const tolerance=options.tolerance??1e-4,clearance=options.clearance??0;
  if(!Number.isFinite(tolerance)||tolerance<=0||tolerance>.01||!Number.isFinite(clearance)||clearance<0||clearance>10)throw new DomainError('Invalid coordination tolerance/clearance.','INVALID_INPUT');
  const selected=options.ids?new Set(options.ids):undefined,issues:CoordinationIssue[]=[],issueIds=new Set<string>(),unsupported:{id:string;reason:string}[]=[],records:Record3[]=[];
  const touched=(ids:string[])=>!selected||ids.some(id=>selected.has(id));
  const discipline=(id:string)=>{const e=s.elements[id];return e?findCategory(categoryIdOfElement(s,e)??'')?.discipline??'unknown':'unknown';};
  const emit=(kind:CoordinationKind,ids:string[],position:V3,message:string,repair?:SafeRepair,region?:Bounds3,geometry:CoordinationIssue['geometry']='exact-polyhedron')=>{
    if(!touched(ids))return;
    const elements=[...ids].sort(),id='CL-'+createHash('sha256').update(JSON.stringify([kind,elements,repair?.input??null])).digest('hex').slice(0,16);
    if(issueIds.has(id))return;issueIds.add(id);
    issues.push({id,elements,disciplines:[...new Set(ids.map(discipline))],kind,position,region,severity:kind==='ExpectedStructuralIntersection'?'info':kind==='ClearanceClash'||kind==='DisconnectedSystem'?'warning':'error',tolerance,message,
      suggestedFix:repair?'Preview the unique repair through model.repair; existing approval/undo rules apply.':'Review geometry and design intent; no automatic geometry deletion or structural penetration.',autoRepairable:!!repair,repair,verification:repair?'detected':'requires_design',geometry});
  };
  const openingHosts=new Set(Object.values(s.elements).filter(e=>e.kind==='opening').map(e=>(e as any).host as string));
  const duplicate=new Map<string,string>();
  for(const e of Object.values(s.elements)) {
    try {
      const solid=elementSolid(s,e,openingHosts);
      // Authoring height is not the physical wall height once a live roof clips it.
      const key=e.kind==='wall'?(solid.cells.length?JSON.stringify(['wall-solid',solid.cells.map(c=>c.points.map(p=>p.map(v=>Math.round(v/tolerance))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]):null):physicalKey(s,e),prior=key?duplicate.get(key):undefined;
      if(prior)emit('DuplicateOverlappingElement',[prior,e.id],[0,0,s.storeys[e.storey]?.elevation??0],'Duplicate physical representation; referenced identities are preserved.');else if(key)duplicate.set(key,e.id);
      if(solid.cells.length)records.push({id:e.id,element:e,cells:solid.cells,bounds:bounds3(solid.cells.flatMap(c=>c.points))});
      else if(e.kind==='mep_segment'){
        const route=routeWorld(s,e),section=crossSection(s.types[e.type])!,radius=section.shape==='round'?section.diameter!/2:Math.hypot(section.width!,section.height!)/2,bounds=bounds3(route);
        records.push({id:e.id,element:e,cells:[],route,bounds:{min:bounds.min.map(v=>v-radius) as V3,max:bounds.max.map(v=>v+radius) as V3}});
      }
      else if(solid.unsupported&&!['opening','hosted_component','spatial','assembly','reinforcement','mep_segment','mep_fitting'].includes(e.kind))unsupported.push({id:e.id,reason:solid.unsupported});
    } catch(error){if(!(error instanceof DomainError))throw error;unsupported.push({id:e.id,reason:error.message});}
  }
  // Sweep-and-prune interval index. Narrow-phase work is local, including incremental changed-ID requests.
  records.sort((a,b)=>a.bounds.min[0]-b.bounds.min[0]||a.id.localeCompare(b.id));
  let active:Record3[]=[],broadCandidates=0,narrowPairs=0;
  for(const b of records){active=active.filter(a=>a.bounds.max[0]+clearance+tolerance>=b.bounds.min[0]);
    for(const a of active){if(!touched([a.id,b.id]))continue;
      if([1,2].some(i=>a.bounds.max[i]+clearance+tolerance<b.bounds.min[i]||b.bounds.max[i]+clearance+tolerance<a.bounds.min[i]))continue;
      broadCandidates++;
      if(a.route||b.route){
        if(a.route&&b.route)continue;
        const line=a.route?a:b,solid=a.route?b:a;
        let penetrates=false;
        for(let i=1;i<line.route!.length;i++)for(const cell of solid.cells){narrowPairs++;const start=line.route![i-1],end=line.route![i],interval=segmentCellInterval(start,end,cell),length=Math.hypot(...end.map((v,k)=>v-start[k]));if(interval&&(interval[1]-interval[0])*length>tolerance)penetrates=true;}
        const connectedEquipment=solid.element.kind==='component'&&Object.values(s.mepJunctions).some(j=>j.members.some(m=>m.element===line.id)&&j.members.some(m=>m.element===solid.id));
        if(penetrates&&!connectedEquipment)emit(solid.element.kind==='wall'||findCategory(categoryIdOfElement(s,solid.element)??'')?.discipline==='structure'?'InvalidPenetration':'HardClash',[a.id,b.id],center(solid.bounds),'A finite route centerline intersects the real solid; no automatic penetration is authorized.',undefined,solid.bounds,'centerline-solid-proof');
        continue;
      }
      let intersects=false,contact=false,distance=Infinity;
      for(const x of a.cells)for(const y of b.cells){narrowPairs++;const result=convexContact(x,y);if(result.overlap>tolerance)intersects=true;if(result.gap<=tolerance)contact=true;if(clearance&&result.gap<=clearance+tolerance)distance=Math.min(distance,convexDistance(x,y));}
      const region={min:a.bounds.min.map((v,i)=>Math.max(v,b.bounds.min[i])) as V3,max:a.bounds.max.map((v,i)=>Math.min(v,b.bounds.max[i])) as V3};
      const position=center({min:a.bounds.min.map((v,i)=>Math.min(v,b.bounds.min[i])) as V3,max:a.bounds.max.map((v,i)=>Math.max(v,b.bounds.max[i])) as V3});
      if((intersects||contact)&&expectedJoint(s,a,b,tolerance)){if(options.includeExpected!==false)emit('ExpectedStructuralIntersection',[a.id,b.id],position,'Expected geometric support/joint; this is not structural adequacy verification.',undefined,region);}
      else if(intersects)emit('HardClash',[a.id,b.id],position,'Positive-volume intersection confirmed by convex-cell separating axes.',undefined,region);
      else if(contact&&a.element.kind==='wall'&&b.element.kind==='wall'){
        const x=a.element,y=b.element,pairs=[];
        for(const ea of ['start','end'] as const)for(const eb of ['start','end'] as const)if(Math.hypot(x[ea][0]-y[eb][0],x[ea][1]-y[eb][1])<=tolerance)pairs.push([{wall:x.id,endpoint:ea},{wall:y.id,endpoint:eb}]);
        if(pairs.length===1){
          const endpoints=pairs[0],point=x[endpoints[0].endpoint];
          const ambiguous=Object.values(s.elements).some(e=>e.kind==='wall'&&e.id!==x.id&&e.id!==y.id&&e.storey===x.storey&&[e.start,e.end].some(p=>Math.hypot(p[0]-point[0],p[1]-point[1])<=tolerance));
          const used=Object.values(s.joins).some(j=>endpoints.some(e=>j.kind==='endpoint_endpoint'?j.members.some(m=>m.wall===e.wall&&m.endpoint===e.endpoint):j.endpoint.wall===e.wall&&j.endpoint.endpoint===e.endpoint));
          emit('MissingConnection',[x.id,y.id],position,'Coincident wall endpoints lack an explicit join.',!ambiguous&&!used?{tool:'bim_join_walls',input:{kind:'endpoint_endpoint',endpoints}}:undefined,region,'connectivity');
        }
      }
      else if(clearance&&distance<clearance-tolerance)emit('ClearanceClash',[a.id,b.id],position,`Exact polyhedral distance ${distance} m is below requested clearance ${clearance} m.`);
    }active.push(b);
  }
  for(const issue of modelIssues(s))if(issue.reason==='INVALID_HOST_RELATION')emit('InvalidHostRelationship',[issue.id],[0,0,0],`${issue.reason}: ${issue.message}`,undefined,undefined,'domain-validation');
  // Connector spatial buckets: detect only unique compatible pairs; never guess among alternative branches.
  const connected=new Set(Object.values(s.mepJunctions).flatMap(j=>j.members.map(m=>`${m.element}:${m.connector}`)));
  const connectors=Object.values(s.elements).flatMap(e=>connectorsOf(s,e)),open=connectors.filter(c=>!connected.has(`${c.ref.element}:${c.ref.connector}`)),buckets=new Map<string,typeof open>();
  const bucket=(p:V3)=>p.map(v=>Math.floor(v/tolerance));
  for(const c of open){const k=bucket(c.position).join(':');const list=buckets.get(k)??[];list.push(c);buckets.set(k,list);}
  const candidates=new Map<string,typeof open>();
  const ref=(r:ConnectorRef)=>`${r.element}:${r.connector}`;
  for(const c of open){const p=bucket(c.position),near:typeof open=[];
    for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++)for(const q of buckets.get([p[0]+x,p[1]+y,p[2]+z].join(':'))??[])
      if(q.ref.element!==c.ref.element&&Math.hypot(...q.position.map((v,i)=>v-c.position[i]))<=tolerance&&!junctionProblem(s,[c.ref,q.ref]))near.push(q);
    candidates.set(ref(c.ref),near);
  }
  for(const c of open){const near=candidates.get(ref(c.ref))??[];if(!near.length)continue;
    for(const q of near){const unique=near.length===1&&(candidates.get(ref(q.ref))?.length===1);emit('MissingConnection',[c.ref.element,q.ref.element],c.position,'Coincident compatible open connectors are not logically connected.',unique?{tool:'bim_connect_mep',input:{connectors:[c.ref,q.ref].sort((a,b)=>ref(a).localeCompare(ref(b)))}}:undefined,undefined,'connectivity');}
  }
  const roofs=Object.values(s.elements).filter(e=>e.kind==='pitched_roof'||e.kind==='boundary'&&e.category==='architecture.roof');
  for(const wall of Object.values(s.elements))if(wall.kind==='wall'&&!wall.topRoof&&touched([wall.id])){
    const candidates=roofs.flatMap(roof=>{try{const top=wallRoof(s,{...wall,topRoof:roof.id})!;const minGap=Math.min(top.start,top.end)-wall.baseOffset-wall.height;if(minGap< -tolerance||minGap>.5||top.maxHeight-wall.height<=tolerance)return [];return [{roof,top}];}catch(e){if(!(e instanceof DomainError))throw e;return [];}});
    if(candidates.length===1){const {roof,top}=candidates[0];emit('MissingConnection',[wall.id,roof.id],[wall.start[0],wall.start[1],(s.storeys[wall.storey]?.elevation??0)+top.start],'Wall top is not attached to the unique adjacent supported roof.',{tool:'bim_attach_walls_to_roof',input:{roof:roof.id,walls:[wall.id]}},undefined,'connectivity');}
    else if(candidates.length>1)emit('MissingConnection',[wall.id,...candidates.map(c=>c.roof.id)],[wall.start[0],wall.start[1],s.storeys[wall.storey]?.elevation??0],'Multiple candidate roofs require explicit design selection.',undefined,undefined,'connectivity');
  }
  for(const system of Object.values(s.mepSystems)){
    const graph=mepNetwork(s,{system:system.id});
    if(graph.components.length>1){const ids=Object.values(s.elements).filter(e=>(e.kind==='mep_segment'||e.kind==='mep_fitting')&&e.system===system.id).map(e=>e.id);emit('DisconnectedSystem',ids,[0,0,0],`${system.name}: ${graph.components.length} disconnected network components.`,undefined,undefined,'connectivity');}
  }
  return {issues:issues.sort((a,b)=>a.id.localeCompare(b.id)),unsupported,statistics:{index:'sweep-and-prune',indexedElements:records.length,broadCandidates,narrowPairs,incremental:!!selected},
    coverage:{exact:['polyhedral walls without hosted voids','rectangular profile members','polygonal boundaries with holes','oriented component boxes','gable/hip roof planes','MEP centerline-to-solid penetration proof'],unsupported:['general curved solids','MEP envelope-only/inter-system body clashes','wall hosted-void decomposition','engineering adequacy']}};
}
