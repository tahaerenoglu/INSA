import {test} from 'node:test';import assert from 'node:assert/strict';import {align3d,hLength,point3d,roadGeometry,roadRing,roadSectionAt,localOrigin,isClosedOriented,type RoadCorridor} from '../src/index.js';
const a=align3d({id:'AL',name:'Level',start_station:0,points:[{x:412000,y:4561000},{x:412500,y:4561000}],pvis:[{station:0,z:62},{station:500,z:62}]});
const section=(station:number)=>({station,leftWidth:3.5,rightWidth:3.5,leftShoulder:.75,rightShoulder:.75,leftCrossfall:-.02,rightCrossfall:-.02});
const thicknesses=[.04,.06,.12,.2,.25];
const road=(to=500):RoadCorridor=>({id:'RD',name:'Road',alignment:'AL',from:0,to,sections:[section(0),section(to)],layers:thicknesses.map((thickness,i)=>({id:`L${i}`,name:`Layer${i}`,role:i<3?'asphalt':'granular',thickness,leftExtent:i<3?'pavement':'full',rightExtent:i<3?'pavement':'full',materialId:'M-0001'}))});
test('straight pavement: five closed solids, vertical thickness, crown sign and analytical quantities',()=>{
 const r=road(),g=roadGeometry(r,a,localOrigin(a));assert.equal(g.layers.length,5);
 for(const [i,l]of g.layers.entries()){const width=i<3?7:8.5,expected=width*thicknesses[i]*500;assert.ok(isClosedOriented(l.mesh));assert.ok(Math.abs(l.quantity.volume_m3-expected)<1e-7);assert.ok(Math.abs(l.quantity.projected_plan_area_m2-width*500)<1e-7);assert.ok(Math.abs(l.quantity.sloping_top_area_m2-width*500*Math.sqrt(1+.02**2))<1e-7);const ring=l.rings[0];assert.ok(Math.abs(ring.at(-1)![1]-ring[0][1]-thicknesses[i])<1e-12);}
 const ring=roadRing(r,0,0);assert.ok(ring[5][1]<ring[4][1]);assert.ok(ring[3][1]<ring[4][1]);assert.equal(ring[0][0],-3.5);assert.equal(g.stations[0],0);assert.equal(g.stations.at(-1),500);
});
test('deterministic width/crossfall transition: exact boundaries, no duplicate stations and integrated volumes',()=>{
 const r=road();const single={...section(300),leftWidth:4,rightWidth:4,leftShoulder:1,rightShoulder:1,leftCrossfall:.025,rightCrossfall:-.025};r.sections=[section(0),section(200),single,{...single,station:500}];const s=roadSectionAt(r,250);assert.equal(s.leftWidth,3.75);assert.ok(Math.abs(s.leftCrossfall-.0025)<1e-12);const g=roadGeometry(r,a,localOrigin(a));for(const boundary of [200,300])assert.ok(g.stations.includes(boundary));assert.equal(g.stations.length,new Set(g.stations).size);
 assert.ok(Math.abs(g.layers[0].quantity.integrated_volume_m3-3750*.04)<1e-8);assert.ok(Math.abs(g.layers[3].quantity.integrated_volume_m3-4625*.2)<1e-8);assert.ok(Math.abs(g.layers[0].quantity.volume_m3-150)<1e-7);
 const end=roadRing(r,0,400);assert.ok(end[5][1]>end[4][1]&&end[3][1]<end[4][1]);
});
test('graded pavement: actual surface differs from plan, geometry follows centre elevation',()=>{
 const graded=align3d({id:'AL',name:'Grade',start_station:0,points:[{x:0,y:0},{x:100,y:0}],pvis:[{station:0,z:5},{station:100,z:10}]});const r=road(100),g=roadGeometry(r,graded,[0,0,0]);const q=g.layers[0].quantity;assert.ok(Math.abs(q.volume_m3-28)<1e-8);assert.ok(Math.abs(q.sloping_top_area_m2-700*Math.sqrt(1+.02**2+.05**2))<1e-7);const p=g.layers[0].mesh.positions;assert.equal(p[4*3+2],5);assert.equal(p[(g.stations.length-1)*18+4*3+2],10);
});
test('circular asymmetric pavement: independent curvature/Jacobian volume and layer extents',()=>{
 const curved=align3d({id:'AL',name:'Curve',start_station:0,points:[{x:0,y:0},{x:100,y:0,radius:50},{x:100,y:100}],pvis:[{station:0,z:0},{station:250,z:2}]});const length=hLength(curved.h),r=road(length);r.layers=[{...r.layers[0],thickness:.2,leftExtent:3,rightExtent:5}];const g=roadGeometry(r,curved,localOrigin(curved)),angle=point3d(curved,length).az-point3d(curved,0).az,expected=.2*(8*length+(25-9)/2*angle);assert.ok(Math.abs(g.layers[0].quantity.integrated_volume_m3-expected)<1e-7);assert.ok(Math.abs(g.layers[0].quantity.mesh_volume_m3-expected)/expected<.0002);assert.ok(g.stations.length>20);
});
test('invalid sections, layers, ranges, folded or crossing footprint are rejected',()=>{
 for(const edit of [(r:RoadCorridor)=>r.to=501,(r:RoadCorridor)=>r.sections[1].station=0,(r:RoadCorridor)=>r.layers[0].thickness=0,(r:RoadCorridor)=>r.layers[1].id=r.layers[0].id,(r:RoadCorridor)=>r.layers[1].leftExtent=1,(r:RoadCorridor)=>r.sections[0].leftCrossfall=.2]){const r=road();edit(r);assert.throws(()=>roadGeometry(r,a,localOrigin(a)));}
 const folded=align3d({id:'A',name:'Sharp',start_station:0,points:[{x:0,y:0},{x:30,y:0,radius:2},{x:30,y:30}],pvis:[{station:0,z:0},{station:100,z:0}]});assert.throws(()=>roadGeometry(road(hLength(folded.h)),folded,[0,0,0]),/folds/);
 const crossing=align3d({id:'A',name:'Crossing',start_station:0,points:[{x:0,y:0},{x:60,y:60,radius:10},{x:0,y:60,radius:10},{x:60,y:0}],pvis:[{station:0,z:0},{station:300,z:0}]});assert.throws(()=>roadGeometry(road(hLength(crossing.h)),crossing,[0,0,0]),/self-intersects/);
});
test('adjacent layer interfaces are identical triangles even through curved transitions and wider bases',()=>{
 const curved=align3d({id:'A',name:'Curved',start_station:0,points:[{x:0,y:0},{x:250,y:0,radius:300,spiral:30},{x:500,y:120}],pvis:[{station:0,z:0},{station:250,z:3,curve:100},{station:600,z:0}]});const end=hLength(curved.h),r=road(end),single={...section(300),leftWidth:4,rightWidth:4,leftShoulder:1,rightShoulder:1,leftCrossfall:.025,rightCrossfall:-.025};r.sections=[section(0),section(200),single,{...single,station:end}];const g=roadGeometry(r,curved,[0,0,0]);
 const triangles=(l:typeof g.layers[number],groups:number[])=>{const list=new Set<string>();for(let t=0;t<l.mesh.indices.length;t+=3)if(groups.includes(l.mesh.faceGroups[t/3]))list.add(l.mesh.indices.slice(t,t+3).map(v=>l.mesh.positions.slice(v*3,v*3+3).map(p=>p.toFixed(8)).join(',')).sort().join('|'));return list;};
 for(let i=0;i<g.layers.length-1;i++){const bottom=triangles(g.layers[i],[0,1]),top=triangles(g.layers[i+1],[3,4]);for(const face of bottom)assert.ok(top.has(face),'Every upper-layer underside triangle exactly matches a lower-layer top triangle');}
 for(const l of g.layers)assert.ok(Math.abs(l.quantity.mesh_volume_m3-l.quantity.volume_m3)/l.quantity.volume_m3<.00001);
 // Coincident pavement/full boundaries may split as a banket widens: still closed, without zero-area triangles.
 r.sections[0].leftShoulder=0;r.sections[0].rightShoulder=0;assert.ok(roadGeometry(r,curved,[0,0,0]).layers.every(l=>isClosedOriented(l.mesh)));
});
