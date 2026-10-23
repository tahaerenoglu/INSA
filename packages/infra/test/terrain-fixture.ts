export function planeXml(nx=2,ny=1,step=10,offsetZ=0,invisibleCentre=false,linearUnit='meter'){
 const E=412000,N=4561000,points:string[]=[],faces:string[]=[],id=(x:number,y:number)=>y*(nx+1)+x+1;
 for(let y=0;y<=ny;y++)for(let x=0;x<=nx;x++)points.push(`<P id="${id(x,y)}">${N+y*step} ${E+x*step} ${60+.02*x*step+.01*y*step+offsetZ}</P>`);
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){const invisible=invisibleCentre&&x===1&&y===1?' i="1"':'';faces.push(`<F${invisible}>${id(x,y)} ${id(x+1,y)} ${id(x+1,y+1)}</F>`,`<F${invisible}>${id(x,y)} ${id(x+1,y+1)} ${id(x,y+1)}</F>`);}
 return `<?xml version="1.0" encoding="UTF-8"?><LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2"><Units><${linearUnit==='meter'?'Metric':'Imperial'} linearUnit="${linearUnit}"/></Units><CoordinateSystem epsgCode="5254" verticalDatum="QA datum"/><Surfaces><Surface name="Plane"><Definition surfType="TIN"><Pnts>${points.join('')}</Pnts><Faces>${faces.join('')}</Faces></Definition></Surface></Surfaces></LandXML>`;
}
export const bytes=(s:string)=>Buffer.from(s,'utf8');
