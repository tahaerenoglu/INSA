import fs from 'node:fs';
import {Platform,MemoryStores} from '@insa/core';import {bimModule,modelIssues} from '@insa/bim';
import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
const source=await createPlatform().state('temiz-proje-20261013','bim');
const p=new Platform({modules:[{...bimModule,initialState:()=>structuredClone(source)}],stores:new MemoryStores(),logger:{info(){},warn(){}}});
const run=(tool,input)=>p.execute({id:'fixture',name:'Memory preflight',kind:'human',roles:['bim_manager']},'fixture',tool,input);
if(!source.types['BT-0001'])await run('bim_create_types',{types:[{kind:'beam',name:'Ahşap Çatı Merteği 100 × 200 mm',material:'Kapı Ahşabı',profile:{shape:'rect',b:.1,h:.2}},{kind:'beam',name:'Ahşap Çatı Mahya/Aşık 150 × 250 mm',material:'Kapı Ahşabı',profile:{shape:'rect',b:.15,h:.25}}]});
const slope=.08,base=3.36,z=y=>base+slope*(y<=5?y:10-y),members=[];
// Leave the ridge member's full section clear, including the rafter end's slope projection.
const gap=.075+.1*slope/Math.sqrt(1+slope*slope)+.001;
for(let i=0;i<=26;i++){const x=-.3+i*.6;
 for(const [a,b,label]of [[-.3,5-gap,'Güney'],[10.3,5+gap,'Kuzey']])members.push({category:'structure.brace',storey:'L-0011',type:'BT-0001',name:`Ahşap Mertek ${i+1} — ${label}`,start:[x,a],end:[x,b],start_offset:z(a),end_offset:z(b)});
}
// Purlin top clears the lowest rafter underside across its 150 mm width.
for(const y of [.13,2.5,5,7.5,9.87])members.push({category:'structure.framing',storey:'L-0011',type:'BT-0002',name:y===5?'Ahşap Mahya':'Ahşap Aşık',start:[-.3,y],end:[15.3,y],z:z(y)-.1*Math.sqrt(1+slope*slope)-slope*.075-.001});
await run('bim_create_profile_members',{members});const s=await p.state('fixture','bim'),issues=modelIssues(s);if(issues.length)throw Error(JSON.stringify(issues));
for(const m of members.filter(m=>m.category==='structure.brace'))if(Math.abs(Math.abs(m.end_offset-m.start_offset)/Math.abs(m.end[1]-m.start[1])-.08)>1e-10)throw Error('Wrong roof slope');
fs.mkdirSync('test-results/timber-roof',{recursive:true});fs.writeFileSync('test-results/timber-roof/inputs.json',JSON.stringify({project:'temiz-proje-20261013',members},null,2));
console.log(JSON.stringify({rafters:54,purlins:5,spacing:.6,slopePercent:8,pitchDegrees:Math.atan(.08)*180/Math.PI,issues}));
