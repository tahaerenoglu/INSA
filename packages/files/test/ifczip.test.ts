import {test} from 'node:test';import assert from 'node:assert/strict';
import {zipSync} from 'fflate';import {ifcSourceBytes} from '../src/ifczip.js';
const original=new TextEncoder().encode('ISO-10303-21;\nHEADER;ENDSEC;DATA;ENDSEC;END-ISO-10303-21;');
test('IFCZIP preserves original bytes and rejects multi-entry archives, paths and non-IFC content',()=>{
 assert.deepEqual(ifcSourceBytes(zipSync({'building.ifc':original}),true),original);
 for(const zipped of [zipSync({'a.ifc':original,'b.ifc':original}),zipSync({'../a.ifc':original}),zipSync({'a.txt':original}),zipSync({'a.ifc':new TextEncoder().encode('not IFC')})])assert.throws(()=>ifcSourceBytes(zipped,true));
});
test('IFCZIP rejects expanded-size limit from ZIP metadata before inflation',()=>{
 const bytes=zipSync({'building.ifc':original}),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.length);
 for(let n=0;n<bytes.length-46;n++)if(view.getUint32(n,true)===0x02014b50){view.setUint32(n+24,65*1024*1024,true);break;}
 assert.throws(()=>ifcSourceBytes(bytes,true),/64 MiB/);
});
