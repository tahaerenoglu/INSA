import json,math
from pathlib import Path
lines=Path('test-results/real-dxf/Drawing1_INSA_on_test.dxf').read_text(encoding='utf-8-sig').splitlines();pairs=[(int(lines[i].strip()),lines[i+1].strip()) for i in range(0,len(lines)-1,2)];records=[]
for c,v in pairs:
 if c==0:records.append({'type':v,'g':[]})
 elif records:records[-1]['g'].append((c,v))
get=lambda r,c:next((v for k,v in r['g'] if k==c),None)
doc=json.loads(Path('test-results/real-dxf/document.json').read_text());lookup={e['id']:e for e in doc['entities']};checks=[];errors=[]
for r in records:
 h=get(r,5);e=lookup.get(h)
 if not e or e.get('unsupported'):continue
 if r['type']=='LWPOLYLINE':
  vertices=[]
  for c,v in r['g']:
   if c==10:vertices.append({'p':[float(v),0],'b':0})
   elif c==20 and vertices:vertices[-1]['p'][1]=float(v)
   elif c==42 and vertices:vertices[-1]['b']=float(v)
  expected=[]
  for i,v in enumerate(vertices[:-1]):
   if v['b']:expected.append((i,v,vertices[i+1]))
  if int(get(r,70) or 0)&1 and vertices[-1]['b']:expected.append((len(vertices)-1,vertices[-1],vertices[0]))
  for i,a,b in expected:
   s=e['segments'][i];theta=4*math.atan(a['b']);chord=math.dist(a['p'],b['p']);R=chord/(2*abs(math.sin(theta/2)));res={'entity':h,'segment':i,'kind':'raw-bulge','sourceBulge':a['b'],'radiusDrawingUnits':R,'sweep_rad':theta,'radiusResidual':abs(R-s['radius']),'sweepResidual':abs(theta-s['sweep']),'startResidual':math.dist(a['p'],s['start']),'endResidual':math.dist(b['p'],s['end']),'circleEndpointResidual':max(abs(math.dist(s['center'],p)-R) for p in [a['p'],b['p']])};checks.append(res)
 elif r['type']=='ARC':
  R=float(get(r,40));theta=math.radians((float(get(r,51))-float(get(r,50)))%360);s=e['segments'][0];checks.append({'entity':h,'kind':'raw-arc','radiusDrawingUnits':R,'sweep_rad':theta,'radiusResidual':abs(R-s['radius']),'sweepResidual':abs(theta-s['sweep'])})
for c in checks:
 if any(v>1e-7 for k,v in c.items() if 'Residual' in k):errors.append(c)
assert not errors,errors
out={'authoritativeModelCreated':False,'independentRawTagChecks':len(checks),'bulgeChecks':sum(c['kind']=='raw-bulge' for c in checks),'arcChecks':sum(c['kind']=='raw-arc' for c in checks),'maxResidual':max(v for c in checks for k,v in c.items() if 'Residual' in k),'checks':checks};Path('test-results/real-dxf/independent-geometry.json').write_text(json.dumps(out,indent=2),encoding='utf-8');print({k:v for k,v in out.items() if k!='checks'})
