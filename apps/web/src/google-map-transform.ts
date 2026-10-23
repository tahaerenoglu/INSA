import proj4 from 'proj4';
import {Matrix4,Vector3} from 'three';
export interface MapReference {eastings:number;northings:number;orthogonalHeight:number;scale:number;xAxisAbscissa:number;xAxisOrdinate:number;crs:{name:string};}
export const TM30='+proj=tmerc +lat_0=0 +lon_0=30 +k=1 +x_0=500000 +y_0=0 +datum=WGS84 +units=m +no_defs';
function projectionFor(name:string){
 const crs=name.trim(),utmEpsg=crs.match(/^EPSG:\s*32([67])(\d{2})$/i),utmText=crs.match(/UTM(?:\s+zone)?\s*(\d{1,2})\s*([NS])/i);
 if(/WGS84/i.test(crs)&&/(30°|TM30|meridyen30)/i.test(crs)&&/(3°|TM30)/i.test(crs))return TM30;
 if(utmEpsg){const zone=Number(utmEpsg[2]);if(zone>=1&&zone<=60)return `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs${utmEpsg[1]==='7'?' +south':''}`;}
 if(/WGS84/i.test(crs)&&utmText){const zone=Number(utmText[1]);if(zone>=1&&zone<=60)return `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs${utmText[2].toUpperCase()==='S'?' +south':''}`;}
 throw Error('Desteklenen CRS: WGS84 / 3° TM30 veya WGS84 UTM zonu (EPSG:326xx/327xx).');
}
export function mapFrame(g:MapReference,geoid:number){
 if(![g.eastings,g.northings,g.orthogonalHeight,g.scale,g.xAxisAbscissa,g.xAxisOrdinate,geoid].every(Number.isFinite)||g.scale<=0||Math.hypot(g.xAxisAbscissa,g.xAxisOrdinate)<1e-9||Math.abs(geoid)>200)throw Error('Geçersiz harita koordinat eşlemesi.');
 const projection=projectionFor(g.crs.name);
 const n=Math.hypot(g.xAxisAbscissa,g.xAxisOrdinate),a=g.xAxisAbscissa/n,b=g.xAxisOrdinate/n;
 const ecef=(x:number,y:number,z:number)=>{const [lon,lat]=proj4(projection,'EPSG:4326',[x,y]);return new Vector3(...proj4('EPSG:4326','+proj=geocent +datum=WGS84 +units=m +no_defs',[lon,lat,z+geoid]) as [number,number,number]);};
 const origin=ecef(g.eastings,g.northings,g.orthogonalHeight),x=ecef(g.eastings+a*g.scale,g.northings+b*g.scale,g.orthogonalHeight).sub(origin),y=ecef(g.eastings,g.northings,g.orthogonalHeight+g.scale).sub(origin),z=ecef(g.eastings+b*g.scale,g.northings-a*g.scale,g.orthogonalHeight).sub(origin);
 const localToEcef=new Matrix4().makeBasis(x,y,z).setPosition(origin),geographic=proj4(projection,'EPSG:4326',[g.eastings,g.northings]);
 return {ecefToLocal:localToEcef.clone().invert(),localToEcef,longitude:geographic[0],latitude:geographic[1]};
}
