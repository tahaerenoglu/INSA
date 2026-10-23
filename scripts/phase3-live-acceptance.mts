/** REAL HTTP acceptance against an already running isolated server. No injected/model-mocked server. */
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const base=process.argv[2]??'http://localhost:8788',out=path.resolve(process.argv[3]??'output/phase3-live-qa-2026-10-23');fs.mkdirSync(out,{recursive:true});
const prefix='p3-'+Date.now().toString(36),calls:any[]=[],checks:any[]=[];
const login=await(await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:'taha'})})).json() as any;
const headers={authorization:'Bearer '+login.token,'content-type':'application/json'};
async function http(url:string,body?:unknown){const response=await fetch(base+url,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)}),value=await response.json();assert.ok(response.ok,`${response.status}: ${JSON.stringify(value)}`);return value as any;}
async function tool(project:string,name:string,input:unknown){const response=await http(`/api/projects/${project}/tools/${name}`,{input});calls.push({project,name,input,response});return response;}
async function project(suffix:string,projectType='superstructure'){const id=prefix+'-'+suffix;await http('/api/projects',{id,name:'Phase 3 '+suffix,projectType});return id;}
async function generate(id:string,requirements:any,label:string){const input={intent:label,requestId:label,requirements},plan=await tool(id,'model_plan',input);return tool(id,'model_generate',{...input,planId:plan.result.summary.planId});}
const tree=(id:string)=>http(`/api/projects/${id}/tree`),query=(id:string,name:string)=>tool(id,'project_query',{tool:name}),validate=(id:string)=>tool(id,'model_validate',{});
const level=(id:string)=>tool(id,'bim_create_storeys',{storeys:[{name:'L0',elevation:0}]});
const family=(name:string,category:string)=>({name,category,parameters:['width','depth','height'].map(key=>({key,name:key,scope:'type',dataType:'length',required:true})),representation:{kind:'box',width:'width',depth:'depth',height:'height'}});
const component=(name:string,family:string,size:number[],extra={})=>({kind:'component',name,family,parameters:Object.fromEntries(['width','depth','height'].map((key,i)=>[key,size[i]])),...extra});
const rebar={cover:.03,diameter:.016,stirrupDiameter:.008,spacing:.15,steelGrade:'B500B'};
const columns=(n:number,reinforcement?:typeof rebar)=>({kind:'instances',storey:'L0',definition:{kind:'column',name:'C1 40x60',profile:{shape:'rect',b:.4,h:.6}},placements:Array.from({length:n},(_,i)=>({at:[i*2,0],height:3})),...(reinforcement?{reinforcement}:{})});
const ids=(nodes:any[])=>nodes.flatMap(st=>Object.values(st.groups).flat()).map((r:any)=>r.id);

const reuse=await project('reuse');await level(reuse);await generate(reuse,columns(20),'20-columns');
const initialTree=await tree(reuse),initialIds=ids(initialTree),library=(await query(reuse,'semantic.library')).result;
assert.equal(initialIds.length,20);assert.equal(library.types.length,1);assert.equal(library.families.length,1);
const revised=await tool(reuse,'model_revise',{changes:[{tool:'bim_update_types',input:{items:[{type:library.types[0].id,kind:'column',set:{profile:{shape:'rect',b:.45,h:.65}}}]}}]});
assert.equal(revised.summary.typeImpact[0].instances.length,20);assert.equal(revised.summary.changed.length,20);assert.deepEqual(ids(await tree(reuse)),initialIds);
await http(`/api/projects/${reuse}/undo`,{});assert.equal((await query(reuse,'semantic.library')).result.types[0].revision,library.types[0].revision);
checks.push({test:'A/B',project:reuse,instances:20,types:1,families:1,typeImpact:20,undo:true});

const reinforced=await project('reinforced');await level(reinforced);await generate(reinforced,columns(1,rebar),'reinforced-column');
const rows=(await tree(reinforced)).flatMap((st:any)=>Object.values(st.groups).flat()) as any[],bars=rows.filter(r=>r.category==='structure.rebar_set');
assert.equal(rows.length,3);assert.equal(bars.length,2);assert.ok(bars.every(r=>r.parentId==='C-0001'&&r.assemblyId==='AS-0001'&&r.global_ids.length>2));
const rbRev=await tool(reinforced,'model_revise',{changes:[{tool:'bim_update_types',input:{items:[{type:'CT-0001',kind:'column',set:{profile:{shape:'rect',b:.45,h:.65}}}]}}]});
assert.equal(rbRev.summary.regenerated.length,2);assert.deepEqual((await validate(reinforced)).result.issues,[]);
await http(`/api/projects/${reinforced}/undo`,{});
checks.push({test:'C/D',project:reinforced,tree:rows,regenerated:rbRev.summary.regenerated,undo:true});

