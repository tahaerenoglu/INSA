import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {FileStores,ArtifactStore} from '@insa/core';
import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
const root=path.resolve('test-results/real-dxf02/data'),id='real-railway-dxf-acceptance',target=path.resolve(root,id),archive=path.resolve('test-results/project-archives',`${id}-${Date.now()}`);
assert.equal(path.dirname(target),root);assert.ok(archive.startsWith(path.resolve('test-results/project-archives')+path.sep));
if(fs.existsSync(target)){assert.ok(!fs.lstatSync(target).isSymbolicLink());fs.mkdirSync(path.dirname(archive),{recursive:true});fs.renameSync(target,archive);}
const project='temiz-proje-20261016',p=createPlatform(new FileStores(root),new ArtifactStore(root));
const actor={id:'project-maintenance',name:'User-authorized project maintenance',kind:'human',roles:['bim_manager']};
const result=await p.execute(actor,project,'bim_set_project',{name:'Temiz Proje',description:'Boş başlangıç projesi'});assert.equal(result.status,'applied');
const bim=await p.state(project,'bim'),infra=await p.state(project,'infra');
for(const key of ['elements','types','materials','storeys','grids'])assert.equal(Object.keys(bim[key]??{}).length,0,key);
for(const key of ['cadDrawings','cadRegions','alignments','cadAlignmentReviews','terrains'])assert.equal(Object.keys(infra[key]??{}).length,0,key);
assert.ok(!(await p.stores.listProjects()).includes(id));
console.log(JSON.stringify({project,name:'Temiz Proje',archived:archive,empty:true,result}));
