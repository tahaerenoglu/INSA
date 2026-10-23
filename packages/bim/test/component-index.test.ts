import {test} from 'node:test';import assert from 'node:assert/strict';
import {initialState,componentBox,polygonSignedArea,GEOMETRY_EPSILON as E,type BimState} from '../src/index.js';
import {modellingIssues,footprintIntersection} from '../src/modelling-policy.js';
function scene(count:number):BimState{const s=initialState();s.storeys.L0={id:'L0',name:'L0',elevation:0};s.families.F={id:'F',name:'Box',category:'architecture.generic_model',parameters:['width','depth','height'].map(key=>({key,name:key,scope:'type',dataType:'length',required:true})),representation:{kind:'box',width:'width',depth:'depth',height:'height'}} as any;s.types.T={id:'T',name:'Box',kind:'component',family:'F',parameters:{width:2,depth:.3,height:1}};
 for(let i=0;i<count;i++)s.elements['CO-'+String(i).padStart(5,'0')]={id:'CO-'+String(i).padStart(5,'0'),kind:'component',storey:'L0',type:'T',placement:{kind:'level_point',x:(i%10)*.8,y:Math.floor(i/10)*.7,offset:(i%3)*.4,rotation:(i%7)*19},parameters:{}};
 return s;
}
test('component spatial sweep equals exhaustive exact intersections for rotated boxes and multiple elevations',()=>{
 const s=scene(100),elements=Object.values(s.elements).filter(e=>e.kind==='component'),expected:any[]=[];
 for(let i=0;i<elements.length;i++)for(let j=i+1;j<elements.length;j++){const a=componentBox(s,elements[i]),b=componentBox(s,elements[j]),height=Math.min(a.zTop,b.zTop)-Math.max(a.zBottom,b.zBottom),area=Math.abs(polygonSignedArea(footprintIntersection(a.corners,b.corners)));if(height>E&&area>E*E)expected.push({ids:[elements[i].id,elements[j].id],volume:area*height});}
 const actual=modellingIssues(s).filter(i=>i.code==='component_overlap');assert.deepEqual(actual.map(i=>i.ids),expected.map(i=>i.ids));for(let i=0;i<actual.length;i++)assert.ok(Math.abs(actual[i].volume!-expected[i].volume)<1e-10);
});
test('5000 separated component occurrences retain identities with no overlap issues',()=>{const s=scene(5000);for(const [i,e]of Object.values(s.elements).entries())if(e.kind==='component'){e.placement.x=(i%100)*4;e.placement.y=Math.floor(i/100)*4;}assert.equal(modellingIssues(s).length,0);assert.equal(Object.keys(s.elements).length,5000);});