const mep=await project('equipment');await level(mep);
const connector=(key:string,position:number[],direction:number[])=>({key,position,direction,domain:'piping',flow:'bidirectional',shape:'round',diameter:.025});
await generate(mep,{kind:'definitions',families:[family('Pump','plumbing.pump'),family('Valve','plumbing.valve')],types:[component('Pump-1','Pump',[1,1,1],{connectors:[connector('out',[.5,0,.5],[1,0,0])]}),component('Valve-1','Valve',[.2,.2,.2],{connectors:[connector('in',[-.1,0,.1],[-1,0,0]),connector('out',[.1,0,.1],[1,0,0])]}),{kind:'pipe',name:'P25',diameter:.025}]},'equipment-definitions');
await generate(mep,{kind:'instances',storey:'L0',type:'Pump-1',placements:[{at:[0,8]},{at:[4,8]},{at:[8,8]}]},'equipment-reuse');
await tool(mep,'bim_create_mep_systems',{systems:[{name:'CW',domain:'piping',classification:'domestic_cold_water'}]});
await generate(mep,{kind:'assembly-array',name:'Pump station',recipe:'pump-valve-pipe',storey:'L0',parts:[{role:'pump',type:'Pump-1'},{role:'pipe',type:'P25',system:'CW',route:[[.5,0,.5],[2,0,.5]]},{role:'valve',type:'Valve-1',at:[2.1,0],offset:.4}],placements:[{at:[0,0]}],connections:[[{role:'pump',connector:'out'},{role:'pipe',connector:'start'}],[{role:'pipe',connector:'end'},{role:'valve',connector:'in'}]]},'equipment-assembly');
const mepGraph=(await query(mep,'semantic.graph')).result;assert.equal(mepGraph.edges.filter((e:any)=>e.relation==='PartOfSystem').length,3);assert.deepEqual((await validate(mep)).result.issues,[]);
checks.push({test:'E/F',project:mep,systemMembers:3,connectedEdges:mepGraph.edges.filter((e:any)=>e.relation==='ConnectedTo').length,sharedPumpOccurrences:4});

const energy=await project('solar');await level(energy);
await generate(energy,{kind:'definitions',families:[family('Panel','electrical.solar_device'),family('Mount','architecture.generic_model')],types:[component('PV','Panel',[2,1,.04]),component('Mount-1','Mount',[1.5,.5,1])]},'solar-definitions');
await generate(energy,{kind:'assembly-array',name:'PV table',recipe:'solar-panel-mount',storey:'L0',parts:[{role:'panel',type:'PV',offset:1},{role:'mount',type:'Mount-1'}],placements:Array.from({length:8},(_,i)=>({at:[i%4*4,Math.floor(i/4)*3]}))},'solar-array');
const energyLibrary=(await query(energy,'semantic.library')).result;assert.equal(energyLibrary.types.length,2);assert.equal(energyLibrary.types.find((t:any)=>t.name==='PV').instances.length,8);assert.deepEqual((await validate(energy)).result.issues,[]);
checks.push({test:'H',project:energy,panelTypes:1,panelOccurrences:8,mountOccurrences:8,assemblies:8});

const infra=await project('corridor','infrastructure');await tool(infra,'bim_set_georeference',{crs:{name:'QA-local-metres'},eastings:0,northings:0,orthogonal_height:0});await tool(infra,'infra_set_crs',{crs:'QA-local-metres'});
await tool(infra,'infra_create_alignment',{name:'A',start_station:1000,horizontal:[{x:0,y:0},{x:2000,y:0}],vertical:[{station:1000,z:10},{station:3000,z:20}]});
await tool(infra,'bim_query_materials',{});await tool(infra,'bim_create_materials',{materials:[{name:'Formation'}]});await tool(infra,'infra_create_component_types',{types:[{name:'Formation .30',layer:{name:'Formation',role:'subbase',thickness:.3,leftExtent:3,rightExtent:3,materialId:'M-0001'}}]});
const section=(station:number)=>({station,leftWidth:3,rightWidth:3,leftShoulder:0,rightShoulder:0,leftCrossfall:0,rightCrossfall:0});
for(const [index,from]of [1000,2000].entries())await generate(infra,{kind:'corridor',definition:{name:'Formation '+index,alignment:'AL-001',from,to:from+1000,sections:[section(from),section(from+1000)],layers:[{componentType:'CT-001'}]}},'corridor-'+index);
const infraGraph=(await query(infra,'semantic.graph')).result;assert.equal(infraGraph.edges.filter((e:any)=>e.relation==='InstanceOfType'&&e.target==='infra:type:CT-001').length,2);assert.deepEqual((await validate(infra)).result.issues,[]);
checks.push({test:'G',project:infra,componentTypes:1,placements:2,from:1000,to:3000,coordinates:'synthetic QA local metres'});

const roof=await project('roof');await generate(roof,{kind:'building',floors:3,totalArea:200,roofForm:'hip'},'phase2-roof-regression');assert.deepEqual((await validate(roof)).result.issues,[]);checks.push({test:'J',project:roof,roof:'hip',issues:0});
for(const [label,id]of [['reinforced',reinforced],['equipment',mep],['solar',energy],['roof',roof]]){
 for(const ext of ['ifc','frag']){const response=await fetch(`${base}/api/projects/${id}/model.${ext}`,{headers}),bytes=new Uint8Array(await response.arrayBuffer());assert.equal(response.status,200);assert.ok(bytes.byteLength>1000);fs.writeFileSync(path.join(out,`${label}.${ext}`),bytes);}
}
const viewer=await(await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:'viewer'})})).json() as any;
const denied=await fetch(`${base}/api/projects/${reinforced}/tools/model_revise`,{method:'POST',headers:{...headers,authorization:'Bearer '+viewer.token},body:JSON.stringify({input:{changes:[{tool:'bim_update_types',input:{items:[{type:'CT-0001',kind:'column',set:{profile:{shape:'rect',b:.5,h:.7}}}]}}]}})});assert.equal(denied.status,403);
const assistant=await http('/api/assistant/status');
const report={base,prefix,checks,viewerWrite:denied.status,assistant,realLlmTest:assistant.enabled?'configured; not executed by deterministic HTTP acceptance':'not configured; not tested',projects:{reuse,reinforced,mep,energy,infra,roof}};
fs.writeFileSync(path.join(out,'acceptance.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(out,'calls.json'),JSON.stringify(calls,null,2));
console.log(JSON.stringify(report,null,2));
