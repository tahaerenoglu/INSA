/** Pure playback timing over sampled canonical 3D distances (not a geometry engine). */
export interface TrainSimulation {status:'playing'|'paused'|'stopped';anchor_station:number;started_at:number;speed_kmh:number;eye_height:number;track_offset:number;look_ahead:number;}
export interface TrainMetric {stations:number[];distances:number[];}
function interpolate(xs:number[],ys:number[],x:number){if(x<=xs[0])return ys[0];if(x>=xs.at(-1)!)return ys.at(-1)!;let lo=0,hi=xs.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(xs[mid]<=x)lo=mid;else hi=mid;}return ys[lo]+(ys[hi]-ys[lo])*(x-xs[lo])/(xs[hi]-xs[lo]);}
export const distanceAtStation=(path:TrainMetric,station:number)=>interpolate(path.stations,path.distances,station);
export const stationAtDistance=(path:TrainMetric,distance:number)=>interpolate(path.distances,path.stations,distance);
export function trainProgress(train:TrainSimulation,path:TrainMetric,now:number){const total=path.distances.at(-1)!,anchor=distanceAtStation(path,train.anchor_station),elapsed=train.status==='playing'?Math.max(0,now-train.started_at)/1000:0,distance=Math.min(total,anchor+elapsed*train.speed_kmh/3.6),complete=distance>=total;return {station:stationAtDistance(path,distance),distance,total,complete,status:complete?'completed':train.status};}
