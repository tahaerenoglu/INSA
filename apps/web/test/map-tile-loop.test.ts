import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {bindMapTileLoop} from '../src/map-tile-loop';

test('map traversal follows moving and replaced cameras, viewport resize, loads and disposal',()=>{
 const listeners=new Set<()=>void>(),loads=new Map<string,()=>void>();
 const world={onAfterUpdate:{add:(fn:()=>void)=>listeners.add(fn),remove:(fn:()=>void)=>listeners.delete(fn)}};
 let camera:THREE.Camera=new THREE.PerspectiveCamera(),width=800,updates=0,invalidations=0,reports=0;
 const parent=new THREE.Group();parent.position.x=100;parent.add(camera);
 const group=new THREE.Group(),root=new THREE.Group();root.position.z=30;root.add(group);
 const registered=new Set<THREE.Camera>();let resolution=0;
 const tiles:any={group,setCamera:(c:THREE.Camera)=>registered.add(c),deleteCamera:(c:THREE.Camera)=>registered.delete(c),
  setResolutionFromRenderer:(c:THREE.Camera,r:any)=>{assert.ok(registered.has(c));resolution=r.width;},
  update:()=>{updates++;assert.equal(camera.matrixWorldInverse.clone().multiply(camera.matrixWorld).equals(new THREE.Matrix4()),true);},
  addEventListener:(name:string,fn:()=>void)=>loads.set(name,fn),removeEventListener:(name:string)=>loads.delete(name)};
 const stop=bindMapTileLoop(world,()=>({camera,renderer:{width} as any,invalidate:()=>invalidations++}),tiles,()=>reports++);
 const frame=()=>{for(const fn of listeners)fn();};
 frame();assert.equal(updates,1);assert.equal(camera.matrixWorld.elements[12],100);assert.equal(group.matrixWorld.elements[14],30);
 camera.position.x=700;frame();assert.equal(camera.matrixWorld.elements[12],800);assert.equal(updates,2);
 const old=camera;camera=new THREE.OrthographicCamera();width=1600;frame();assert.equal(registered.has(old),false);assert.ok(registered.has(camera));assert.equal(resolution,1600);
 const before=invalidations;loads.get('needs-update')!();assert.equal(invalidations,before+1);assert.equal(reports,3);
 stop();frame();assert.equal(updates,3);assert.equal(registered.size,0);assert.equal(loads.size,0);assert.equal(listeners.size,0);
});
