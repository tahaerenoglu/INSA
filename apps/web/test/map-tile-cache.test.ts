import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LRUCache} from '3d-tiles-renderer/core';
import {configureMapTileCache} from '../src/map-tile-cache';

function fill(cache:LRUCache){
 const items=Array.from({length:300},(_,i)=>({i}));
 for(const item of items){assert.equal(cache.add(item,()=>{}),true);cache.setMemoryUsage(item,1024);cache.setLoaded(item,true);}
 return items;
}

test('old map settings freeze at the first 300 tiles even after the camera leaves',()=>{
 const cache=new LRUCache();cache.maxSize=300;cache.maxBytesSize=512*1024*1024;
 const items=fill(cache);for(const item of items)cache.markUnused(item);
 cache.unloadUnusedContent();
 assert.equal(cache.isFull(),true);assert.equal(cache.add({i:301},()=>{}),false);
});

test('camera leaving a full map cache frees space for new-region tiles, retaining visible tiles',t=>{
 // Run eviction passes explicitly; the browser schedules further passes by RAF.
 const previous=globalThis.requestAnimationFrame,previousCancel=globalThis.cancelAnimationFrame;
 globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
 t.after(()=>{globalThis.requestAnimationFrame=previous;globalThis.cancelAnimationFrame=previousCancel;});
 const cache=new LRUCache();configureMapTileCache(cache);
 const items=fill(cache);for(const item of items.slice(20))cache.markUnused(item);
 assert.equal(cache.isFull(),true);cache.unloadUnusedContent();
 assert.equal(cache.isFull(),false);assert.equal(cache.add({i:301},()=>{}),true);
 for(const item of items.slice(0,20))assert.equal(cache.has(item),true);
 // Repeated navigation continues to admit new tiles without clearing the map.
 for(let region=0;region<10;region++){
  const next=[];while(!cache.isFull()){const item={region,n:next.length};assert.ok(cache.add(item,()=>{}));cache.setLoaded(item,true);next.push(item);}
  for(const item of next)cache.markUnused(item);
  cache.unloadUnusedContent();assert.equal(cache.isFull(),false);
 }
});
