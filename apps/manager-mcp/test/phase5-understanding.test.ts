import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Platform,MemoryStores,ArtifactStore,canonicalJson} from '@insa/core';
import {bimModule,type BimState} from '@insa/bim';import {infraModule} from '@insa/infra';import {filesModule} from '@insa/files';import {modelingModule} from '../src/modeling.js';
const actor={id:'p5',name:'P5',kind:'human' as const,roles:['bim_manager']};
function setup(artifacts?:ArtifactStore){const p=new Platform({modules:[bimModule,infraModule,filesModule,modelingModule],stores:new MemoryStores(),artifacts,approvalMode:'auto'});return {p,run:(tool:string,input:unknown)=>p.execute(actor,'p5',tool,input) as Promise<any>};}
test('P5 planning: Turkish number words, targeted schemas and explicit transaction coverage',async()=>{
 const {p,run}=setup(),before=canonicalJson(await p.state('p5','bim'));
 const input={intent:'Üç katlı, toplam 300 m² bir bina oluştur.',requestId:'three'};
 const plan=(await run('model_plan',input)).result;
 assert.equal(plan.summary.status,'READY');assert.equal(plan.summary.operationSteps[0].inputs.floors,3);assert.equal(plan.summary.operationSteps[0].inputs.totalArea,300);assert.equal(plan.summary.transaction.partialCommit,false);
 assert.equal(canonicalJson(await p.state('p5','bim')),before);
 const catalog=(await run('project_analyze',{capabilityKinds:['building'],queryNames:['bim_model_summary']})).result;
 assert.deepEqual(catalog.capabilities.map((c:any)=>c.kind),['building']);assert.deepEqual(catalog.queries.map((q:any)=>q.name),['bim_model_summary']);
 assert.ok(catalog.planningKnowledge.conditionalRules.bridge[0].requires.includes('span stations'));
 await run('model_generate',{...input,planId:plan.summary.planId});const checked=(await run('model_validate',{})).result;
 assert.equal(checked.constraints.quality.evidenceLevel,'CONCEPTUAL');assert.equal(checked.constraints.engineeringAdequacy,false);
});
test('P5 understanding: type/placement documents join with citations; conflicts and BOQ cannot change geometry',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'insa-p5-'));t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));assert.ok(path.basename(dir).startsWith('insa-p5-'));fs.rmSync(dir,{recursive:true,force:true});});
 const {p,run}=setup(new ArtifactStore(dir));await run('bim_create_storeys',{storeys:[{name:'L0',elevation:0}]});
 async function upload(filename:string,csv:string){const r=(await run('files_upload',{filename,base64:Buffer.from(csv).toString('base64')})).result;await run('files_register',{filename,asset:r.asset});}
 await upload('types.csv','Type,Width_mm,Depth_mm,Height_mm\nC1,400,600,3000');
 await upload('plan.csv','Type,Tag,X_m,Y_m,Storey\nC1,A1,0,0,L0\nC1,A2,3,0,L0');
 await upload('boq.csv','Type,Width_mm,Depth_mm,Height_mm\nC1,900,900,9000');
 const source=(file:string,role:string,mapping:object)=>({source:{file,version:1},role,mapping,units:'mm',placementUnits:'m',coordinateReference:'local-project-SI'});
 const sources=[source('F-0001','specification',{type:'Type',width:'Width_mm',depth:'Depth_mm',height:'Height_mm'}),source('F-0002','geometry',{type:'Type',tag:'Tag',x:'X_m',y:'Y_m',storey:'Storey'}),source('F-0003','boq',{type:'Type',width:'Width_mm',depth:'Depth_mm',height:'Height_mm'})];
 const request={sources,reviewedMapping:true},evidence=(await run('project_query',{tool:'documents.requirements',input:request})).result;
 assert.equal(evidence.ready,true);assert.equal(evidence.modelRequirements.length,2);assert.equal(evidence.modelRequirements[0].dimensions.width,.4);assert.ok(evidence.modelRequirements[0].sourceReferences.some((s:string)=>s.includes('F-0001 v1 CSV!B2')));
 const unknownFrame=(await run('project_query',{tool:'documents.requirements',input:{...request,sources:sources.map(s=>({...s,coordinateReference:'EPSG:32635'}))}})).result;assert.equal(unknownFrame.ready,false);assert.equal(unknownFrame.modelRequirements[0].status,'RequiresApproval');
 const input={intent:'Join reviewed source geometry and type table',requestId:'docs',requirements:{kind:'document-set-model',...request,storey:'L0'}};
 const plan=(await run('model_plan',input)).result;assert.equal(Object.keys((await p.state<BimState>('p5','bim')).elements).length,0);
 await run('model_generate',{...input,planId:plan.summary.planId});const state=await p.state<BimState>('p5','bim');assert.equal(Object.keys(state.types).length,1);assert.equal(Object.keys(state.elements).length,2);assert.equal(state.elements['C-0001'].props?.INSA_Source.qualityLevel,'SOURCE-BASED');
 await upload('conflict.csv','Type,Width_mm,Depth_mm,Height_mm\nC1,500,600,3000');
 const conflictSources=[...sources,source('F-0004','specification',{type:'Type',width:'Width_mm',depth:'Depth_mm',height:'Height_mm'})];
 const conflict=(await run('project_query',{tool:'documents.requirements',input:{...request,sources:conflictSources}})).result;assert.equal(conflict.ready,false);assert.equal(conflict.conflicts.length,1);assert.ok(conflict.parameters.some((f:any)=>f.verificationStatus==='Conflicting'));
 const seq=await p.seq('p5');await assert.rejects(run('model_generate',{...input,requestId:'conflict',requirements:{...input.requirements,sources:conflictSources}}),(e:any)=>e.reason==='SOURCE_REQUIRES_REVIEW');assert.equal(await p.seq('p5'),seq);
 await run('platform_undo',{}); // undo conflict file registration, not model generation
});
