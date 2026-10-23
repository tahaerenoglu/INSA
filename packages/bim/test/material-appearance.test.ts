import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { Platform,MemoryStores,FileStores,ArtifactStore } from '@insa/core';
import { bimModule,toIfc, type BimState,AppearanceSchema } from '../src/index.js';
import { allowedTextureUrl,boundedFetch,validateTexture } from '../src/polyhaven.js';
const actor:any={id:'test',name:'Test',kind:'human',roles:['bim_manager']};
const appearance=()=>AppearanceSchema.parse({baseColor:'#aabbcc',roughness:.65,metallic:.1,opacity:.9,textureSize:[1,2]});

test('door/window material assignment persists and exports semantic relationships',async()=>{
 const p=new Platform({modules:[bimModule],stores:new MemoryStores(),logger:{info(){},warn(){}}});
 const run=(tool:string,input:any)=>p.execute(actor,'insert-materials',tool,input);
 await run('bim_create_storeys',{storeys:[{name:'Ground',elevation:0}]});
 await run('bim_create_types',{types:[{kind:'wall',name:'Wall',layers:[{material:'Concrete',thickness:.2}]},{kind:'door',name:'Door',width:.9,height:2.1,material:'Wood'},{kind:'window',name:'Window',width:1,height:1,material:'Glass'}]});
 await run('bim_create_walls',{walls:[{storey:'Ground',type:'Wall',start:[0,0],end:[5,0],height:3}]});
 await run('bim_place_openings',{items:[{host:'W-0001',kind:'door',along:1,type:'Door'},{host:'W-0001',kind:'window',along:3,type:'Window'}]});
 const s=await p.state<BimState>('insert-materials','bim');
 assert.equal(s.types['DT-0001'].material,'M-0002');assert.equal(s.types['NT-0001'].material,'M-0003');
 await assert.rejects(run('bim_delete_materials',{materials:['M-0002']}),/used|use/i);
 assert.match(toIfc(s,{projectKey:"insert-materials"}),/IFCRELASSOCIATESMATERIAL/);
 await run('bim_update_types',{items:[{kind:'door',type:'DT-0001',set:{material:'Glass'}}]});
 assert.equal((await p.state<BimState>('insert-materials','bim')).types['DT-0001'].material,'M-0003');
});
test('layered type assigns material ids in order and exposes selectable details on one element',async()=>{
 const p=new Platform({modules:[bimModule],stores:new MemoryStores(),logger:{info(){},warn(){}}});
 const run=(tool:string,input:any)=>p.execute(actor,'layers',tool,input);
 await run('bim_create_storeys',{storeys:[{name:'Level',elevation:0}]});
 await run('bim_create_materials',{materials:[{name:'Finish',appearance:appearance()},{name:'Core'},{name:'Plaster',color:'#ffffff'}]});
 await run('bim_create_types',{types:[{kind:'wall',name:'Coated wall',layers:[{material:'M-0001',thickness:.02,function:'finish'},{material:'M-0002',thickness:.2,function:'structure'},{material:'M-0003',thickness:.015,function:'finish'}]}]});
 await run('bim_create_walls',{walls:[{storey:'Level',type:'Coated wall',start:[0,0],end:[4,0],height:3}]});
 const r:any=await run('bim_get_element',{id:'W-0001'});const s=await p.state<BimState>('layers','bim');
 assert.equal(Object.keys(s.elements).length,1);assert.equal(Object.keys(s.materials).length,3);
 assert.deepEqual(r.result.material_details.map((l:any)=>l.definition.name),['Finish','Core','Plaster']);
 assert.deepEqual(r.result.material_details[0].definition.appearance,appearance());
 assert.equal(r.result.type_def.layers[1].material,'M-0002');
});
test('appearance CRUD preserves old fields, undo and IFC semantic material references',async()=>{
 const p=new Platform({modules:[bimModule],stores:new MemoryStores(),logger:{info(){},warn(){}}});
 const run=(tool:string,input:any)=>p.execute(actor,'p',tool,input);
 await run('bim_create_materials',{materials:[{name:'Old',color:'#123456',category:'Concrete'},{name:'Oak',appearance:appearance()}]});
 await run('bim_create_storeys',{storeys:[{name:'Level',elevation:0}]});
 await run('bim_create_types',{types:[{kind:'slab',name:'Floor',layers:[{material:'Oak',thickness:.2}]}]});
 await run('bim_create_slabs',{slabs:[{storey:'Level',type:'Floor',outline:[[0,0],[3,0],[3,2],[0,2]]}]});
 await run('bim_update_materials',{items:[{material:'Old',set:{appearance:appearance()}}]});
 const s=await p.state<BimState>('p','bim');assert.equal(s.materials['M-0001'].color,'#123456');assert.equal(s.materials['M-0001'].category,'Concrete');
 const ifc=toIfc(s,{projectKey:"p"});assert.match(ifc,/IFCMATERIAL\('Oak'/);assert.match(ifc,/IFCRELASSOCIATESMATERIAL/);assert.doesNotMatch(ifc,/textureSize|roughness|tex-/);
 await run('platform_undo',{});assert.equal((await p.state<BimState>('p','bim')).materials['M-0001'].appearance,undefined);
 const before=JSON.stringify(await p.state('p','bim'));
 await assert.rejects(run('bim_update_materials',{items:[{material:'Oak',set:{appearance:{roughness:1.2}}}]}));assert.equal(JSON.stringify(await p.state('p','bim')),before);
 await run('bim_update_materials',{items:[{material:'Oak',set:{appearance:null}}]});assert.equal((await p.state<BimState>('p','bim')).materials['M-0002'].appearance,null);
});
test('appearance survives FileStores snapshots and reopen',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'insa-material-'));
 try{const stores=new FileStores(root); const make=()=>new Platform({modules:[bimModule],stores,snapshotPolicy:{everyEvents:1,keep:2},logger:{info(){},warn(){}}});
  await make().execute(actor,'p','bim_create_materials',{materials:[{name:'Persistent',appearance:appearance()}]});
  const reopened=await make().state<BimState>('p','bim');assert.deepEqual(reopened.materials['M-0001'].appearance,appearance());
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('remote URLs, bounded download and invalid file formats are refused',async()=>{
 for(const url of ['http://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/a.jpg','https://127.0.0.1/a.jpg','https://dl.polyhaven.org.evil.test/file/ph-assets/Textures/jpg/a.jpg','https://dl.polyhaven.org/file/ph-assets/Textures/jpg/a.jpg?x=1'])assert.throws(()=>allowedTextureUrl(url));
 assert.equal(allowedTextureUrl('https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/a.jpg'),'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/a.jpg');
 await assert.rejects(boundedFetch('https://example.test',2,(async()=>new Response('abcd'))as typeof fetch),/too large/);
 assert.throws(()=>validateTexture(Buffer.from('<html>'),{size:6,md5:'0'.repeat(32)}));
});
test('texture storage is content-addressed and refuses path traversal or missing assets',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'insa-texture-'));
 try{const store=new ArtifactStore(root);assert.throws(()=>store.resolveTexture('p','../../secret.jpg'));assert.throws(()=>store.saveTexture('p','0'.repeat(32),Buffer.from('wrong')));assert.throws(()=>store.resolveTexture('p','tex-'+ '0'.repeat(32)+'.jpg'));}finally{fs.rmSync(root,{recursive:true,force:true});}
});

