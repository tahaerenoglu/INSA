import grid from './data/egm96-tm30.json' with {type:'json'};
/** Local-only bilinear evaluation of original NGA/PROJ EGM96 nodes. */
export function egm96Reference(longitude:number,latitude:number){
 if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||longitude<grid.west||longitude>grid.east||latitude<grid.south||latitude>grid.north)return null;
 const x=(longitude-grid.west)/grid.step,y=(grid.north-latitude)/grid.step,i=Math.min(Math.floor(x),grid.values[0].length-2),j=Math.min(Math.floor(y),grid.values.length-2),u=x-i,v=y-j;
 const value=grid.values[j][i]*(1-u)*(1-v)+grid.values[j][i+1]*u*(1-v)+grid.values[j+1][i]*(1-u)*v+grid.values[j+1][i+1]*u*v;
 return {value,model:grid.model,source:grid.source,approximate:true as const};
}
