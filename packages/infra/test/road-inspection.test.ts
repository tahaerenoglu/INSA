import {test} from 'node:test';import assert from 'node:assert/strict';
import {align3d,hLength,point3d,roadEngineeringSection,roadIntervalQuantities,roadGeometry,localOrigin,parseStation,type RoadCorridor} from '../src/index.js';
const section=(station:number)=>({station,leftWidth:3.5,rightWidth:3.5,leftShoulder:.75,rightShoulder:.75,leftCrossfall:-.02,rightCrossfall:-.02});
const a=align3d({id:'AL',name:'Straight grade',start_station:0,points:[{x:0,y:0},{x:500,y:0}],pvis:[{station:0,z:62},{station:500,z:67}]});
const r:RoadCorridor={id:'RD',name:'Reference',alignment:'AL',from:0,to:500,sections:[section(0),section(200),{...section(300),leftWidth:4,rightWidth:4,leftShoulder:1,rightShoulder:1,leftCrossfall:.025,rightCrossfall:-.025},{...section(500),leftWidth:4,rightWidth:4,leftShoulder:1,rightShoulder:1,leftCrossfall:.025,rightCrossfall:-.025}],layers:[.04,.06,.12,.2,.25].map((t,i)=>({id:`L${i}`,name:`Layer ${i}`,role:'pavement',thickness:t,leftExtent:i<3?'pavement':'full',rightExtent:i<3?'pavement':'full',materialId:'M-0001'}))};
const near=(x:number,y:number,tol=1e-9)=>assert.ok(Math.abs(x-y)<=tol,`${x} != ${y}`);
test('engineering sections: exact controls, independent transition, elevations and five vertical layers',()=>{
 const before=structuredClone(r);
 for(const station of [0,100,200,250,300,500]){
  const s=roadEngineeringSection(r,a,station),f=Math.max(0,Math.min(1,(station-200)/100)),width=3.5+.5*f,shoulder=.75+.25*f,left=-.02+.045*f,right=-.02-.005*f,z=62+.01*station;
  near(s.parameters.leftWidth,width);near(s.parameters.rightWidth,width);near(s.parameters.leftShoulder,shoulder);near(s.parameters.leftCrossfall,left);near(s.parameters.rightCrossfall,right);near(s.centerline_xyz[2],z);
  near(s.top_points[0].elevation_m,z+(width+shoulder)*left);near(s.top_points[3].elevation_m,z+width*right);assert.equal(s.layers.length,5);
  let depth=0;for(const [i,l] of s.layers.entries()){const w=i<3?width:width+shoulder;near(l.cross_section_area_m2,2*w*r.layers[i].thickness);near(l.upper.find(p=>p.offset_m===0)!.elevation_m,z-depth);for(let j=0;j<l.upper.length;j++)near(l.upper[j].elevation_m-l.lower[j].elevation_m,r.layers[i].thickness);assert.equal(l.layerId,r.layers[i].id);assert.equal(l.materialId,'M-0001');depth+=r.layers[i].thickness;}
  for(let i=0;i<4;i++)for(const p of s.layers[i].lower){const matching=s.layers[i+1].upper.find(q=>q.offset_m===p.offset_m);assert.ok(matching);near(matching.elevation_m,p.elevation_m);}
  near(s.orientation.right_xyz[1],-1);near(s.layers[0].upper.at(-1)!.xyz[1],-width);
 }
 assert.deepEqual(r,before);assert.equal(parseStation('Km 0+250'),250);assert.equal(parseStation('0+250,5'),250.5);assert.throws(()=>parseStation(''));assert.throws(()=>parseStation('no'));
});
test('interval quantities: independent straight/transition volumes, short intervals and additivity',()=>{
 const full=roadIntervalQuantities(r,a,0,500),cuts=[0,100,200,250,300,500],parts=cuts.slice(0,-1).map((s,i)=>roadIntervalQuantities(r,a,s,cuts[i+1]));
 for(let i=0;i<5;i++){near(parts.reduce((sum,p)=>sum+p.quantities[i].volume_m3,0),full.quantities[i].volume_m3,1e-8);near(parts.reduce((sum,p)=>sum+p.quantities[i].projected_plan_area_m2,0),full.quantities[i].projected_plan_area_m2,1e-7);near(parts.reduce((sum,p)=>sum+p.quantities[i].sloping_top_area_m2,0),full.quantities[i].sloping_top_area_m2,full.quantities[i].sloping_top_area_m2*1e-4);}
 near(full.quantities[0].volume_m3,3750*.04);near(roadIntervalQuantities(r,a,100,300).quantities[0].volume_m3,(700+750)*.04);near(roadIntervalQuantities(r,a,250,250.02).quantities[0].volume_m3,(7.5+7.5002)/2*.02*.04,1e-9);
 assert.deepEqual(full.quantities,roadGeometry(r,a,localOrigin(a)).layers.map(l=>l.quantity));
 for(const [from,to] of [[-1,10],[10,501],[200,100],[10,10],[10,10.001],[NaN,10]])assert.throws(()=>roadIntervalQuantities(r,a,from,to));for(const s of [-.001,500.001,Infinity,NaN])assert.throws(()=>roadEngineeringSection(r,a,s));
});
test('curved/vertical asymmetric sections: Jacobian differs from transverse area, interval sum reconciles',()=>{
 const curve=align3d({id:'AL',name:'Curve',start_station:0,points:[{x:0,y:0},{x:100,y:0,radius:50},{x:100,y:100}],pvis:[{station:0,z:10},{station:90,z:15,curve:40},{station:200,z:12}]}),end=hLength(curve.h),road={...r,to:end,sections:[{...section(0),leftCrossfall:.03,rightCrossfall:-.04},{...section(end),leftCrossfall:.03,rightCrossfall:-.04}],layers:[{...r.layers[0],thickness:.2,leftExtent:3,rightExtent:5}]};
 const angle=point3d(curve,end).az-point3d(curve,0).az,full=roadIntervalQuantities(road,curve,0,end),expected=.2*(8*end+8*angle);near(full.quantities[0].volume_m3,expected,1e-8);
 const cuts=[0,50,80,110,end],sum=cuts.slice(0,-1).reduce((v,s,i)=>v+roadIntervalQuantities(road,curve,s,cuts[i+1]).quantities[0].volume_m3,0);near(sum,expected,1e-8);
 const s=roadEngineeringSection(road,curve,80);near(s.layers[0].cross_section_area_m2,1.6);near(s.layers[0].volume_per_horizontal_m,.2*(8+8*s.orientation.curvature_per_m));assert.notEqual(s.layers[0].cross_section_area_m2,s.layers[0].volume_per_horizontal_m);assert.ok(s.orientation.grade!==0);
});
