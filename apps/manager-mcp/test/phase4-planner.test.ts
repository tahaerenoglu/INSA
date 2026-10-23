import {test} from 'node:test';import assert from 'node:assert/strict';
import {Platform,MemoryStores,canonicalJson} from '@insa/core';
import {bimModule,type BimState} from '@insa/bim';import {infraModule} from '@insa/infra';import {filesModule} from '@insa/files';import {modelingModule} from '../src/modeling.js';
const actor={id:'p4',name:'Phase 4',kind:'human' as const,roles:['bim_manager']};
function setup(){const stores=new MemoryStores(),p=new Platform({modules:[bimModule,infraModule,filesModule,modelingModule],stores,approvalMode:'auto'});return {p,stores,run:(name:string,input:unknown)=>p.execute(actor,'p4',name,input) as Promise<any>,state:()=>p.state<BimState>('p4','bim')};}
test('P1: missing intent inputs produce a read-only blocked plan; explicit Turkish intent produces an executable pinned plan',async()=>{
 const t=setup(),before=canonicalJson(await t.state());
 const missing=await t.run('model_plan',{intent:'Çok katlı bir bina oluştur',requestId:'missing'});assert.equal(missing.result.summary.status,'REQUIRES_INPUT');assert.equal(missing.result.steps.length,0);assert.equal(canonicalJson(await t.state()),before);
 const solar=(await t.run('model_plan',{intent:'Bu GES için 5000 panel yerleştir',requestId:'missing-solar'})).result;assert.equal(solar.summary.status,'REQUIRES_INPUT');assert.equal(solar.summary.projectType,'solar-plant');assert.equal(canonicalJson(await t.state()),before);
 await assert.rejects(t.run('model_generate',{intent:'Çok katlı bir bina oluştur',requestId:'missing'}),(e:any)=>e.reason==='PLAN_REQUIRES_INPUT');
 const input={intent:'Toplam brüt alanı 600 m2 olan 2 katlı bina oluştur',requestId:'building'};
 const plan=(await t.run('model_plan',input)).result;assert.equal(plan.summary.status,'READY');assert.equal(plan.summary.projectType,'residential');assert.ok(plan.summary.newTypes.length);assert.ok(plan.summary.dependencies.length);assert.equal(canonicalJson(await t.state()),before);
 const applied=await t.run('model_generate',{...input,planId:plan.summary.planId});assert.equal(applied.status,'applied');assert.ok(Object.keys((await t.state()).elements).length>10);
 await assert.rejects(t.run('model_generate',input),(e:any)=>e.reason==='REQUEST_ALREADY_APPLIED');
});
test('P1/P2: workflow DAG executes prerequisite resources first and preserves existing model; cycles/stale plans do not mutate',async()=>{
 const t=setup();await t.run('bim_create_storeys',{storeys:[{name:'L0',elevation:0}]});
 const requirements={kind:'workflow',archetype:'industrial',systems:['structure'],operations:[{id:'place',dependsOn:['define'],requirements:{kind:'instances',storey:'L0',type:'C1',placements:[{at:[0,0],height:3},{at:[3,0],height:3}]}},{id:'define',requirements:{kind:'definitions',types:[{kind:'column',name:'C1',profile:{shape:'rect',b:.4,h:.6}}]}}]};
 const input={intent:'Explicit industrial column subsystem',requestId:'workflow',requirements},plan=(await t.run('model_plan',input)).result;
 assert.deepEqual(plan.summary.capabilitySelection.map((c:any)=>c.operation),['define','place']);assert.equal(plan.summary.requiredInstances.length,2);
 const implicit=(await t.run('model_plan',{...input,requestId:'implicit',requirements:{...requirements,operations:requirements.operations.map(o=>({...o,id:o.id==='define'?'z-define':'a-place',dependsOn:[]}))}})).result;
 assert.deepEqual(implicit.summary.capabilitySelection.map((c:any)=>c.operation),['z-define','a-place']);assert.deepEqual(implicit.summary.dependencies.find((d:any)=>d.id==='a-place').dependsOn,['z-define']);
 await t.run('bim_create_storeys',{storeys:[{name:'L1',elevation:3}]});const before=canonicalJson(await t.state());
 await assert.rejects(t.run('model_generate',{...input,planId:plan.summary.planId}),(e:any)=>e.reason==='STALE_MODEL_PLAN');assert.equal(canonicalJson(await t.state()),before);
 await t.run('model_generate',input);assert.equal(Object.keys((await t.state()).storeys).length,2);assert.equal(Object.keys((await t.state()).types).length,1);
 const noChange=(await t.run('model_plan',{intent:'Reuse the exact existing definition',requestId:'no-change',requirements:{kind:'definitions',types:[{kind:'column',name:'Alias',profile:{shape:'rect',b:.4,h:.6}}]}})).result;assert.equal(noChange.summary.status,'NO_CHANGE');assert.equal(noChange.steps.length,0);
 const sequence=await t.p.seq('p4');await assert.rejects(t.run('model_plan',{...input,requestId:'cycle',requirements:{...requirements,operations:requirements.operations.map(o=>({...o,dependsOn:[o.id==='place'?'define':'place']}))}}),(e:any)=>e.reason==='INVALID_PLAN');assert.equal(await t.p.seq('p4'),sequence);
 await t.run('platform_undo',{});assert.equal(Object.keys((await t.state()).elements).length,0);assert.equal(Object.keys((await t.state()).storeys).length,2);
});
