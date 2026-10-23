import {test} from 'node:test';import assert from 'node:assert/strict';import * as THREE from 'three';
Object.defineProperty(globalThis,'localStorage',{value:{getItem:()=>null},configurable:true});
const {metricUVs,MaterialAppearanceView}=await import('../src/material-appearance.js');
const {api}=await import('../src/api.js');
const triangle=(width:number)=>new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,width,0,0,0,0,3],3));
test('metric UVs retain real-world repeat size across different surface sizes',()=>{
 const small=triangle(3),large=triangle(6);metricUVs(small,[1.5,1.5]);metricUVs(large,[1.5,1.5]);
 assert.equal(small.getAttribute('uv').getX(1),2);assert.equal(large.getAttribute('uv').getX(1),4);
 assert.equal(small.getAttribute('uv').getY(2),large.getAttribute('uv').getY(2));small.dispose();large.dispose();
});
test('shared material reuse, appearance-only changes keep geometry, missing texture fallback and clearing',async()=>{
 let geometryCalls=0,fetches=0;const visibility:any[]=[];
 const object=new THREE.Group();object.position.set(12,4,-8);
 const model:any={object,getLocalIdsByGuids:async(guids:string[])=>guids.map(guid=>guid==='a'?1:2),getItemsGeometry:async(ids:number[])=>{geometryCalls+=ids.length;return ids.map(()=>[{positions:new Float32Array([0,0,0,3,0,0,0,0,3]),indices:new Uint32Array([0,1,2]),transform:new THREE.Matrix4()}]);},setVisible:async(...args:any[])=>visibility.push(args)};
 const view=new MaterialAppearanceView(model,'test');const original=api.texture;api.texture=async()=>{fetches++;throw new Error('missing');};
 const data:any={materials:{M:{appearance:{baseColor:'#cc8833',opacity:1,roughness:.8,metallic:0,textureSize:[1,1],normalConvention:'OpenGL',baseColorTexture:'tex-'+ '0'.repeat(32)+'.jpg'}}},bindings:[{guid:'a',materialId:'M'},{guid:'b',materialId:'M'}]};
 try{await view.update(data);assert.equal(geometryCalls,2);assert.equal(fetches,1);assert.equal(view.stats.materials,1);assert.ok(view.warnings.length);const geometry=(view.group.children[0] as THREE.Mesh).geometry;
  assert.deepEqual(view.group.matrix.elements,object.matrixWorld.elements,'PBR and native fragments share model placement');
  const originalMaterial=(view.group.children[0] as THREE.Mesh).material;
  view.highlight('a');const overlay=view.group.getObjectByName('INSA selection overlay')!;
  assert.equal((overlay.children[0] as THREE.Mesh).geometry,geometry);
  assert.ok((overlay.children[0] as THREE.Mesh).material instanceof THREE.MeshBasicMaterial);
  assert.equal((view.group.children[0] as THREE.Mesh).material,originalMaterial,'selection never replaces PBR material');
  view.highlight(null);assert.equal(view.group.getObjectByName('INSA selection overlay'),undefined);
  assert.equal((view.group.children[0] as THREE.Mesh).material,originalMaterial);
  data.materials.M.appearance.baseColor='#22cc33';await view.update(data);assert.equal(geometryCalls,2);assert.equal((view.group.children[0] as THREE.Mesh).geometry,geometry);assert.equal(view.stats.materials,1);
  data.materials.M.appearance=null;await view.update(data);assert.equal(view.stats.elements,0);assert.ok(visibility.some(x=>x[1]===true));
 }finally{view.dispose();api.texture=original;}
});
