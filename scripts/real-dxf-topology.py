import json,math,collections,re
from pathlib import Path
D=json.loads(Path('test-results/real-dxf/document.json').read_text());E=[e for e in D['entities'] if e['layer']=='0_Prj_Eksen' and e['segments']];nodes=[];grid={};adj=collections.defaultdict(list);edges=[];tol=1e-6
def node(p):
 key=tuple(math.floor(v/tol) for v in p)
 for dx in [-1,0,1]:
  for dy in [-1,0,1]:
   for i in grid.get((key[0]+dx,key[1]+dy),[]):
    if math.dist(nodes[i],p)<=tol:return i
 i=len(nodes);nodes.append(p);grid.setdefault(key,[]).append(i);return i
for e in E:
 for i,s in enumerate(e['segments']):
  u,v=node(s['start']),node(s['end']);length=math.dist(s['start'],s['end']) if s['kind']=='line' else s['radius']*abs(s['sweep']);k=len(edges);edges.append({'entity':e['id'],'segment':i,'kind':s['kind'],'length':length,'u':u,'v':v,'sourceUnsupported':e.get('unsupported')});adj[u].append(k);adj[v].append(k)
seen=set();components=[]
for i in range(len(nodes)):
 if i in seen:continue
 todo=[i];ns=set();es=set()
 while todo:
  n=todo.pop()
  if n in seen:continue
  seen.add(n);ns.add(n)
  for k in adj[n]:
   es.add(k);q=edges[k];todo.append(q['v'] if q['u']==n else q['u'])
 ends=[n for n in ns if len(adj[n])==1];branches=[n for n in ns if len(adj[n])>2];components.append({'handles':sorted(set(edges[k]['entity'] for k in es)),'segments':len(es),'kinds':dict(collections.Counter(edges[k]['kind'] for k in es)),'drawingLength':sum(edges[k]['length'] for k in es),'endpoints':[nodes[n] for n in ends],'branches':[{'at':nodes[n],'degree':len(adj[n])} for n in branches],'sourceDiagnostics':list(set(edges[k]['sourceUnsupported'] for k in es if edges[k]['sourceUnsupported'])),'status':'requires-engineering-review','bounds':[min(nodes[n][0] for n in ns),min(nodes[n][1] for n in ns),max(nodes[n][0] for n in ns),max(nodes[n][1] for n in ns)]})
components.sort(key=lambda c:-c['drawingLength'])
for i,c in enumerate(components):c['candidate']=f'AX-{i+1:02d}'
Path('test-results/real-dxf/axis-candidates.json').write_text(json.dumps({'toleranceDrawingUnits':tol,'authoritative':False,'components':components},indent=2),encoding='utf-8');print('COMPONENTS',len(components));print(json.dumps(components,ensure_ascii=False,indent=1)[:19000])
# Diagnostic only: nearest annotation is a hypothesis, never an approved station correspondence.
texts=[e for e in D['entities'] if e.get('text')]
station_labels=[]
for e in texts:
 for m in re.finditer(r'(?:(TS|SC|CS|ST|KM)\s*=\s*)?(-?\d+)\+(\d+(?:[.,]\d+)?)',e['text'],re.I):
  km=m.group(2);sign=-1 if km.startswith('-') else 1;station=sign*(abs(int(km))*1000+float(m.group(3).replace(',','.')));station_labels.append({'entity':e['id'],'layer':e['layer'],'raw':e['text'],'kind':(m.group(1) or 'station').upper(),'station':station,'at':e['at']})
