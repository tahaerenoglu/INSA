import { createHash } from "node:crypto";
import { z } from "zod";
import type { QueryTool, ArtifactStore } from "@insa/core";
import type { BimState } from "./model.js";
import { AppearanceSchema } from "./appearance.js";
const headers = { "User-Agent": "INSA-BIM-MaterialAppearance/0.1", Referer: "https://insa.local/" };
const API = "https://api.polyhaven.com";
const cache = new Map<string,{at:number;value:any}>();
export function allowedTextureUrl(url: string) {
  const u = new URL(url);
  if (u.protocol !== "https:" || u.hostname !== "dl.polyhaven.org" || u.port || u.username || u.password || !u.pathname.startsWith("/file/ph-assets/Textures/jpg/") || !u.pathname.endsWith(".jpg") || u.search || u.hash) throw new Error("Untrusted texture URL");
  return u.href;
}
export async function boundedFetch(url: string, max: number, fetcher: typeof fetch = fetch): Promise<Buffer> {
  const r = await fetcher(url,{headers,redirect:"error",signal:AbortSignal.timeout(30000)});
  if (!r.ok || !r.body) throw new Error(`Poly Haven HTTP ${r.status}`);
  if (Number(r.headers.get("content-length")??0)>max) { await r.body.cancel(); throw new Error("File too large"); }
  const reader=r.body.getReader(), chunks:Uint8Array[]=[]; let size=0;
  try { while(true) { const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>max)throw new Error("File too large"); chunks.push(value); } }
  catch(e) { await reader.cancel(); throw e; }
  return Buffer.concat(chunks);
}
async function json(path: string) {
  const hit=cache.get(path); if(hit && Date.now()-hit.at<3600000)return hit.value;
  const value=JSON.parse((await boundedFetch(API+path,20*1024*1024)).toString("utf8"));
  if(cache.size>128)cache.delete(cache.keys().next().value!);
  cache.set(path,{at:Date.now(),value});return value;
}
export function validateTexture(bytes: Uint8Array, metadata: {size:number;md5:string}) {
  if(bytes.length!==metadata.size || bytes.length>20*1024*1024 || bytes[0]!==255 || bytes[1]!==216 || bytes[2]!==255 || bytes[bytes.length-2]!==255 || bytes[bytes.length-1]!==217 || createHash("md5").update(bytes).digest("hex")!==metadata.md5)throw new Error("Invalid JPEG texture or checksum");
}
export async function importPolyHaven(store: ArtifactStore, project: string, id: string, resolution: "1k"|"2k", textureSize:[number,number]) {
  if(!/^[a-z0-9_]{1,100}$/.test(id))throw new Error("Invalid asset ID");
  const [info,files]=await Promise.all([json(`/info/${id}`),json(`/files/${id}`)]);
  if(info.type!==1)throw new Error("Only PBR texture assets are supported");
  const appearance:any={baseColor:"#ffffff",roughness:1,metallic:0,opacity:1,textureSize,normalConvention:"OpenGL",source:{provider:"Poly Haven",assetId:id,version:info.files_hash??"unknown",resolution,license:"CC0"}};
  for(const [keys,field] of [[['Diffuse','diff'],'baseColorTexture'],[['nor_gl'],'normalTexture'],[['Rough','rough'],'roughnessTexture']] as const) {
    const file=keys.map(k=>files[k]?.[resolution]?.jpg).find(Boolean);
    if(!file) { if(field==='baseColorTexture')throw new Error("Required JPG base color missing"); continue; }
    const meta=z.object({url:z.string(),size:z.number().int().positive().max(20*1024*1024),md5:z.string().regex(/^[a-f0-9]{32}$/)}).parse(file);
    const url=allowedTextureUrl(meta.url), asset=`tex-${meta.md5}.jpg`;
    try { store.resolveTexture(project,asset); }
    catch { const bytes=await boundedFetch(url,20*1024*1024); validateTexture(bytes,meta); store.saveTexture(project,meta.md5,bytes); }
    appearance[field]=asset;
  }
  return {appearance:AppearanceSchema.parse(appearance),name:info.name,credit:"Powered by Poly Haven",sourceUrl:`https://polyhaven.com/a/${id}`};
}
export const materialSearch: QueryTool<BimState> = {
  kind:"query",effect:"read",module:"bim",name:"material_search",title:"Search Poly Haven materials",permission:"bim.read",
  description:"Search the official Poly Haven PBR texture catalogue. Returns metadata and source attribution. No BIM resources are created.",
  input:z.object({query:z.string().max(100).default(""),limit:z.number().int().min(1).max(50).default(12)}),
  run:async(_ctx,i)=>{ const assets=await json('/assets?t=textures'); const words=i.query.toLowerCase().split(/\s+/).filter(Boolean);
    return {credit:"Powered by Poly Haven",results:Object.entries<any>(assets).filter(([id,a])=>words.every((w:string)=>`${id} ${a.name} ${(a.tags??[]).join(' ')} ${(a.categories??[]).join(' ')}`.toLowerCase().includes(w))).slice(0,i.limit).map(([id,a])=>({id,name:a.name,sourceUrl:`https://polyhaven.com/a/${id}`,dimensions:a.dimensions,version:a.files_hash}))}; },
};
export const materialImport: QueryTool<BimState> = {
  kind:"query",effect:"read",module:"bim",name:"material_import",title:"Cache Poly Haven textures",permission:"bim.write",
  description:"Download selected 1K/2K base-color, OpenGL normal and roughness JPEG files to existing project artifact storage. Immutable texture cache only (like export artifacts); does NOT modify BIM state. Returns validated appearance for governed bim_create_materials/bim_update_materials. textureSize is the explicit physical tile size in metres.",
  input:z.object({asset_id:z.string().regex(/^[a-z0-9_]{1,100}$/),resolution:z.enum(['1k','2k']).default('1k'),textureSize:z.tuple([z.number().positive().max(1000),z.number().positive().max(1000)])}),
  run:({project,platform},i)=>importPolyHaven(platform.requireArtifacts(),project,i.asset_id,i.resolution,i.textureSize),
};
