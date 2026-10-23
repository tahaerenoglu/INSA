import {test} from 'node:test';
import assert from 'node:assert/strict';
import {egm96Reference} from '../src/geoid-reference';
test('local EGM96 reference matches independently sampled origin and rejects outside coverage',()=>{
 assert.ok(Math.abs(egm96Reference(28.6223143,41.2348879)!.value-37.2327027413)<0.00001);
 assert.equal(egm96Reference(0,0),null);assert.equal(egm96Reference(NaN,41),null);
 assert.ok(egm96Reference(26,43));assert.ok(egm96Reference(34,36));
 const a=egm96Reference(28.5,41)!.value,b=egm96Reference(28.75,41)!.value;
 assert.ok(Math.abs(egm96Reference(28.625,41)!.value-(a+b)/2)<1e-10);
});
