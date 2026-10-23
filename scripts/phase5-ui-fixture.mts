/** Isolated UI acceptance fixture. NOT an LLM; never enabled by the production entry. */
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import {createPlatform} from '../apps/manager-mcp/src/runtime.js';
import {buildApp} from '../apps/web-server/src/app.js';
import type {ModelClient} from '@insa/agent';
const root=path.resolve('tmp/phase5-ui-data');
if(path.resolve(process.env.INSA_DATA??'')!==root)throw Error('Fixture requires INSA_DATA=tmp/phase5-ui-data');
const model:ModelClient={async run(req,onText){
 const last=req.messages.at(-1)!;
 const call=(name:string,input:unknown)=>({content:[{type:'tool_use',id:crypto.randomUUID(),name,input}],stop_reason:'tool_use'});
 const answer=(text:string)=>{onText(text);return {content:[{type:'text',text}],stop_reason:'end_turn'};};
 if(typeof last.content==='string'){
  if(/doğrula/i.test(last.content))return call('model_validate',{});
  return call('model_plan',{intent:last.content,requestId:'ui-'+crypto.randomUUID()});
 }
 const result=(last.content as any[]).find(b=>b.type==='tool_result');
 if(!result)return answer('SCRIPTED UI FIXTURE: unsupported turn.');
 if(result.is_error)return answer('SCRIPTED UI FIXTURE: işlem hata verdi; girdi incelemesi gerekli.');
 const payload=JSON.parse(result.content[0].text);
 const prior=req.messages.at(-2)?.content as any[];
 const use=prior?.find(b=>b.type==='tool_use'&&b.id===result.tool_use_id);
 if(use?.name==='model_plan'&&payload.summary?.status==='READY')return call('model_generate',{...use.input,planId:payload.summary.planId});
 if(use?.name==='model_plan')return answer('SCRIPTED UI FIXTURE: eksik girdiler '+JSON.stringify(payload.summary?.missing));
 if(payload.status==='proposed')return answer('SCRIPTED UI FIXTURE — gerçek LLM değildir. Plan hazır; değişiklik insan onayını bekliyor.');
 return answer('SCRIPTED UI FIXTURE — gerçek LLM değildir. Doğrulama sonucu alındı; mühendislik yeterlilik hesabı yapılmadı.');
}};
const app=buildApp({platform:createPlatform(),model,devLogin:true,logger:false});
await app.register(fastifyStatic,{root:path.resolve('apps/web/dist')});
app.setNotFoundHandler((req,reply)=>req.url.startsWith('/api/')?reply.status(404).send({error:'Not found'}):reply.sendFile('index.html'));
await app.listen({port:8791,host:'127.0.0.1'});console.log('SCRIPTED acceptance fixture: http://localhost:8791; isolated '+root);
