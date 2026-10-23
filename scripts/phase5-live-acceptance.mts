/** Actual HTTP; synthetic documents only. Never represents a scripted client as a provider. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const base=process.argv[2]??'http://localhost:8790',out=path.resolve('output/phase5-live-qa-2026-10-23');fs.mkdirSync(out,{recursive:true});
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:'taha'})});
const token=(await login.json() as any).token,headers={authorization:'Bearer '+token,'content-type':'application/json'},calls:any[]=[];
async function http(url:string,body?:unknown){const response=await fetch(base+url,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)}),data=await response.json();assert.ok(response.ok,JSON.stringify(data));return data as any;}
const id='p5-'+Date.now().toString(36)+'-documents';await http('/api/projects',{id,name:'Phase 5 sourced columns',projectType:'superstructure'});
async function tool(name:string,input:unknown){const result=await http(`/api/projects/${id}/tools/${name}`,{input});calls.push({name,status:result.status});return result;}
await tool('bim_create_storeys',{storeys:[{name:'L0',elevation:0}]});
async function upload(filename:string,text:string){const r=(await tool('files_upload',{filename,base64:Buffer.from(text).toString('base64')})).result;await tool('files_register',{filename,asset:r.asset});}
await upload('types.csv','Type,Width_mm,Depth_mm,Height_mm\nC1,400,600,3000');
await upload('placements.csv','Type,Tag,X_m,Y_m,Storey\nC1,A1,0,0,L0\nC1,A2,3,0,L0\nC1,A3,6,0,L0');
await upload('boq.csv','Type,Width_mm,Depth_mm,Height_mm\nC1,900,900,9000');
const source=(file:string,role:string,mapping:object)=>({source:{file,version:1},role,mapping,units:'mm',placementUnits:'m',coordinateReference:'local-project-SI'}),sources=[source('F-0001','specification',{type:'Type',width:'Width_mm',depth:'Depth_mm',height:'Height_mm'}),source('F-0002','geometry',{type:'Type',tag:'Tag',x:'X_m',y:'Y_m',storey:'Storey'}),source('F-0003','boq',{type:'Type',width:'Width_mm',depth:'Depth_mm',height:'Height_mm'})];
const evidence=(await tool('project_query',{tool:'documents.requirements',input:{sources,reviewedMapping:true}})).result;assert.equal(evidence.ready,true);assert.equal(evidence.modelRequirements.length,3);
const input={intent:'Reviewed source type table and placement plan',requestId:'p5-docs',requirements:{kind:'document-set-model',sources,reviewedMapping:true,storey:'L0'}},plan=(await tool('model_plan',input)).result;assert.equal(plan.summary.status,'READY');
const before=await http(`/api/projects/${id}/tree`);assert.equal(before.flatMap((s:any)=>Object.values(s.groups).flat()).length,0);
await tool('model_generate',{...input,planId:plan.summary.planId});const tree=await http(`/api/projects/${id}/tree`);assert.equal(tree.flatMap((s:any)=>Object.values(s.groups).flat()).length,3);
const library=(await tool('project_query',{tool:'semantic.library'})).result;assert.equal(library.types.length,1);
const validation=(await tool('model_validate',{})).result;assert.equal(validation.issues.length,0);assert.equal(validation.constraints.quality.evidenceLevel,'SOURCE-BASED');
const exports:any={};for(const ext of ['ifc','frag']){const start=performance.now(),response=await fetch(`${base}/api/projects/${id}/model.${ext}`,{headers});assert.equal(response.status,200);const bytes=Buffer.from(await response.arrayBuffer());assert.ok(bytes.length>1000);fs.writeFileSync(path.join(out,'documents.'+ext),bytes);exports[ext]={bytes:bytes.length,ms:performance.now()-start};}
await http(`/api/projects/${id}/undo`,{});assert.deepEqual(await http(`/api/projects/${id}/tree`),before);
const assistant=await http('/api/assistant/status');
const report={base,project:id,documents:3,instances:3,types:1,parameters:evidence.parameters.length,boqIgnored:true,undo:true,exports,assistant,realProviderAcceptance:assistant.enabled?'CONFIGURED; NOT TESTED by this script':'NOT TESTED: no provider configured',calls};
fs.writeFileSync(path.join(out,'acceptance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
