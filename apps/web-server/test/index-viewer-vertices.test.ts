import {test} from 'node:test';import assert from 'node:assert/strict';import {indexViewerVertices} from '../src/index-viewer-vertices.js';
test('indexed viewer data preserves exact triangles, UV seams and hard cap normals',()=>{
 const source={positions:[0,0,0,1,0,0,1,1,0,0,0,0,1,1,0,0,1,0,0,0,0],uv:[0,0,1,0,1,1,0,0,1,1,0,1,2,0],normalGroups:[0,1,2,0,2,3,0]},v=indexViewerVertices(source);assert.equal(v.positions.length,15);assert.equal(v.indices.length,7);assert.deepEqual(v.indices.flatMap(i=>v.positions.slice(i*3,i*3+3)),source.positions);assert.deepEqual(v.indices.flatMap(i=>v.uv.slice(i*2,i*2+2)),source.uv);assert.notEqual(v.indices[0],v.indices[6]);
});
