import {test} from 'node:test';import assert from 'node:assert/strict';import {platform,ai} from './fixtures.js';
const profile:[number,number][]=[[-1,-.2],[1,-.2],[1,0],[-1,0]],layer={name:'Shared sleeper',role:'sleeper',thickness:.2,leftExtent:2,rightExtent:2,materialId:'M-0001',profile,repeat:{spacing:.6,length:.25}};
test('one component definition drives multiple placements, updates, replay and undo',async()=>{
 const p=platform(),project='components',run=async(tool:string,input:any)=>{const r=await p.execute(ai,project,tool,input);assert.equal(r.status,'applied');return r;};
 await run('infra_create_alignment',{name:'Line',horizontal:[{x:0,y:0},{x:100,y:0}],vertical:[{station:0,z:0},{station:100,z:1}]});
 await run('infra_create_component_types',{types:[{name:'Sleeper type',layer}]});
 for(const[from,to]of [[0,50],[50,100]])await run('infra_create_road_corridor',{name:'Segment'+from,alignment:'AL-001',from,to,sections:[from,to].map(station=>({station,leftWidth:2,rightWidth:2,leftShoulder:0,rightShoulder:0,leftCrossfall:0,rightCrossfall:0})),layers:[{componentType:'CT-001',repeat:{anchor:.3}}]});
 let s:any=await p.state(project,'infra');assert.equal(Object.keys(s.componentTypes).length,1);const ids=Object.values(s.roads).map((r:any)=>r.layers[0].id);
 const events=await p.store(project).readEvents();for(const e of events.filter(e=>e.type==='RoadCorridorSet')){assert.equal(e.payload.layers[0].profile,undefined);assert.equal(e.payload.layers[0].materialId,undefined);assert.equal(e.payload.layers[0].componentType,'CT-001');}
 await run('infra_update_component_type',{type:'CT-001',name:'Sleeper type',layer:{...layer,profile:profile.map(([x,y])=>[x*1.2,y])}});
 s=await p.state(project,'infra');for(const r of Object.values(s.roads) as any[]){assert.equal(r.layers[0].profile[0][0],-1.2);assert.equal(r.layers[0].repeat.anchor,.3);}assert.deepEqual(Object.values(s.roads).map((r:any)=>r.layers[0].id),ids);
 await assert.rejects(()=>run('infra_create_component_types',{types:[{name:'Sleeper type',layer}]}),/exists/);
 await assert.rejects(()=>run('infra_create_road_corridor',{name:'Missing',alignment:'AL-001',from:0,to:1,sections:[0,1].map(station=>({station,leftWidth:2,rightWidth:2,leftShoulder:0,rightShoulder:0,leftCrossfall:0,rightCrossfall:0})),layers:[{componentType:'CT-999'}]}),/missing/);
 await run('platform_undo',{});s=await p.state(project,'infra');for(const r of Object.values(s.roads) as any[])assert.equal(r.layers[0].profile[0][0],-1);
});
