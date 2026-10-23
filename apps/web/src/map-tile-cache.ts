import type {LRUCache} from '3d-tiles-renderer/core';

/** Keep eviction below the hard limit so moving the camera can admit new tiles. */
export function configureMapTileCache(cache:LRUCache){
 cache.minSize=200;
 cache.maxSize=300;
 cache.minBytesSize=256*1024*1024;
 cache.maxBytesSize=512*1024*1024;
}
