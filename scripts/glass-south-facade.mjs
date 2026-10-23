import {Platform,MemoryStores} from '@insa/core';import {bimModule,modelIssues} from '@insa/bim';import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
const live=createPlatform(),project='temiz-proje-20261013',source=await live.state(project,'bim');
const walls=Object.values(source.elements).filter(e=>e.kind==='wall'&&e.type==='WT-0001'&&Math.abs(e.start[1]-.13)<1e-7&&Math.abs(e.end[1]-.13)<1e-7);
if(walls.length!==11)throw Error(`Expected 11 south walls, got ${walls.length}`);
const items=walls.map(e=>({kind:'wall',id:e.id,set:{type:'WT-0004',name:'Güney Cephe — Cam Duvar'}}));
const p=new Platform({modules:[{...bimModule,initialState:()=>structuredClone(source)}],stores:new MemoryStores(),logger:{info(){},warn(){}}});const actor={id:'fixture',name:'Memory preflight',kind:'human',roles:['bim_manager']};
if(!source.types['WT-0004'])await p.execute(actor,'fixture','bim_create_types',{types:[{kind:'wall',name:'Cam Cephe Duvarı — 24 mm',layers:[{material:'Pencere Camı',thickness:.024,function:'finish'}]}]});
await p.execute(actor,'fixture','bim_update_elements',{items});const s=await p.state('fixture','bim'),issues=modelIssues(s);if(issues.length)throw Error(JSON.stringify(issues));console.log(JSON.stringify({walls:items.length,glassThickness:.024,existingWallAxesPreserved:true,issues}));
if(process.argv.includes('--propose')){const r=await live.execute({id:'codex',name:'Codex',kind:'ai',roles:['ai_agent']},project,'bim_update_elements',{items});console.log(JSON.stringify({status:r.status,proposalId:r.proposalId}));}

