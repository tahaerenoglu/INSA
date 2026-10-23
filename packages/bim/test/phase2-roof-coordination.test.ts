import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Platform,MemoryStores } from '@insa/core';
import { bimModule,wallRoof,quantities,toIfc,coordinateModel,type BimState } from '../src/index.js';
const actor:any={id:'test',name:'Test',kind:'human',roles:['bim_manager']};
async function fixture(){const p=new Platform({modules:[bimModule],stores:new MemoryStores()});const run=(tool:string,input:unknown)=>p.execute(actor,'phase2',tool,input);return {p,run,state:()=>p.state<BimState>('phase2','bim')};}
async function wallMeshVolume(s:BimState,id:string){
  const require=createRequire(import.meta.url),{IfcAPI}=require('web-ifc'),api=new IfcAPI();api.SetWasmPath(path.dirname(require.resolve('web-ifc'))+path.sep,true);await api.Init();
  const model=api.OpenModel(new TextEncoder().encode(toIfc(s,{projectKey:'phase2'}))),meshes=api.LoadAllGeometry(model);let volume=0;
  try{for(let i=0;i<meshes.size();i++){const mesh=meshes.get(i);if(api.GetLine(model,mesh.expressID).Tag?.value!==id)continue;
    for(let j=0;j<mesh.geometries.size();j++){const g=api.GetGeometry(model,mesh.geometries.get(j).geometryExpressID),v=api.GetVertexArray(g.GetVertexData(),g.GetVertexDataSize()),ix=api.GetIndexArray(g.GetIndexData(),g.GetIndexDataSize());let signed=0;
      for(let k=0;k<ix.length;k+=3){const a=ix[k]*6,b=ix[k+1]*6,c=ix[k+2]*6;signed+=(v[a]*(v[b+1]*v[c+2]-v[b+2]*v[c+1])+v[a+1]*(v[b+2]*v[c]-v[b]*v[c+2])+v[a+2]*(v[b]*v[c+1]-v[b+1]*v[c]))/6;}volume+=Math.abs(signed);g.delete();}
  }}finally{api.CloseModel(model);}return volume;
}
for(const form of ['gable','hip'])test(`P1 ${form}: ridge-crossing wall uses piecewise geometry, exact quantities and the same real IFC solid`,async()=>{
  const t=await fixture();await t.run('bim_create_storeys',{storeys:[{name:'Base',elevation:0}]});
  await t.run('bim_create_types',{types:[{kind:'wall',name:'W',layers:[{material:'Concrete',thickness:.2}]},{kind:'roof',name:'R',layers:[{material:'Concrete',thickness:.2}]}]});
  await t.run('bim_create_walls',{walls:[{storey:'Base',type:'W',start:[3,0],end:[3,4],height:3}]});
  await t.run('bim_create_pitched_roofs',{roofs:[{storey:'Base',type:'R',outline:[[0,0],[6,0],[6,4],[0,4]],form,ridge:'long',pitch:30,overhang:.3,offset:3+.2/Math.cos(Math.PI/6)}]});
  let s=await t.state();const roof=Object.values(s.elements).find(e=>e.kind==='pitched_roof')!;
  await t.run('bim_attach_walls_to_roof',{roof:roof.id,walls:['W-0001']});s=await t.state();
  const wall:any=s.elements['W-0001'],top=wallRoof(s,wall)!,expected=4*.2*(3+1.3*Math.tan(Math.PI/6)),initialVolume=quantities(s,wall).gross_volume;
  assert.equal(top.patches.length,2);assert.ok(top.maxHeight>Math.max(top.start,top.end));
  assert.ok(Math.abs(quantities(s,wall).gross_volume-expected)<1e-7);
  assert.ok(Math.abs(await wallMeshVolume(s,wall.id)-expected)<1e-4);
  const duplicate=structuredClone(s);duplicate.elements['W-copy']={...duplicate.elements[wall.id],id:'W-copy',height:4} as any;
  assert.ok(coordinateModel(duplicate).issues.some(i=>i.kind==='DuplicateOverlappingElement'&&i.elements.includes('W-copy')),'derived solid, not uncut authoring height, determines wall duplicates');
  const seq=await t.p.seq('phase2');await assert.rejects(t.run('bim_delete_elements',{ids:[roof.id]}));assert.equal(await t.p.seq('phase2'),seq);
  await t.run('bim_update_elements',{items:[{id:roof.id,kind:'pitched_roof',set:{pitch:40}}]});
  assert.notEqual(wallRoof(await t.state(),(await t.state()).elements[wall.id] as any)!.meanHeight,top.meanHeight);
  await t.run('platform_undo',{});assert.equal(quantities(await t.state(),(await t.state()).elements[wall.id]).gross_volume,initialVolume);
});
test('P1 narrow phase: overlapping AABBs are not clashes; actual oriented solid intersections and exact clearance are distinguished',async()=>{
  const t=await fixture();await t.run('bim_create_storeys',{storeys:[{name:'Base',elevation:0}]});
  await t.run('bim_create_families',{families:[{name:'Slender',category:'mechanical.equipment',parameters:['width','depth','height'].map(key=>({key,name:key,scope:'type',dataType:'length',required:true})),representation:{kind:'box',width:'width',depth:'depth',height:'height'}}]});
  await t.run('bim_create_types',{types:[{kind:'component',name:'Box',family:'Slender',parameters:{width:2,depth:.2,height:1}}]});
  await t.run('bim_create_components',{components:[{type:'Box',storey:'Base',x:0,y:0,rotation:45},{type:'Box',storey:'Base',x:0,y:.5,rotation:45}]});
  const s=await t.state(),result=coordinateModel(s,{clearance:.2});
  assert.ok(result.statistics.broadCandidates>0);assert.equal(result.issues.filter(i=>i.kind==='HardClash').length,0);assert.equal(result.issues.filter(i=>i.kind==='ClearanceClash').length,1);
  const historical=structuredClone(s),component:any=Object.values(historical.elements)[1];component.placement.y=.1;
  assert.equal(coordinateModel(historical).issues.filter(i=>i.kind==='HardClash').length,1);
  assert.equal(coordinateModel(historical,{ids:[Object.keys(historical.elements)[0]]}).issues.filter(i=>i.kind==='HardClash').length,1);
});
test('P1 index: separated large grids avoid all-pairs narrow-phase work',async()=>{
  const t=await fixture();await t.run('bim_create_storeys',{storeys:[{name:'Base',elevation:0}]});
  await t.run('bim_create_types',{types:[{kind:'column',name:'C',profile:{shape:'rect',b:.3,h:.3}}]});
  await t.run('bim_create_profile_members',{members:[{category:'structure.column',storey:'Base',type:'C',at:[0,0],height:3}]});
  const s=await t.state(),original:any=Object.values(s.elements)[0];s.elements={};
  for(let i=0;i<2000;i++){const id=`C-${i}`;s.elements[id]={...original,id,at:[i*4,0]};}
  const result=coordinateModel(s,{ids:['C-1000']});assert.equal(result.statistics.indexedElements,2000);assert.equal(result.statistics.broadCandidates,0);assert.equal(result.statistics.narrowPairs,0);
});

