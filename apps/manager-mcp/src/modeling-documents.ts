/** Header/cell evidence is deterministic. Classification and unit mapping are
 * reviewed inputs, not guesses from layer names or BOQ quantities. */
import {z} from 'zod';import {can,DomainError,type ToolContext} from '@insa/core';
import {readFileEvidence,type FilesState} from '@insa/files';
import type {Builder,registerModelingCapability} from './modeling.js';
export const DocumentRequest=z.object({file:z.string(),version:z.number().int().positive(),sheet:z.string().optional()}).strict();
export function documentUnderstanding(ctx:ToolContext<any>,request:z.infer<typeof DocumentRequest>){
 if(!can(ctx.actor,'files.read',ctx.platform.roles))throw new DomainError('Document evidence requires files.read.','UNAUTHORIZED');
 const files=ctx.states?.get('files') as FilesState;if(!files)throw new DomainError('Project document context missing.','INVALID_SOURCE_REFERENCE');
 const source=readFileEvidence(ctx.platform.requireArtifacts(),ctx.project,files,request.file,request.version),a=source.analysis;
 const sheets=(a.structure?.sheets??[]).filter(s=>!request.sheet||s.name===request.sheet).map(sheet=>{
  const rows=new Map<number,Record<string,{value:string;reference:string;formula?:string}>>();
  for(const cell of sheet.cells){const match=cell.reference.match(/^([A-Z]+)(\d+)$/);if(!match)continue;const row=rows.get(Number(match[2]))??{};row[match[1]]=cell;rows.set(Number(match[2]),row);}
  const ordered=[...rows].sort((a,b)=>a[0]-b[0]),header=ordered.find(([,r])=>Object.values(r).some(c=>c.value.trim()));
  return {name:sheet.name,headers:header?Object.fromEntries(Object.entries(header[1]).map(([col,c])=>[col,c.value])):{},rows:ordered.filter(([n])=>n!==(header?.[0]??0)).slice(0,1000).map(([row,cells])=>({row,cells:Object.fromEntries(Object.entries(cells).map(([col,c])=>[col,{...c,citation:`${source.file} v${source.version} ${sheet.name}!${c.reference}`,verificationStatus:c.formula?'RequiresApproval':'Derived',confidence:c.formula?'cached-formula-value':'literal-cell'}]))})),truncated:ordered.length>1001};
 });
 return {document:source.file,revision:source.version,sha256:source.sha256,filename:source.filename,status:a.status,sheets,textEvidence:a.parts.slice(0,50).map(p=>({...p,citation:`${source.file} v${source.version} page ${p.page} part ${p.part}`,verificationStatus:'Derived'})),warnings:a.warnings,untrustedSource:true,technicalInference:'Explicit column mapping and units are required before generation; no classification from layer/name alone.',supportedInterpretation:sheets.length?'reviewed-tabular-type-and-placement-mapping':'text-evidence-only; use existing CAD/IFC/LandXML geometry adapters where available',boqAuthority:'comparison-only'};
}
const mapping=z.object({type:z.string(),width:z.string(),depth:z.string(),height:z.string(),x:z.string(),y:z.string(),storey:z.string().optional()}).strict();
const input=z.object({kind:z.literal('document-model'),source:DocumentRequest,mapping,units:z.enum(['m','mm','cm','ft','in']),placementUnits:z.enum(['m','mm','cm','ft','in']),storey:z.string(),category:z.string(),family:z.string().optional(),familyDefinition:z.record(z.string(),z.unknown()).optional(),reviewedMapping:z.literal(true),role:z.literal('geometry')}).strict();
export function registerDocumentCapabilities(register:typeof registerModelingCapability){register({id:'reviewed-document-type-instances',kind:'document-model',input,engines:['profile_member'],compile(b,raw){
 const r=input.parse(raw);
 const evidence=documentUnderstanding(b.ctx,r.source);b.extraPermissions.add('files.read');
 let family:string|undefined;
 if(r.category!=='structure.column'){
  if(Boolean(r.family)===Boolean(r.familyDefinition))throw new DomainError('Non-column table mapping requires one explicit existing component family or definition.','SOURCE_REQUIRES_REVIEW');
  family=r.familyDefinition?b.family(r.familyDefinition):b.bim.families[r.family!]?.id??Object.values(b.bim.families).find(f=>f.name===r.family)?.id;
  const f=family?b.bim.families[family]:undefined;
  if(!f||f.category!==r.category||f.representation.kind!=='box'||!['width','depth','height'].every(k=>f.parameters.some(p=>p.key===k&&p.scope==='type'&&p.dataType==='length')))throw new DomainError('Explicit category and width/depth/height component family are required.','SOURCE_REQUIRES_REVIEW');
 }
 if(evidence.sheets.length!==1||evidence.sheets[0].truncated)throw new DomainError('Select one bounded worksheet with at most 1000 data rows.','SOURCE_REQUIRES_REVIEW');
 const sheet=evidence.sheets[0],scale={m:1,mm:.001,cm:.01,ft:.3048,in:.0254}[r.placementUnits],facts:any[]=[],byName=new Map<string,string>(),placements:{type:string;storey:string;at:[number,number];height:number;source:any}[]=[];
 const column=(key:string)=>Object.keys(sheet.headers).find(c=>c===key||sheet.headers[c]===key)??(()=>{throw new DomainError('Mapped column missing: '+key,'SOURCE_REQUIRES_REVIEW');})();
 const columns=Object.fromEntries(Object.entries(r.mapping).map(([key,value])=>[key,column(value)]));
 for(const key of ['width','depth','height','x','y']){const heading=sheet.headers[columns[key]],unit=heading.match(/(?:[_[(]\s*|\s)(mm|cm|m|ft|in)\s*[\])]?$/i)?.[1].toLowerCase(),expected=['width','depth'].includes(key)||key==='height'&&family?r.units:r.placementUnits;if(unit&&unit!==expected)throw new DomainError('Heading unit conflicts with reviewed mapping: '+heading,'SOURCE_REQUIRES_REVIEW');}
 for(const row of sheet.rows){if(!Object.values(row.cells).some((c:any)=>c.value.trim()))continue;
  const cell=(key:string)=>{const c=row.cells[columns[key]];if(!c||c.formula)throw new DomainError('Missing or formula-derived cell requires explicit source review.','SOURCE_REQUIRES_REVIEW');return c;};
  const number=(key:string)=>{const value=cell(key).value.trim();if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))throw new DomainError('Unambiguous numeric cell required: '+key,'SOURCE_REQUIRES_REVIEW');return Number(value);};
  const label=cell('type').value.trim(),width=number('width'),depth=number('depth'),shape=JSON.stringify([width,depth,...(family?[number('height')]:[])]);if(!label)throw new DomainError('Type label missing.','SOURCE_REQUIRES_REVIEW');
  if(byName.has(label)&&byName.get(label)!==shape)throw new DomainError('Conflicting dimensions for source type '+label,'SOURCE_REQUIRES_REVIEW');byName.set(label,shape);
  const type=b.type(family?{kind:'component',name:label,units:r.units,family,parameters:{width,depth,height:number('height')}}:{kind:'column',name:label,units:r.units,profile:{shape:'rect',b:width,h:depth}}),source={file:evidence.document,version:evidence.revision,sha256:evidence.sha256,sheet:sheet.name,row:row.row,typeLabel:label,citations:Object.keys(columns).map(key=>cell(key).citation),verificationStatus:'Derived',mappingReviewed:true};
  placements.push({type,storey:columns.storey?cell('storey').value:r.storey,at:[number('x')*scale,number('y')*scale],height:number('height')*scale,source});facts.push(source);
 }
 if(!placements.length)throw new DomainError('No reviewed geometric rows found.','SOURCE_REQUIRES_REVIEW');
 for(const p of placements){const ids=b.created(()=>family?b.add('bim_create_components',{components:[{type:p.type,storey:p.storey,x:p.at[0],y:p.at[1]}]}):b.add('bim_create_profile_members',{members:[{category:r.category,type:p.type,storey:p.storey,at:p.at,height:p.height}]}));b.add('bim_set_properties',{items:[{ids,pset:'INSA_Source',values:{document:p.source.file,revision:p.source.version,sha256:p.source.sha256,sheet:p.source.sheet,row:p.source.row,sourceTypeLabel:p.source.typeLabel,citations:p.source.citations.join('; '),verificationStatus:'Derived',mappingReviewed:true}}]});}
 b.sourceEvidence.push(...facts);
}});}
