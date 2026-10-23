import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';
import {Platform,FileStores} from '../src/index.js';import {demo} from './fixtures/demo.js';
test('portable node runner: separate processes approve a proposal at most once',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'insa-portable-'));try{
 const p=new Platform({modules:[demo],stores:new FileStores(root),approvalMode:'ai'}),ai:any={id:'ai',name:'AI',kind:'ai',roles:['ai_agent']};const proposal:any=await p.execute(ai,'p1','demo_inc',{});
 const child=path.resolve('packages/core/test/fixtures/approve-child.ts');const outcomes=await Promise.all([0,1,2].map(n=>new Promise<any>((resolve,reject)=>{const c=spawn(process.execPath,['--import','tsx',child,root,'p1',proposal.proposalId,`human-${n}`],{env:{...process.env,START_AT:String(Date.now()+800)},stdio:['ignore','pipe','pipe']});let output='',error='';c.stdout.on('data',b=>output+=b);c.stderr.on('data',b=>error+=b);c.on('error',reject);c.on('close',code=>{if(code!==0)reject(new Error(error));else{try{resolve(JSON.parse(output.trim()));}catch(e){reject(e);}}});})));
 assert.equal(outcomes.filter(x=>x.ok).length,1);const events=await p.store('p1').readEvents();assert.equal(events.filter(e=>e.type==='Inc').length,1);assert.equal(events.filter(e=>e.type==='CommandApplied'&&e.payload.proposalId===proposal.proposalId).length,1);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
