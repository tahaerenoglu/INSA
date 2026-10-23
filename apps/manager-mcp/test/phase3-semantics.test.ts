import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Platform,MemoryStores,canonicalJson,type Actor} from '@insa/core';
import {bimModule,toIfc,ifcToFrag,quantities,bimSemanticHierarchy,type BimState} from '@insa/bim';
import {infraModule} from '@insa/infra';
import {filesModule} from '@insa/files';
import {modelingModule} from '../src/modeling.js';
import {buildApp} from '../../web-server/src/app.js';
const human:Actor={id:'phase3',name:'Phase 3',kind:'human',roles:['bim_manager']},ai:Actor={...human,id:'ai:phase3',kind:'ai'};
const modules=[bimModule,infraModule,filesModule,modelingModule];
function setup(approvalMode:'auto'|'ai'='auto'){
 const stores=new MemoryStores(),p=new Platform({modules,stores,approvalMode,snapshotPolicy:{everyEvents:2,keep:3}});let request=0;
 const run=(tool:string,input:unknown,actor=human,dryRun=false)=>p.execute(actor,'phase3',tool,input,{dryRun}) as Promise<any>;
 return {p,stores,run,state:()=>p.state<BimState>('phase3','bim'),generate:(requirements:unknown,actor=human,dryRun=false)=>run('model_generate',{intent:'Explicit Phase 3 geometry',requestId:`r${++request}`,requirements},actor,dryRun)};
}
const rebar={cover:.03,diameter:.016,stirrupDiameter:.008,spacing:.15,steelGrade:'B500B'};
const columnRequest=(count=20,reinforcement?:typeof rebar)=>({kind:'instances',storey:'L0',definition:{kind:'column',name:'C1 40x60',profile:{shape:'rect',b:.4,h:.6}},placements:Array.from({length:count},(_,i)=>({at:[i*2,0],height:3})),...(reinforcement?{reinforcement}:{})});
const boxFamily=(name:string,category:string)=>({name,category,parameters:['width','depth','height'].map(key=>({key,name:key,scope:'type',dataType:'length',required:true})),representation:{kind:'box',width:'width',depth:'depth',height:'height'}});
const boxType=(name:string,family:string,dimensions=[1,1,1],extra={})=>({kind:'component',name,family,parameters:Object.fromEntries(['width','depth','height'].map((k,i)=>[k,dimensions[i]])),...extra});