label_matches=[]
for c in components[:2]:
 es=[(e,i,s) for e in E if e['id'] in c['handles'] for i,s in enumerate(e['segments'])];pending=list(es);ordered=[];cursor=max(c['endpoints'],key=lambda p:p[1] if c['candidate']=='AX-02' else p[0]);cum=0
 while pending:
  match=next(((j,e,i,s,math.dist(cursor,s['end'])<tol) for j,(e,i,s) in enumerate(pending) if min(math.dist(cursor,s['start']),math.dist(cursor,s['end']))<=tol),None)
  if not match:break
  j,e,i,s,rev=match;pending.pop(j);s=dict(s)
  if rev:s['start'],s['end']=s['end'],s['start'];s['sweep']=-s.get('sweep',0)
  L=math.dist(s['start'],s['end']) if s['kind']=='line' else s['radius']*abs(s['sweep']);ordered.append((cum,L,e['id'],i,s));cum+=L;cursor=s['end']
 def project(p):
  best=None
  for begin,L,entity,i,s in ordered:
   a,b=s['start'],s['end']
   if s['kind']=='line':
    dx,dy=b[0]-a[0],b[1]-a[1];t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));q=[a[0]+t*dx,a[1]+t*dy]
   else:
    center=s['center'];aa=math.atan2(a[1]-center[1],a[0]-center[0]);pa=math.atan2(p[1]-center[1],p[0]-center[0]);delta=((1 if s['sweep']>0 else -1)*(pa-aa))%(2*math.pi)
    t=delta/abs(s['sweep']) if delta<=abs(s['sweep']) else (0 if math.dist(a,p)<math.dist(b,p) else 1);angle=aa+t*s['sweep'];q=[center[0]+s['radius']*math.cos(angle),center[1]+s['radius']*math.sin(angle)]
   hit={'candidate':c['candidate'],'projectedDrawingDistance':begin+t*L,'distanceDrawingUnits':math.dist(p,q),'segmentEntity':entity,'segmentIndex':i,'projectedPoint':q}
   if best is None or hit['distanceDrawingUnits']<best['distanceDrawingUnits']:best=hit
  return best
 for label in station_labels:
  if label['layer'] not in ['0_Prj_Km','0_Km_Proje']:continue
  hit=project(label['at'])
  if hit and hit['distanceDrawingUnits']<300:label_matches.append({**label,**hit,'association':'proximity-hypothesis-only','offsetIfMetres':label['station']-hit['projectedDrawingDistance']})
 pairs=[]
 kmrows=sorted([r for r in label_matches if r['candidate']==c['candidate'] and r['layer']=='0_Prj_Km' and r['kind']=='STATION'],key=lambda r:r['projectedDrawingDistance'])
 for a,b in zip(kmrows,kmrows[1:]):
  ds=b['projectedDrawingDistance']-a['projectedDrawingDistance'];dk=b['station']-a['station']
  if abs(dk)>=900 and abs(dk)<=1100 and ds>500:
   pairs.append({'from':a['entity'],'to':b['entity'],'labels':[a['raw'],b['raw']],'deltaStation_m':dk,'deltaDrawingUnits':ds,'metresHypothesisResidual_m':ds-abs(dk),'millimetresHypothesisResidual_m':ds*.001-abs(dk),'ratioDrawingUnitsPerStationMetre':ds/abs(dk),'distancesToAxis':[a['distanceDrawingUnits'],b['distanceDrawingUnits']]})
 c['stationComparisonHypotheses']=pairs
Path('test-results/real-dxf/axis-candidates.json').write_text(json.dumps({'toleranceDrawingUnits':tol,'authoritative':False,'components':components},indent=2),encoding='utf-8');Path('test-results/real-dxf/station-labels.json').write_text(json.dumps(station_labels,ensure_ascii=False,indent=2),encoding='utf-8');Path('test-results/real-dxf/station-proximity.json').write_text(json.dumps(label_matches,ensure_ascii=False,indent=2),encoding='utf-8');print('UNITS HYPOTHESES',json.dumps([{k:c[k] for k in ['candidate','stationComparisonHypotheses']} for c in components[:2]],ensure_ascii=False,indent=1)[:13000]);print('Transition counts',collections.Counter(l['kind'] for l in station_labels));
