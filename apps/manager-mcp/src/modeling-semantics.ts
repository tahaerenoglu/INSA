import {bimSemanticGraph,semanticEdge,semanticRevision,type coordinateModel,type BimState,type SemanticNode,type SemanticEdge} from '@insa/bim';
import type {InfraState} from '@insa/infra';
/** Adapters preserve each domain's existing IDs, shared definitions and placement resources. */
export function projectSemantics(bim:BimState,infra?:InfraState,coordination?:ReturnType<typeof coordinateModel>){
 const graph=bimSemanticGraph(bim),nodes:SemanticNode[]=[...graph.nodes],edges:SemanticEdge[]=[...graph.edges];
 const infraFamilies:any[]=[];
 const node=(id:string,kind:string,value:any)=>nodes.push({id:'infra:'+id,localId:id,domain:'infra',kind,name:value.name??id,revision:semanticRevision(value)});
 const edge=(a:string,b:string,relation:SemanticEdge['relation'])=>edges.push(semanticEdge('infra:'+a,'infra:'+b,relation));
 if(infra){
  for(const a of Object.values(infra.alignments))node(a.id,'alignment',a);
  for(const type of Object.values(infra.componentTypes??{})){node('type:'+type.id,'component_type',type);infraFamilies.push({id:'infra:type:'+type.id,name:type.name,origin:'stored',definition:type,revision:semanticRevision(type),types:[type.id],instances:[] as string[]});}
  for(const section of Object.values(infra.sections))node('type:'+section.id,'section',section);
  for(const road of Object.values(infra.roads??{})){
   node(road.id,'corridor',road);edge(road.id,road.alignment,'FollowsAlignment');
   for(const layer of road.layers){const id=`${road.id}:layer:${layer.id}`;node(id,'component_placement',{name:layer.name});edge(id,road.id,'PartOf');if(layer.componentType){edge(id,'type:'+layer.componentType,'InstanceOfType');infraFamilies.find(f=>f.id==='infra:type:'+layer.componentType)?.instances.push(id);} }
  }
  for(const tunnel of Object.values(infra.tunnels)){node(tunnel.id,'tunnel',tunnel);edge(tunnel.id,tunnel.alignment,'FollowsAlignment');for(const range of tunnel.ranges)edge(tunnel.id,'type:'+range.section,'DependsOn');}
  for(const f of Object.values(infra.families??{})){node('family:'+f.id,'family',f);infraFamilies.push({id:'infra:family:'+f.id,name:f.name,origin:'stored',definition:f,revision:semanticRevision(f),types:[],instances:Object.values(infra.familyInstances??{}).filter(i=>i.family===f.id).map(i=>i.id)});}
  for(const instance of Object.values(infra.familyInstances??{})){node(instance.id,'family_instance',instance);edge(instance.id,'family:'+instance.family,'InstanceOfType');for(const id of instance.members)edge(id,instance.id,'MemberOfAssembly');}
 }
 if(coordination)for(const issue of coordination.issues)if(issue.elements.length===2&&['HardClash','ExpectedStructuralIntersection','InvalidPenetration'].includes(issue.kind)){
  const [a,b]=issue.elements;
  const [source,target]=issue.kind==='InvalidPenetration'&&bim.elements[a]?.kind!=='mep_segment'?[b,a]:[a,b];
  edges.push(semanticEdge('bim:'+source,'bim:'+target,issue.kind==='InvalidPenetration'?'Penetrates':'Intersects','derived',issue.id));
  if(issue.kind==='ExpectedStructuralIntersection'){
   const x=bim.elements[a],y=bim.elements[b];
   if(x&&y){const beam=x.kind==='profile_member'&&x.category==='structure.framing'?x:y.kind==='profile_member'&&y.category==='structure.framing'?y:undefined,column=x.kind==='profile_member'&&x.category==='structure.column'?x:y.kind==='profile_member'&&y.category==='structure.column'?y:undefined;if(beam&&column)edges.push(semanticEdge('bim:'+beam.id,'bim:'+column.id,'SupportedBy','derived',issue.id));}
  }
 }
 const uniqueEdges=[...new Map(edges.map(e=>[e.id,e])).values()];
 return {nodes,edges:uniqueEdges,library:{...graph.catalog,infrastructure:infraFamilies},revision:semanticRevision({nodes:[...nodes].sort((a,b)=>a.id.localeCompare(b.id)),edges:[...uniqueEdges].sort((a,b)=>a.id.localeCompare(b.id))})};
}
export const PROJECT_ARCHETYPES=[
 {id:'residential',systems:['architecture','structure','MEP'],capabilities:['building','instances','reinforcement','network','assembly']},
 {id:'railway',systems:['alignment','track','formation','structures','drainage'],capabilities:['corridor'],missing:['specialized track/drainage assemblies']},
 {id:'metro-station',systems:['structure','platforms','circulation','technical-areas'],capabilities:['instances','assembly'],missing:['station-specific planning']},
 {id:'solar-plant',systems:['terrain','panels','mounts','electrical-equipment'],capabilities:['assembly-array'],missing:['electrical design/terrain-following panel placement']},
 {id:'industrial',systems:['structure','equipment','utilities','distribution'],capabilities:['instances','assembly-array','network'],missing:['process-specific engineering']},
 {id:'bridge',systems:['foundation','piers','bearings','superstructure'],capabilities:['instances','assembly'],missing:['bridge-specific geometric automation']},
];
