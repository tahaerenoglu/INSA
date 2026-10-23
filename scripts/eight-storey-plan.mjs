import fs from 'node:fs';
import { Platform, MemoryStores } from '@insa/core';
import { bimModule } from '@insa/bim';
import { createPlatform } from '../apps/manager-mcp/src/runtime.ts';
const project='yeni-proje-20261013-01';
const real=createPlatform();
const source=await real.state(project,'bim');
const p=new Platform({modules:[bimModule],stores:new MemoryStores(),logger:{info(){},warn(){}}});
const actor={id:'test',name:'Preflight',kind:'human',roles:['bim_manager']};
const run=(name,input)=>p.execute(actor,'preflight',name,input);
const levels=Array.from({length:8},(_,i)=>i===0?'Zemin Kat':`${i}. Kat`);
await run('bim_create_storeys',{storeys:[{name:'Temel',elevation:-.5},...levels.map((name,i)=>({name,elevation:i*3.2})),{name:'Çatı',elevation:25.6}]});
await run('bim_create_types',{types:Object.values(source.types).map(t=>t.layers?{kind:t.kind,name:t.name,layers:t.layers.map(l=>({...l,material:source.materials[l.material].name}))}:t.kind==='stair'?{kind:'stair',name:t.name,max_riser:t.maxRiser,min_tread:t.minTread,default_width:t.defaultWidth,material:'Concrete C30/35'}:{kind:t.kind,name:t.name,width:t.width,height:t.height})});
const outline=[[0,0],[12.5,0],[12.5,8.9],[7.3,8.9],[7.3,14.3],[4.5,14.3],[4.5,8.9],[0,8.9]];
const hole=[[4.7,10.1],[7.1,10.1],[7.1,12.4],[4.7,12.4]];
const boundaries={boundaries:[{category:'structure.foundation_slab',storey:'Temel',type:'Radye Temel 500 mm',name:'Radye temel',offset:.3,outline:[[-.4,-.4],[12.9,-.4],[12.9,9.3],[7.7,9.3],[7.7,14.7],[4.1,14.7],[4.1,9.3],[-.4,9.3]]},...levels.map((storey,i)=>({category:'architecture.floor',storey,type:'Betonarme Döşeme 200 mm',name:`${storey} döşemesi`,outline,holes:i?[hole]:[]})),{category:'architecture.roof',storey:'Çatı',type:'Düz Çatı 200 mm',name:'Bina ve merdiven üstü düz çatı',outline}]};
const walls={walls:levels.flatMap((storey,i)=>{
 const top_storey=levels[i+1]??'Çatı';
 const inner=(name,start,end)=>({storey,top_storey,type:'İç Duvar 150 mm',name:`${storey} | ${name}`,start,end});
 return [{storey,top_storey,type:'Dış Duvar 200 mm',name:`${storey} | Dış çevre`,closed:true,location_line:'exterior_face',points:[[0,0],[12.5,0],[12.5,8.9],[0,8.9]]},
 ...[[[4.6,8.8],[4.6,14.2]],[[4.6,14.2],[7.2,14.2]],[[7.2,14.2],[7.2,8.8]]].map(([start,end],j)=>({storey,top_storey,type:'Dış Duvar 200 mm',name:`${storey} | Merdiven çekirdeği ${j+1}`,start,end})),
 inner('Ana yatak odası',[4.5,.1],[4.5,8.8]),inner('Ebeveyn banyosu alt duvar',[.1,5.7],[4.5,5.7]),inner('Ebeveyn banyosu yan duvar',[2.6,5.7],[2.6,8.8]),
 inner('Sağ oda koridor duvarı',[9,.1],[9,8.8]),inner('Yatak odası 3 üst duvar',[9,3.2],[12.4,3.2]),inner('Ortak banyo üst duvar',[9,5.7],[12.4,5.7])];
})};
const stairs={stairs:levels.slice(0,7).flatMap(storey=>[{storey,type:'Ortak Merdiven 1200 mm',name:`${storey} alt merdiven kolu`,start:[5.3,10.1],end:[5.3,12.34],width:1.2,riser_count:9,height:1.6},{storey,type:'Ortak Merdiven 1200 mm',name:`${storey} üst merdiven kolu`,start:[6.6,12.34],end:[6.6,10.1],width:1.2,riser_count:9,height:1.6,base_offset:1.6}])};
for (const wall of walls.walls) if (wall.storey === levels[7]) { delete wall.top_storey; wall.height = 3; }
boundaries.boundaries.push(...levels.slice(0,7).map(storey=>({category:'architecture.landing',storey,type:'Betonarme Döşeme 200 mm',name:`${storey} ara sahanlık`,offset:1.6,outline:[[4.7,12.34],[7.1,12.34],[7.1,13.64],[4.7,13.64]]})));
await run('bim_create_boundaries',boundaries);
await run('bim_create_walls',walls);
await run('bim_create_stairs',stairs);
const state=await p.state('preflight','bim');
const openings={items:levels.flatMap(storey=>{
 const ws=Object.values(state.elements).filter(e=>e.kind==='wall'&&state.storeys[e.storey].name===storey);
 const byName=n=>ws.find(w=>w.name===`${storey} | ${n}`).id;
 const exterior=ws.filter(w=>w.name===`${storey} | Dış çevre`);
 const door=(host,at,type='Oda Kapısı 900x2100',name='Oda kapısı')=>({kind:'door',host,at,type,name:`${storey} | ${name}`});
 return [door(exterior[2].id,[5.8,8.8],'Giriş Kapısı 1000x2100','Daire girişi'),door(byName('Ana yatak odası'),[4.5,4.5]),door(byName('Ebeveyn banyosu alt duvar'),[1.2,5.7],'Banyo Kapısı 800x2100'),door(byName('Sağ oda koridor duvarı'),[9,1.9]),door(byName('Sağ oda koridor duvarı'),[9,4.4],'Banyo Kapısı 800x2100'),door(byName('Sağ oda koridor duvarı'),[9,6.8]),
 ...[[exterior[0].id,[2.2,.1]],[exterior[0].id,[6.8,.1]],[exterior[0].id,[10.7,.1]],[exterior[1].id,[12.4,7.3]],[exterior[2].id,[7.8,8.8]],[exterior[3].id,[.1,3.0]]].map(([host,at])=>({kind:'window',host,at,type:'Pencere 1500x1200',sill:1,name:`${storey} | Pencere`})),
 ...(storey===levels[0]?[door(byName('Merdiven çekirdeği 2'),[5.9,14.2],'Giriş Kapısı 1000x2100','Bina girişi')]:[])];
})};
await run('bim_place_openings',openings);
const output={project,assumptions:{width:12.5,depth:8.9,storeyHeight:3.2},boundaries,walls,stairs,openings};
fs.writeFileSync('eight-storey-plan.json',JSON.stringify(output,null,2));
console.log(JSON.stringify({preflight:'passed',elements:Object.keys((await p.state('preflight','bim')).elements).length,storeys:levels.length,wallRequests:walls.walls.length,stairs:stairs.stairs.length,boundaries:boundaries.boundaries.length,openings:openings.items.length}));
if (process.argv.includes('--submit')) {
 const ai={id:'codex',name:'Codex',kind:'ai',roles:['ai_agent']};
 for(const [tool,input] of [['bim_create_boundaries',boundaries],['bim_create_walls',walls],['bim_create_stairs',stairs]]) {
  const result=await real.execute(ai,project,tool,input);
  console.log(JSON.stringify({tool,status:result.status,proposalId:result.proposalId}));
 }
}
