import {test} from 'node:test';
import assert from 'node:assert/strict';
import {boundary,boundaries,polyArea,align3d,tunnelGeometry,localOrigin,isClosedOriented,meshVolume} from '../src/index.js';

test('polygon lining offsets expand outward for either source winding',()=>{
 const points:[number,number][]=[[-7.5,-1.343],[7.5,-1.343],[7.5,7],[-7.5,7]];
 for(const ring of [points,[...points].reverse()]){
  const p={shape:'polygon' as const,points:ring},outer=boundary(p,.8,.802);
  assert.ok(Math.abs(Math.min(...outer.map(q=>q[0]))+8.3)<1e-10);
  assert.ok(Math.abs(Math.max(...outer.map(q=>q[1]))-7.8)<1e-10);
  assert.ok(Math.abs(Math.min(...outer.map(q=>q[1]))+2.143)<1e-10);
  assert.ok(polyArea(outer)>polyArea(points));
 }
});

test('cut-and-cover concrete and thin membrane produce positive closed disjoint rings',()=>{
 const section={id:'TS-1',name:'box',profile:{shape:'polygon' as const,points:[[-7.5,-1.343],[7.5,-1.343],[7.5,7],[-7.5,7]] as [number,number][]},layers:[{name:'concrete',thickness:.8},{name:'membrane',thickness:.002}]};
 const a=align3d({id:'AL-1',name:'straight',start_station:0,points:[{x:0,y:0},{x:275,y:0}],pvis:[{station:0,z:80},{station:275,z:81}]});
 const rings=boundaries(section).rings,geometry=tunnelGeometry(a,[{from:0,to:275,section:section.id}],{[section.id]:section},localOrigin(a));
 for(const [i,l]of geometry[0].layers.entries()){
  assert.ok(isClosedOriented(l.mesh));const expected=(polyArea(rings[i+1])-polyArea(rings[i]))*275;
  assert.ok(expected>0);assert.ok(Math.abs(meshVolume(l.mesh)-expected)<1e-6);
 }
});
