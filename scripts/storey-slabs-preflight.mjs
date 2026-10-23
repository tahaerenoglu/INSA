import fs from 'node:fs';
import {Platform,MemoryStores} from '@insa/core';
import {bimModule,modelIssues} from '@insa/bim';
import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
const live=createPlatform(),project='temiz-proje-20261013',source=await live.state(project,'bim');
const p=new Platform({modules:[{...bimModule,initialState:()=>structuredClone(source)}],stores:new MemoryStores(),logger:{info(){},warn(){}}});
const run=(tool,input)=>p.execute({id:'fixture',name:'Memory preflight',kind:'human',roles:['bim_manager']},'fixture',tool,input);
if(!source.types['ST-0001'])await run('bim_create_types',{types:[{kind:'slab',name:'Kat Döşemesi — Parke 10 + Şap 10 + Beton 150 mm',layers:[{material:'Parke',thickness:.01,function:'finish'},{material:'Şap',thickness:.01,function:'substrate'},{material:'Beton C30/35',thickness:.15,function:'structure'}]}]});
const boundaries=Object.values(source.storeys).filter(s=>s.elevation>0&&s.elevation<=30).sort((a,b)=>a.elevation-b.elevation).map(s=>({category:'architecture.floor',storey:s.id,type:'ST-0001',name:`${s.name} — Parke/Şap/Beton Döşeme`,offset:0,outline:[[0,0],[15,0],[15,10],[0,10]]}));
await run('bim_create_boundaries',{boundaries});const s=await p.state('fixture','bim'),issues=modelIssues(s);if(issues.length)throw Error(JSON.stringify(issues));
for(const w of Object.values(s.elements).filter(e=>e.kind==='wall'&&s.storeys[e.storey].elevation<30)){if(Math.abs(w.height-2.83)>1e-7)throw Error(`Wall not clipped ${w.id}: ${w.height}`);}
fs.mkdirSync('test-results/storey-slabs',{recursive:true});fs.writeFileSync('test-results/storey-slabs/inputs.json',JSON.stringify({project,boundaries},null,2));
console.log(JSON.stringify({slabs:boundaries.length,thickness:.17,wallClearHeight:2.83,issues}));
