import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {FileStores,MemoryStores} from '@insa/core';import {createPlatform} from '../src/runtime.js';import {infraIfcText} from '@insa/infra';
const human:any={id:'fixture',name:'Isolated fixture',kind:'human',roles:['bim_manager']},ai:any={id:'ai',name:'AI',kind:'ai',roles:['ai_agent']};
const types={types:[{name:'Circle',profile:{shape:'circle',radius:3,center_y:0},layers:[{name:'A',thickness:.3},{name:'B',thickness:.2}]}]};
test('canonical layer ids, governed assignment, undo, material lifecycle and project isolation',async()=>{
 const previous=process.env.INSA_APPROVAL;process.env.INSA_APPROVAL='ai';try{
 const p=createPlatform(new MemoryStores());await p.execute(human,'demo','bim_create_materials',{materials:[{name:'Concrete'},{name:'Shotcrete'}]});await p.execute(human,'other','bim_create_materials',{materials:[{name:'Other'},{name:'Other2'},{name:'Foreign only'}]});await p.execute(human,'demo','infra_create_section_types',types);
 const before:any=structuredClone(await p.state('demo','infra')),ids=before.sections['TS-001'].layers.map((l:any)=>l.id);assert.equal(new Set(ids).size,2);
 const assign={section:'TS-001',assignments:[{layerId:ids[0],materialId:'M-0001'},{layerId:ids[1],materialId:'M-0002'}]};const proposal:any=await p.execute(ai,'demo','infra_update_section_type',assign);assert.equal(proposal.status,'proposed');assert.equal((await p.state<any>('demo','infra')).sections['TS-001'].layers[0].materialId,undefined);await p.approve(human,'demo',proposal.proposalId);
 await assert.rejects(p.execute(human,'demo','bim_delete_materials',{materials:['M-0001']}),/in use/);
 await assert.rejects(p.execute(human,'demo','infra_update_section_type',{section:'TS-001',assignments:[{layerId:ids[0],materialId:'M-0003'}]}),/does not exist in this project/);
 await assert.rejects(p.execute(human,'demo','infra_update_section_type',{section:'TS-001',assignments:[{layerId:'wrong',materialId:'M-0001'}]}),/Unknown layer/);
 const undo:any=await p.execute(ai,'demo','platform_undo',{});assert.equal(undo.status,'proposed');await p.approve(human,'demo',undo.proposalId);assert.deepEqual(await p.state('demo','infra'),before);
 await p.execute(human,'demo','infra_update_section_type',assign);
 const layers=(await p.state<any>('demo','infra')).sections['TS-001'].layers;await p.execute(human,'demo','infra_update_section_type',{section:'TS-001',layers:[layers[1],{name:'New',thickness:.1},layers[0]]});let changed=(await p.state<any>('demo','infra')).sections['TS-001'].layers;assert.equal(changed[0].id,ids[1]);assert.equal(changed[0].materialId,'M-0002');assert.equal(changed[2].materialId,'M-0001');assert.ok(changed[1].id);
 await p.execute(human,'demo','infra_update_section_type',{section:'TS-001',layers:[changed[0],changed[2]]});changed=(await p.state<any>('demo','infra')).sections['TS-001'].layers;assert.equal(changed[1].id,ids[0]);
 await p.execute(human,'demo','infra_update_section_type',{section:'TS-001',assignments:[{layerId:ids[0],materialId:null}]});await p.execute(human,'demo','bim_delete_materials',{materials:['M-0001']});
 }finally{if(previous===undefined)delete process.env.INSA_APPROVAL;else process.env.INSA_APPROVAL=previous;}
});
test('material references survive FileStores reopen and IFC semantic associations use canonical names',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'insa-01c-'));try{const p=createPlatform(new FileStores(root));await p.execute(human,'demo','bim_create_materials',{materials:[{name:'Canonical Concrete'}]});await p.execute(human,'demo','infra_create_section_types',types);const id=(await p.state<any>('demo','infra')).sections['TS-001'].layers[0].id;
 await p.execute(human,'demo','infra_update_section_type',{section:'TS-001',assignments:[{layerId:id,materialId:'M-0001'}]});await p.execute(human,'demo','infra_create_alignment',{name:'Straight',horizontal:[{x:0,y:0},{x:50,y:0}],vertical:[{station:0,z:0},{station:50,z:0}]});await p.execute(human,'demo','infra_create_tunnel',{name:'Tunnel',alignment:'AL-001',ranges:[{from:0,to:50,section:'TS-001'}]});
 await p.createSnapshot('demo');const reopened=createPlatform(new FileStores(root)),s:any=await reopened.state('demo','infra'),b:any=await reopened.state('demo','bim');assert.equal(s.sections['TS-001'].layers[0].materialId,'M-0001');const text=infraIfcText(s,'demo',false,b.materials);assert.match(text,/IFCMATERIAL\('Canonical Concrete'/);assert.match(text,/IFCRELASSOCIATESMATERIAL/);assert.match(text,/M-0001/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
