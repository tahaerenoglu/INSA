import {test} from 'node:test';import assert from 'node:assert/strict';import {batchRoadView} from '../src/road-view-batch.js';
test('only sleepers combine; four rails and three beds keep independent resource objects',()=>{
 const roles=['rail','rail','rail','rail','ballast','subballast','subbase','sleeper','sleeper'];const resources=roles.map((role,i)=>({id:`part${i}`,kind:'pavement_layer',properties:{road:'RD-001',layerId:`layer${i}`,role}})),objects=resources.map((r,i)=>({id:r.id,kind:'mesh',positions:[i,0,0,i+1,0,0,i,1,0],color:'#aaa',geometryKey:r.id}));const out=batchRoadView(resources,objects);
 assert.equal(out.length,8);for(let i=0;i<7;i++)assert.ok(out.includes(objects[i]));const batch=out.find(o=>o.id==='infra:RD-001:sleepers');assert.ok(batch);assert.equal(batch.parent,'infra:RD-001');assert.equal(batch.parts.length,2);assert.equal(batch.materialGroups.length,2);assert.deepEqual(resources.find(r=>r.id===batch.id)!.properties.layerIds,['layer7','layer8']);
});
