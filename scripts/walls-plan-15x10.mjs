import fs from 'node:fs';
import {Platform,MemoryStores} from '@insa/core';import {bimModule,modelIssues,planSvg,svgToPng} from '@insa/bim';
const project='temiz-proje-20261013';
const layers=[['Boya',.01,'finish'],['İnce Sıva',.01,'finish'],['Kaba Sıva',.01,'substrate'],['Gazbeton Blok',.2,'structure'],['Kaba Sıva',.01,'substrate'],['İnce Sıva',.01,'finish'],['Boya',.01,'finish']].map(([material,thickness,functionName])=>({material,thickness,function:functionName}));
const p=new Platform({modules:[bimModule],stores:new MemoryStores(),logger:{info(){},warn(){}}});
const actor={id:'fixture',name:'Preflight',kind:'human',roles:['bim_manager']};const run=(tool,input)=>p.execute(actor,'preflight',tool,input);
await run('bim_create_storeys',{storeys:[{name:'Zemin Kat',elevation:0}]});
await run('bim_create_types',{types:[{kind:'wall',name:'Dış Duvar',layers},{kind:'wall',name:'İç Duvar',layers:[{material:'Gazbeton Blok',thickness:.2,function:'structure'}]}]});
const inner=(name,start,end)=>({storey:'Zemin Kat',type:'WT-0002',name,start,end,height:3});
const walls=[{storey:'Zemin Kat',type:'WT-0001',name:'Dış çevre 15 × 10 m',closed:true,location_line:'exterior_face',points:[[0,0],[15,0],[15,10],[0,10]],height:3},
inner('Sol alt yatak odası doğu',[5,.13],[5,4]),inner('Sol üst yatak odası doğu',[5,6],[5,9.87]),
inner('Sol alt yatak odası kuzey',[.13,4],[5,4]),inner('Sol üst yatak odası güney',[.13,6],[5,6]),
inner('Sol WC doğu',[3,4],[3,6]),inner('Sağ odalar ve salon bölmesi',[11,.13],[11,9.87]),
inner('Makine odası kuzey',[11,3],[14.87,3]),inner('Sağ yatak odası güney',[11,6],[14.87,6]),
inner('WC duş ve sauna bölmesi',[13,3],[13,6])];
await run('bim_create_walls',{walls});const state=await p.state('preflight','bim');
const issues=modelIssues(state);if(issues.length)throw new Error(JSON.stringify(issues));
fs.writeFileSync('walls-plan-15x10.json',JSON.stringify({project,walls},null,2));
fs.writeFileSync('walls-plan-15x10-preview.png',svgToPng(planSvg(state,state.storeys['L-0001'],{showIds:false,width:1200})));
console.log(JSON.stringify({walls:Object.keys(state.elements).length,height:3,outerThickness:.26,joins:Object.keys(state.joins).length,issues}));