test('A/B: 20 native instances reuse one type; content revisions, impact, IFC occurrences and undo preserve identities',async()=>{
 const t=setup();await t.run('bim_create_storeys',{storeys:[{name:'L0',elevation:0}]});
 await t.generate(columnRequest());const original=canonicalJson(await t.state()),s=await t.state(),ids=Object.keys(s.elements),type=Object.keys(s.types)[0];
 assert.equal(ids.length,20);assert.equal(Object.keys(s.types).length,1);
 const library=(await t.run('project_query',{tool:'semantic.library'})).result;assert.equal(library.families.length,1);assert.equal(library.types[0].instances.length,20);
 const revision=library.types[0].revision,ifc=toIfc(s,{projectKey:'phase3'});
 assert.equal((ifc.match(/=IFCCOLUMN\(/g)??[]).length,20);assert.equal((ifc.match(/=IFCCOLUMNTYPE\(/g)??[]).length,1);assert.equal((ifc.match(/=IFCRELDEFINESBYTYPE\(/g)??[]).length,1);
 assert.equal((ifc.match(/=IFCRECTANGLEPROFILEDEF\(/g)??[]).length,1,'shared profile definition does not merge the 20 occurrence identities');
 const response=await t.run('model_revise',{changes:[{tool:'bim_update_types',input:{items:[{type,kind:'column',set:{profile:{shape:'rect',b:.45,h:.65}}}]}}]});
 assert.equal(response.summary.typeImpact[0].instances.length,20);assert.deepEqual(Object.keys((await t.state()).elements),ids);
 assert.notEqual((await t.run('project_query',{tool:'semantic.library'})).result.types[0].revision,revision);
 assert.ok(Math.abs(quantities(await t.state(),(await t.state()).elements[ids[0]]).volume-.45*.65*3)<1e-9);
 await t.run('platform_undo',{});assert.equal(canonicalJson(await t.state()),original);
 const seq=await t.p.seq('phase3');await assert.rejects(t.run('model_revise',{changes:[{tool:'bim_update_types',input:{items:[{type,kind:'column',set:{profile:{shape:'rect',b:4.2,h:.6}}}]}}]}),(e:any)=>e.reason==='MODEL_VALIDATION_FAILED');assert.equal(await t.p.seq('phase3'),seq);assert.equal(canonicalJson(await t.state()),original);
});

test('C/D: reinforced column assembly keeps host/set IDs, regenerates rotated local layouts and exposes one semantic tree occurrence',async()=>{
 const t=setup();await t.run('bim_create_storeys',{storeys:[{name:'L0',elevation:0}]});await t.generate(columnRequest(1,rebar));
 let s=await t.state();const host:any=s.elements['C-0001'],type=host.type,sets=Object.values(s.elements).filter(e=>e.kind==='reinforcement');assert.equal(sets.length,2);
 assert.equal(Object.values(s.elements).filter(e=>e.kind==='assembly').length,1);
 const original=canonicalJson(s),before=sets.map(e=>e.id),layers=canonicalJson(sets.map(e=>(e as any).layers));
 const revised=await t.run('model_revise',{changes:[{tool:'bim_update_types',input:{items:[{type,kind:'column',set:{profile:{shape:'rect',b:.45,h:.65}}}]}}]});
 assert.deepEqual(revised.summary.regenerated.sort(),before.sort());s=await t.state();assert.notEqual(canonicalJson(before.map(id=>(s.elements[id] as any).layers)),layers);
 assert.deepEqual((await t.run('model_validate',{})).result.issues,[]);
 await t.run('bim_update_elements',{items:[{id:host.id,kind:'column',set:{rotation:37,at:[3,4],height:4}}]});
 assert.deepEqual((await t.run('model_validate',{})).result.issues,[]);
 const replay=await new Platform({modules,stores:t.stores,snapshotPolicy:false}).state('phase3','bim');assert.equal(canonicalJson(replay),canonicalJson(await t.state()));
 const snapshot=await new Platform({modules,stores:t.stores}).state('phase3','bim');assert.equal(canonicalJson(snapshot),canonicalJson(await t.state()));
 const app=buildApp({platform:t.p,model:null});const token=(await app.inject({method:'POST',url:'/api/auth/login',payload:{user:'taha'}})).json().token;
 try{
  const tree=(await app.inject({method:'GET',url:'/api/projects/phase3/tree',headers:{authorization:`Bearer ${token}`}})).json(),rows=tree.flatMap((st:any)=>Object.values(st.groups).flat()) as any[];
  assert.equal(rows.length,3);assert.equal(new Set(rows.map(r=>r.id)).size,3);
  for(const id of before){const row=rows.find(r=>r.id===id);assert.equal(row.parentId,host.id);assert.equal(row.assemblyId,'AS-0001');assert.ok(row.global_ids.length>2);}
  assert.ok(rows.find(r=>r.id===host.id).familyId.startsWith('native:column:'));
 }finally{await app.close();}
 const ifc=toIfc(await t.state(),{projectKey:'phase3'});assert.match(ifc,/IFCELEMENTASSEMBLY/);assert.match(ifc,/IFCREINFORCINGBARTYPE/);assert.match(ifc,/IFCREINFORCINGBAR/);
 assert.ok((await ifcToFrag(ifc)).byteLength>1000);
 await t.run('platform_undo',{});await t.run('platform_undo',{});assert.equal(canonicalJson(await t.state()),original);
 const seq=await t.p.seq('phase3');await assert.rejects(t.run('model_revise',{changes:[{tool:'bim_update_types',input:{items:[{type,kind:'column',set:{profile:{shape:'rect',b:.08,h:.08}}}]}}]}));assert.equal(await t.p.seq('phase3'),seq);
});

test('F/H: family definitions reuse one shared type; repeated energy assemblies retain distinct members and recipe metadata',async()=>{
 const t=setup();await t.run('bim_create_storeys',{storeys:[{name:'L0',elevation:0}]});
 await t.generate({kind:'definitions',families:[boxFamily('Panel','electrical.solar_device'),boxFamily('Mount','architecture.generic_model')],types:[boxType('PV','Panel',[2,1,.04]),boxType('Mount-1','Mount',[1.5,.5,1])]});
 const types=Object.keys((await t.state()).types),families=Object.keys((await t.state()).families);
 await t.generate({kind:'instances',storey:'L0',familyDefinition:boxFamily('Panel','electrical.solar_device'),definition:boxType('PV','Panel',[2,1,.04]),placements:[{at:[0,8]},{at:[4,8]},{at:[8,8]}]});
 assert.deepEqual(Object.keys((await t.state()).types),types);assert.deepEqual(Object.keys((await t.state()).families),families);
 await t.generate({kind:'assembly-array',name:'PV table',recipe:'solar-panel-mount',storey:'L0',parts:[{role:'panel',type:'PV',offset:1},{role:'mount',type:'Mount-1'}],placements:[{at:[0,0]},{at:[4,0],rotation:30},{at:[8,0]}]});
 const s=await t.state(),assemblies=Object.values(s.elements).filter(e=>e.kind==='assembly'),components=Object.values(s.elements).filter(e=>e.kind==='component');
 assert.equal(assemblies.length,3);assert.equal(components.length,9);assert.equal(new Set(components.map(e=>e.id)).size,9);assert.equal(Object.keys(s.types).length,2);
 assert.equal(new Set(assemblies.map(e=>e.props?.INSA_Assembly.recipeRevision)).size,1);
 const graph=(await t.run('project_query',{tool:'semantic.graph'})).result;assert.equal(graph.edges.filter((e:any)=>e.relation==='MemberOfAssembly').length,6);
 assert.deepEqual((await t.run('model_validate',{})).result.issues,[]);
 const sequence=await t.p.seq('phase3');await assert.rejects(t.generate({kind:'definitions',families:[boxFamily('Panel','plumbing.pump')]}));assert.equal(await t.p.seq('phase3'),sequence);
 await assert.rejects(t.generate({kind:'instances',storey:'L0',type:'PV',placements:[{at:[20,0],height:3}]}),(e:any)=>e.reason==='INVALID_INPUT');assert.equal(await t.p.seq('phase3'),sequence);
 await t.generate({kind:'definitions',families:[boxFamily('Panel alias','electrical.solar_device')],types:[boxType('PV wider','Panel alias',[3,1,.04])]});
 assert.deepEqual(Object.keys((await t.state()).families),families);assert.equal(Object.keys((await t.state()).types).length,3);
});

test('E: generic equipment, valve and pipe share an explicit connector system and engineering assembly',async()=>{
 const t=setup();await t.run('bim_create_storeys',{storeys:[{name:'L0',elevation:0}]});
 const connector=(key:string,position:number[],direction:number[])=>({key,position,direction,domain:'piping',flow:'bidirectional',shape:'round',diameter:.025});
 await t.generate({kind:'definitions',families:[boxFamily('Pump','plumbing.pump'),boxFamily('Valve','plumbing.valve')],types:[boxType('Pump-1','Pump',[1,1,1],{connectors:[connector('out',[.5,0,.5],[1,0,0])]}),boxType('Valve-1','Valve',[.2,.2,.2],{connectors:[connector('in',[-.1,0,.1],[-1,0,0]),connector('out',[.1,0,.1],[1,0,0])]}),{kind:'pipe',name:'P25',diameter:.025}]});
 await t.run('bim_create_mep_systems',{systems:[{name:'CW',domain:'piping',classification:'domestic_cold_water'}]});
 await t.generate({kind:'assembly-array',name:'Pump station',recipe:'pump-valve-pipe',storey:'L0',parts:[{role:'pump',type:'Pump-1'},{role:'pipe',type:'P25',system:'CW',route:[[.5,0,.5],[2,0,.5]]},{role:'valve',type:'Valve-1',at:[2.1,0],offset:.4}],placements:[{at:[0,0]}],connections:[[{role:'pump',connector:'out'},{role:'pipe',connector:'start'}],[{role:'pipe',connector:'end'},{role:'valve',connector:'in'}]]});
 const graph=(await t.run('project_query',{tool:'semantic.graph'})).result;
 assert.equal(graph.edges.filter((e:any)=>e.relation==='PartOfSystem').length,3);assert.equal(graph.edges.filter((e:any)=>e.relation==='ConnectedTo').length,2);
 assert.deepEqual((await t.run('model_validate',{})).result.issues,[]);
 await t.generate({kind:'assembly-array',name:'Offset route',recipe:'explicit-route-offset',storey:'L0',parts:[{role:'pipe',type:'P25',system:'CW',route:[[0,0,0],[1,0,0]],at:[2,0],offset:1,rotation:90}],placements:[{at:[0,10],offset:2,rotation:90}]});
 const route=(await t.state()).elements['ME-0002'] as any;assert.ok(Math.abs(route.route[0].at[0])<1e-10);assert.equal(route.route[0].at[1],12);assert.equal(route.route[0].offset,3);assert.ok(Math.abs(route.route[1].at[0]+1)<1e-10);
 const seq=await t.p.seq('phase3');await assert.rejects(t.run('model_revise',{changes:[{tool:'bim_update_elements',input:{items:[{id:'CO-0001',kind:'component',set:{x:5}}]}}]}));assert.equal(await t.p.seq('phase3'),seq);
});

test('governance: new assembly capabilities preview without mutation and AI writes wait for human approval',async()=>{
 const t=setup('ai');await t.run('bim_create_storeys',{storeys:[{name:'L0',elevation:0}]});const seq=await t.p.seq('phase3');
 assert.equal((await t.generate(columnRequest(1,rebar),human,true)).status,'preview');assert.equal(await t.p.seq('phase3'),seq);
 const proposal=await t.generate(columnRequest(1,rebar),ai);assert.equal(proposal.status,'proposed');assert.equal(await t.p.seq('phase3'),seq);
 await assert.rejects(t.p.approve(ai,'phase3',proposal.proposalId));await t.p.approve({...human,id:'reviewer'},'phase3',proposal.proposalId);
 assert.equal(Object.values((await t.state()).elements).filter(e=>e.kind==='reinforcement').length,2);
 await t.run('platform_undo',{});assert.equal(Object.keys((await t.state()).elements).length,0);
});

test('nested primary assemblies expose visible parents and graph revisions track geometry',async()=>{
 const t=setup();await t.run('bim_create_storeys',{storeys:[{name:'L0',elevation:0}]});await t.generate(columnRequest(3));
 await t.generate({kind:'assembly',name:'Inner',members:['C-0001','C-0002'],primary:'C-0001'});
 await t.generate({kind:'assembly',name:'Outer',members:['AS-0001','C-0003'],primary:'AS-0001'});
 const h=bimSemanticHierarchy(await t.state());
 assert.equal(h.parent.get('C-0002'),'C-0001');assert.equal(h.parent.get('C-0003'),'C-0001');assert.equal(h.parent.has('C-0001'),false);
 for(const [id,parent]of h.parent)if(!h.suppressed.has(id))assert.equal(h.suppressed.has(parent),false);
 const graph=(await t.run('project_query',{tool:'semantic.graph'})).result;
 await t.run('model_revise',{changes:[{tool:'bim_update_elements',input:{items:[{id:'C-0003',kind:'column',set:{height:4}}]}}]});
 assert.notEqual((await t.run('project_query',{tool:'semantic.graph'})).result.revision,graph.revision);
});
