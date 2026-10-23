import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {FileStores,canonicalJson} from '@insa/core';import {createPlatform} from '../../manager-mcp/src/runtime.js';
import {infrastructureScene,infrastructureMaterials} from '../src/infrastructure.js';
const actor:any={id:'fixture',name:'Isolated test fixture',kind:'human',roles:['bim_manager']};
test('profile corridor replays, retains design basis and materials, updates native selectable pieces, and undo restores them',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'insa-profile-'));
 try{const p=createPlatform(new FileStores(root)),project='isolated',run=(tool:string,input:any)=>p.execute(actor,project,tool,input);
  await run('bim_set_project',{name:'Isolated test'});await run('bim_set_georeference',{crs:{name:'test-local'},eastings:400000,northings:4500000,orthogonal_height:55});await run('infra_set_crs',{crs:'test-local'});
  await run('bim_create_materials',{materials:[{name:'Sleeper concrete',color:'#bfbfbf'}]});
  await run('infra_create_alignment',{name:'Source',horizontal:[{x:400000,y:4500000},{x:400200,y:4500000}],vertical:[{station:0,z:55},{station:100,z:54,curve:100},{station:200,z:55}]});
  const before:any=await p.state(project,'infra'),alignment=canonicalJson(before.alignments);
  const layer={id:'sleepers',name:'Sleepers',role:'sleeper',thickness:.234,leftExtent:1.3,rightExtent:1.3,materialId:'M-0001',profile:[[-1.3,-.406],[1.3,-.406],[1.3,-.172],[-1.3,-.172]],repeat:{anchor:50.15,spacing:.6,length:.3}};
  const designBasis={status:'design assumptions',notes:['not definitive project dimensions'],sources:[{title:'test source',reference:'test.pdf'}]};
  await run('infra_create_road_corridor',{name:'Railway',alignment:'AL-001',from:50,to:150,sections:[50,150].map(station=>({station,leftWidth:7.25,rightWidth:7.25,leftShoulder:0,rightShoulder:0,leftCrossfall:-.05,rightCrossfall:-.05})),layers:[layer],designBasis});
  const scene=async(q:ReturnType<typeof createPlatform>)=>{const s:any=await q.state(project,'infra'),b:any=await q.state(project,'bim');return infrastructureMaterials(infrastructureScene(project,s,b),s,b);};
  const saved=await scene(p),batch=saved.objects.find(o=>o.id==='infra:RD-001:sleepers')!,pieces=batch.parts;assert.equal(pieces.length,167);assert.equal(new Set(pieces.map(o=>o.id)).size,167);assert.equal(saved.objects.filter(o=>o.kind==='mesh-batch').length,1);assert.equal(batch.materialGroups.length,1);assert.equal(batch.materialGroups[0].materialId,'M-0001');assert.ok(batch.positions.every(Number.isFinite)&&batch.uvMetres.every(Number.isFinite));
  assert.deepEqual(await scene(createPlatform(new FileStores(root))),saved);assert.deepEqual((await p.state<any>(project,'infra')).roads['RD-001'].designBasis,designBasis);
  await run('infra_update_road_corridor',{road:'RD-001',layers:[{...layer,repeat:{...layer.repeat,spacing:.8}}]});assert.notEqual((await scene(p)).objects.find(o=>o.id==='infra:RD-001:sleepers')!.parts.length,pieces.length);assert.equal(canonicalJson((await p.state<any>(project,'infra')).alignments),alignment);
  await run('platform_undo',{});assert.deepEqual(await scene(p),saved);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
