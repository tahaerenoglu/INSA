import {createHash} from 'node:crypto';
import {align3d,boundaries,hLength,point3d,type InfraState} from '@insa/infra';
import type {BimState} from '@insa/bim';
import {coordinateAdapter} from './infrastructure.js';
export function portalMapTargets(s:InfraState,b:BimState){
 const adapter=coordinateAdapter(s.crs,b.project.georef);if(adapter.status!=='resolved')throw Error('Koordinat eşlemesi gerekli.');const portals:any[]=[];
 for(const portal of Object.values(s.tunnels).filter(t=>/portalı/.test(t.name))){
  const match=/LOT4 (TN-\d+) (giriş|çıkış) portalı/.exec(portal.name);if(!match)continue;const parent=s.tunnels[match[1]];if(!parent||portal.ranges.length!==1)continue;
  const direction=match[2]==='giriş'?-1:1,base=direction<0?parent.ranges[0].from:parent.ranges.at(-1)!.to,a=align3d(s.alignments[portal.alignment]),section=s.sections[portal.ranges[0].section],ring=boundaries(section,.02).rings.at(-1)!;
  const width=Math.max(...ring.map(p=>Math.abs(p[0]))),offsets=[-width*.5,0,width*.5];
  const roof=offsets.map(x=>{const heights:number[]=[];for(let i=0;i<ring.length;i++){const p=ring[i],q=ring[(i+1)%ring.length];if(Math.abs(q[0]-p[0])<1e-10)continue;const t=(x-p[0])/(q[0]-p[0]);if(t>=0&&t<=1)heights.push(p[1]+t*(q[1]-p[1]));}return {x,z:Math.max(...heights)};});
  let limit=Math.min(500,direction<0?base-a.h[0].s0:a.h[0].s0+hLength(a.h)-base);
  // Do not extend into a neighbouring bridge or another main tunnel.
  const obstacles=[...Object.values(s.roads??{}).filter(r=>/Köprü/.test(r.name)&&r.layers.some(l=>l.role==='pier-cap')).map(r=>({from:r.from,to:r.to})),...Object.values(s.tunnels).filter(t=>t.id!==parent.id&&!/portalı/.test(t.name)).flatMap(t=>t.ranges)];
  for(const o of obstacles){const gap=direction<0?base-o.to:o.from-base;if(gap>0)limit=Math.min(limit,Math.max(0,gap-2));}
  const stations=[];for(let distance=0;distance<=limit+1e-8;distance+=5){const station=base+direction*distance,q=point3d(a,station);stations.push({station,distance,targets:roof.map((v,i)=>({id:portal.id+':'+distance+':'+i,point:adapter.worldToViewer([q.x+v.x*Math.sin(q.az),q.y-v.x*Math.cos(q.az),q.z+v.z])}))});}
  portals.push({id:portal.id,name:portal.name,base,direction,section:section.id,stations});
 }
 return {revision:createHash('sha256').update(JSON.stringify([s.tunnels,s.sections,s.alignments,s.roads,b.project.georef])).digest('hex'),portals};
}
export function portalFitPlans(s:InfraState,b:BimState,input:{revision:string;samples:{id:string;point:[number,number,number]|null}[]}){
 const current=portalMapTargets(s,b);if(input.revision!==current.revision)throw Error('Model değişti; ölçümü tekrarlayın.');const samples=new Map(input.samples.map(x=>[x.id,x.point]));if(samples.size!==input.samples.length)throw Error('Mükerrer ölçüm.');const operations:any[]=[],reports:any[]=[],diagnostics:string[]=[];
 for(const p of current.portals){let previous:{station:number;clearance:number}|undefined,found=false;
  for(const row of p.stations){const values=row.targets.map((t:any)=>{const hit=samples.get(t.id);return hit&&Math.hypot(hit[0]-t.point[0],hit[2]-t.point[2])<.02?hit[1]-t.point[1]:null;});
   if(values.some((v:any)=>v===null)){diagnostics.push(p.id+': arazi karoları eksik; portal korunuyor.');break;}
   // Intersection with the upper outer envelope, using three lateral surface samples.
   const clearance=Math.min(...values as number[]);
   if(previous&&previous.clearance*clearance<=0&&Math.abs(previous.clearance-clearance)>1e-8){
    const station=previous.station+(row.station-previous.station)*previous.clearance/(previous.clearance-clearance),old=s.tunnels[p.id],oldEnd=p.direction<0?old.ranges[0].from:old.ranges[0].to;
    if(Math.abs(station-p.base)<=Math.abs(oldEnd-p.base)+.05){diagnostics.push(p.id+': ilk kesişim mevcut portal boyundan ileride değil; portal korunuyor.');found=true;break;}
    const ranges=[{...old.ranges[0],from:p.direction<0?station:p.base,to:p.direction<0?p.base:station}];operations.push({tool:'infra_set_tunnel_ranges',input:{tunnel:p.id,ranges}});reports.push({portal:p.id,station,length:Math.abs(station-p.base),bracket:[previous.station,row.station],source:'Yüklü Google 3B üst yüzeyi; 5 m aralıklı yaklaşık kesişim, çıplak arazi doğrulanmadı.'});found=true;break;
   }
   previous={station:row.station,clearance};
  }
  if(!found&&!diagnostics.some(d=>d.startsWith(p.id+':')))diagnostics.push(p.id+': taranan yaklaşımda kesişim bulunamadı; portal korunuyor.');
 }
 for(const sectionId of new Set(reports.map(r=>s.tunnels[r.portal].ranges[0].section))){const section=s.sections[sectionId],relevant=reports.filter(r=>s.tunnels[r.portal].ranges[0].section===sectionId);operations.unshift({tool:'infra_update_section_type',input:{section:sectionId,designBasis:{status:'Yaklaşık Google 3B yüzeyi kesişiminden portal boyu',notes:[...(section.designBasis?.notes??[]).slice(-30),...relevant.map(r=>`${r.portal}: uç Km ${r.station.toFixed(3)}, boy ${r.length.toFixed(3)} m; ${r.source} Arama aralığı ${r.bracket.join('–')}.`)],sources:[...(section.designBasis?.sources??[]).slice(-18),{title:'Tarayıcıda yüklü Google 3B karo üçgenleri',reference:'Üst dış zarfın üç yanal noktasında düşey ışın; N kullanıcı harita eşlemesinden. Kesin arazi/röper verisi değildir.'}]}}});}
 return {operations,reports,diagnostics};
}
