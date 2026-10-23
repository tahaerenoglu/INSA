import fs from 'node:fs';import path from 'node:path';
import {Platform,FileStores,ArtifactStore} from '@insa/core';import {bimModule,toIfc} from '@insa/bim';
const root=path.resolve('test-results/material-appearance/data'),project='pbr-demo-v01-final';
const p=new Platform({modules:[bimModule],stores:new FileStores(root),artifacts:new ArtifactStore(root),logger:{info(){},warn(){}}});
const actor={id:'fixture',name:'Isolated test fixture',kind:'human',roles:['bim_manager']};
for(const [id,name,size]of [['concrete_wall_001','Beton C30/35',[2,2]],['brick_wall_001','Tuğla',[2,2]],['wood_floor','Meşe Parke',[1.7,1.7]]]){
 const r=await p.execute(actor,project,'material_import',{asset_id:id,resolution:'1k',textureSize:size});
 await p.execute(actor,project,'bim_update_materials',{items:[{material:name,set:{appearance:r.result.appearance}}]});
}
fs.writeFileSync('test-results/material-appearance/demo.ifc',toIfc(await p.state(project,'bim'),{projectKey:project}));
console.log('Updated complete color/normal/roughness appearances without geometry changes.');
