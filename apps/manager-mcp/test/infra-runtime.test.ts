import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {MemoryStores,FileStores} from '@insa/core';import {createPlatform} from '../src/runtime.js';
const actor:any={id:'fixture',name:'Integration fixture',kind:'human',roles:['bim_manager']};
const alignment={name:'500 m integration alignment',horizontal:[{x:412000,y:4561000},{x:412500,y:4561000}],vertical:[{station:0,z:62},{station:500,z:67}]};
test('shared runtime exposes existing infra tools and isolates BIM/infra project state',async()=>{
 const p=createPlatform(new MemoryStores());
 const names=p.listTools().map(t=>t.name);for(const name of ['bim_create_walls','material_search','infra_create_alignment','infra_tunnel_quantities','infra_export_ifc'])assert.ok(names.includes(name));
 await p.execute(actor,'infra-runtime','bim_create_storeys',{storeys:[{name:'Ground',elevation:0}]});
 await p.execute(actor,'infra-runtime','infra_create_alignment',alignment);
 assert.equal(Object.keys((await p.state<any>('infra-runtime','infra')).alignments).length,1);
 assert.equal(Object.keys((await p.state<any>('other-project','infra')).alignments).length,0);
 assert.equal(Object.keys((await p.state<any>('infra-runtime','bim')).storeys).length,1);
 await p.execute(actor,'infra-runtime','platform_undo',{});
 assert.equal(Object.keys((await p.state<any>('infra-runtime','infra')).alignments).length,0);
 assert.equal(Object.keys((await p.state<any>('infra-runtime','bim')).storeys).length,1);
});
test('shared runtime infrastructure survives FileStores reopen',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'insa-infra-runtime-'));
 try{const first=createPlatform(new FileStores(root));await first.execute(actor,'persisted', 'infra_create_alignment',alignment);const before=await first.state('persisted','infra');const reopened=createPlatform(new FileStores(root));assert.deepEqual(await reopened.state('persisted','infra'),before);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('infra writes retain the shared AI proposal and human approval policy',async()=>{
 const previous=process.env.INSA_APPROVAL;process.env.INSA_APPROVAL='ai';
 try{const p=createPlatform(new MemoryStores());const r:any=await p.execute({id:'ai',name:'AI',kind:'ai',roles:['ai_agent']},'governed','infra_create_alignment',alignment);
 assert.equal(r.status,'proposed');assert.equal(Object.keys((await p.state<any>('governed','infra')).alignments).length,0);
 await p.approve(actor,'governed',r.proposalId);assert.equal(Object.keys((await p.state<any>('governed','infra')).alignments).length,1);
 }finally{if(previous===undefined)delete process.env.INSA_APPROVAL;else process.env.INSA_APPROVAL=previous;}
});
