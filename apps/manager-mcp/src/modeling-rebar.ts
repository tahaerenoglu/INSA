/** Shared BIM layout engine; orchestration supplies explicit project parameters only. */
import { type BimState, rebarCoverProblem, columnRebarGeometry } from '@insa/bim';
type Parameters = { cover: number; diameter: number; stirrupDiameter: number; spacing: number; steelGrade: string };
export function reinforcementLayout(s:BimState,hostId:string,p:Parameters,main:string,tie:string){
 return (['longitudinal','stirrups'] as const).map(role=>{
  const layout={kind:'rectangular_column' as const,role,mainType:main,tieType:tie,spacing:p.spacing},geometry=columnRebarGeometry(s,hostId,p.cover,layout);
  return {category:'structure.rebar_set',name:`${role==='longitudinal'?'Longitudinal':'Stirrups'} ${hostId}`,type:role==='longitudinal'?main:tie,host:hostId,cover:p.cover,layout,layers:geometry.layers,...('bendRadius'in geometry?{bend_radius:geometry.bendRadius}:{})};
 });
}
/** Check the outer bar surface against the rotated host prism, never just its centerline. */
export function reinforcementGeometryIssues(s: BimState) {
  const issues: { id: string; reason: string; message: string }[] = [];
  for (const e of Object.values(s.elements)) {
    if (e.kind !== 'reinforcement') continue;
    if (!e.geometryValidation) continue;
    const problem = rebarCoverProblem(s, e);
    if (problem) issues.push({ id: e.id, reason: 'REBAR_COVER_VIOLATION', message: problem });
  }
  return issues;
}
