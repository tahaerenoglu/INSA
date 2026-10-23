import * as THREE from "three";
import type { FragmentsModel } from "@thatopen/fragments";
import { AppearanceResources } from "./appearance-resources";
export interface Appearance {
 baseColor:string;opacity:number;metallic:number;roughness:number;textureSize:[number,number];normalConvention:"OpenGL"|"DirectX";
 baseColorTexture?:string;normalTexture?:string;roughnessTexture?:string;
}
/** Metric planar UVs on the actual Fragments triangles; never changes source geometry. */
export function metricUVs(geometry:THREE.BufferGeometry,size:[number,number]) {
 const p=geometry.getAttribute("position"),existing=geometry.getAttribute('uv'),uv=existing instanceof THREE.BufferAttribute&&existing.array instanceof Float32Array&&existing.array.length===p.count*2?existing.array:new Float32Array(p.count*2);
 const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),n=new THREE.Vector3();
 for(let i=0;i<p.count;i+=3){
  a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
  n.crossVectors(b.sub(a),c.sub(a));const x=Math.abs(n.x),y=Math.abs(n.y),z=Math.abs(n.z);
  for(let j=i;j<i+3;j++){ const px=p.getX(j),py=p.getY(j),pz=p.getZ(j);
   const u=y>=x&&y>=z?px:x>=z?-pz:px, v=y>=x&&y>=z?-pz:py;
   uv[j*2]=u/size[0];uv[j*2+1]=v/size[1];
  }
 }
 if(existing instanceof THREE.BufferAttribute&&existing.array===uv)existing.needsUpdate=true;else geometry.setAttribute("uv",new THREE.BufferAttribute(uv,2));
}
export class MaterialAppearanceView {
 readonly group=new THREE.Group();
 private entries=new Map<string,{id:number;meshes:THREE.Mesh[];signature:string;materialId:string}>();
 private resources:AppearanceResources;
 private materials=new Map<string,THREE.MeshStandardMaterial>();
 private disposed=false;
 private selection=new THREE.Group();
 private selectedGuid:string|null=null;
 private selectionMaterial=new THREE.MeshBasicMaterial({color:0xa9e000,opacity:1,transparent:false,depthWrite:true,depthTest:true,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
 warnings:string[]=[];
 constructor(private model:FragmentsModel,private project:string){this.resources=new AppearanceResources(project);this.group.name="INSA material appearances";this.selection.name="INSA selection overlay";}
 async update(data:{materials:Record<string,any>;bindings:{guid:string;elementId:string;materialId:string}[]}){
  // Fragments sample transforms are model-local. Match native fragments' world placement.
  this.model.object.updateWorldMatrix(true,false);
  this.group.matrixAutoUpdate=false;
  this.group.matrix.copy(this.model.object.matrixWorld);
  this.group.matrixWorldNeedsUpdate=true;
  const selected=this.selectedGuid;this.highlight(null);
  this.warnings=[];this.resources.warnings=[];
  this.resources.retain(Object.values(data.materials).flatMap((m:any)=>m.appearance?[m.appearance]:[]));
  const wanted=new Set<string>();
  const fresh=data.bindings.filter(b=>!this.entries.has(b.guid)&&(data.materials[b.materialId]?.appearance||data.materials[b.materialId]?.color));
  const ids=fresh.length?await this.model.getLocalIdsByGuids(fresh.map(b=>b.guid)):[];
  const valid=fresh.flatMap((b,i)=>ids[i]==null?[]:[{guid:b.guid,id:ids[i]!}]);
  const parts=valid.length?await this.model.getItemsGeometry(valid.map(b=>b.id)):[];
  const geometry=new Map(valid.map((b,i)=>[b.guid,{id:b.id,parts:parts[i]}]));
  const hide:number[]=[],show:number[]=[];
  for(const binding of data.bindings){
   const resource=data.materials[binding.materialId];
   const a:Appearance|undefined=resource?.appearance??(resource?.color?{baseColor:resource.color,opacity:1,metallic:0,roughness:.8,textureSize:[2,2],normalConvention:"OpenGL"}:undefined);
   if(!a)continue;wanted.add(binding.guid);
   const signature=JSON.stringify(a),key=`${binding.materialId}:${signature}`;
   let material=this.materials.get(key);
   if(!material){
    material=await this.resources.material(a);
    if(this.disposed){material.dispose();return;}
    this.materials.set(key,material);
   }
   let entry=this.entries.get(binding.guid);
   if(entry?.signature===signature)continue;
   if(!entry){
    const freshGeometry=geometry.get(binding.guid);if(!freshGeometry)continue;
    const {id,parts}=freshGeometry;if(this.disposed)return;
    const meshes:THREE.Mesh[]=[];
    for(const part of parts){
     if(!part.positions?.length || !part.indices?.length)continue;
     let g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(part.positions),3));g.setIndex(new THREE.BufferAttribute(new Uint32Array(part.indices),1));
     g.applyMatrix4(part.transform);const old=g;g=g.toNonIndexed();old.dispose();g.computeVertexNormals();metricUVs(g,a.textureSize);
     const mesh=new THREE.Mesh(g,material);mesh.userData.guid=binding.guid;mesh.userData.elementId=binding.elementId;this.group.add(mesh);meshes.push(mesh);
    }
    if(!meshes.length)continue;
    entry={id,meshes,signature,materialId:binding.materialId};this.entries.set(binding.guid,entry);
    hide.push(id);
   }else{for(const mesh of entry.meshes){mesh.material=material;metricUVs(mesh.geometry,a.textureSize);}entry.signature=signature;entry.materialId=binding.materialId;}
  }
  for(const [guid,entry]of this.entries)if(!wanted.has(guid)){
   show.push(entry.id);for(const mesh of entry.meshes){this.group.remove(mesh);mesh.geometry.dispose();}this.entries.delete(guid);
  }
  if(hide.length)await this.model.setVisible(hide,false);
  if(show.length)await this.model.setVisible(show,true);
  const used=new Set([...this.entries.values()].flatMap(e=>e.meshes.map(m=>m.material)));
  for(const [key,material]of this.materials)if(!used.has(material)){material.dispose();this.materials.delete(key);}
  this.resources.prune();this.warnings=[...new Set([...this.resources.warnings,...[...this.materials.values()].flatMap(m=>m.userData.warnings??[])])];this.highlight(selected);
 }
 highlight(guid:string|null){
  this.selection.clear();this.group.remove(this.selection);this.selectedGuid=guid;
  const entry=guid?this.entries.get(guid):null;if(!entry)return;
  this.group.add(this.selection);
  for(const mesh of entry.meshes){const overlay=new THREE.Mesh(mesh.geometry,this.selectionMaterial);overlay.renderOrder=10;this.selection.add(overlay);}
 }
 has(guid:string){return this.entries.has(guid);}
 dispose(){this.disposed=true;this.highlight(null);this.selectionMaterial.dispose();for(const entry of this.entries.values())for(const mesh of entry.meshes)mesh.geometry.dispose();for(const m of this.materials.values())m.dispose();this.resources.dispose();this.group.clear();this.entries.clear();this.materials.clear();}
 get stats(){return {elements:this.entries.size,materials:this.materials.size,textures:this.resources.textureCount,warnings:this.warnings};}
}
