import {test} from 'node:test';import assert from 'node:assert/strict';
import {align3d,point3d,roadGeometry,roadEngineeringSection,roadIntervalQuantities,isClosedOriented,type RoadCorridor} from '../src/index.js';
const a=align3d({id:'AL',name:'Parabola',start_station:0,points:[{x:400000,y:4500000},{x:400200,y:4500000}],pvis:[{station:0,z:55},{station:100,z:54,curve:100},{station:200,z:55}]});
const road=():RoadCorridor=>({id:'RD',name:'Profile components',alignment:'AL',from:50,to:150,sections:[50,150].map(station=>({station,leftWidth:7.25,rightWidth:7.25,leftShoulder:0,rightShoulder:0,leftCrossfall:-.05,rightCrossfall:-.05})),layers:[{id:'sleepers',name:'Sleepers',role:'sleeper',thickness:.234,leftExtent:3.55,rightExtent:.1,materialId:'M-0001',profile:[[-3.55,-.406],[-.95,-.406],[-.95,-.172],[-3.55,-.172]],repeat:{anchor:50.15,spacing:.6,length:.3}}]});
test('repeated closed components follow real vertical parabola, with stable identities and actual section inspection',()=>{
 const r=road(),g=roadGeometry(r,a,[400000,4500000,0]),l=g.layers[0];assert.equal(l.parts!.length,167);
 for(const p of l.parts!){assert.ok(isClosedOriented(p.mesh));assert.ok(Math.abs(p.mesh.positions[2]-(point3d(a,p.from).z-.406))<1e-10);assert.ok(p.mesh.faceGroups.length===p.mesh.indices.length/3);}
 assert.ok(Math.abs(l.quantity.volume_m3-167*.3*2.6*.234)<1e-8);
 const s=roadEngineeringSection(r,a,50.15);assert.ok(Math.abs(s.layers[0].cross_section_area_m2-2.6*.234)<1e-12);assert.equal(roadEngineeringSection(r,a,50.45).layers[0].cross_section_area_m2,0);
 const changed=structuredClone(r);changed.layers[0].repeat!.spacing=.8;assert.notEqual(roadGeometry(changed,a,[0,0,0]).layers[0].parts!.length,l.parts!.length);assert.equal(r.layers[0].repeat!.spacing,.6);
});
test('interval queries retain sleeper phase and clip boundary pieces without duplication or missing volume',()=>{
 const r=road(),whole=roadGeometry(r,a,[0,0,0]).layers[0].quantity.volume_m3;
 const left=roadIntervalQuantities(r,a,50,99.37).quantities[0].volume_m3,right=roadIntervalQuantities(r,a,99.37,150).quantities[0].volume_m3;
 assert.ok(Math.abs(whole-left-right)<1e-7);
});
test('invalid profile/repetition rejected; continuous rail section remains a closed parametric sweep',()=>{
 for(const edit of [(r:RoadCorridor)=>r.layers[0].repeat!.length=.7,(r:RoadCorridor)=>r.layers[0].repeat!.spacing=0,(r:RoadCorridor)=>r.layers[0].profile!.reverse(),(r:RoadCorridor)=>r.layers[0].profile=[[0,0],[1,1],[0,1],[1,0]]]){const r=road();edit(r);assert.throws(()=>roadGeometry(r,a,[0,0,0]));}
 const r=road();delete r.layers[0].repeat;const g=roadGeometry(r,a,[0,0,0]);assert.equal(g.layers[0].parts!.length,1);assert.ok(isClosedOriented(g.layers[0].mesh));assert.ok(Math.abs(g.layers[0].quantity.volume_m3-100*2.6*.234)<1e-7);
});
test('two-kilometre extension fills before the original anchor and preserves existing sleeper identities',()=>{
 const a2=align3d({id:'AL',name:'Long',start_station:0,points:[{x:400000,y:4500000},{x:402000,y:4500000}],pvis:[{station:0,z:55},{station:2000,z:65}]});
 const original=road(),r=road();r.from=0;r.to=2000;r.sections=[{...r.sections[0],station:0},{...r.sections[1],station:2000}];
 const g=roadGeometry(r,a2,[400000,4500000,0]),pieces=g.layers[0].parts!;
 assert.ok(pieces.length>3300&&pieces.length<3400);assert.ok(pieces[0].from<.6);assert.ok(pieces.at(-1)!.to>1999.4);
 const originalPieces=roadGeometry(original,a,[400000,4500000,0]).layers[0].parts!;
 for(const p of originalPieces){const same=pieces.find(x=>x.id===p.id);assert.ok(same);assert.equal(same.from,p.from);assert.equal(same.to,p.to);}
 const tooMany=structuredClone(r);tooMany.layers[0].repeat!.spacing=.3;assert.throws(()=>roadGeometry(tooMany,a2,[0,0,0]),/5000/);
});
