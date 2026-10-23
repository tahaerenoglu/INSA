import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Platform,MemoryStores} from '@insa/core';
import {bimModule,type BimState} from '@insa/bim';
import {runAgent,compact,type AgentEvent,type ModelClient} from '../src/index.js';
const actor={id:'ai:p5',name:'P5',kind:'ai' as const,roles:['bim_manager']};
const platform=()=>new Platform({modules:[bimModule],stores:new MemoryStores(),approvalMode:'auto'});
async function collect(model:ModelClient,p=platform(),options={}){const events:AgentEvent[]=[];for await(const e of runAgent({platform:p,actor,project:'p5',model,history:[],userText:'test',...options}))events.push(e);return events;}
const tool=(id:string,name:string,input:unknown)=>({type:'tool_use',id,name,input});
test('P5 guards: repeated writes execute once; nested differences remain distinct and usage is measured',async()=>{
 const p=platform();let calls=0;
 const model:ModelClient={async run(){calls++;return calls===1?{content:[tool('1','bim_create_storeys',{storeys:[{name:'L0',elevation:0}]}),tool('2','bim_create_storeys',{storeys:[{name:'L1',elevation:3}]}),tool('3','bim_create_storeys',{storeys:[{name:'L0',elevation:0}]})],stop_reason:'tool_use',usage:{inputTokens:10,outputTokens:4}}:{content:[],stop_reason:'end_turn',usage:{inputTokens:20,outputTokens:2}};}};
 const events=await collect(model,p),metric=events.find(e=>e.type==='telemetry') as any;
 assert.equal(Object.keys((await p.state<BimState>('p5','bim')).storeys).length,2);
 assert.equal((await p.history('p5')).length,2);assert.equal(metric.cachedCalls,1);assert.equal(metric.toolCalls,2);assert.equal(metric.inputTokens,30);assert.equal(metric.outputTokens,6);
});
test('P5 guards: identical failing requests stop after two attempts with paired tool results',async()=>{
 let calls=0;const events=await collect({async run(){calls++;return {content:[tool(String(calls),'unknown',{})],stop_reason:'tool_use'};}});
 assert.equal(calls,2);assert.equal((events.at(-1) as any).stop_reason,'repeated_tool_failure');
 assert.equal(events.filter(e=>e.type==='tool_result'&&!e.ok).length,2);
});
test('P5 guards: uncooperative provider times out and oversized context never calls provider',async()=>{
 let calls=0;const model:ModelClient={run(){calls++;return new Promise(()=>{});}};
 const events=await collect(model,platform(),{modelTimeoutMs:10});assert.equal((events.at(-1) as any).stop_reason,'provider_error');
 const bounded=await collect(model,platform(),{maxContextCharacters:2});assert.equal((bounded.at(-1) as any).stop_reason,'context_limit');assert.equal(calls,1);
});
test('P5 context: large JSON remains parseable and preserves proposal authority fields',()=>{
 const messages:any=compact([{role:'user',content:[{type:'tool_result',tool_use_id:'x',content:[{type:'text',text:JSON.stringify({status:'proposed',proposalId:'P-1',summary:{planId:'PLAN-1'},data:'x'.repeat(40000)})}]}]}]);
 const result=JSON.parse(messages[0].content[0].content[0].text);assert.equal(result.status,'proposed');assert.equal(result.proposalId,'P-1');assert.equal(result.summary.planId,'PLAN-1');assert.equal(result.truncated,true);
});
