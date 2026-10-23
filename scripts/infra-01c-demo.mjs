import fs from 'node:fs';import path from 'node:path';import {FileStores,ArtifactStore} from '@insa/core';import {buildDemo} from '../apps/web-server/test/fixtures/infrastructure-demo.ts';
const root=path.resolve('test-results/infra-01c/data'),project='infra-01c-demo';
process.env.INSA_DATA=root;const {createPlatform}=await import('../apps/manager-mcp/src/runtime.ts');
const source=createPlatform(new FileStores('data')),sourceProject='temiz-proje-20261013',bim=await source.state(sourceProject,'bim');
const sourceAssets=new ArtifactStore(path.resolve('data')),assets=new ArtifactStore(root);process.env.INSA_DATA=root;
const p=createPlatform(new FileStores(root));const actor={id:'fixture',name:'Isolated Phase 01C fixture',kind:'human',roles:['bim_manager']};
if((await p.seq(project))===0){
 await buildDemo(p,project);
 const appearances=['rough_concrete','concrete_wall_003'].map(id=>{const material=Object.values(bim.materials).find(m=>m.appearance?.source?.assetId===id);if(!material)throw new Error(`Previously imported material ${id} unavailable`);const a=structuredClone(material.appearance);for(const file of [a.baseColorTexture,a.normalTexture,a.roughnessTexture].filter(Boolean)){const bytes=fs.readFileSync(sourceAssets.resolveTexture(sourceProject,file));assets.saveTexture(project,file.slice(4,36),bytes);}return a;});
 appearances[0].textureSize=[2,2];appearances[1].textureSize=[1,1];
 await p.execute(actor,project,'bim_create_materials',{materials:[{name:'Tunnel Shotcrete',category:'concrete',appearance:appearances[0]},{name:'Tunnel Concrete Lining',category:'concrete',appearance:appearances[1]}]});
 const s=await p.state(project,'infra'),layers=s.sections['TS-001'].layers;
 await p.execute(actor,project,'infra_update_section_type',{section:'TS-001',assignments:[{layerId:layers[0].id,materialId:'M-0002'},{layerId:layers[1].id,materialId:'M-0003'}]});

 await p.createSnapshot(project);
}
const demoBim=await p.state(project,'bim'),columnType=Object.values(demoBim.types).find(t=>t.kind==='column');
if(columnType?.material!=='M-0002')await p.execute(actor,project,'bim_update_types',{items:[{kind:'column',type:columnType.id,set:{material:'M-0002'}}]});
await p.createSnapshot(project);
console.log(JSON.stringify({root,project,seq:await p.seq(project)}));
