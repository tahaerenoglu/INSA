import json,re,collections
from pathlib import Path
d=json.loads(Path('test-results/real-dxf/document.json').read_text());out=[]
for e in d['entities']:
 text=e.get('text','')
 if not text:continue
 kind='tunnel' if re.search(r'TUNNEL|T[ÜU]NEL|T.neli',text,re.I) else 'viaduct' if re.search(r'VIADUCT|V[Iİ]YAD',text,re.I) else 'bridge' if re.search(r'BRIDGE|K[ÖO]PR',text,re.I) else 'culvert' if re.search(r'CULVERT|MENFEZ',text,re.I) else None
 if not kind:continue
 stations=[]
 for m in re.finditer(r'KM\s*=\s*(-?\d+)\+(\d+(?:[.,]\d+)?)',text,re.I):
  sign=-1 if m.group(1).startswith('-') else 1;stations.append({'raw':m.group(0),'station_m_text':sign*(abs(int(m.group(1)))*1000+float(m.group(2).replace(',','.')))})
 lengths=[{'raw':m.group(0),'value_m_text':float(m.group(1).replace(',','.'))} for m in re.finditer(r'\bL\s*=\s*(\d+(?:[.,]\d+)?)\s*m',text,re.I)]
 nameMatch=re.search(r'\b(TUNNEL|BRIDGE|VIADUCT|CULVERT)\s*[- ]*([A-Z0-9]+(?:-[A-Z0-9]+)*)',text,re.I)
 out.append({'nameCandidate':nameMatch.group(0).strip() if nameMatch else None,'entity':e['id'],'layer':e['layer'],'kindCandidate':kind,'raw':text,'at':e['at'],'stationEvidenceSameText':stations,'lengthEvidenceSameText':lengths,'dimensionEvidence':re.findall(r'\d+(?:[.,]\d+)?\s*[xX×]\s*\d+(?:[.,]\d+)?',text),'detailed3dGeometryVerified':False,'status':'source-annotation-only'})
Path('test-results/real-dxf/structures.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8');print('STRUCTURES',collections.Counter(q['kindCandidate'] for q in out),'same-text km',sum(bool(q['stationEvidenceSameText']) for q in out),'same-text L',sum(bool(q['lengthEvidenceSameText']) for q in out));print('PROFILE LINES',json.dumps([e for e in d['entities'] if e['layer']=='00_Tunel_Profil'],ensure_ascii=False,indent=1));print('SAME-TEXT KM sample',json.dumps([q for q in out if q['stationEvidenceSameText']][:5],ensure_ascii=False,indent=1))
