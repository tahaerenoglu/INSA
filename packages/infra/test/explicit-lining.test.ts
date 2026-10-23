import {test} from 'node:test';import assert from 'node:assert/strict';
import {boundaries,polyArea,align3d,tunnelGeometry,localOrigin,isClosedOriented,meshVolume,threeDSvg,type SectionType} from '../src/index.js';
import {platform,ai} from './fixtures.js';
const inner:[number,number][]=[[-2,-1],[2,-1],[2,3],[-2,3]],outer:[number,number][]=[[-2.4,-1.45],[2.4,-1.45],[2.4,3.4],[-2.4,3.4]];
const section:SectionType={id:'TS-1',name:'40cm wall / 45cm invert',profile:{shape:'polygon',points:inner},layers:[{name:'lining',thickness:.4,outer_profile:outer},{name:'PVC',thickness:.002}]};
test('dimensioned nonuniform lining sweeps exact supplied boundary and offsets later membrane from it',()=>{
 const b=boundaries(section);assert.deepEqual(b.rings[1],outer);assert.ok(Math.abs(b.rings[2][0][1]+1.452)<1e-9);
 const a=align3d({id:'AL-1',name:'line',start_station:0,points:[{x:0,y:0},{x:500,y:0}],pvis:[{station:0,z:80},{station:500,z:83}]});
 const g=tunnelGeometry(a,[{from:0,to:500,section:'TS-1'}],{'TS-1':section},localOrigin(a))[0];
 for(const [i,l]of g.layers.entries()){assert.ok(isClosedOriented(l.mesh));assert.ok(Math.abs(meshVolume(l.mesh)-(polyArea(b.rings[i+1])-polyArea(b.rings[i]))*500)<1e-7);}
 assert.ok(Math.abs(b.rings[1][0][1]-b.rings[0][0][1]+.45)<1e-12);
});
test('invalid correspondence, inward and crossed explicit boundaries are refused',()=>{
 const check=(points:[number,number][])=>boundaries({...section,layers:[{name:'bad',thickness:.4,outer_profile:points}]});
 assert.throws(()=>check(outer.slice(2)),/vertices/);assert.throws(()=>check([...outer].reverse()),/CCW/);
 assert.throws(()=>check(inner.map(([x,y])=>[x*.5,y*.5])),/enclose|outer area/);
 assert.throws(()=>check([outer[0],outer[2],outer[1],outer[3]]),/CCW|folded|intersect/);
});
test('independent vertex counts retain a concave drainage notch without radial-cap approximation',()=>{
 const outer:[number,number][]=[[-3,-2],[3,-2],[3,4],[1,4],[1,3.5],[-1,3.5],[-1,4],[-3,4]];
 const s:SectionType={...section,layers:[{name:'lining',thickness:.4,outer_profile:outer}]};
 const a=align3d({id:'AL-1',name:'line',start_station:0,points:[{x:0,y:0},{x:500,y:0}],pvis:[{station:0,z:80},{station:500,z:83}]});
 const g=tunnelGeometry(a,[{from:0,to:500,section:s.id}],{[s.id]:s},localOrigin(a))[0];assert.ok(isClosedOriented(g.layers[0].mesh));assert.ok(Math.abs(meshVolume(g.layers[0].mesh)-(polyArea(outer)-polyArea(inner))*500)<1e-8);
 assert.doesNotMatch(threeDSvg('notch',a,[{from:0,to:20,section:s.id}],{[s.id]:s},700),/NaN|undefined/);
});
test('existing section tools preserve explicit boundaries through state replay and allow clearing on update',async()=>{
 const p=platform();await p.execute(ai,'demiryolu','infra_create_section_types',{types:[section]});
 const state:any=await p.state('demiryolu','infra');assert.deepEqual(state.sections['TS-001'].layers[0].outer_profile,outer);
 const layer=state.sections['TS-001'].layers[0];await p.execute(ai,'demiryolu','infra_update_section_type',{section:'TS-001',layers:[{...layer,outer_profile:null}]});
 const next:any=await p.state('demiryolu','infra');assert.equal(next.sections['TS-001'].layers[0].outer_profile,undefined);assert.ok(Math.abs(boundaries(next.sections['TS-001']).rings[1][0][1]+1.4)<1e-9);
});
