/** Share vertices that already have the same position identity, smoothing group and UV.
 * No simplification: expanding indices recovers exactly the prior triangle stream.
 */
export function indexViewerVertices(source:{positions:number[];uv:number[];normalGroups:number[]}){
 const positions:number[]=[],uv:number[]=[],normalGroups:number[]=[],indices:number[]=[],seen=new Map<string,number>();
 for(let i=0;i<source.normalGroups.length;i++){const group=source.normalGroups[i],key=`${group}:${source.uv[i*2]}:${source.uv[i*2+1]}`;let index=seen.get(key);if(index===undefined){index=positions.length/3;seen.set(key,index);positions.push(source.positions[i*3],source.positions[i*3+1],source.positions[i*3+2]);uv.push(source.uv[i*2],source.uv[i*2+1]);normalGroups.push(group);}indices.push(index);}
 return {positions,uv,normalGroups,indices};
}
