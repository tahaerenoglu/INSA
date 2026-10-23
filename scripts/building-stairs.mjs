import fs from 'node:fs';import {Platform,MemoryStores} from '@insa/core';import {bimModule,modelIssues} from '@insa/bim';import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
const live=createPlatform(),project='temiz-proje-20261013',source=await live.state(project,'bim');
const p=new Platform({modules:[{...bimModule,initialState:()=>structuredClone(source)}],stores:new MemoryStores(),logger:{info(){},warn(){}}});const run=(t,i)=>p.execute({id:'fixture',name:'Memory preflight',kind:'human',roles:['bim_manager']},'fixture',t,i);
if(!source.types['STT-0001'])await run('bim_create_types',{types:[{kind:'stair',name:'C30/35 Merdiven — 120 cm, 16.7 cm Rıht',material:'M-0005',max_riser:.18,min_tread:.28,default_width:1.2},{kind:'slab',name:'C30/35 Ara Sahanlık 150 mm',layers:[{material:'M-0005',thickness:.15,function:'structure'}]}]});
const hole=[[5.15,1.2],[7.85,1.2],[7.85,4.69],[5.15,4.69]],items=Object.values(source.elements).filter(e=>e.kind==='boundary'&&e.category==='architecture.floor'&&e.name?.includes('Salon ve Mutfak')).map(e=>({id:e.id,kind:'boundary',set:{holes:[...e.holes,hole]}}));
if(items.length!==10)throw Error(`Expected 10 salon slabs: ${items.length}`);
const stairs=[],boundaries=[];
for(let i=0;i<10;i++){const storey=i===0?'Zemin Kat':`${i}. Kat`;
 stairs.push({storey,type:'STT-0001',name:`${i}–${i+1}. Kat — Alt Kol`,start:[5.8,1.2],end:[5.8,3.44],base_offset:0,height:1.5,riser_count:9,width:1.2},{storey,type:'STT-0001',name:`${i}–${i+1}. Kat — Üst Kol`,start:[7.2,3.44],end:[7.2,1.2],base_offset:1.5,height:1.5,riser_count:9,width:1.2});
 boundaries.push({category:'architecture.floor',storey,type:'ST-0002',name:`${i}–${i+1}. Kat Ara Sahanlık`,outline:[[5.2,3.44],[7.8,3.44],[7.8,4.64],[5.2,4.64]],offset:1.5});
}
await run('bim_update_elements',{items});await run('bim_create_boundaries',{boundaries});await run('bim_create_stairs',{stairs});const issues=modelIssues(await p.state('fixture','bim'));if(issues.length)throw Error(JSON.stringify(issues));
fs.mkdirSync('test-results/building-stairs',{recursive:true});fs.writeFileSync('test-results/building-stairs/inputs.json',JSON.stringify({project,items,boundaries,stairs},null,2));console.log(JSON.stringify({flights:stairs.length,landings:boundaries.length,slabOpenings:items.length,issues}));
if(process.argv.includes('--propose'))for(const [tool,input]of [['bim_update_elements',{items}],['bim_create_boundaries',{boundaries}],['bim_create_stairs',{stairs}]]){const r=await live.execute({id:'codex',name:'Codex',kind:'ai',roles:['ai_agent']},project,tool,input);console.log(JSON.stringify({status:r.status,proposalId:r.proposalId}));}
