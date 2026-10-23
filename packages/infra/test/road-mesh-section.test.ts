import {test} from 'node:test';import assert from 'node:assert/strict';
import {sweepSolid} from '../src/sweep.js';import {meshPlaneSegments,sectionLevels} from '../src/road-mesh-section.js';
test('oblique real mesh cut retains measured offsets/elevations; coplanar cap omits internal diagonals',()=>{
 const mesh=sweepSolid([{p:[0,0,0],n:[0,1,0]},{p:[10,0,1],n:[0,1,0]}],[[-2,-1],[2,-1],[2,0],[-2,0]]);
 const cut=meshPlaneSegments(mesh,[5,0,.5],[1,0,.1],[0,-1,0]);assert.equal(cut.segments.length,8);const levels=sectionLevels(cut.segments,0);assert.ok(Math.abs(levels[0]-(-.5+1/101))<1e-8);assert.ok(Math.abs(levels[1]-.5)<1e-8);
 const cap=meshPlaneSegments(mesh,[0,0,0],[1,0,0],[0,-1,0]);assert.equal(cap.coplanarTriangles,2);assert.equal(cap.segments.length,4);assert.deepEqual(sectionLevels(cap.segments,0),[-1,0]);
});
