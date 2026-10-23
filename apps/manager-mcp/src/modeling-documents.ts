/** Header/cell evidence is deterministic. Classification and unit mapping are
 * reviewed inputs, not guesses from layer names or BOQ quantities. */
import {createHash} from 'node:crypto';
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

/** Reviewed field meanings, never executable instructions from source text. */
const field=z.enum(['type','tag','width','depth','height','x','y','storey','axis','station','material']);
export const DocumentSetRequest=z.object({sources:z.array(z.object({source:DocumentRequest,role:z.enum(['geometry','specification','boq']),mapping:z.partialRecord(field,z.string()),units:z.enum(['m','mm','cm','ft','in']),placementUnits:z.enum(['m','mm','cm','ft','in']),coordinateReference:z.string().min(1).max(200)}).strict()).min(1).max(10),reviewedMapping:z.literal(true)}).strict();
const unitScale={m:1,mm:.001,cm:.01,ft:.3048,in:.0254};
export function documentRequirements(ctx:ToolContext<any>,raw:z.infer<typeof DocumentSetRequest>){
 const request=DocumentSetRequest.parse(raw),parameters:any[]=[],rows:any[]=[],warnings:string[]=[];
 for(const item of request.sources){
  const evidence=documentUnderstanding(ctx,item.source);
  if(evidence.sheets.length!==1||evidence.sheets[0].truncated)throw new DomainError('Select one bounded worksheet per mapping.','SOURCE_REQUIRES_REVIEW');
  const sheet=evidence.sheets[0],columns:Record<string,string>={};
  for(const [key,heading]of Object.entries(item.mapping)){
   const col=Object.keys(sheet.headers).find(c=>c===heading||sheet.headers[c]===heading);if(!col)throw new DomainError('Mapped column missing: '+heading,'SOURCE_REQUIRES_REVIEW');columns[key]=col;
   const declared=sheet.headers[col].match(/(?:[_[(]\s*|\s)(mm|cm|m|ft|in)\s*[\])]?$/i)?.[1].toLowerCase();
   if(declared&&['width','depth','height','x','y','station'].includes(key)&&declared!==(['width','depth','height'].includes(key)?item.units:item.placementUnits))throw new DomainError('Heading unit conflicts with mapping.','SOURCE_REQUIRES_REVIEW');
  }
  if(!columns.type)throw new DomainError('Explicit shared type-code mapping required.','SOURCE_REQUIRES_REVIEW');
  for(const row of sheet.rows){
   if(!Object.values(row.cells).some((c:any)=>c.value.trim()))continue;
   const code=row.cells[columns.type]?.value.trim();if(!code)throw new DomainError('Type code missing.','SOURCE_REQUIRES_REVIEW');
   const values:Record<string,any>={},facts:any[]=[];
   for(const [name,col]of Object.entries(columns)){
    const cell=row.cells[col],numeric=['width','depth','height','x','y','station'].includes(name),unit=numeric?(['width','depth','height'].includes(name)?item.units:item.placementUnits):null;
    const literal=cell?.value.trim()??'',valid=!numeric||/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(literal);
    const status=!literal?'Missing':cell?.formula?'RequiresApproval':!valid?'RequiresApproval':'Derived';
    const parameter={id:'FACT-'+createHash('sha256').update(JSON.stringify([evidence.document,evidence.revision,evidence.sha256,sheet.name,row.row,col,name,item.role,item.coordinateReference,unit])).digest('hex').slice(0,20),name,value:literal&&valid?(numeric?Number(literal):literal):null,unit,normalizedValue:numeric&&literal&&valid?Number(literal)*unitScale[unit as keyof typeof unitScale]:literal||null,normalizedUnit:numeric?'m':null,file:evidence.document,revision:evidence.revision,sha256:evidence.sha256,sheet:sheet.name,cell:cell?.reference??col+row.row,citation:cell?.citation??`${evidence.document} v${evidence.revision} ${sheet.name}!${col}${row.row}`,coordinateReference:item.coordinateReference,confidence:status==='Derived'?'literal-reviewed-mapping':'unverified',verificationStatus:status,role:item.role,typeCode:code};
    parameters.push(parameter);facts.push(parameter);values[name]=parameter.normalizedValue;
   }
   rows.push({typeCode:code,role:item.role,values,parameters:facts,coordinateReference:item.coordinateReference});
  }
 }
 const conflicts:any[]=[];
 // Type dimensions/material are shared; coordinates belong to occurrences and never merge by type.
 const dimensionGroups=new Map<string,any[]>();
 for(const fact of parameters.filter(f=>f.role!=='boq'&&['width','depth','height','material'].includes(f.name)&&f.verificationStatus==='Derived')){const key=fact.typeCode+':'+fact.name;dimensionGroups.set(key,[...(dimensionGroups.get(key)??[]),fact]);}
 for(const [key,facts]of dimensionGroups)if(new Set(facts.map(f=>JSON.stringify(f.normalizedValue))).size>1){facts.forEach(f=>f.verificationStatus='Conflicting');conflicts.push({key,parameterIds:facts.map(f=>f.id),citations:facts.map(f=>f.citation),reason:'Incompatible values for the same explicit type code'});}
 const modelRequirements=rows.filter(r=>r.role==='geometry'&&('x'in r.values||'y'in r.values)).map(row=>{
  const shared=Object.fromEntries(['width','depth','height','material'].map(name=>[name,(dimensionGroups.get(row.typeCode+':'+name)??[])[0]?.normalizedValue]));
  const relevant=parameters.filter(f=>f.typeCode===row.typeCode&&f.role!=='boq'&&['width','depth','height','material'].includes(f.name));
  const values={...shared,...row.values},all=[...row.parameters,...relevant];
  const missing=['width','depth','height','x','y'].filter(k=>typeof values[k]!=='number'||!Number.isFinite(values[k]));
  return {category:'structure.column',typeCode:row.typeCode,tag:values.tag??null,dimensions:{width:values.width,depth:values.depth,height:values.height,unit:'m'},placement:{x:values.x,y:values.y,storey:values.storey??null,coordinateReference:row.coordinateReference},material:values.material??null,host:null,connections:[],parameterIds:[...new Set(all.map(f=>f.id))],sourceReferences:[...new Set(all.map(f=>f.citation))],missing,status:all.some(f=>f.verificationStatus==='Conflicting')?'Conflicting':all.some(f=>f.verificationStatus==='RequiresApproval')||row.coordinateReference!=='local-project-SI'?'RequiresApproval':missing.length?'Missing':'Derived'};
 });
 if(!modelRequirements.length)warnings.push('No explicit geometry placement rows; text/BOQ alone cannot create occurrences.');
 if(modelRequirements.some(r=>r.placement.coordinateReference!=='local-project-SI'))warnings.push('Mapped generation supports reviewed local-project-SI coordinates only. No source-to-project CRS transform was performed.');
 return {parameters,conflicts,modelRequirements,warnings,ready:modelRequirements.length>0&&conflicts.length===0&&modelRequirements.every(r=>r.status==='Derived'),scope:'Reviewed rectangular column requirements only; category is an explicit capability contract, not inferred document meaning',relationshipBasis:'Explicit shared type codes only; axis/station/tag retained as evidence, never guessed',boqAuthority:'comparison-only',qualityLevel:'SOURCE-BASED',engineeringAdequacy:false,untrustedSource:true};
}
export function registerDocumentSetCapability(register:typeof registerModelingCapability){
 const schema=DocumentSetRequest.extend({kind:z.literal('document-set-model'),storey:z.string()}).strict();
 register({id:'reviewed-multi-document-columns',kind:'document-set-model',input:schema,engines:['profile_member'],compile(b,raw){
  const r=schema.parse(raw),evidence=documentRequirements(b.ctx,{sources:r.sources,reviewedMapping:r.reviewedMapping});b.extraPermissions.add('files.read');
  if(!evidence.ready)throw new DomainError('Document requirements contain conflicts, missing geometry or unreviewed values. Query documents.requirements for citations.','SOURCE_REQUIRES_REVIEW',{conflicts:evidence.conflicts.length,requirements:evidence.modelRequirements.length});
  for(const requirement of evidence.modelRequirements){
   const d=requirement.dimensions,p=requirement.placement,type=b.type({kind:'column',name:requirement.typeCode,profile:{shape:'rect',b:d.width,h:d.depth},...(requirement.material?{material:requirement.material}:{})});
   const ids=b.created(()=>b.add('bim_create_profile_members',{members:[{category:'structure.column',type,storey:p.storey??r.storey,at:[p.x,p.y],height:d.height}]}));
   b.add('bim_set_properties',{items:[{ids,pset:'INSA_Source',values:{citations:requirement.sourceReferences.join('; '),parameterIds:requirement.parameterIds.join('; '),sourceTypeLabel:requirement.typeCode,sourceTag:requirement.tag??'',coordinateReference:p.coordinateReference,verificationStatus:'Derived',qualityLevel:'SOURCE-BASED',mappingReviewed:true}}]});
  }
  b.sourceEvidence.push(...evidence.parameters);
 }});
}
