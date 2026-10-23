import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Platform,MemoryStores,type Actor} from '@insa/core';
import {bimModule,wallFrame,apply,validateCommand,type BimState} from '../src/index.js';
import {footprintIntersection,modellingIssues} from '../src/modelling-policy.js';
import {polygonArea} from '../src/geometry.js';
import {toIfc} from '../src/index.js';
import {createRequire} from 'node:module';
import path from 'node:path';
import {wallLayerPolygon} from '../src/plan.js';
const actor:Actor={id:'test',name:'Test',kind:'human',roles:['bim_manager']};
async function fixture(){const p=new Platform({modules:[bimModule],stores:new MemoryStores(),approvalMode:'auto'});const run=(name:string,input:any)=>p.execute(actor,'p',name,input);
 await run('bim_create_storeys',{storeys:[{name:'Base',elevation:0}]});
 await run('bim_create_types',{types:[{kind:'wall',name:'110',layers:[{material:'Brick',thickness:.11}]},{kind:'wall',name:'220',layers:[{material:'Brick',thickness:.22}]}]});return{p,run,state:()=>p.state<BimState>('p','bim')};}
test('short DWG corners join inside the original command, with unequal thicknesses and no wedge/overlap',async()=>{
 const{run,state}=await fixture();await run('bim_create_walls',{walls:[{storey:'Base',type:'220',start:[0,0],end:[1.945,0],height:3},{storey:'Base',type:'110',start:[2,.11],end:[2,2],height:3}]});
 const s=await state(),a=s.elements['W-0001'] as any,b=s.elements['W-0002'] as any;
 assert.deepEqual(a.end,[2,0]);assert.deepEqual(b.start,[2,0]);assert.equal(Object.keys(s.joins).length,1);
 const A=wallFrame(s,a).footprint,B=wallFrame(s,b).footprint;
 assert.ok(polygonArea(footprintIntersection(A,B))<1e-8);
 for(const [wall,outline] of [[a,A],[b,B]] as const){const t=wallFrame(s,wall).t;assert.deepEqual(wallLayerPolygon(outline,t,t/2,-t/2),outline);const layers=[wallLayerPolygon(outline,t,t/2,0),wallLayerPolygon(outline,t,0,-t/2)];assert.ok(Math.abs(layers.reduce((n,p)=>n+polygonArea(p),0)-polygonArea(outline))<1e-8);}
 assert.ok(A.some(p=>B.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<1e-8)),'cut faces meet');
});
test('a reversed duplicate is refused atomically',async()=>{const{run,state}=await fixture();await run('bim_create_walls',{walls:[{storey:'Base',type:'220',start:[0,0],end:[3,0],height:3}]});const before=JSON.stringify(await state());await assert.rejects(run('bim_create_walls',{walls:[{storey:'Base',type:'220',start:[3,0],end:[0,0],height:3}]}));assert.equal(JSON.stringify(await state()),before);});
test('partial parallel solid overlap is refused; touching faces are permitted',async()=>{const{run}=await fixture();await run('bim_create_walls',{walls:[{storey:'Base',type:'220',start:[0,0],end:[3,0],height:3}]});await assert.rejects(run('bim_create_walls',{walls:[{storey:'Base',type:'220',start:[1,.1],end:[4,.1],height:3}]}),(e:any)=>e.details?.rule==='wall_overlap');await run('bim_create_walls',{walls:[{storey:'Base',type:'220',start:[0,.22],end:[3,.22],height:3}]});});
test('plan coincidence at different heights is not a join or a clash',async()=>{const{run,state}=await fixture();await run('bim_create_walls',{walls:[{storey:'Base',type:'220',start:[0,0],end:[2,0],height:1},{storey:'Base',type:'220',start:[2,0],end:[2,2],base_offset:2,height:1}]});assert.equal(Object.keys((await state()).joins).length,0);assert.deepEqual(modellingIssues(await state()),[]);});
test('reversed/rotated slab contour duplicates are refused, holes distinguish solids',async()=>{const{run}=await fixture();await run('bim_create_types',{types:[{kind:'slab',name:'S',layers:[{material:'Concrete',thickness:.2}]}]});await run('bim_create_slabs',{slabs:[{storey:'Base',type:'S',outline:[[0,0],[3,0],[3,3],[0,3]]}]});await assert.rejects(run('bim_create_slabs',{slabs:[{storey:'Base',type:'S',outline:[[3,3],[3,0],[0,0],[0,3]]}]}),(e:any)=>e.details?.rule==='duplicate');});
test('oriented component boxes use solids, not AABB overlap, and reject interpenetration',async()=>{
 const {run,state}=await fixture();await run('bim_create_families',{families:[{name:'Box',category:'architecture.generic_model',parameters:['w','d','h'].map(key=>({key,name:key,scope:'type',dataType:'length',required:true})),representation:{kind:'box',width:'w',depth:'d',height:'h'}}]});
 await run('bim_create_types',{types:[{kind:'component',name:'Long box',family:'Box',parameters:{w:3,d:.2,h:1}}]});
 const at=(x:number,y:number)=>({storey:'Base',type:'Long box',x,y,rotation:45});
 await run('bim_create_components',{components:[at(0,0),at(.5,-.5)]});
 const before=JSON.stringify(await state());await assert.rejects(run('bim_create_components',{components:[at(.05,-.05)]}),(e:any)=>e.details?.rule==='component_overlap');assert.equal(JSON.stringify(await state()),before);
});
test('legacy redundant walls repair atomically and the second repair has no events',async()=>{
 const {run,state}=await fixture();await run('bim_create_walls',{walls:[{storey:'Base',type:'220',start:[0,0],end:[3,0],height:3}]});const before=await state();
 // A trusted historical record written before the new command-time guard.
 before.elements['W-0002']={...structuredClone(before.elements['W-0001']),id:'W-0002',type:'WT-0001'} as any;before.counters.W=2;
 const tool:any=bimModule.tools.find(t=>t.name==='bim_reconcile_model');
 const decision=tool.decide(structuredClone(before),{},{}),after=structuredClone(before);for(const e of decision.events)apply(after,e);validateCommand(after,before);
 assert.equal(Object.keys(after.elements).length,1);assert.deepEqual(modellingIssues(after),[]);assert.deepEqual(decision.summary.removedRedundantWalls,['W-0002']);
 assert.equal(tool.decide(structuredClone(after),{},{}).events.length,0);
});
test('IFC shared boundary volumes have one owner, without merging product identities',async()=>{
 const {run,state}=await fixture();await run('bim_create_types',{types:[{kind:'ceiling',name:'Trim',layers:[{material:'Stone',thickness:.2}]}]});
 await run('bim_create_boundaries',{boundaries:[{storey:'Base',type:'Trim',category:'architecture.ceiling',offset:2,outline:[[0,0],[2,0],[2,1],[0,1]]},{storey:'Base',type:'Trim',category:'architecture.ceiling',offset:2,outline:[[1,.5],[3,.5],[3,1.5],[1,1.5]]}]});
 const require=createRequire(import.meta.url),{IfcAPI}=require('web-ifc'),api=new IfcAPI();api.SetWasmPath(path.dirname(require.resolve('web-ifc'))+path.sep,true);await api.Init();
 const id=api.OpenModel(new TextEncoder().encode(toIfc(await state(),{projectKey:'p'}))),meshes=api.LoadAllGeometry(id),products=new Set<number>();let volume=0;
 try{for(let i=0;i<meshes.size();i++){const m=meshes.get(i);let local=0;for(let j=0;j<m.geometries.size();j++){const part=m.geometries.get(j),g=api.GetGeometry(id,part.geometryExpressID),v=api.GetVertexArray(g.GetVertexData(),g.GetVertexDataSize()),ix=api.GetIndexArray(g.GetIndexData(),g.GetIndexDataSize());
   let signed=0;for(let k=0;k<ix.length;k+=3){const a=ix[k]*6,b=ix[k+1]*6,c=ix[k+2]*6;signed+=(v[a]*(v[b+1]*v[c+2]-v[b+2]*v[c+1])+v[a+1]*(v[b+2]*v[c]-v[b]*v[c+2])+v[a+2]*(v[b]*v[c+1]-v[b+1]*v[c]))/6;}local+=Math.abs(signed);g.delete();}
   if(local>1e-8){products.add(m.expressID);volume+=local;}}
   assert.equal(products.size,2);assert.ok(Math.abs(volume-.7)<1e-5,`union volume ${volume}, expected 0.7 (not 0.8)`);
 }finally{api.CloseModel(id);}
});
