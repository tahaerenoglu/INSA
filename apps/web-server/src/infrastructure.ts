import {familyPresentation} from './family-presentation.js';
import {profileReferenceGeometry} from '@insa/infra';
import {civilNavigationGeometry} from '@insa/infra';
import {batchRoadView} from './road-view-batch.js';
import {repeatedComponentInstances} from './road-sleeper-instances.js';
import {indexViewerVertices} from './index-viewer-vertices.js';
import {createHash} from 'node:crypto';
import {canonicalJson} from '@insa/core';
import {toLocal,toMap,georefProblem,type BimState,type Georeference} from '@insa/bim';
import {align3d,hLength,point3d,evalElement,evalV,evalH,verticalCoverage,verticalLineageStatus,cadLineageStatus,sampleStations,tunnelGeometry,localOrigin,EXPORT_TOL,boundaries,frames,layerId,roadGeometry,earthworksSolidResults,earthworksLines,earthworksGeometryKey,zoneStatus,roadTerrainCompatibility,type PreparedTerrain,type InfraState} from '@insa/infra';
import {tunnelMetricUV} from './infrastructure-uv.js';
import {roadMetricUV,roadProfileUV} from './road-uv.js';
type P=[number,number,number];
export function coordinateAdapter(sourceCrs:string|undefined,g:Georeference|null|undefined){
 if(!g)return {status:'unresolved',diagnostic:'Altyapı eşlemesi için BIM proje georeference tanımı gerekli.'} as const;
 const problem=georefProblem(g);if(problem)return {status:'unresolved',diagnostic:problem} as const;
 if(!sourceCrs)return {status:'unresolved',diagnostic:'Altyapı kaynak CRS tanımı eksik; koordinatlar değiştirilmedi.'} as const;
 if(sourceCrs.trim().toUpperCase()!==g.crs.name.trim().toUpperCase())return {status:'incompatible',diagnostic:`Kaynak CRS ${sourceCrs}, proje CRS ${g.crs.name}. CRS reprojeksiyonu desteklenmiyor.`} as const;
 return {status:'resolved',sourceCrs,projectCrs:g.crs.name,worldToProject:(p:P)=>toLocal(g,p),projectToWorld:(p:P)=>toMap(g,p),worldToViewer:(p:P)=>{const q=toLocal(g,p);return [q[0]+0,q[2]+0,-q[1]+0] as P;}} as const;
}
const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
const geometricState=(s:InfraState)=>{const geometry=structuredClone(s);delete geometry.civilNavigation;delete geometry.families;delete geometry.familyInstances;for(const type of Object.values(geometry.componentTypes??{}))(type.layer as any).materialId=undefined;for(const section of Object.values(geometry.sections))section.layers.forEach((layer,i)=>{layer.id=layerId(section,i);delete layer.materialId;delete layer.material;});for(const road of Object.values(geometry.roads??{}))for(const l of road.layers)(l as any).materialId=undefined;for(const t of Object.values(geometry.terrains??{}))delete t.materialId;return geometry;};
export function infrastructureKey(project:string,s:InfraState,b:BimState){return hash([project,geometricState(s),b.project.georef]);}
export function infrastructureMaterials(data:ReturnType<typeof infrastructureScene>,s:InfraState,b:BimState){
 const resources=data.resources.map(r=>{
 if(r.kind==='earthworks_design'){const d=s.earthworks?.[r.properties.id];return {...r,properties:{...r.properties,zones:Object.values(s.earthworkZones??{}).filter(z=>z.design===d?.id).map(z=>d?zoneStatus(z,d,s.roads?.[d.road]&&s.terrains?.[d.terrain]?earthworksGeometryKey(d,s.roads[d.road],s.alignments[s.roads[d.road].alignment],s.terrains[d.terrain]):undefined):z)}};}
 if(r.kind==='terrain_surface'){const terrain=s.terrains?.[r.properties.id],material=terrain?.materialId?b.materials[terrain.materialId]:undefined;return {...r,properties:{...r.properties,...terrain,materialId:terrain?.materialId??null,materialName:material?.name??null}};}
 if(r.kind==='road_corridor'){const road=s.roads?.[r.properties.id];return {...r,properties:{...r.properties,...road,quantities:r.properties.quantities?.map((q:any)=>({...q,materialId:road?.layers.find(l=>l.id===q.layerId)?.materialId}))}};}
 if(r.kind!=='lining_layer'&&r.kind!=='pavement_layer')return r;const section=r.kind==='pavement_layer'?s.roads?.[r.properties.road]:s.sections[r.properties.section],layer=r.kind==='pavement_layer'?section?.layers.find((l:any)=>l.id===r.properties.layerId):(section as any)?.layers.find((_:any,i:number)=>layerId(section as any,i)===r.properties.layerId),material=layer?.materialId?b.materials[layer.materialId]:undefined;
 return {...r,properties:{...r.properties,...(r.properties.quantity?{quantity:{...r.properties.quantity,materialId:layer?.materialId??null}}:{}),thickness:layer?.thickness??null,componentType:(layer as any)?.componentType??null,designBasis:(section as any)?.designBasis??null,materialId:layer?.materialId??null,materialText:layer?.material??null,materialResolution:material?'resolved':layer?.materialId?'missing':'unassigned',materialName:material?.name??null}};});
 const objects=data.objects.map(o=>{const resource=resources.find(r=>r.id===o.id),materialId=resource?.properties.materialId;return {...o,materialId:materialId??undefined,...(o.materialGroups?{materialGroups:o.materialGroups.map((g:any)=>({...g,materialId:resources.find(r=>r.id===g.resourceId)?.properties.materialId??undefined}))}:{})};});
 const rawNavigation=civilNavigationGeometry(s),adapter=coordinateAdapter(s.crs,b.project.georef);
 const civilNavigation=rawNavigation?.enabled&&'point' in rawNavigation&&adapter.status==='resolved'?{...rawNavigation,metresToViewer:(()=>{const p=rawNavigation.point!,a=adapter.worldToViewer(p),b=adapter.worldToViewer([p[0],p[1],p[2]+1]);return Math.hypot(...a.map((v,i)=>b[i]-v));})(),point:adapter.worldToViewer(rawNavigation.point!),tangent:(()=>{const origin=rawNavigation.point!,end=origin.map((v,i)=>v+rawNavigation.tangent![i]) as P,p=adapter.worldToViewer(origin),q=adapter.worldToViewer(end);return q.map((v,i)=>v-p[i]);})(),positions:rawNavigation.positions!.flatMap((_,i,a)=>i%3===0?adapter.worldToViewer(a.slice(i,i+3) as P):[]),stationLabels:rawNavigation.stationLabels!.map(l=>({...l,point:adapter.worldToViewer(l.point)}))}:rawNavigation?{...rawNavigation,enabled:false,diagnostic:rawNavigation.enabled?'Project coordinate mapping unresolved.':('diagnostic' in rawNavigation?rawNavigation.diagnostic:undefined)}:null;
 return {...data,civilNavigation,resources:familyPresentation(resources,s),objects,materials:b.materials,appearanceKey:hash([Object.values(s.terrains??{}).map(t=>[t.id,t.materialId]),s.sections,Object.values(s.roads??{}).map(r=>r.layers.map(l=>[l.id,l.materialId])),b.materials])};
}
export function infrastructureScene(project:string,s:InfraState,b:BimState,derived?:Map<string,any>,terrainData?:Map<string,PreparedTerrain>){
 const key=infrastructureKey(project,s,b),mapping=coordinateAdapter(s.crs,b.project.georef),resources:any[]=[],objects:any[]=[];
 const geometric=geometricState(s),resourceKey=(value:unknown)=>hash([project,value,b.project.georef,s.crs]);
 const cached=<T>(key:string,create:()=>T):T=>{if(derived?.has(key))return derived.get(key);const value=create();if(derived){if(derived.size>=192)derived.delete(derived.keys().next().value!);derived.set(key,value);}return value;};
 for(const d of Object.values(s.earthworks??{}))resources.push({id:`infra:${d.id}`,label:d.name,kind:'earthworks_design',properties:d});
 for(const z of Object.values(s.earthworkZones??{})){const d=s.earthworks?.[z.design];resources.push({id:`infra:${z.id}`,parent:`infra:${z.design}`,label:z.name,kind:'earthwork_zone',properties:d?zoneStatus(z,d,s.roads?.[d.road]&&s.terrains?.[d.terrain]?earthworksGeometryKey(d,s.roads[d.road],s.alignments[s.roads[d.road].alignment],s.terrains[d.terrain]):undefined):z});}
 for(const d of Object.values(s.alignments)){const a=align3d(d);resources.push({id:`infra:${d.id}`,label:d.name,kind:'alignment',properties:{...d,sourceStatus:cadLineageStatus(s,d),verticalStatus:verticalCoverage(a).status,verticalCoverage:verticalCoverage(a),verticalSourceStatus:verticalLineageStatus(s,d),from:a.h[0].s0,to:a.h[0].s0+hLength(a.h)}});}
 for(const t of Object.values(s.tunnels))resources.push({id:`infra:${t.id}`,...(t.parentTunnel?{parent:`infra:${t.parentTunnel}`}:{}) ,label:t.name,kind:'tunnel',properties:t});
 for(const road of Object.values(s.roads??{}))resources.push({id:`infra:${road.id}`,...(road.parentTunnel?{parent:`infra:${road.parentTunnel}`}:{}) ,label:road.name,kind:'road_corridor',properties:road});
 for(const r of Object.values(s.profileReferences??{}))resources.push({id:`infra:${r.id}`,label:r.name,kind:'approximate_profile_reference',properties:{...r,warning:'Yaklaşık görsel profil; ölçülmüş TIN/arazi değildir. Metraj dışı.'}});
 for(const terrain of Object.values(s.terrains??{})){
  const terrainMapping=coordinateAdapter(terrain.sourceCrs,b.project.georef),prepared=terrainData?.get(terrain.id),id=`infra:${terrain.id}`,projectDatum=b.project.georef?.crs.verticalDatum??null;
  resources.push({id,label:terrain.name,kind:'terrain_surface',properties:{...terrain,projectCrs:b.project.georef?.crs.name??null,projectVerticalDatum:projectDatum,comparisonReady:Boolean(terrain.verticalDatum.name&&projectDatum===terrain.verticalDatum.name)||terrain.verticalDatum.confirmed,mapping:terrainMapping.status}});
  if(terrainMapping.status==='resolved'&&prepared){const geometryKey=hash([project,terrain.id,terrain.geometrySignature,terrain.sourceCrs,b.project.georef]);objects.push({...cached(geometryKey,()=>{const used=[...new Set(prepared.indices)].sort((a,b)=>a-b),refs=new Map(used.map((v,i)=>[v,i])),positions:number[]=[],uvMetres:number[]=[];for(const index of used){const p=prepared.positions.slice(index*3,index*3+3) as P;positions.push(...terrainMapping.worldToViewer(p));uvMetres.push(p[0]-prepared.statistics.bounds.min[0],p[1]-prepared.statistics.bounds.min[1]);}return {id,kind:'mesh',positions,indices:prepared.indices.map(i=>refs.get(i)!),uvMetres,color:'#8f9f71',geometryKey};}),materialId:terrain.materialId});}
 }
 if(mapping.status!=='resolved')return {project,key,status:objects.length?(Object.keys(s.alignments).length?'partial':'resolved'):mapping.status,diagnostic:Object.keys(s.alignments).length?mapping.diagnostic:null,resources,objects};
 const convert=(positions:number[],origin:P=[0,0,0])=>{const out:number[]=[];for(let i=0;i<positions.length;i+=3){const p=mapping.worldToViewer([positions[i]+origin[0],positions[i+1]+origin[1],positions[i+2]+origin[2]]);out.push(...p);}return out;};
 for(const r of Object.values(s.profileReferences??{})){const geometryKey=resourceKey([r,s.alignments[r.alignment]]),g=cached(geometryKey,()=>profileReferenceGeometry(s,r));objects.push({id:`infra:${r.id}`,kind:'mesh',positions:convert(g.positions),indices:g.indices,color:'#799c75',opacity:r.opacity,geometryKey});for(let side=0;side<(r.lateral_offsets??[0]).length;side++)objects.push({id:`infra:${r.id}:trace:${side}`,parent:`infra:${r.id}`,kind:'line',positions:convert(g.trace.slice(side*g.stations.length*3,(side+1)*g.stations.length*3)),color:'#38583c',geometryKey});}
 for(const d of Object.values(s.alignments)){
  const geometryKey=resourceKey(d);
  if(d.elements||d.verticalSource){const a=align3d(d),coverage=verticalCoverage(a);for(const [i,e] of a.h.entries()){const id=`infra:${e.id??`${d.id}:segment:${i+1}`}`,positions:number[]=[],from=a.v.length?Math.max(e.s0,a.v[0].station):e.s0,to=a.v.length?Math.min(e.s0+e.length,a.v.at(-1)!.station):e.s0+e.length;resources.push({id,parent:`infra:${d.id}`,label:`${i+1} · ${e.kind}`,kind:'alignment_segment',properties:{...e,alignment:d.id,verticalCoverage:coverage,elevation:d.pvis.length?'defined-in-valid-range':null,source:d.cadSource?.segments.find(x=>x.id===e.id),verticalSource:d.verticalSource?{region:d.verticalSource.region,sourceHash:d.verticalSource.sourceHash,datum:d.verticalSource.configuration.datum}:null}});if(to<=from)continue;const stations=sampleStations(a,from,to,.02,10);if(stations.length>50000)throw new Error('Alignment display budget exceeded.');for(const station of stations){const q=evalH(a.h,station);positions.push(q.x,q.y,a.v.length?evalV(a.v,station).z:b.project.georef!.orthogonalHeight);}objects.push({id,parent:`infra:${d.id}`,kind:'line',positions:convert(positions),color:'#d69b21',geometryKey});}continue;}
  objects.push(cached(geometryKey,()=>{
  const a=align3d(d),start=a.h[0].s0,end=start+hLength(a.h),positions:number[]=[];
  for(const station of sampleStations(a,start,end,.02,10)){const p=point3d(a,station);positions.push(p.x,p.y,p.z);}
  return {id:`infra:${d.id}`,kind:'line',positions:convert(positions),color:'#d69b21',geometryKey};}));
 }
 for(const t of Object.values(s.tunnels)){
  const geometryKey=resourceKey([t,s.alignments[t.alignment],t.ranges.map(r=>geometric.sections[r.section])]);
  const result=cached(geometryKey,()=>{const resources:any[]=[],objects:any[]=[];
  const a=align3d(s.alignments[t.alignment]),origin=localOrigin(a);
  for(const [ri,range]of tunnelGeometry(a,t.ranges,s.sections,origin,EXPORT_TOL.tol,EXPORT_TOL.ringTol).entries()){
   if(!range.layers.length){
    // A section with no modeled lining still has a meaningful clear envelope.
    // Draw it as a selectable, display-only wire cage; it is not a solid and
    // contributes no fabricated lining material or quantity.
    const id=`infra:${t.id}:range:${ri}:clear-profile`,ring=boundaries(range.section,EXPORT_TOL.ringTol).rings[0];
    resources.push({id,parent:`infra:${t.id}`,label:`${range.section.name} · temiz kesit sınırı (görsel rehber)`,kind:'tunnel_clearance_guide',properties:{tunnel:t.id,section:range.section.id,range:range.range,displayOnly:true,engineeringQuantity:false,liningDefined:false}});
    const from=range.range.from,to=range.range.to,length=to-from,stations=sampleStations(a,from,to,Math.min(.05,Math.max(.001,length/2000)),10),stationFrames=frames(a,stations,origin),positions:number[]=[],addSegment=(p:P,q:P)=>positions.push(...p,...q),at=(f:number,i:number):P=>{const frame=stationFrames[f],v=ring[i];return [frame.p[0]-v[0]*frame.n[0],frame.p[1]-v[0]*frame.n[1],frame.p[2]+v[1]];};
    const crossFrames=[0,Math.floor((stationFrames.length-1)/2),stationFrames.length-1];for(const fi of [...new Set(crossFrames)])for(let i=0;i<ring.length;i++)addSegment(at(fi,i),at(fi,(i+1)%ring.length));
    const stride=Math.max(1,Math.ceil(ring.length/16));for(let i=0;i<ring.length;i+=stride)for(let f=0;f<stationFrames.length-1;f++)addSegment(at(f,i),at(f+1,i));
    objects.push({id,parent:`infra:${t.id}`,kind:'line-batch',positions:convert(positions,origin),color:'#d7e1e8',geometryKey});
   }
   for(const [li,layer]of range.layers.entries()){
   const stableId=layerId(range.section,li),id=`infra:${t.id}:range:${ri}:layer:${stableId.startsWith('legacy-')?stableId.slice(7):stableId}`;
   resources.push({id,parent:`infra:${t.id}`,label:layer.name,kind:'lining_layer',properties:{tunnel:t.id,section:range.section.id,range:range.range,layer:li,layerId:stableId,materialText:layer.material??null,materialResolution:'legacy_text_fallback'}});
   const rings=boundaries(range.section,EXPORT_TOL.ringTol).rings,adapted=indexViewerVertices(tunnelMetricUV(layer.mesh,range.stations,[rings[li+1],rings[li]],a));
   objects.push({id,parent:`infra:${t.id}`,kind:'mesh',positions:convert(adapted.positions,origin),indices:adapted.indices,uvMetres:adapted.uv,normalGroups:adapted.normalGroups,color:li%2?'#a7b9a2':'#b8c1ca',geometryKey});
   }
  }
  return {resources,objects};});resources.push(...result.resources);objects.push(...result.objects);
 }
 for(const road of Object.values(s.roads??{})){
  const geometryKey=resourceKey([geometric.roads?.[road.id],s.alignments[road.alignment]]),a=align3d(s.alignments[road.alignment]),origin=localOrigin(a);
  const geometry=cached(geometryKey,()=>roadGeometry(road,a,origin));
  const root=resources.find(r=>r.id===`infra:${road.id}`);root.properties={...road,engineeringGeometryKey:geometryKey,quantities:geometry.layers.map(l=>l.quantity),sampling:{stations:geometry.stations.length,tolerance_m:geometry.tolerance_m}};
  const sleepers=repeatedComponentInstances(road.id,geometry.layers,a,origin,mapping.worldToViewer);
  if(sleepers)for(const group of sleepers.groups){const id=`infra:${road.id}:layer:${group.layerIds[0]}`;resources.push({id,parent:`infra:${road.id}`,label:`${group.name} · ortak geometri`,kind:'pavement_layer',properties:{road:road.id,role:group.role,layerId:group.layerIds[0],layerIds:group.layerIds,componentCount:group.instances.length,displayTolerance_m:sleepers.maxError}});objects.push({id,parent:`infra:${road.id}`,kind:'mesh-instances',positions:group.positions,indices:group.indices,instances:group.instances,prototypeKey:group.prototypeKey,materialId:group.materialId,color:group.role==='sleeper'?'#c1beb3':'#b8c1ca',geometryKey});}
  for(const layer of geometry.layers){
   if(sleepers?.layerIds.includes(layer.layer.id))continue;
   if(layer.parts){const parent=`infra:${road.id}:layer:${layer.layer.id}`,properties={road:road.id,layerId:layer.layer.id,role:layer.layer.role,profile:layer.layer.profile,repeat:layer.layer.repeat,quantity:layer.quantity};
    resources.push({id:parent,parent:`infra:${road.id}`,label:layer.layer.name,kind:'pavement_layer',properties});
    for(const part of layer.parts){const id=layer.layer.repeat?`${parent}:piece:${part.id}`:parent;
     if(layer.layer.repeat)resources.push({id,parent,label:`${layer.layer.name} · ${((part.from+part.to)/2).toFixed(3)}`,kind:'pavement_layer',properties:{road:road.id,layerId:layer.layer.id,instanceId:part.id,from:part.from,to:part.to}});
     const adapted=indexViewerVertices(roadProfileUV(part));
     objects.push({id,parent:layer.layer.repeat?parent:`infra:${road.id}`,kind:'mesh',positions:convert(adapted.positions,origin),indices:adapted.indices,uvMetres:adapted.uv,normalGroups:adapted.normalGroups,color:layer.layer.role==='rail'?'#8d969e':layer.layer.role==='sleeper'?'#c1beb3':layer.layer.role==='ballast'?'#6f7478':layer.layer.role==='subballast'?'#ae9579':'#89715c',geometryKey:`${geometryKey}:${part.id}`});
    }continue;
   }
   const id=`infra:${road.id}:layer:${layer.layer.id}`,adapted=cached(`${geometryKey}:${layer.layer.id}`,()=>indexViewerVertices(roadMetricUV(layer,geometry.stations,a)));
   resources.push({id,parent:`infra:${road.id}`,label:layer.layer.name,kind:'pavement_layer',properties:{road:road.id,layerId:layer.layer.id,role:layer.layer.role,thickness:layer.layer.thickness,extent:{left:layer.layer.leftExtent,right:layer.layer.rightExtent},quantity:layer.quantity}});
   objects.push({id,parent:`infra:${road.id}`,kind:'mesh',positions:convert(adapted.positions,origin),indices:adapted.indices,uvMetres:adapted.uv,normalGroups:adapted.normalGroups,color:['#484848','#615e56','#746858','#a99971','#afa893'][road.layers.findIndex(l=>l.id===layer.layer.id)%5],geometryKey});
  }
 }
 for(const d of Object.values(s.earthworks??{})){const r=s.roads?.[d.road],t=s.terrains?.[d.terrain],prepared=t?terrainData?.get(t.id):undefined,root=resources.find(p=>p.id===`infra:${d.id}`);if(!r||!t||!prepared){root.properties={...d,diagnostic:'Earthworks source unavailable.'};continue;}try{roadTerrainCompatibility(s.crs,t,b.project.georef);const a=align3d(s.alignments[r.alignment]),geometryKey=resourceKey(earthworksGeometryKey(d,r,s.alignments[r.alignment],t)),result=cached(geometryKey,()=>earthworksLines(d,r,a,t,prepared));root.properties={...d,visualization:{stations:result.stations,step_m:result.step_m,diagnostics:result.diagnostics,referenceOnly:true,volumes:'not-calculated'}};for(const l of result.lines){const id=`infra:${l.id}`;resources.push({id,parent:`infra:${d.id}`,label:`${l.role} · ${l.side} · ${l.classification}`,kind:'earthworks_reference',properties:{design:d.id,designRevision:d.revision,terrainRevision:t.revision,role:l.role,side:l.side,classification:l.classification,from:l.stations[0],to:l.stations.at(-1),referenceOnly:true,volumes:'not-calculated'}});objects.push({id,parent:`infra:${d.id}`,kind:'line',positions:convert(l.positions),color:l.role==='formation-edge'?'#9039b5':l.classification==='cut'?'#ce3030':l.classification==='fill'?'#1765d1':'#687580',geometryKey});}}catch(e){root.properties={...d,diagnostic:(e as Error).message};}}

 for(const d of Object.values(s.earthworks??{})){
  const r=s.roads?.[d.road],t=s.terrains?.[d.terrain],prepared=t?terrainData?.get(t.id):undefined;if(!r||!t||!prepared)continue;
  try{roadTerrainCompatibility(s.crs,t,b.project.georef);const signature=earthworksGeometryKey(d,r,s.alignments[r.alignment],t),zones=Object.values(s.earthworkZones??{}).filter(z=>z.design===d.id),geometryKey=resourceKey(['earthworks-solids-v1',signature,zones]),result=cached(geometryKey,()=>earthworksSolidResults(d,r,align3d(s.alignments[r.alignment]),t,prepared,zones,signature));
   const root=resources.find(p=>p.id===`infra:${d.id}`);root.properties.solidTotals={status:result.status,cut_m3:result.cut_m3,fill_m3:result.fill_m3,diagnostics:result.diagnostics};
   for(const zone of result.zones){const resource=resources.find(p=>p.id===`infra:${zone.zone}`);if(resource)resource.properties.solidResult={...zone,solids:zone.solids.map(({mesh,origin,...metadata}:any)=>metadata)};
    if(result.diagnostics.length)continue;
    for(const solid of zone.solids){const {mesh,origin,...metadata}=solid,id=`infra:${solid.id}`;resources.push({id,parent:`infra:${zone.zone}`,label:`${solid.classification==='cut'?'Kazı':'Dolgu'} · ${solid.volume_m3.toFixed(3)} m³`,kind:'earthwork_solid',properties:{...metadata,category:solid.classification==='cut'?'earthworks.excavation':'earthworks.fill',engine:'tin_grading_solid'}});objects.push(cached(`${geometryKey}:${id}`,()=>({id,parent:`infra:${zone.zone}`,kind:'mesh',positions:convert(mesh.positions,origin),indices:mesh.indices,color:solid.classification==='cut'?'#ce3030':'#1765d1',geometryKey:`${geometryKey}:${id}`})));}
   }
  }catch(e){const root=resources.find(p=>p.id===`infra:${d.id}`);if(root)root.properties.solidTotals={status:'incomplete',cut_m3:null,fill_m3:null,diagnostics:[(e as Error).message]};}
 }
 const packed=batchRoadView(resources,objects);
 // Large-scene JSON uses micrometre display precision; canonical XYZ and quantities stay full precision.
 if(packed.length>1000)for(const object of packed){for(const values of [object.positions,object.uvMetres,...(object.instances??[]).map((i:any)=>i.matrix)])if(values)for(let i=0;i<values.length;i++)values[i]=Math.round(values[i]*1e6)/1e6;}
 return {project,key,status:mapping.status,sourceCrs:mapping.sourceCrs,projectCrs:mapping.projectCrs,resources,objects:packed};
}

