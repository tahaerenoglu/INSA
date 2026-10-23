import {createHash} from 'node:crypto';
import {align3d,point3d,profileIntervals,type InfraState,type RoadCorridor} from '@insa/infra';
import {coordinateAdapter} from './infrastructure.js';
import type {BimState} from '@insa/bim';
export function bridgeMapTargets(s:InfraState,b:BimState){
 const adapter=coordinateAdapter(s.crs,b.project.georef);if(adapter.status!=='resolved')throw Error('Koordinat eşlemesi gerekli.');
 const targets=Object.values(s.roads??{}).flatMap(r=>{const footing=r.layers.find(l=>l.role==='bridge-foundation'&&l.repeat);if(!footing||r.name.startsWith('Harita destek '))return [];const a=align3d(s.alignments[r.alignment]);return profileIntervals(footing,r.from,r.to).map(({from,to},i)=>{const station=(from+to)/2,q=point3d(a,station);return {id:r.id+':'+i,road:r.id,station,point:adapter.worldToViewer([q.x,q.y,q.z]),railZ:q.z};});});
 return {revision:createHash('sha256').update(JSON.stringify([s.roads,s.alignments,b.project.georef])).digest('hex'),targets};
}
export function bridgeFitPlans(s:InfraState,b:BimState,input:{revision:string;samples:{id:string;point:[number,number,number]|null}[]}){
 const current=bridgeMapTargets(s,b);if(current.revision!==input.revision)throw Error('Model değişti; yeniden ölçün.');const adapter=coordinateAdapter(s.crs,b.project.georef);if(adapter.status!=='resolved')throw Error('Koordinat eşlemesi gerekli.');
 if(new Set(input.samples.map(x=>x.id)).size!==input.samples.length||input.samples.some(x=>!current.targets.some(t=>t.id===x.id)))throw Error('Geçersiz veya mükerrer ölçüm.');
 const plans:any[]=[],diagnostics:string[]=[];
 for(const road of Object.values(s.roads??{})){
  const targets=current.targets.filter(t=>t.road===road.id);if(!targets.length)continue;const supports:any[]=[];let failed=false;
  for(const t of targets){const hit=input.samples.find(v=>v.id===t.id)?.point;if(!hit||Math.hypot(hit[0]-t.point[0],hit[2]-t.point[2])>.02){diagnostics.push(t.id+': yüklenmiş harita yüzeyi bulunamadı.');failed=true;continue;}
   const ground=adapter.projectToWorld([hit[0],-hit[2],hit[1]])[2],bottom=ground-2-t.railZ,top=bottom+1.5,capBottom=-4.505;
   if(bottom < -20||top>=capBottom-.1||!Number.isFinite(ground)){diagnostics.push(t.id+': yüzey kotu mevcut destek geometrisiyle uyumsuz; otomatik işlem yok.');failed=true;continue;}
   const rect=(x0:number,x1:number,z0:number,z1:number)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
   const mat=road.layers.find(l=>l.role==='bridge-foundation')!.materialId;
   const layer=(name:string,role:string,profile:number[][],length:number)=>({name,role,profile,materialId:mat,thickness:Math.min(3,Math.max(...profile.map(p=>p[1]))-Math.min(...profile.map(p=>p[1]))),leftExtent:6,rightExtent:6,repeat:{anchor:t.station,spacing:100,length}});
   const layers=[layer('Yaklaşık harita kotuna göre temel','bridge-foundation',rect(-6,6,bottom,top),8)];
   for(const c of [-2.5,2.5])for(let z=top;z<capBottom-1e-8;z+=3)layers.push(layer('Harita yüzeyine göre 2x2 m kolon','bridge-pier',rect(c-1,c+1,z,Math.min(capBottom,z+3)),2));
   const name=`Harita destek ${t.id}`,existing=Object.values(s.roads??{}).find(r=>r.name===name),from=t.station-4,to=t.station+4;
   const body={name,alignment:road.alignment,from,to,sections:[{...road.sections[0],station:from},{...road.sections[0],station:to}],layers,designBasis:{status:'Yaklaşık yüklü Google 3B yüzeyi; tasarım varsayımı',notes:[`Kaynak: tarayıcıda yüklenmiş harita üçgenleri; çıplak arazi olduğu doğrulanmadı. Zemin kotu ${ground.toFixed(3)} m.`,`Temel altı zeminden 2 m aşağıda; temel 1.5 m. Tabliye/başlık korunur. Ulusal düşey datum bağlantısı doğrulanmadı.`],sources:[{title:'Google Photorealistic 3D Tiles — local ray intersection',reference:`${t.id}; Km ${t.station}; model revision ${current.revision}`} ]}};
   supports.push({tool:existing?'infra_update_road_corridor':'infra_create_road_corridor',input:existing?{...body,road:existing.id}:body});
  }
  if(!failed){plans.push({road:road.id,supports,cleanup:{tool:'infra_update_road_corridor',input:{road:road.id,layers:road.layers.filter(l=>l.role!=='bridge-foundation'&&l.role!=='bridge-pier')}}});}
 }
 return {plans,diagnostics};
}
