import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {MemoryStores,FileStores} from '@insa/core';import {createPlatform} from '../../manager-mcp/src/runtime.js';import {coordinateAdapter,infrastructureScene} from '../src/infrastructure.js';
import {buildApp} from '../src/app.js';
const actor:any={id:'fixture',name:'Fixture',kind:'human',roles:['bim_manager']};
const g={crs:{name:'EPSG:5254'},eastings:412000,northings:4561000,orthogonalHeight:62,xAxisAbscissa:0,xAxisOrdinate:1,scale:2};
test('large coordinates, elevation, rotation and scale round-trip without CRS reprojection',()=>{
 const a=coordinateAdapter('epsg:5254',g);assert.equal(a.status,'resolved');if(a.status!=='resolved')return;
 const world:[number,number,number]=[411980,4561040,68];assert.deepEqual(a.worldToProject(world),[20,10,3]);assert.deepEqual(a.worldToViewer(world),[20,3,-10]);assert.deepEqual(a.projectToWorld([20,10,3]),world);
 assert.equal(coordinateAdapter('EPSG:4326',g).status,'incompatible');assert.equal(coordinateAdapter(undefined,g).status,'unresolved');assert.equal(coordinateAdapter('EPSG:5254',null).status,'unresolved');
});
import {buildDemo} from './fixtures/infrastructure-demo.js';
export {buildDemo};

test('HTTP scene endpoint enforces authentication and returns explicit unresolved legacy mapping',async()=>{
 const p=createPlatform(new MemoryStores());await p.execute(actor,'legacy','infra_create_alignment',{name:'Legacy',horizontal:[{x:412000,y:4561000},{x:412100,y:4561000}],vertical:[{station:0,z:62},{station:100,z:62}]});
 const app=buildApp({platform:p,model:null});try{assert.equal((await app.inject({method:'GET',url:'/api/projects/legacy/infrastructure'})).statusCode,401);
 const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{user:'viewer'}}),token=login.json().token;
 const r=await app.inject({method:'GET',url:'/api/projects/legacy/infrastructure',headers:{authorization:`Bearer ${token}`}});assert.equal(r.statusCode,200);assert.equal(r.json().status,'unresolved');assert.equal(r.json().objects.length,0);assert.equal(r.json().resources[0].id,'infra:AL-001');
 const other=await app.inject({method:'GET',url:'/api/projects/other/infrastructure',headers:{authorization:`Bearer ${token}`}});assert.equal(other.json().resources.length,0);
 }finally{await app.close();}
});
test('scene is derived, project isolated, replays identically, updates and undo restore geometry',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'insa-01b-'));try{const p=createPlatform(new FileStores(root));await buildDemo(p,'demo');const infra:any=await p.state('demo','infra'),bim:any=await p.state('demo','bim');const before=infrastructureScene('demo',infra,bim);assert.equal(before.status,'resolved');assert.equal(before.objects.length,3);for(const [i,radius] of [[1,3.3],[2,3.5]]){const pos=before.objects[i].positions;assert.ok(Math.abs(Math.hypot(pos[0]-20,pos[1]-.24,pos[2])-radius)<1e-6,'Independent lining radius');}assert.deepEqual(before.objects[0].positions.slice(0,3),[0,0,0]);assert.equal(bim.elements['C-0001'].at[0],20);assert.ok(before.objects.every(o=>o.positions.every(Number.isFinite)));assert.ok(before.objects[0].positions.some((v:number,i:number)=>i%3===1&&Math.abs(v)>1));
 const reopened=createPlatform(new FileStores(root));assert.deepEqual(infrastructureScene('demo',await reopened.state<any>('demo','infra'),await reopened.state<any>('demo','bim')),before);
 await p.execute(actor,'demo','infra_update_alignment',{alignment:'AL-001',vertical:[{station:0,z:64},{station:250,z:67,curve:100},{station:600,z:64}]});const after=infrastructureScene('demo',await p.state<any>('demo','infra'),bim);assert.notEqual(after.key,before.key);assert.equal(after.objects[0].positions[1],2);await p.execute(actor,'demo','platform_undo',{});assert.deepEqual(infrastructureScene('demo',await p.state<any>('demo','infra'),bim),before);
 assert.equal(Object.keys((await p.state<any>('other','infra')).alignments).length,0);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('unlined tunnel sections still emit a selectable display-only clear-profile guide',async()=>{
 const p=createPlatform(new MemoryStores());await buildDemo(p,'clear-profile');const infra:any=await p.state('clear-profile','infra'),bim:any=await p.state('clear-profile','bim');
 infra.sections['TS-001'].layers=[];
 const scene=infrastructureScene('clear-profile',infra,bim),tunnel=scene.resources.find((r:any)=>r.id==='infra:TN-001'),guide=scene.resources.find((r:any)=>r.kind==='tunnel_clearance_guide'),object=scene.objects.find((o:any)=>o.kind==='line-batch'&&o.id===guide?.id);
 assert.ok(tunnel);assert.equal(guide.parent,tunnel.id);assert.equal(guide.properties.displayOnly,true);assert.equal(guide.properties.engineeringQuantity,false);assert.ok(object.positions.length>100);assert.ok(object.positions.every(Number.isFinite));assert.equal(scene.objects.some((o:any)=>o.id.includes(':layer:')),false);
});



