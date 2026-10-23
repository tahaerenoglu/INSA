import fs from 'node:fs';import {Platform,MemoryStores} from '@insa/core';import {bimModule,toIfc,modelIssues} from '@insa/bim';import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
const live=createPlatform(),project='temiz-proje-20261013',source=await live.state(project,'bim');
const items=Object.values(source.types).filter(t=>t.kind==='window').map(t=>({kind:'window',type:t.id,set:{window_frame:{width:.06,depth:.07,glassThickness:.024}}}));
const ids=Object.values(source.elements).filter(e=>e.kind==='component'&&/^N-\d+ — .*Ahşap Çıta$/.test(e.name??'')).map(e=>e.id);
const fixture=new Platform({modules:[{...bimModule,initialState:()=>structuredClone(source)}],stores:new MemoryStores(),logger:{info(){},warn(){}}});
const actor={id:'fixture',name:'Memory preflight',kind:'human',roles:['bim_manager']};await fixture.execute(actor,'fixture','bim_update_types',{items});await fixture.execute(actor,'fixture','bim_delete_elements',{ids});
const s=await fixture.state('fixture','bim');if(modelIssues(s).length)throw Error(JSON.stringify(modelIssues(s)));
fs.mkdirSync('test-results/window-section',{recursive:true});fs.writeFileSync('test-results/window-section/updated.ifc',toIfc(s,{projectKey:project}));
console.log(JSON.stringify({windows:Object.values(s.elements).filter(e=>e.kind==='hosted_component'&&s.types[e.type].kind==='window').length,removedTrim:ids.length,issues:modelIssues(s)}));
if(process.argv.includes('--propose')){const ai={id:'codex',name:'Codex',kind:'ai',roles:['ai_agent']};for(const [tool,input]of [['bim_update_types',{items}],['bim_delete_elements',{ids}]]){const r=await live.execute(ai,project,tool,input);console.log(JSON.stringify({status:r.status,proposalId:r.proposalId}));}}
