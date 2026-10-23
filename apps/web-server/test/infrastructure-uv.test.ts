import {test} from 'node:test';import assert from 'node:assert/strict';import {align3d,tunnelGeometry,localOrigin,boundaries} from '@insa/infra';import {tunnelMetricUV} from '../src/infrastructure-uv.js';import {infrastructureKey,infrastructureMaterials,infrastructureScene} from '../src/infrastructure.js';
test('explicit lining with independent inner and outer vertex counts retains finite metric UVs',()=>{
 const a=align3d({id:'AL',name:'A',start_station:0,points:[{x:0,y:0},{x:100,y:0}],pvis:[{station:0,z:10},{station:100,z:11}]});
 const section:any={id:'TS',name:'drain notch',profile:{shape:'polygon',points:[[-2,-1],[2,-1],[2,3],[-2,3]]},layers:[{name:'C30',thickness:.4,outer_profile:[[-3,-2],[3,-2],[3,4],[1,4],[1,3.5],[-1,3.5],[-1,4],[-3,4]]}]};
 const rings=boundaries(section).rings,g=tunnelGeometry(a,[{from:0,to:100,section:'TS'}],{TS:section},localOrigin(a))[0],uv=tunnelMetricUV(g.layers[0].mesh,g.stations,[rings[1],rings[0]],a);
 assert.equal(uv.positions.length,g.layers[0].mesh.indices.length*3);assert.equal(uv.uv.length,g.layers[0].mesh.indices.length*2);assert.ok(uv.positions.every(Number.isFinite));assert.ok(uv.uv.every(Number.isFinite));
});
test('metric UV circumferential seam, graded sweep length, adjacent ranges and scale factors',()=>{
 const a=align3d({id:'AL',name:'Grade',start_station:0,points:[{x:412000,y:4561000},{x:412100,y:4561000}],pvis:[{station:0,z:62},{station:100,z:72}]});const section:any={id:'TS',name:'Circle',profile:{shape:'circle',radius:3,center_y:0},layers:[{id:'a',name:'A',thickness:.3}]};const origin=localOrigin(a),geo=tunnelGeometry(a,[{from:0,to:50,section:'TS'},{from:50,to:100,section:'TS'}],{TS:section},origin),rings=boundaries(section).rings;
 const adapted=geo.map(g=>tunnelMetricUV(g.layers[0].mesh,g.stations,[rings[1],rings[0]],a));const sideUV=adapted.map((d,i)=>d.uv.slice(0,(geo[i].stations.length-1)*rings[0].length*24));const maxU=Math.max(...sideUV[0].filter((_,i)=>i%2===0)),minU=Math.min(...sideUV[1].filter((_,i)=>i%2===0));assert.ok(Math.abs(maxU-50*Math.sqrt(1.01))<1e-8);assert.equal(maxU,minU);
 const circumference=2*Math.PI*3.3,maxV=Math.max(...adapted[0].uv.filter((_,i)=>i%2));assert.ok(Math.abs(maxV-circumference)<.005);assert.equal(maxU/(maxU/2),2);
 assert.equal(adapted[0].positions.length/3,geo[0].layers[0].mesh.indices.length);for(const p of adapted[0].positions)assert.ok(Number.isFinite(p));
});
test('appearance assignment invalidates appearance but not engineering geometry key',()=>{
 const s:any={alignments:{},tunnels:{},sections:{TS:{id:'TS',name:'S',profile:{shape:'circle',radius:3,center_y:0},layers:[{name:'Legacy',thickness:.3}]}},counters:{}},b:any={project:{},materials:{'M-0001':{id:'M-0001',name:'Concrete',color:'#eeeeee'}}};const key=infrastructureKey('p',s,b);s.sections.TS.layers[0].id='legacy-0';s.sections.TS.layers[0].materialId='M-0001';assert.equal(infrastructureKey('p',s,b),key);const scene=infrastructureMaterials(infrastructureScene('p',s,b),s,b);const a=scene.appearanceKey;b.materials['M-0001'].color='#ff0000';assert.notEqual(infrastructureMaterials(scene,s,b).appearanceKey,a);assert.equal(infrastructureKey('p',s,b),key);
});
