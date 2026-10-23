import {test} from 'node:test';import assert from 'node:assert/strict';
import {familyPresentation} from '../src/family-presentation.js';
test('read-only family properties reflect later member edits and retain canonical section materials',()=>{
 const state:any={alignments:{},sections:{},tunnels:{},families:{'IF-001':{id:'IF-001',name:'Shared family',category:'Köprüler',length:10}},familyInstances:{'FI-001':{id:'FI-001',name:'Bridge1',family:'IF-001',alignment:'AL-001',station:0,members:['RD-001']}},roads:{'RD-001':{id:'RD-001',name:'Bridge deck',from:20,to:50,sections:[20,50].map(station=>({station,leftWidth:2,rightWidth:2,leftShoulder:0,rightShoulder:0,leftCrossfall:0,rightCrossfall:0})),layers:[{id:'deck',name:'Concrete',materialId:'M-0001',componentType:'CT-001',thickness:.3,leftExtent:2,rightExtent:2}]}}};
 const input=[{id:'infra:RD-001',kind:'road_corridor',label:'Deck',properties:{id:'RD-001',quantities:[{volume_m3:36}]}}],before=structuredClone(state);
 const rows=familyPresentation(input,state),family=rows.find(r=>r.kind==='structure_family')!;
 assert.equal(family.properties.station,20);assert.equal(family.properties.to,50);assert.equal(family.properties.length,30);assert.equal(family.properties.detailSections[0].polygons[0].materialId,'M-0001');assert.equal(family.properties.quantities[0].volume_m3,36);assert.equal(rows[0].parent,'infra:FI-001');assert.equal((input[0] as any).parent,undefined);assert.deepEqual(state,before);
});