test('P1 penetrations: a route through a real slab is detected, a route through its hole is clear',async()=>{
  const t=await fixture();await t.run('bim_create_storeys',{storeys:[{name:'Base',elevation:0}]});
  await t.run('bim_create_types',{types:[{kind:'slab',name:'S',layers:[{material:'Concrete',thickness:.3}]},{kind:'pipe',name:'P',diameter:.025}]});
  await t.run('bim_create_boundaries',{boundaries:[{category:'structure.slab',storey:'Base',type:'S',outline:[[0,0],[4,0],[4,4],[0,4]],holes:[[[1,1],[1,2],[2,2],[2,1]]],offset:3}]});
  await t.run('bim_create_mep_systems',{systems:[{name:'CW',domain:'piping',classification:'domestic_cold_water'}]});
  const route=(x:number)=>[2,4].map(offset=>({storey:'Base',at:[x,1.5],offset}));
  await t.run('bim_create_pipes',{pipes:[{type:'P',system:'CW',route:route(.5)},{type:'P',system:'CW',route:route(1.5)}]});
  const result=coordinateModel(await t.state()),penetrations=result.issues.filter(i=>i.kind==='InvalidPenetration');
  assert.equal(penetrations.length,1);assert.ok(penetrations[0].elements.includes('ME-0001'));assert.equal(penetrations[0].autoRepairable,false);
  assert.ok(!penetrations.some(i=>i.elements.includes('ME-0002')));
});

test('P1 roof attachment refuses a wall crossing a roof hole even when both endpoints are inside the outer ring',async()=>{
  const t=await fixture();await t.run('bim_create_storeys',{storeys:[{name:'Base',elevation:0}]});
  await t.run('bim_create_types',{types:[{kind:'wall',name:'W',layers:[{material:'Concrete',thickness:.2}]},{kind:'roof',name:'R',layers:[{material:'Concrete',thickness:.2}]}]});
  await t.run('bim_create_walls',{walls:[{storey:'Base',type:'W',start:[0,2],end:[4,2],height:3}]});
  await t.run('bim_create_boundaries',{boundaries:[{category:'architecture.roof',storey:'Base',type:'R',outline:[[0,0],[4,0],[4,4],[0,4]],holes:[[[1,1],[1,3],[3,3],[3,1]]],offset:3.2}]});
  const roof=Object.values((await t.state()).elements).find(e=>e.kind==='boundary')!,seq=await t.p.seq('phase2');
  await assert.rejects(t.run('bim_attach_walls_to_roof',{roof:roof.id,walls:['W-0001']}),(e:any)=>e.reason==='INVALID_HOST_RELATION');
  assert.equal(await t.p.seq('phase2'),seq);assert.equal((await t.state()).elements['W-0001'].kind==='wall'&&(await t.state()).elements['W-0001'].topRoof,undefined);
});
