import fs from 'node:fs';
import {Platform,MemoryStores} from '@insa/core';
import {bimModule,modelIssues,quantities} from '@insa/bim';
import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
const source=await createPlatform().state('temiz-proje-20261013','bim');
const {updates,boundaries}=JSON.parse(fs.readFileSync('scripts/room-floors-inputs.json','utf8'));
const p=new Platform({modules:[{...bimModule,initialState:()=>structuredClone(source)}],stores:new MemoryStores(),logger:{info(){},warn(){}}});
const run=(tool,input)=>p.execute({id:'fixture',name:'Memory preflight',kind:'human',roles:['bim_manager']},'fixture',tool,input);
await run('bim_update_elements',{items:updates});await run('bim_create_boundaries',{boundaries});
const s=await p.state('fixture','bim'),issues=modelIssues(s);if(issues.length)throw Error(JSON.stringify(issues));
const floors=Object.values(s.elements).filter(e=>e.kind==='boundary'&&e.category==='architecture.floor');
for(const level of Object.values(s.storeys).filter(l=>l.elevation>0)){
 const group=floors.filter(f=>f.storey===level.id),area=group.reduce((v,e)=>v+quantities(s,e).area,0);
 if(group.length!==8||Math.abs(area-150)>1e-6)throw Error(`Invalid partition ${level.id}: ${group.length}, ${area}`);
}
console.log(JSON.stringify({floors:floors.length,perLevel:8,areaPerLevel:150,issues}));
