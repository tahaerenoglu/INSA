import path from 'node:path';import {FileStores} from '@insa/core';import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
const p=createPlatform(new FileStores(path.resolve('test-results/infra-01b/data'))),project='infra-01b-demo',actor={id:'fixture',name:'Isolated browser fixture',kind:'human',roles:['bim_manager']};
if(process.argv.includes('--undo')){const h=await p.history(project,1);if(h[0]?.tool!=='infra_update_alignment')throw Error('Latest command is not the demo update');console.log(await p.execute(actor,project,'platform_undo',{}));}
else console.log(await p.execute(actor,project,'infra_update_alignment',{alignment:'AL-001',vertical:[{station:0,z:64},{station:250,z:67,curve:100},{station:600,z:64}]}));
