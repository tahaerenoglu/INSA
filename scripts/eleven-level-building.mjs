import fs from 'node:fs';
import {Platform,MemoryStores} from '@insa/core';
import {bimModule,modelIssues,toIfc} from '@insa/bim';
import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
const project='temiz-proje-20261013',live=createPlatform();
const original=await live.state(project,'bim');
const base=Object.values(original.elements).filter(e=>e.kind==='wall'&&e.storey==='L-0001').sort((a,b)=>a.id.localeCompare(b.id));
if(base.length!==13)throw Error('Expected 13 source walls');
const fixture=new Platform({modules:[{...bimModule,initialState:()=>structuredClone(original)}],stores:new MemoryStores(),logger:{info(){},warn(){}}});
const human={id:'fixture',name:'Memory-only preflight',kind:'human',roles:['bim_manager']};
const run=(tool,input)=>fixture.execute(human,'preflight',tool,input);
const walls=Array.from({length:10},(_,i)=>base.map(w=>({storey:`${i+1}. Kat`,type:w.type,name:`${i+1}. Kat — ${w.name}`,start:w.start,end:w.end,height:3,base_offset:0,exterior_side:w.exterior === "left" ? "left" : "right"}))).flat();
await run('bim_create_walls',{walls});
const s=await fixture.state('preflight','bim');
const items=[];
for(const level of Object.values(s.storeys)){
 const ws=Object.values(s.elements).filter(e=>e.kind==='wall'&&e.storey===level.id).sort((a,b)=>a.id.localeCompare(b.id));
 if(ws.length!==13)throw Error(`Unexpected source walls on ${level.name}`);
 const door=(index,along,type)=>items.push({host:ws[index].id,kind:'door',along,sill:0,type});
 door(0,7.37,'DT-0003');door(4,1.87,'DT-0001');door(5,1.4,'DT-0001');door(8,1,'DT-0002');
 door(9,1.37,'DT-0001');door(9,4.37,'DT-0002');door(9,7.87,'DT-0001');door(12,1.5,'DT-0002');
 const window=(index,along,small=false)=>items.push({host:ws[index].id,kind:'window',along,sill:small?1.6:.9,type:small?'NT-0002':'NT-0001'});
 [2.37,9.87,12.87].forEach(x=>window(0,x));
 [1.87,6.87,12.37].forEach(x=>window(2,x));
 window(3,1.87);window(3,4.87,true);window(3,7.87);
 window(1,1.37);window(1,4.37,true);window(1,7.87);
}
await run('bim_place_openings',{items});
const final=await fixture.state('preflight','bim');const issues=modelIssues(final);
if(issues.length)throw Error(JSON.stringify(issues));
fs.mkdirSync('test-results/eleven-level-building',{recursive:true});
fs.writeFileSync('test-results/eleven-level-building/preflight.ifc',toIfc(final,{projectKey:project}));
fs.writeFileSync('test-results/eleven-level-building/inputs.json',JSON.stringify({project,walls,items},null,2));
console.log(JSON.stringify({storeys:Object.keys(final.storeys).length,newWalls:walls.length,doors:items.filter(x=>x.kind==='door').length,windows:items.filter(x=>x.kind==='window').length,issues}));
if(process.argv.includes('--propose-walls'))console.log(JSON.stringify(await live.execute({id:'codex',name:'Codex',kind:'ai',roles:['ai_agent']},project,'bim_create_walls',{walls})));

