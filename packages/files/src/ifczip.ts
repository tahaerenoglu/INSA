import {unzipSync} from 'fflate';
import {DomainError} from '@insa/core';
/** IFCZIP is one original IFC, not a generic archive extractor. Never writes paths. */
export function ifcSourceBytes(bytes:Uint8Array,zipped:boolean):Uint8Array {
 let result=bytes;
 if(zipped){
  let entries=0,invalid=false;
  let files:Record<string,Uint8Array>;
  try{files=unzipSync(bytes,{filter:entry=>{
   entries++;
   if(entries!==1||!entry.name.toLowerCase().endsWith('.ifc')||/[\\/]/.test(entry.name)||entry.name.includes('..')||entry.originalSize<1||entry.originalSize>64*1024*1024){invalid=true;return false;}
   return true;
  }});}catch{throw new DomainError('Invalid IFCZIP archive.','INVALID_INPUT');}
  if(invalid||entries!==1||Object.keys(files).length!==1)throw new DomainError('IFCZIP requires exactly one IFC, at most 64 MiB expanded, without paths.','INVALID_INPUT');
  result=Object.values(files)[0];
 }
 if(!result.length||result.length>64*1024*1024)throw new DomainError('IFC source exceeds 64 MiB.','INVALID_INPUT');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(result);}catch{throw new DomainError('IFC source must be UTF-8.','INVALID_INPUT');}
 if(!/^\s*ISO-10303-21\s*;/i.test(text)||!text.includes('END-ISO-10303-21;'))throw new DomainError('Invalid IFC STEP source.','INVALID_INPUT');
 return result;
}
