import json,math
from pathlib import Path
source=Path('test-results/real-dxf/Drawing1_INSA_on_test.dxf');lines=source.read_text(encoding='utf-8-sig').splitlines();pairs=[(int(lines[i]),lines[i+1].strip()) for i in range(0,len(lines)-1,2)];records=[]
for code,value in pairs:
 if code==0:records.append({'type':value,'groups':[]})
 elif records:records[-1]['groups'].append((code,value))
get=lambda r,k,d=0:next((v for c,v in r['groups'] if c==k),d)
def cross(a,b):return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def unit(a):
 n=math.sqrt(sum(x*x for x in a));return [x/n for x in a]
def basis(normal):
 z=unit(normal);x=unit(cross([0,1,0] if abs(z[0])<1/64 and abs(z[1])<1/64 else [0,0,1],z));y=unit(cross(z,x));return x,y,z
# Independent arbitrary-axis cross-product implementation, matching the published ezdxf OCS reference.
doc=json.loads(Path('test-results/real-dxf02/document.json').read_text(encoding='utf-8'));lookup={e['id']:e for e in doc['entities']};checks=[]
for r in records:
 if r['type']!='ARC':continue
 h=get(r,5,None);e=lookup.get(h)
 if not e or e.get('unsupported'):continue
 normal=[float(get(r,k,1 if k==230 else 0)) for k in [210,220,230]];axes=basis(normal)
 transform=lambda p:[sum(p[j]*axes[j][k] for j in range(3)) for k in range(3)]
 center=[float(get(r,k)) for k in [10,20,30]];R=float(get(r,40));angles=[math.radians(float(get(r,k))) for k in [50,51]];expected=[transform([center[0]+R*math.cos(a),center[1]+R*math.sin(a),center[2]]) for a in angles];c=transform(center);s=e['segments'][0];residual=max(math.dist(s['center'],c[:2]),*[math.dist(s[key],p[:2]) for key,p in zip(['start','end'],expected)]);sweep=(angles[1]-angles[0])%(2*math.pi)*cross(axes[0],axes[1])[2];assert residual<1e-7 and abs(s['sweep']-sweep)<1e-12,(h,residual);checks.append({'entity':h,'normal':normal,'basis':axes,'expectedCenter':c,'expectedEndpoints':expected,'expectedSweep':sweep,'radius':R,'residual':residual})
out={'sourceBytesUnchanged':True,'method':'normalized normal; Ax=(Wy x N) or (Wz x N); Ay=N x Ax; WCS=x*Ax+y*Ay+z*N','reference':'https://github.com/mozman/ezdxf/blob/master/src/ezdxf/math/ucs.py','checks':len(checks),'negativeRecovered':sum(c['normal'][2]<0 for c in checks),'maxResidual':max(c['residual'] for c in checks),'axisArcs':[c for c in checks if c['entity'] in ['1414A','1414C']]};Path('test-results/real-dxf02/independent-ocs.json').write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps(out,indent=2))
