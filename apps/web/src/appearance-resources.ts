import * as THREE from 'three';
import {api} from './api';
import type {Appearance} from './material-appearance';
type Cache={users:number;textures:Map<string,Promise<THREE.Texture|null>>;owners:Map<symbol,Set<string>>};
const projects=new Map<string,Cache>();
/** One project-scoped GPU texture cache shared by native BIM and infrastructure. */
export class AppearanceResources {
 private cache:Cache;private disposed=false;private owner=Symbol();
 warnings:string[]=[];
 constructor(readonly project:string){this.cache=projects.get(project)??{users:0,textures:new Map(),owners:new Map()};this.cache.users++;this.cache.owners.set(this.owner,new Set());projects.set(project,this.cache);}
 retain(appearances:Appearance[]){const keys=new Set<string>();for(const a of appearances){if(a.baseColorTexture)keys.add(`${a.baseColorTexture}:true`);for(const id of [a.normalTexture,a.roughnessTexture])if(id)keys.add(`${id}:false`);}this.cache.owners.set(this.owner,keys);}
 async texture(asset:string|undefined,color:boolean){
  if(!asset)return null;const key=`${asset}:${color}`;let promise=this.cache.textures.get(key);
  if(!promise){promise=(async()=>{let url='';try{url=URL.createObjectURL(await api.texture(this.project,asset));const t=await new THREE.TextureLoader().loadAsync(url);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=color?THREE.SRGBColorSpace:THREE.NoColorSpace;t.anisotropy=4;return t;}catch{return null;}finally{if(url)URL.revokeObjectURL(url);}})();this.cache.textures.set(key,promise);}
  const t=await promise;if(!t)this.warnings.push(`Doku yüklenemedi: ${asset}; temel renk kullanılıyor.`);return t;
 }
 async material(a:Appearance){const [map,normalMap,roughnessMap]=await Promise.all([this.texture(a.baseColorTexture,true),this.texture(a.normalTexture,false),this.texture(a.roughnessTexture,false)]);
  const m=new THREE.MeshStandardMaterial({color:a.baseColor,opacity:a.opacity,transparent:a.opacity<1,metalness:a.metallic,roughness:a.roughness,map,normalMap,roughnessMap,side:THREE.DoubleSide,depthWrite:a.opacity===1});m.normalScale.set(1,a.normalConvention==='DirectX'?-1:1);m.userData.warnings=[...new Set(this.warnings)];return m;
 }
 get textureCount(){return this.cache.textures.size;}
 /** Retain only current asset variants; selection clones do not own textures. */
 prune(){const used=new Set([...this.cache.owners.values()].flatMap(s=>[...s]));for(const [key,p]of this.cache.textures)if(!used.has(key)){this.cache.textures.delete(key);void p.then(t=>t?.dispose());}}
 dispose(){if(this.disposed)return;this.disposed=true;this.cache.owners.delete(this.owner);this.prune();if(--this.cache.users===0){projects.delete(this.project);this.cache.textures.clear();}}
}
