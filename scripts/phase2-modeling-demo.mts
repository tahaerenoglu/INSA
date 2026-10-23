/** Three real, isolated governed examples; never reads or edits live project data. */
import fs from 'node:fs';
import path from 'node:path';
import {MemoryStores,ArtifactStore,type Actor} from '@insa/core';
import {createPlatform} from '../apps/manager-mcp/src/runtime.js';
import {engineOfKind} from '@insa/bim';
const root=path.resolve(process.argv[2]??'output/umb-phase2-2026-10-23');fs.mkdirSync(root,{recursive:true});
const p=createPlatform(new MemoryStores(),new ArtifactStore(root));
const actor:Actor={id:'phase2-demo',name:'Isolated Phase 2 demo',kind:'human',roles:['bim_manager']};
const calls:any[]=[],examples:any[]=[];
async function run(project:string,tool:string,input:unknown){const response=await p.execute(actor,project,tool,input);calls.push({project,tool,input,response});return response as any;}
async function save(project:string,request:string){
  const bim:any=await p.state(project,'bim'),infra:any=await p.state(project,'infra'),validation=(await run(project,'model_validate',{})).result;
  const generations=calls.filter(c=>c.project===project&&c.tool==='model_generate');
  examples.push({project,request,highLevelCalls:calls.filter(c=>c.project===project&&/^(model_|project_)/.test(c.tool)).map(c=>({tool:c.tool,input:c.input})),
    engines:[...new Set([...generations.flatMap(c=>c.response.summary?.engines??[]),...Object.values(bim.elements).map((e:any)=>engineOfKind(e.kind)?.id).filter(Boolean)])],elementCount:Object.keys(bim.elements).length,
    infrastructureResources:Object.fromEntries(Object.entries(infra).filter(([,v])=>v&&typeof v==='object'&&!Array.isArray(v)).map(([k,v])=>[k,Object.keys(v as object).length])),
    validation,repair:{applied:0,reason:'No unique missing connection in these generated examples; repair governance is exercised separately in tests.'}});
  for(const [module,state]of [['bim',bim],['infra',infra]])fs.writeFileSync(path.join(root,`${project}-${module}.json`),JSON.stringify(state,null,2));
  fs.writeFileSync(path.join(root,`${project}-history.json`),JSON.stringify(await p.history(project),null,2));
}
await run('roof-building','model_generate',{intent:'Üç katlı 200 m² kırma çatılı bina ve çatıya bağlı duvarlar',requestId:'hip',requirements:{kind:'building',floors:3,totalArea:200,roofForm:'hip'}});
await run('roof-building','model_export',{format:'ifc'});await run('roof-building','model_export',{format:'frag'});
await save('roof-building','Üç katlı toplam 200 m² kırma çatılı bina; gerçek bağlantıları ve clash sonuçlarını denetle.');
await run('services','model_generate',{intent:'Donatı ve MEP için kavramsal bina',requestId:'frame',requirements:{kind:'building',floors:3,totalArea:200}});
await run('services','model_generate',{intent:'Kolon boyuna donatısı ve etriyeleri',requestId:'rebar',requirements:{kind:'reinforcement',hosts:['C-0001','C-0002'],cover:.03,diameter:.016,stirrupDiameter:.008,spacing:.15,steelGrade:'B500B'}});
await run('services','model_generate',{intent:'Onaylı servis bölgesinde temiz su riser ve branşmanları',requestId:'mep',requirements:{kind:'network',name:'CW',domain:'piping',classification:'domestic_cold_water',diameter:.025,shaft:[2,2],routingSpaceApproved:true,terminals:[0,1,2].map(i=>({storey:`UMB-L${i}`,at:[4,2],offset:2.5}))}});
await run('services','model_export',{format:'ifc'});await run('services','model_export',{format:'frag'});
await save('services','Kolon donatısı ve kavramsal temiz su sistemi; kapasite/boyutlandırma hesabı yok.');
await run('chainage','infra_create_alignment',{name:'Source alignment',start_station:1000,horizontal:[{x:0,y:0},{x:2000,y:0}],vertical:[{station:1000,z:10},{station:3000,z:20}]});
await run('chainage','bim_create_materials',{materials:[{name:'Formation'}]});
await run('chainage','infra_create_component_types',{types:[{name:'Formation .30',layer:{name:'Formation',role:'subbase',thickness:.3,leftExtent:3,rightExtent:3,materialId:'M-0001'}}]});
const section=(station:number)=>({station,leftWidth:3,rightWidth:3,leftShoulder:0,rightShoulder:0,leftCrossfall:0,rightCrossfall:0});
await run('chainage','model_generate',{intent:'KM 1+000–3+000 ortak tip ile altyapı koridoru',requestId:'corridor',requirements:{kind:'corridor',definition:{name:'Formation',alignment:'AL-001',from:1000,to:3000,sections:[section(1000),section(3000)],layers:[{componentType:'CT-001'}]}}});
await save('chainage','Kaynak güzergâh üzerinde KM 1+000–3+000; ortak CT-001 kesit tipi. Koridor IFC ihracı bu aşamada desteklenmiyor.');
fs.writeFileSync(path.join(root,'examples.json'),JSON.stringify(examples,null,2));fs.writeFileSync(path.join(root,'calls.json'),JSON.stringify(calls,null,2));
console.log(JSON.stringify(examples.map(e=>({project:e.project,engines:e.engines,elementCount:e.elementCount,infrastructureResources:e.infrastructureResources,issues:e.validation.issues.length,statistics:e.validation.coordination.statistics})),null,2));
console.log(root);
