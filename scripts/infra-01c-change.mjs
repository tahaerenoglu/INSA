import path from 'node:path';import fs from 'node:fs';import {createHash} from 'node:crypto';import {FileStores} from '@insa/core';import {align3d,tunnelGeometry,tunnelQuantities,localOrigin} from '@insa/infra';
process.env.INSA_DATA=path.resolve('test-results/infra-01c/data');process.env.INSA_APPROVAL='ai';
const {createPlatform}=await import('../apps/manager-mcp/src/runtime.ts');
const p=createPlatform(new FileStores(process.env.INSA_DATA)),project='infra-01c-demo',s=await p.state(project,'infra'),b=await p.state(project,'bim'),actor={id:'demo-ai',name:'Isolated demo AI',kind:'ai',roles:['ai_agent']};
const action=process.argv[2]??'assign',a=align3d(s.alignments['AL-001']),geometry=tunnelGeometry(a,s.tunnels['TN-001'].ranges,s.sections,localOrigin(a));
const hashes={positions:createHash('sha256').update(JSON.stringify(geometry.map(r=>r.layers.map(l=>l.mesh)))).digest('hex'),quantities:tunnelQuantities(geometry)};
fs.writeFileSync(`test-results/infra-01c/${action}-engineering.json`,JSON.stringify(hashes,null,2));
let result;
if(action==='undo')result=await p.execute(actor,project,'platform_undo',{});
else if(action==='appearance'||action==='missing'){const appearance=structuredClone(b.materials['M-0003'].appearance);if(action==='appearance'){appearance.baseColor='#6699bb';appearance.textureSize=[2,2];}else appearance.baseColorTexture=`tex-${'0'.repeat(32)}.jpg`;result=await p.execute(actor,project,'bim_update_materials',{items:[{material:'M-0003',set:{appearance}}]});}
else result=await p.execute(actor,project,'infra_update_section_type',{section:'TS-001',assignments:[{layerId:s.sections['TS-001'].layers[1].id,materialId:'M-0002'}]});
console.log(JSON.stringify(result));
