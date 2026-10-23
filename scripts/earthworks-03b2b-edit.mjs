import path from 'node:path';import {FileStores,ArtifactStore} from '@insa/core';import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
process.env.INSA_APPROVAL='ai';const root=path.resolve('test-results/earthworks-03b2b/data'),p=createPlatform(new FileStores(root),new ArtifactStore(root)),project='solid-fill',actor={id:'qa-ai',name:'Isolated QA AI',kind:'ai',roles:['ai_agent']},s=await p.state(project,'infra'),d=s.earthworks['EW-001'],mode=process.argv[2];
if(mode==='edit'){const {id,revision,...input}=d;console.log(JSON.stringify(await p.execute(actor,project,'infra_upsert_earthworks_design',{...input,design:id,sections:d.sections.map(s=>({...s,elevation:62}))})));}
else if(mode==='reconcile')console.log(JSON.stringify(await p.execute(actor,project,'infra_upsert_earthwork_zones',{design:d.id,zones:Object.values(s.earthworkZones).map(({id,name,from,to,side,operation})=>({id,name,from,to,side,operation}))})));
else if(mode==='undo')console.log(JSON.stringify(await p.execute(actor,project,'platform_undo',{})));
else console.log(JSON.stringify((await p.execute(actor,project,'infra_query_earthworks',{design:d.id,solids:true})).result.solidResults));
