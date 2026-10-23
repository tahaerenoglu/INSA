/** Reproduce the reviewed 2D-to-native reconstruction, never import a source IFC.
 * Prerequisites: download the municipality's ADU_2_BEDROOM.pdf and extract its
 * architecture/electrical and structural page subsets into output/adu-2d/.
 * All mutations use the running INSA server's governed, audited tool endpoint.
 * Coordinates below are an explicit human/assistant interpretation of 2D sheets,
 * not a claim of automatic PDF understanding or engineering design approval.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const base=process.env.INSA_URL??'http://localhost:8790';
const project=process.env.INSA_PROJECT??'sacramento-adu-from-2d-20261023';
const out='output/adu-2d';fs.mkdirSync(out,{recursive:true});
const source='https://adu.cityofsacramento.org/content/dam/cityofsacramento/adu/plan/ADU_2_BEDROOM.pdf';
const catalog='https://adu.cityofsacramento.org/Shelf-ready-plans';
const progressPath=`${out}/progress-${project}.json`;
const progress=fs.existsSync(progressPath)?JSON.parse(fs.readFileSync(progressPath,'utf8')):{project,completed:{}};
const save=()=>fs.writeFileSync(progressPath,JSON.stringify(progress,null,2));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const original=fs.readFileSync(`${out}/ADU_2_BEDROOM.pdf`);
const originalHash=hash(original);
assert.equal(originalHash,'cac7bc5f01be4691e9dd07e8c51984ef21c2d774947204a559565ddf788d3e8d','Source revision changed: review the 2D interpretation before generation');
const {token}=await(await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({user:'taha'})})).json();
assert.ok(token,'Local INSA authentication failed');
const headers={authorization:'Bearer '+token,'content-type':'application/json'};
async function http(path,body){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});const v=await r.json();if(!r.ok)throw Error(`${path}: ${JSON.stringify(v)}`);return v;}
const tool=(name,input)=>http(`/api/projects/${project}/tools/${name}`,{input});
async function once(key,action){if(progress.completed[key])return progress.completed[key];const v=await action();if(v.status==='pending')throw Error('Approval pending: '+JSON.stringify(v));progress.completed[key]=v;save();console.log(key+' OK');return v;}
const command=(key,name,input)=>once(key,()=>tool(name,input));
async function register(filename,discipline){const bytes=fs.readFileSync(`${out}/${filename}`),sha=hash(bytes);return once('file:'+filename+':'+sha,async()=>{const existing=(await tool('files_list',{query:filename})).result.files.find(f=>f.current.filename===filename);if(existing?.current.sha256===sha)return {summary:{id:existing.id,version:existing.current.version},localSha256:sha};const stage=(await tool('files_upload',{filename,base64:bytes.toString('base64')})).result;const r=await tool('files_register',{asset:stage.asset,filename,discipline,...(existing?{file:existing.id,expected_version:existing.current.version}:{}),tags:['2D-source','Sacramento-ADU','2025-11-26']});return {...r,localSha256:sha};});}
const inch=.0254,ft=.3048,m=n=>Math.round(n*inch*1e8)/1e8,pt=([x,y])=>[m(x),m(y)],poly=a=>a.map(pt);
const H=m(97),W=m(240),D=m(480),ridge=m(151.25),pitch=Math.atan(5/12)*180/Math.PI;
const level='FFL 0.000';
const provenance=[];
function evidence(ids,sheet,status,notes){provenance.push({ids,sheet,status,notes});}
function created(r){return r.summary.created.map(x=>typeof x==='string'?x:x.id);}

await once('project',async()=>http('/api/projects',{id:project,name:'Sacramento ADU - 2D Paftalardan Uretilen Model',projectType:'superstructure',description:'Native INSA reconstruction from City of Sacramento 20x40 two-bedroom 2D PDF sheets, 11/26/2025. No source IFC imported. Architecture, foundation and timber roof framing; electrical symbols and plumbing fixtures. Missing MEP routes are not invented. Geometry and approximation register attached.'}));
await once('library-before',()=>tool('project_query',{tool:'semantic.library'}));
await once('materials-before',()=>tool('bim_query_materials',{}));
await command('materials','bim_create_materials',{materials:[
 {name:'ADU Timber frame cavity - composite envelope',color:'#dbd1b4'},
 {name:'ADU Douglas Fir No2',color:'#b7834e'},
 {name:'ADU Concrete 2500psi',color:'#aab0b4'},
 {name:'ADU Roof plywood OSB 15-32in',color:'#bda273'},
 {name:'ADU Roof shingle - assumed thickness',color:'#555b64'},
 {name:'ADU Door leaf simplified',color:'#a17a50'},
 {name:'ADU Window glass simplified',color:'#86b7d2'},
 {name:'ADU Electrical marker',color:'#e5ba42'},
 {name:'ADU Sanitary fixture marker',color:'#c9e3ef'},
 {name:'ADU Equipment marker',color:'#82bcac'},
]});
await command('levels','bim_create_storeys',{storeys:[{name:level,elevation:0},{name:'Top plate 8ft1in',elevation:H},{name:'Roof ridge 12ft7-1-4in',elevation:ridge}]});
await command('axes','bim_create_grids',{grids:[{name:'1',start:[0,-.7],end:[0,D+.7]},{name:'2',start:[W,-.7],end:[W,D+.7]},{name:'A',start:[-.7,D],end:[W+.7,D]},{name:'B',start:[-.7,m(276.5)],end:[W+.7,m(276.5)]},{name:'C',start:[-.7,0],end:[W+.7,0]}]});
const layer=(material,thickness)=>({material,thickness});
const beam=(name,b,h)=>({kind:'beam',name,profile:{shape:'rect',b:m(b),h:m(h)},material:'ADU Douglas Fir No2'});
const types=[
 {kind:'wall',name:'ADU Frame envelope 2x6',layers:[layer('ADU Timber frame cavity - composite envelope',m(5.5))]},
 {kind:'wall',name:'ADU Partition envelope 2x4',layers:[layer('ADU Timber frame cavity - composite envelope',m(3.5))]},
 {kind:'foundation_slab',name:'ADU Concrete slab 4in',layers:[layer('ADU Concrete 2500psi',m(4))]},
 {kind:'footing',name:'ADU Strip below slab 16in',footing_kind:'strip',layers:[layer('ADU Concrete 2500psi',m(16))]},
 {kind:'footing',name:'ADU Porch pier 20in',footing_kind:'pad',layers:[layer('ADU Concrete 2500psi',m(20))]},
 {kind:'roof',name:'ADU Gable deck and shingle',layers:[layer('ADU Roof shingle - assumed thickness',.015),layer('ADU Roof plywood OSB 15-32in',m(15/32))]},
 beam('ADU Ceiling joist 2x6 actual',1.5,5.5),beam('ADU Ridge board 2x8 actual',1.5,7.25),beam('ADU Porch beam 4x10 actual',3.5,9.25),
 {kind:'column',name:'ADU Porch post 6x6 actual',profile:{shape:'rect',b:m(5.5),h:m(5.5)},material:'ADU Douglas Fir No2'},
 beam('ADU Rafter 2x6 actual',1.5,5.5),beam('ADU Collar tie 2x4 actual',1.5,3.5),
 ...[['3068',36,80],['2268',26,80],['2668-BF',30,80],['5068-BP',60,80]].map(([code,w,h])=>({kind:'door',name:'ADU '+code,width:m(w),height:m(h),material:'ADU Door leaf simplified'})),
 ...[['3050',36,60],['2646',30,54],['2030',24,36]].map(([code,w,h])=>({kind:'window',name:'ADU '+code,width:m(w),height:m(h),material:'ADU Window glass simplified'})),
];
await command('types','bim_create_types',{types});

// A2.1: the dimension authority is FACE OF STUD, not outside cladding.
// The vector plan is calibrated by x=458.94..818.94, top=504..1224 PDF pt:
// x(in)=(pdfX-458.94)/1.5; y(in)=(1224-pdfTop)/1.5. Reviewed to 1/4 in.
const perimeter=[[2.75,2.75],[141.25,2.75],[141.25,68.75],[237.25,68.75],[237.25,477.25],[2.75,477.25]];
const segments=[
 ['Bedroom divider',[120,347.25],[120,477.25],4],
 ['Bedroom 1 hall side',[73.25,298.75],[73.25,347.25],4],
 ['Bedroom 1 entry',[73.25,347.25],[120,347.25],4],
 ['Bedroom 1 closet front',[2.75,327.25],[73.25,327.25],4],
 ['Bedroom 1 closet back',[2.75,298.75],[73.25,298.75],4],
 ['Bedroom 2 entry',[120,347.25],[166.75,347.25],4],
 ['Bedroom 2 hall side',[166.75,318.75],[166.75,347.25],4],
 ['Bedroom 2 closet front',[166.75,347.25],[237.25,347.25],4],
 ['Bedroom 2 closet back',[166.75,318.75],[237.25,318.75],4],
 ['Laundry west',[172.25,278.25],[172.25,318.75],4],
 ['Laundry south',[166.75,278.25],[201.75,278.25],4],
 ['Water heater west',[201.75,278.25],[201.75,318.75],6],
 ['Water heater south',[201.75,278.25],[237.25,278.25],6],
 ['Bathroom east',[118.75,183.75],[118.75,298.75],4],
 ['Bathroom south',[2.75,183.75],[118.75,183.75],4],
 ['Bathroom niche north',[2.75,218.75],[54.25,218.75],4],
 ['Bathroom niche east',[54.25,183.75],[54.25,218.75],6],
];
const wallResult=await command('walls','bim_create_walls',{walls:[{storey:level,type:'ADU Frame envelope 2x6',points:poly(perimeter),closed:true,height:H,name:'A2.1 Exterior frame'},...segments.map(([name,start,end,size])=>({storey:level,type:size===6?'ADU Frame envelope 2x6':'ADU Partition envelope 2x4',start:pt(start),end:pt(end),height:H,name:'A2.1 '+name}))]});
const wallIds=created(wallResult),wall={front:wallIds[0],porchEntry:wallIds[1],porchRear:wallIds[2],east:wallIds[3],rear:wallIds[4],west:wallIds[5]};
segments.forEach(([name],i)=>wall[name]=wallIds[i+6]);
evidence(wallIds,'A2.1; A3.1','Derived','Explicit face-of-frame dimensions and vector line calibration. Wall solids are frame/cavity envelopes; individual studs, wall finish skins and hardware are excluded. 2x actual sizes 1.5/3.5/5.5in interpreted as modeling assumptions.');
const bathroomEntry=await command('bathroom-entry-wall','bim_create_walls',{walls:[{storey:level,type:'ADU Partition envelope 2x4',start:pt([73.25,298.75]),end:pt([118.75,298.75]),height:H,name:'A2.1 Bathroom entry'}]});
wall['Bathroom entry']=created(bathroomEntry)[0];
evidence(created(bathroomEntry),'A2.1','Derived','Bathroom door lies in the horizontal north wall between closet back and east bathroom partition.');

const openings=[];
const opening=(host,kind,code,at,sill,name)=>openings.push({host:wall[host],kind,type:'ADU '+code,at:pt(at),sill:m(sill),name:'A2.1 '+name});
opening('front','window','2646',[54,2.75],30,'Front window 1');opening('front','window','2646',[90,2.75],30,'Front window 2');
opening('porchRear','window','2646',[174,68.75],30,'Porch window 1');opening('porchRear','window','2646',[210,68.75],30,'Porch window 2');
opening('rear','window','3050',[94.25,477.25],24,'Bedroom 1 rear window');opening('rear','window','3050',[145.75,477.25],24,'Bedroom 2 rear window');
opening('east','window','3050',[237.25,375],24,'Bedroom 2 side window');opening('east','window','2030',[237.25,219.5],48,'Kitchen sink window');opening('east','window','2646',[237.25,96],30,'Dining side window');
opening('porchEntry','door','3068',[141.25,26.5],0,'Main entry');opening('east','door','2268',[237.25,298.5],0,'Water heater closet');
opening('Bedroom 1 entry','door','3068',[97.25,347.25],0,'Bedroom 1 door');opening('Bedroom 2 entry','door','3068',[142.75,347.25],0,'Bedroom 2 door');
opening('Bedroom 1 closet front','door','5068-BP',[38.5,327.25],0,'Bedroom 1 closet');opening('Bedroom 2 closet front','door','5068-BP',[201.5,347.25],0,'Bedroom 2 closet');
opening('Laundry west','door','2668-BF',[172.25,298.5],0,'Laundry bifold');opening('Bathroom entry','door','3068',[96,298.75],0,'Bathroom door');opening('Bathroom south','door','2268',[23.5,183.75],0,'Bathroom storage door');
const openingResult=await command('openings','bim_place_openings',{items:openings});
// Correct a previously executed draft's orientation through the native editor.
const bathroomDoor=(await tool('bim_get_element',{id:created(openingResult).at(-2)})).result;
if(bathroomDoor.host!==wall['Bathroom entry'])await command('bathroom-door-correction','bim_rehost_opening',{opening:bathroomDoor.opening,host:wall['Bathroom entry'],along:m(22.75),sill:0});
evidence(created(openingResult),'A2.1; A3.1','Derived','Type codes give nominal widths/heights; symbol positions calibrated in plan. Window head chosen at 7ft with sills 24/30/48in from elevations (interpretation). Simplified leaf/glazing; bypass and bifold hardware not represented.');

const floorOutline=poly([[0,0],[144,0],[144,66],[240,66],[240,480],[0,480]]);
const foundation=await command('foundations','bim_create_boundaries',{boundaries:[
 {category:'structure.foundation_slab',storey:level,type:'ADU Concrete slab 4in',outline:floorOutline,offset:0,name:'S1.1 Slab on grade 4in'},
 {category:'structure.foundation_slab',storey:level,type:'ADU Concrete slab 4in',outline:poly([[144,0],[240,0],[240,66],[144,66]]),offset:-m(4),name:'S1.1 Porch slab -4in (slope omitted)'},
 {category:'structure.footing',storey:level,type:'ADU Strip below slab 16in',outline:poly([[-3.25,-3.25],[147.25,-3.25],[147.25,62.75],[243.25,62.75],[243.25,483.25],[-3.25,483.25]]),holes:[poly([[8.75,8.75],[135.25,8.75],[135.25,74.75],[231.25,74.75],[231.25,471.25],[8.75,471.25]])],offset:-m(4),name:'S1.1 SD.1 Perimeter strip width12in'},
 {category:'structure.footing',storey:level,type:'ADU Strip below slab 16in',outline:poly([[114,183.75],[126,183.75],[126,471.25],[114,471.25]]),offset:-m(4),name:'S1.1 Interior longitudinal strip'},
 {category:'structure.footing',storey:level,type:'ADU Strip below slab 16in',outline:poly([[8.75,292.75],[114,292.75],[114,304.75],[8.75,304.75]]),offset:-m(4),name:'S1.1 Interior west cross strip'},
 {category:'structure.footing',storey:level,type:'ADU Strip below slab 16in',outline:poly([[126,312.75],[231.25,312.75],[231.25,324.75],[126,324.75]]),offset:-m(4),name:'S1.1 Interior east cross strip'},
 {category:'structure.footing',storey:level,type:'ADU Porch pier 20in',outline:poly([[231.25,-3.25],[243.25,-3.25],[243.25,8.75],[231.25,8.75]]),offset:0,name:'SD.1 Porch post pier 12in square'},
]});
evidence(created(foundation),'S1.1; SD.1 details 1,2,3; SN.1','Derived','Slab4in, strip width12in, grade-8in, embedment12in below grade. Strip axis alignment is an interpretation of the foundation plan. Footing top at underside of slab avoids double-counted slab volume. Porch -4in modeled flat: 1/4in per foot drainage slope omitted. Vapor barrier, gravel, wire mesh, bars and anchors not modeled.');

const roof=await command('roof','bim_create_pitched_roofs',{roofs:[{storey:level,type:'ADU Gable deck and shingle',outline:poly([[0,0],[240,0],[240,480],[0,480]]),form:'gable',ridge:'long',pitch,overhang:ft,offset:ridge-m(132)*5/12,name:'A2.2 S2.1 Gable 5-12 ridge12ft7-1-4in'}]});
const roofId=created(roof)[0];
await command('gable-wall-attachment','bim_attach_walls_to_roof',{roof:roofId,walls:[wall.front,wall.rear]});
evidence(created(roof),'A2.2; A3.1; S1.2; S2.1','Derived','5:12 pitch, 1ft maximum overhang selected, ridge12ft7-1/4in. Eave reference solved from ridge and pitch. Roof15/32in deck explicit; shingle15mm thickness assumed. No fascia, gutters, flashing, insulation or site-specific FSD.1 alternative.');

const frame=[];
const member=(name,type,start,end,z)=>frame.push({category:'structure.framing',storey:level,type,start:pt(start),end:pt(end),z,name});
// Beam/joist top elevation is explicit. End cuts and connection hardware are omitted.
for(let y=2.75;y<=477.25;y+=24){member(`S1.2 Ceiling joist y${y}in`,'ADU Ceiling joist 2x6 actual',[2.75,y],[237.25,y],H);}
member('S1.2 Ridge board','ADU Ridge board 2x8 actual',[120,-12],[120,492],ridge-.02690625);
member('S1.2 Porch front beam','ADU Porch beam 4x10 actual',[141.25,2.75],[237.25,2.75],H);
member('S1.2 Porch side beam','ADU Porch beam 4x10 actual',[237.25,2.75],[237.25,68.75],H);
member('S1.2 Interior ceiling beam','ADU Porch beam 4x10 actual',[120,183.75],[120,477.25],H);
const frameResult=await command('horizontal-framing','bim_create_profile_members',{members:frame});
const postResult=await command('porch-post','bim_create_profile_members',{members:[{category:'structure.column',storey:level,type:'ADU Porch post 6x6 actual',at:pt([237.25,2.75]),base_offset:0,height:H-m(9.25),name:'S1.2 Porch 6x6 post'}]});
// Spatial-axis profile members are the native sloping-member representation.
const sloping=[];const roofTopAt=x=>ridge-m(Math.abs(x-120))*5/12;
const halfRafter=m(5.5)/2/Math.cos(pitch*Math.PI/180),cover=.02690625/Math.cos(pitch*Math.PI/180);
for(let y=-12;y<=492;y+=24){for(const [a,b,side]of [[-12,120,'west'],[120,252,'east']])sloping.push({category:'structure.brace',storey:level,type:'ADU Rafter 2x6 actual',start:pt([a,y]),end:pt([b,y]),start_offset:roofTopAt(a)-cover-halfRafter,end_offset:roofTopAt(b)-cover-halfRafter,name:`S1.2 Rafter ${side} y${y}in`});}
// Collar-tie vertical location is not dimensioned: keep an explicit assumption.
const tieZ=H+m(32);
for(let y=0;y<=480;y+=48){member(`S1.2 Collar tie y${y}in`,'ADU Collar tie 2x4 actual',[60,y],[180,y],tieZ);}
const slopeResult=await command('rafters','bim_create_profile_members',{members:sloping});
const tiesResult=await command('collar-ties','bim_create_profile_members',{members:frame.filter(x=>x.name.includes('Collar tie'))});
// Review against the bearing/soffit section, preserving the source plan positions.
// Joists bear above the plate; the living-room ceiling beam stops at the bath.
// Two native joist occurrences meet at the central bearing line.
const frameIds=created(frameResult),tieIds=created(tiesResult),reviewItems=[];
for(let i=0;i<20;i++)reviewItems.push({id:frameIds[i],kind:'beam',set:{end:pt([120,2.75+24*i]),z:H+m(5.5)}});
reviewItems.push({id:frameIds[20],kind:'beam',set:{z:ridge-.038}});
for(const i of [21,22])reviewItems.push({id:frameIds[i],kind:'beam',set:{z:m(84+9.25)}});
reviewItems.push({id:frameIds[23],kind:'beam',set:{start:pt([120,2.75]),end:pt([120,183.75]),z:H+m(5.5)}});
tieIds.forEach((id,i)=>reviewItems.push({id,kind:'beam',set:{start:pt([78,i*48]),end:pt([162,i*48])}}));
reviewItems.push({id:created(postResult)[0],kind:'column',set:{height:m(84)}});
await command('framing-section-review','bim_update_elements',{items:reviewItems});
const eastJoists=await command('east-joist-halves','bim_create_profile_members',{members:Array.from({length:20},(_,i)=>({category:'structure.framing',storey:level,type:'ADU Ceiling joist 2x6 actual',start:pt([120,2.75+24*i]),end:pt([237.25,2.75+24*i]),z:H+m(5.5),name:`S1.2 Ceiling joist east y${2.75+24*i}in`}))});
evidence([...created(frameResult),...created(postResult),...created(slopeResult),...created(tiesResult),...created(eastJoists)],'S1.2; S2.1; SD.1','Derived','DF No2 member designations and 24in/48in spacings from S1.2. Actual dressed sizes interpreted. Joists bear above the plate and meet at central bearing line. Porch beam soffit7ft explicit. Phase/origin of repeated members, rafter centerline seating and collar tie height/endpoints are assumptions; no birdsmouths, end cuts, connectors, studs, jack/king studs, headers or nailing modeled. Sloped rafters use native spatial-axis profile member (structure.brace category), original role retained in name/properties.');

// Component symbols: exact products are not specified by these drawings.
const families=[['Light','electrical.lighting_fixture'],['Electrical device','electrical.equipment'],['Plumbing fixture','plumbing.fixture'],['Equipment','mechanical.equipment']].map(([name,category])=>({name:'ADU '+name+' symbol',category,placement:'level_point',description:'Simplified box marker interpreted from 2D plan. Type size/3D detail is an assumption, not a manufacturer model.',parameters:['width','depth','height'].map(key=>({key,name:key,scope:'type',dataType:'length',required:true})),representation:{kind:'box',width:'width',depth:'depth',height:'height'}}));
await command('families','bim_create_families',{families});
const cp=(name,family,width,depth,height,material)=>({kind:'component',name:'ADU '+name,family:'ADU '+family+' symbol',parameters:{width,depth,height},material});
await command('component-types','bim_create_types',{types:[cp('Ceiling light','Light',.2,.2,.06,'ADU Electrical marker'),cp('Socket','Electrical device',.075,.035,.115,'ADU Electrical marker'),cp('Switch','Electrical device',.075,.035,.115,'ADU Electrical marker'),cp('Bath 60x30 symbol','Plumbing fixture',m(60),m(30),.55,'ADU Sanitary fixture marker'),cp('WC symbol','Plumbing fixture',.4,.7,.75,'ADU Sanitary fixture marker'),cp('Lavatory symbol','Plumbing fixture',.45,.5,.2,'ADU Sanitary fixture marker'),cp('Kitchen sink symbol','Plumbing fixture',.55,.5,.2,'ADU Sanitary fixture marker'),cp('Water heater symbol','Equipment',.58,.58,1.6,'ADU Equipment marker'),cp('Washer symbol','Equipment',.65,.65,.9,'ADU Equipment marker'),cp('Kitchen exhaust symbol','Equipment',.6,.45,.18,'ADU Equipment marker'),cp('Bathroom exhaust symbol','Equipment',.2,.2,.1,'ADU Equipment marker')]});
const components=[];
const component=(name,type,xy,z=0,rotation=0)=>components.push({storey:level,type:'ADU '+type,x:xy[0],y:xy[1],offset:z,rotation,name});
// A2.2 symbol centers digitized in the rendered 4500px page crop: corners
// (65,44)..(690,1295) correspond to 240x480in; positions are approximate.
const elxy=(x,y)=>[m((x-65)/625*240),m((1295-y)/1251*480)];
const lights=[[226,222],[529,222],[378,454],[258,612],[453,652],[578,652],[453,808],[578,808],[658,723],[173,914],[332,914],[551,1013],[173,1187],[332,1187],[558,1202]];
lights.forEach(([x,y],i)=>component(`A2.2 Light ${i+1}`,'Ceiling light',elxy(x,y),H-.08));
const sockets=[[226,76],[529,76],[90,225],[392,225],[659,225],[271,454],[572,500],[572,527],[650,545],[540,585],[566,585],[622,585],[659,658],[659,808],[659,877],[659,963],[565,1097],[565,1133],[267,1270],[90,1164],[90,977],[283,831],[90,626],[350,634],[390,667],[565,34]];
sockets.forEach(([x,y],i)=>component(`A2.2 Socket ${i+1}`,'Socket',elxy(x,y),[6,7,8,9,10,11,12,13,16,17,22].includes(i)?m(42):m(15)));
const switches=[[265,370],[492,370],[243,531],[255,531],[391,798],[405,798],[416,1151],[416,1172]];
switches.forEach(([x,y],i)=>component(`A2.2 Switch ${i+1}`,'Switch',elxy(x,y),m(48)));
const electricalResult=await command('electrical-symbols','bim_create_components',{components});
evidence(created(electricalResult),'A2.2','Derived','15 ceiling light symbols, 26 receptacle symbols, 8 switch symbols digitized by calibrated plan. Device elevations 15/42/48in except annotated42in are assumptions; dimensions are simplified marker boxes. No circuit numbering, panelboard, cables, conduit routes, loads, switching circuit design or PV layout inferred. Symbol count is an interpretation, not a certified electrical takeoff.');
components.length=0;
// Location marker only, not the equipment's full clearance/physical envelope.
// The first larger guessed heater box covered a neighboring source socket.
// Reduce the explicitly assumed marker size, keeping both source positions.
await command('heater-location-marker','bim_update_types',{items:[{type:'ADU Water heater symbol',kind:'component',set:{parameters:{width:.45,depth:.45}}}]});
await command('lavatory-location-marker','bim_update_types',{items:[{type:'ADU Lavatory symbol',kind:'component',set:{parameters:{width:.42}}}]});
component('A2.1 Bath tub','Bath 60x30 symbol',pt([87,200.5]));
component('A2.1 WC','WC symbol',pt([21,279]),0,90);
component('A2.1 Lavatory','Lavatory symbol',pt([14,240]),.65);
component('A2.1 Kitchen sink','Kitchen sink symbol',pt([223,219.5]),.7);
component('A2.1 Water heater','Water heater symbol',pt([219,299]),0);
component('A2.1 Washer','Washer symbol',pt([185,299]),0);
component('A2.1 Kitchen exhaust hood','Kitchen exhaust symbol',pt([186,263]),1.75);
component('A2.2 Bathroom exhaust','Bathroom exhaust symbol',elxy(258,644),H-.12);
const fixtureResult=await command('fixtures-and-exhaust','bim_create_components',{components});
evidence(created(fixtureResult),'A2.1; A2.2','Derived','Fixture/equipment locations digitized from symbols. Dimensions/height are assumed except bath plan extent approximately60x30in. Box geometry is a location/space claim only. No hidden water/drain/refrigerant/duct paths or systems invented. Split heat pump performance noted in source but unit positions are missing: units not placed.');

// Native spatial labels, bounded by explicit automatically joined wall topology.
const roomResult=await command('rooms','bim_create_spatial_elements',{items:[['101','Bedroom 1',35,400],['102','Bedroom 2',185,400],['104','Bathroom',80,245],['105','Living dining kitchen and open hall',100,110],['106','Laundry',185,298],['107','Water heater',220,298]].map(([number,name,x,y])=>({category:'architecture.room',storey:level,x:m(x),y:m(y),number,name,height:H}))});
evidence(created(roomResult),'A2.1','Derived','Room topology from modeled frame centerlines; calculated area is not the published habitable/net area. Closets included as bounded regions but not separately labeled.');

const arch=await register('architecture-electrical.pdf','Mimari ve Elektrik');
const structural=await register('structure.pdf','Statik');
const sourceFiles={architecture:arch.summary.id,structure:structural.summary.id};
const voids=(await tool('bim_query_elements',{kind:'opening',limit:1000})).result;
evidence(voids.elements.map(e=>e.id),'A2.1; A3.1','Derived','Hosted voids follow the nominal door/window types and source plan positions.');
const props=provenance.map(e=>({ids:e.ids,pset:'INSA_Source',values:{sourceUrl:source,sourcePdfSHA256:originalHash,sourceDate:'2025-11-26',sheet:e.sheet,sourceFile:/^S/.test(e.sheet)?sourceFiles.structure:sourceFiles.architecture,sourceVersion:1,verificationStatus:e.status,qualityLevel:'2D-SOURCE-RECONSTRUCTION',notes:e.notes,engineeringAdequacy:false,sourceIFCImported:false}}));
await command('source-properties:'+hash(JSON.stringify(props)).slice(0,16),'bim_set_properties',{items:props});
const basis={project,source,catalog,originalHash,originalBytes:original.length,sourceDate:'2025-11-26',sourcePageCount:19,sourceFiles,nativeModel:true,sourceIFCImported:false,units:'m',coordinateBasis:'Local interpretation: front-left face of stud=(0,0), +x along20ft, +y along40ft; not surveyed/site/georeferenced.',dimensions:{frameWidth:W,frameDepth:D,topPlate:H,roofRidge:ridge,roofPitch: pitch,roofPitchRatio:'5:12',porchWidth:m(96),porchDepth:m(66)},calibration:{A21:{pdfFaceOfStud:{x0:458.94,x1:818.94,top:504,bottom:1224},pdfPointsPerInch:1.5,roundingInches:.25},A22:{symbolDigitization:'4500px page crop left720 top820, frame(65,44)..(690,1295)',estimatedPlanToleranceMetres:.05}},scope:{modeled:['Frame-envelope walls','Nominal doors/windows with hosted openings','Slab and simplified monolithic strip foundations','Gable roof and gable infill','Joists/rafters/ridge/porch beam/post/collar ties','Electrical symbol markers','Plumbing fixture/equipment symbol markers','Bounded native room labels'],notModeled:['Site plan and survey','Complete wood stud/header/connector detailing','Foundation wire mesh, reinforcing bars and anchors','Wall finish skins and thermal layers','Porch slope','Water/drain/refrigerant/duct/conduit/cable routes','Electrical circuit/loads/panels and PV layout','HVAC units with missing positions','Engineering capacity/seismic/code compliance design']},provenance};
fs.writeFileSync(`${out}/reconstruction-basis.json`,JSON.stringify(basis,null,2));
await register('reconstruction-basis.json','Kaynak ve Varsayimlar');
const inventory=(await tool('bim_query_elements',{limit:1000,with_quantities:true})).result;
fs.writeFileSync(`${out}/native-inventory.json`,JSON.stringify(inventory,null,2));
const validation=(await tool('model_validate',{})).result;
fs.writeFileSync(`${out}/validation.json`,JSON.stringify(validation,null,2));
console.log(JSON.stringify({project,total:inventory.total,byKind:inventory.elements.reduce((a,e)=>(a[e.kind]=(a[e.kind]??0)+1,a),{}),validationIssues:validation.issues.length,unsupported:validation.unsupported?.length,dimensions:basis.dimensions}));
