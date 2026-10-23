import fs from 'node:fs';import path from 'node:path';
import {Platform,FileStores,ArtifactStore} from '@insa/core';
import {bimModule,toIfc,ifcToFrag,modelIssues} from '@insa/bim';
const root=path.resolve('test-results/material-appearance/data');
const project='pbr-demo-v01-final';
const p=new Platform({modules:[bimModule],stores:new FileStores(root),artifacts:new ArtifactStore(root),snapshotPolicy:{everyEvents:10,keep:2},logger:{info(){},warn(){}}});
const fixture={id:'fixture',name:'Isolated test fixture',kind:'human',roles:['bim_manager']};
const run=(tool,input)=>p.execute(fixture,project,tool,input);
if((await p.seq(project))>0){console.log('Fixture already exists');process.exit(0);}
await run('bim_set_project',{name:'PBR V0.1 — Yalıtılmış Test',description:'Concrete columns, brick walls, oak floors and glass. Isolated browser verification fixture.'});
await run('bim_create_storeys',{storeys:[{name:'Demo',elevation:0},{name:'Top',elevation:3}]});
const materials=[];
for(const [id,name,size]of [['concrete_wall_001','Beton C30/35',[2,2]],['brick_wall_001','Tuğla',[2,2]],['wood_floor','Meşe Parke',[1.7,1.7]]]){
 const response=await run('material_import',{asset_id:id,resolution:'1k',textureSize:size});
 materials.push({name,appearance:response.result.appearance});
 console.log(`Imported ${id}`);
}
materials.push({name:'Cam',color:'#b5e6ed',appearance:{baseColor:'#b5e6ed',opacity:.25,metallic:0,roughness:.08,textureSize:[1,1],normalConvention:'OpenGL'}});
await run('bim_create_materials',{materials});
await run('bim_create_types',{types:[{kind:'column',name:'Beton Kolon 400',material:'Beton C30/35',profile:{shape:'rect',b:.4,h:.4}},{kind:'wall',name:'Tuğla Duvar 200',layers:[{material:'Tuğla',thickness:.2}]},{kind:'slab',name:'Parke Zemin',layers:[{material:'Meşe Parke',thickness:.2}]}]});
await run('bim_create_slabs',{slabs:[{name:'Geniş parke yüzey 6x3',storey:'Demo',type:'Parke Zemin',outline:[[0,0],[6,0],[6,3],[0,3]]},{name:'Küçük parke yüzey 3x3',storey:'Demo',type:'Parke Zemin',outline:[[7,0],[10,0],[10,3],[7,3]]}]});
await run('bim_create_walls',{walls:[{name:'Tuğla uzun yüzey',storey:'Demo',type:'Tuğla Duvar 200',start:[0,3],end:[6,3]},{name:'Tuğla kısa yüzey',storey:'Demo',type:'Tuğla Duvar 200',start:[7,3],end:[10,3]}]});
await run('bim_create_columns',{columns:[{storey:'Demo',type:'Beton Kolon 400',at:[.3,.3]},{storey:'Demo',type:'Beton Kolon 400',at:[5.7,.3]},{storey:'Demo',type:'Beton Kolon 400',at:[7.3,.3]}]});
await run('bim_create_families',{families:[{name:'Cam panel',category:'architecture.generic_model',parameters:['width','depth','height'].map((name,i)=>({key:name,name,scope:'type',dataType:'length',required:true,default:[2,.04,2.5][i]})),representation:{kind:'box',width:'width',depth:'depth',height:'height'}}]});
await run('bim_create_types',{types:[{kind:'component',name:'Cam panel 2m',family:'Cam panel',parameters:{width:2,depth:.04,height:2.5},material:'Cam'}]});
await run('bim_create_components',{components:[{name:'Saydam cam panel',storey:'Demo',type:'Cam panel 2m',x:3,y:1.2}]});
const s=await p.state(project,'bim');const ifc=toIfc(s,{projectKey:project});
fs.mkdirSync('test-results/material-appearance',{recursive:true});
fs.writeFileSync('test-results/material-appearance/demo.ifc',ifc);
fs.writeFileSync('test-results/material-appearance/demo.frag',await ifcToFrag(ifc));
console.log(JSON.stringify({project,root,issues:modelIssues(s),elements:Object.keys(s.elements).length,materials:Object.values(s.materials).map(m=>({id:m.id,name:m.name,appearance:m.appearance}))}));
