import fs from 'node:fs';import {Platform,MemoryStores} from '@insa/core';import {bimModule,modelIssues} from '@insa/bim';import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
const live=createPlatform(),project='temiz-proje-20261013',source=await live.state(project,'bim');
const floors=Object.values(source.elements).filter(e=>e.kind==='boundary'&&e.category==='architecture.floor');
const coord=(v,max)=>Math.abs(v)<1e-7?.03:Math.abs(v-max)<1e-7?max-.03:v;
const items=floors.map(e=>({id:e.id,kind:'boundary',set:{outline:e.outline.map(([x,y])=>[coord(x,15),coord(y,10)])}}));
const walls=Object.values(source.storeys).filter(l=>l.elevation<30).map(l=>({storey:l.id,type:'WT-0003',name:`${l.name} — Üst Döşeme Cephe Kapaması`,points:[[0,0],[15,0],[15,10],[0,10]],closed:true,location_line:'exterior_face',base_offset:2.83,height:.17}));
const fixture=new Platform({modules:[{...bimModule,initialState:()=>structuredClone(source)}],stores:new MemoryStores(),logger:{info(){},warn(){}}});const run=(tool,input)=>fixture.execute({id:'fixture',name:'Memory preflight',kind:'human',roles:['bim_manager']},'fixture',tool,input);
if(!source.types['WT-0003'])await run('bim_create_types',{types:[{kind:'wall',name:'Cephe Döşeme Alın Kapaması — Sıva ve Boya 30 mm',layers:[{material:'M-0001',thickness:.01,function:'finish'},{material:'M-0002',thickness:.01,function:'finish'},{material:'M-0003',thickness:.01,function:'substrate'}]}]});
await run('bim_update_elements',{items});await run('bim_create_walls',{walls});const s=await fixture.state('fixture','bim');const issues=modelIssues(s);if(issues.length)throw Error(JSON.stringify(issues));
const bands=Object.values(s.elements).filter(e=>e.kind==='wall'&&e.type==='WT-0003');for(const e of bands)if(Math.abs(e.height-.17)>1e-6||Math.abs(e.baseOffset-2.83)>1e-6)throw Error(`Incorrect edge closure ${e.id}: ${e.height}, ${e.baseOffset}`);
fs.mkdirSync('test-results/facade-slab-edges',{recursive:true});fs.writeFileSync('test-results/facade-slab-edges/inputs.json',JSON.stringify({project,items,walls},null,2));console.log(JSON.stringify({floors:items.length,facadeBands:bands.length,issues}));
if(process.argv.includes('--propose-inset')){const r=await live.execute({id:'codex',name:'Codex',kind:'ai',roles:['ai_agent']},project,'bim_update_elements',{items});console.log(JSON.stringify({status:r.status,proposalId:r.proposalId}));}
