import fs from 'node:fs';
import {createPlatform} from '../apps/manager-mcp/src/runtime.ts';
const p=createPlatform(),project='temiz-proje-20261013',actor={id:'codex',name:'Codex',kind:'ai',roles:['ai_agent']};
const {items}=JSON.parse(fs.readFileSync('test-results/eleven-level-building/inputs.json','utf8'));
const r=await p.execute(actor,project,'bim_place_openings',{items});console.log(JSON.stringify({status:r.status,proposalId:r.proposalId,doors:88,windows:132}));
const m=await p.execute(actor,project,'bim_update_types',{items:[...['DT-0001','DT-0002','DT-0003'].map(type=>({kind:'door',type,set:{material:'Kapı Ahşabı'}})),...['NT-0001','NT-0002'].map(type=>({kind:'window',type,set:{material:'Pencere Camı'}}))]});console.log(JSON.stringify({status:m.status,proposalId:m.proposalId}));
