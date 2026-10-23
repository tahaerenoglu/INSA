import fs from 'node:fs';
import {Platform,MemoryStores} from '@insa/core';
import {bimModule,modelIssues} from '@insa/bim';
import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
const live=createPlatform(),project='temiz-proje-20261013',source=await live.state(project,'bim');
const p=new Platform({modules:[{...bimModule,initialState:()=>structuredClone(source)}],stores:new MemoryStores(),logger:{info(){},warn(){}}});
const run=(tool,input)=>p.execute({id:'fixture',name:'Memory preflight',kind:'human',roles:['bim_manager']},'fixture',tool,input);
if(!source.types['CT-0001'])await run('bim_create_types',{types:[{kind:'column',name:'Kazık Ø1000 mm — Beton C30/35',material:'M-0005',profile:{shape:'circle',d:1}}]});
const piles=[1.5,5.5,9.5,13.5].flatMap(x=>[1,5,9].map(y=>({storey:'L-0001',type:'CT-0001',at:[x,y],base_offset:-.5,length:20,name:`Kazık Ø1000 — (${x}, ${y})`})));
await run('bim_create_piles',{piles});const s=await p.state('fixture','bim'),issues=modelIssues(s);if(issues.length)throw Error(JSON.stringify(issues));
for(const a of piles){if(a.at[0]-.5<-.3||a.at[0]+.5>15.3||a.at[1]-.5<-.3||a.at[1]+.5>10.3)throw Error('Pile outside raft');}
fs.mkdirSync('test-results/raft-piles',{recursive:true});fs.writeFileSync('test-results/raft-piles/inputs.json',JSON.stringify({project,piles},null,2));
console.log(JSON.stringify({count:piles.length,grid:'4 × 3',spacing:4,diameter:1,top:-.5,bottom:-20.5,issues}));
