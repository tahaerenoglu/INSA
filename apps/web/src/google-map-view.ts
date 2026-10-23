import * as THREE from 'three';import * as OBC from '@thatopen/components';
import {TilesRenderer} from '3d-tiles-renderer/three';
import {GoogleCloudAuthPlugin,CesiumIonAuthPlugin} from '3d-tiles-renderer/core/plugins';
import {GLTFExtensionsPlugin,QuantizedMeshPlugin} from '3d-tiles-renderer/three/plugins';
import {DRACOLoader} from 'three/addons/loaders/DRACOLoader.js';
import {mapFrame,type MapReference} from './google-map-transform';
import {bindMapTileLoop} from './map-tile-loop';
import {configureMapTileCache} from './map-tile-cache';
/** Shared OBC World, camera and tick. No second scene or viewer. */
export class GoogleMapView {
 private tiles?:TilesRenderer;private reference?:MapReference;private removeTick=()=>{};private credits?:HTMLDivElement;private tileStatusTimer?:ReturnType<typeof setTimeout>;private opacity=.8;private matrix=new THREE.Matrix4();private modelTransform=new THREE.Matrix4();private gridVisible?:boolean;
 constructor(private components:OBC.Components,private world:OBC.SimpleWorld<OBC.SimpleScene,OBC.OrthoPerspectiveCamera,OBC.SimpleRenderer>){}
 start(key:string,reference:MapReference,geoid:number,opacity:number,status:(s:string)=>void,provider:'google'|'cesium'|'terrain'='google',assetId=2275207){
  this.stop();this.reference=reference;this.matrix.copy(mapFrame(reference,geoid).ecefToLocal);this.opacity=opacity;const label=provider==='terrain'?'Cesium World Terrain':'Google 3B harita';
  const tiles=new TilesRenderer('https://tile.googleapis.com/v1/3dtiles/root.json');this.tiles=tiles;
  if(provider!=='google')tiles.registerPlugin(new CesiumIonAuthPlugin({apiToken:key,assetId:String(provider==='terrain'?1:assetId),autoRefreshToken:true,assetTypeHandler:(type,target)=>{if(type==='TERRAIN'&&provider==='terrain')target.registerPlugin(new QuantizedMeshPlugin({solid:false,useRecommendedSettings:false}));else throw Error('Desteklenmeyen arazi varlığı türü.');}}));else tiles.registerPlugin(new GoogleCloudAuthPlugin({apiToken:key,autoRefreshToken:true}));
  const draco=new DRACOLoader().setDecoderPath('/draco/');tiles.registerPlugin(new GLTFExtensionsPlugin({dracoLoader:draco,autoDispose:true}));
  // Lower screen-space error requests finer source tiles; keep memory bounded.
  tiles.errorTarget=provider==='terrain'?4:2;tiles.downloadQueue.maxJobsPerOrigin=4;configureMapTileCache(tiles.lruCache);
  tiles.group.matrixAutoUpdate=false;this.setModelTransform(this.modelTransform);this.world.scene.three.add(tiles.group);
  const grid=this.components.get(OBC.Grids).list.get(this.world.uuid);this.gridVisible=grid?.visible;if(grid)grid.visible=false;
  const credits=document.createElement('div');this.credits=credits;credits.setAttribute('aria-label','Google harita atıfları');credits.style.cssText='position:absolute;right:12px;bottom:10px;z-index:15;background:white;color:#222;padding:5px 8px;font:11px Arial;max-width:80%';
  const logo=document.createElement('img');logo.src=provider==='terrain'?'https://api.cesium.com/ion-credit.png':'https://developers.google.com/static/maps/documentation/images/google_on_white.png';logo.alt=provider==='terrain'?'Cesium ion':'Google';logo.style.cssText='height:20px;vertical-align:middle;margin-right:8px';const text=document.createElement('span');text.textContent=label;credits.append(logo,text);this.world.renderer!.three.domElement.parentElement!.appendChild(credits);
  const anisotropy=Math.min(8,this.world.renderer!.three.capabilities.getMaxAnisotropy());
  const materials=(scene:THREE.Object3D)=>scene.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){if('map' in m&&m.map instanceof THREE.Texture&&m.map.anisotropy!==anisotropy){m.map.anisotropy=anisotropy;m.map.needsUpdate=true;}if(provider==='terrain'&&'color' in m)(m.color as THREE.Color).set('#8e9e7c');m.transparent=this.opacity<1;m.opacity=this.opacity;m.depthWrite=this.opacity===1;m.needsUpdate=true;}});
  tiles.addEventListener('load-model',e=>materials(e.scene));tiles.addEventListener('load-root-tileset',()=>status(label+' bağlantısı kuruldu; bu konumun karoları yükleniyor…'));tiles.addEventListener('load-error',(event:any)=>{const code=event?.error?.status??event?.error?.response?.status;status(`${label} karo isteği başarısız${code?` (HTTP ${code})`:''}. Cesium ion tokenının ${assetId} varlığına eriştiğini ve ağ erişimini kontrol edin.`);});
  let lastText='',lastCount=-1;const report=()=>{const attributions=tiles.getAttributions([]).filter(x=>x.type==='string').map(x=>String(x.value)).join(' · ');if(attributions!==lastText){text.textContent=attributions||'Google Maps';lastText=attributions;}if(tiles.visibleTiles.size&&tiles.visibleTiles.size!==lastCount){lastCount=tiles.visibleTiles.size;status(`${label} açık · ${lastCount} görünür karo`);}};
  this.removeTick=bindMapTileLoop(this.world,()=>({camera:this.world.camera.three,renderer:this.world.renderer!.three,invalidate:()=>{if(this.world.renderer)this.world.renderer.needsUpdate=true;}}),tiles,report);this.tileStatusTimer=setTimeout(()=>{if(this.tiles===tiles&&!tiles.visibleTiles.size)status(`${label} açık, ancak 15 sn içinde görünür karo gelmedi. Koordinat eşlemesini, ${provider==='google'?'Google API anahtarı ve 3B Tiles erişimini':`Cesium ion tokenının ${assetId} varlığı için assets:read iznini`} ve ağ isteklerini kontrol edin.`);},15000);status(label+' başlatılıyor…');
 }
 sampleSurface(point:[number,number,number]):[number,number,number]|null{
  if(!this.tiles)throw Error('Önce Google 3B haritayı açın.');
  const from=new THREE.Vector3(point[0],point[1]+2000,point[2]).applyMatrix4(this.modelTransform),to=new THREE.Vector3(point[0],point[1]-2000,point[2]).applyMatrix4(this.modelTransform),direction=to.clone().sub(from),distance=direction.length();
  const ray=new THREE.Raycaster(from,direction.normalize(),0,distance),meshes:THREE.Object3D[]=[];
  // Traverse loaded visible tile models only; never intersect BIM objects or fetch elevation services.
  this.tiles.group.updateWorldMatrix(true,true);this.tiles.group.traverseVisible(o=>{if(o instanceof THREE.Mesh)meshes.push(o);});
  const hit=ray.intersectObjects(meshes,false)[0];return hit?hit.point.clone().applyMatrix4(this.modelTransform.clone().invert()).toArray() as [number,number,number]:null;
 }
 setGeoid(value:number){if(this.reference){this.matrix.copy(mapFrame(this.reference,value).ecefToLocal);this.setModelTransform(this.modelTransform);}}
 setModelTransform(m:THREE.Matrix4){this.modelTransform.copy(m);if(this.tiles){this.tiles.group.matrix.multiplyMatrices(m,this.matrix);this.tiles.group.updateMatrixWorld(true);}}
 setOpacity(value:number){this.opacity=Math.max(.1,Math.min(1,value));this.tiles?.forEachLoadedModel(scene=>scene.traverse(o=>{if(o instanceof THREE.Mesh)for(const m of Array.isArray(o.material)?o.material:[o.material]){m.opacity=this.opacity;m.transparent=this.opacity<1;m.depthWrite=this.opacity===1;m.needsUpdate=true;}}));}
 stop(){this.removeTick();this.removeTick=()=>{};if(this.tileStatusTimer)clearTimeout(this.tileStatusTimer);this.tileStatusTimer=undefined;if(this.tiles){this.world.scene.three.remove(this.tiles.group);this.tiles.dispose();this.tiles=undefined;}this.reference=undefined;this.credits?.remove();this.credits=undefined;const grid=this.components.get(OBC.Grids).list.get(this.world.uuid);if(grid&&this.gridVisible!==undefined)grid.visible=this.gridVisible;this.gridVisible=undefined;}
 dispose(){this.stop();}
}



