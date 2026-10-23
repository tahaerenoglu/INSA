import {test} from 'node:test';import assert from 'node:assert/strict';import {stairProfile} from '../src/arch.js';
test('optional sloped stair underside preserves treads and clears the under-stair volume',()=>{
 const el={start:[0,0] as [number,number],end:[0,2.24] as [number,number],height:1.5,riserCount:9};
 const old=stairProfile(el),profile=stairProfile(el,.15);
 assert.deepEqual(profile.slice(0,17),old.slice(0,17));
 const [last,bottom]=profile.slice(-2);assert.equal(last[0],2.24);assert.ok(last[1]>1.15);assert.ok(bottom[0]>0&&bottom[0]<.4);assert.equal(bottom[1],0);
 assert.deepEqual(stairProfile(el),old,'legacy types remain unchanged');
});
