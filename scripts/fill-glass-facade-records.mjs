import {Platform,MemoryStores} from '@insa/core';import {bimModule,modelIssues} from '@insa/bim';import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
const live=createPlatform(),project='temiz-proje-20261013',source=await live.state(project,'bim');
const subtract=(range,holes)=>{let spans=[range];for(const [a,b]of holes)spans=spans.flatMap(([s,e])=>b<=s||a>=e?[[s,e]]:[[s,Math.max(s,a)],[Math.min(e,b),e]].filter(([s,e])=>e-s>1e-6));return spans;};
const members=[],existing=Object.values(source.elements).filter(e=>e.kind==='profile_member');
for(const w of Object.values(source.elements).filter(e=>e.kind==='wall'&&e.type==='WT-0004')){
 if(Object.values(source.elements).some(e=>e.kind==='opening'&&e.host===w.id))throw Error('Facade still has openings');
 const y=w.start[1]-.062,near=existing.filter(e=>e.storey===w.storey);
 const xs=[w.start[0],...Array.from({length:9},(_,i)=>(i+1)*1.5),w.end[0]];
 for(const x of xs){const spans=near.filter(e=>e.type==='CT-0002'&&e.placement==='member_vertical'&&Math.abs(e.at[0]-x)<1e-7&&Math.abs(e.at[1]-y)<1e-7).map(e=>[e.baseOffset,e.baseOffset+e.height]);for(const [a,b]of subtract([w.baseOffset,w.baseOffset+w.height],spans))members.push({category:'structure.column',type:'CT-0002',storey:w.storey,at:[x,y],base_offset:a,height:b-a,name:`${w.id} — Dikey Kayıt Boşluk Tamamlama`});}
 for(const z of [w.baseOffset+.05,w.baseOffset+1.425,w.baseOffset+w.height]){const spans=near.filter(e=>e.type==='BT-0003'&&e.placement==='member_axis'&&Math.abs(e.z-z)<1e-7).map(e=>[Math.min(e.start[0],e.end[0]),Math.max(e.start[0],e.end[0])]);for(const [a,b]of subtract([w.start[0],w.end[0]],spans))members.push({category:'structure.framing',type:'BT-0003',storey:w.storey,start:[a,y],end:[b,y],z,name:`${w.id} — Yatay Kayıt Boşluk Tamamlama`});}
}
if(!members.length){console.log('No gaps remain');process.exit(0);}
const fixture=new Platform({modules:[{...bimModule,initialState:()=>structuredClone(source)}],stores:new MemoryStores(),logger:{info(){},warn(){}}});await fixture.execute({id:'fixture',name:'Memory preflight',kind:'human',roles:['bim_manager']},'fixture','bim_create_profile_members',{members});const issues=modelIssues(await fixture.state('fixture','bim'));if(issues.length)throw Error(JSON.stringify(issues));console.log(JSON.stringify({added:members.length,issues}));
const r=await live.execute({id:'codex',name:'Codex',kind:'ai',roles:['ai_agent']},project,'bim_create_profile_members',{members});console.log(JSON.stringify({status:r.status,proposalId:r.proposalId}));
