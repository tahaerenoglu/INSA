import type {Camera, WebGLRenderer} from 'three';
import type {TilesRenderer} from '3d-tiles-renderer/three';

/** Tick once after the world's camera/render update, including asynchronous loads.
 * RendererWith2D emits onBeforeUpdate both before and after its WebGL render;
 * it is not a reliable clock for tile traversal / cache eviction.
 */
export function bindMapTileLoop(
 world:{onAfterUpdate:{add(fn:()=>void):void;remove(fn:()=>void):void}},
 current:()=>{camera:Camera;renderer:WebGLRenderer;invalidate:()=>void},
 tiles:TilesRenderer,
 afterUpdate:()=>void,
){
 let previous:Camera|undefined;
 const invalidate=()=>current().invalidate();
 const tick=()=>{
  const {camera,renderer}=current();
  if(camera!==previous){if(previous)tiles.deleteCamera(previous);tiles.setCamera(camera);previous=camera;}
  // Include parents when a camera is parented, and keep inverse matrices fresh
  // before the tile renderer computes its ECEF-space view frustum.
  camera.updateWorldMatrix(true,false);
  tiles.group.updateWorldMatrix(true,false);
  tiles.setResolutionFromRenderer(camera,renderer);
  tiles.update();
  afterUpdate();
  invalidate();
 };
 tiles.addEventListener('needs-update',invalidate);
 world.onAfterUpdate.add(tick);
 invalidate();
 return ()=>{
  world.onAfterUpdate.remove(tick);
  tiles.removeEventListener('needs-update',invalidate);
  if(previous)tiles.deleteCamera(previous);
 };
}
