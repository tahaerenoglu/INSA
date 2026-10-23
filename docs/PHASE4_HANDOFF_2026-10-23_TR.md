# Phase 4 çalışma durumu

Başlangıç: `c2c4e8a`. Uygulanan ve açık kalan özelliklerin 17 başlıklı durum raporu: [Phase 4 raporu](PHASE4_AUTONOMOUS_MODELING_2026-10-23_TR.md).

## Çalışan ortam ve kanıtlar

- Son kod için izole test sunucusu: `http://localhost:8789`; veri `tmp/phase4-live-data`; approval `ai`; PostgreSQL kapalı. Kullanıcı `data/` ve 8787/8788 süreçlerine dokunulmadı.
- Son başarılı kabul projeleri: `p4-mvl3lgeh-reuse`, `p4-mvl3lgeh-assembly`, `p4-mvl3lgeh-building`, `p4-mvl3lgeh-energy`, `p4-mvl3lgeh-density`.
- Gerçek HTTP acceptance ve calls: `output/phase4-live-qa-2026-10-23/acceptance.json`, `calls.json`. Son script test J'yi provider yokluğu nedeniyle NOT TESTED raporlar.
- Bağımsız web-ifc oracle: `ifc-oracle.json`; 5.000 unique product GUID, 2 shared type relation; RC assembly type/decomposition kontrolü geçti.
- Gerçek Fragments ve UI: 5.000 satır için 25/17 DOM satırı; arama, son elemanı seçme, filtre temizlenince seçimin görünür aralığa alınması; küçük vana near-plane düzeltmesi. Görüntüler aynı output klasöründe.
- Kalıcı RC ve MEP assembly type revizyonu, override, manuel edit çatışması, ID/junction korunması, undo/snapshot/replay test edildi.
- Gerçek CSV upload → hücre kanıtı → 40 native kolon; ayrıca generic vana tipi testi. Başlık birimi/mapping çelişkisi ve kaynak tip ölçü çelişkisi reddedilir.
- Kilometre referanslı shared componentType corridor ve diğer Phase 2/3 HTTP regresyonları `phase3-regression/acceptance.json` içinde başarılı.

## Son testler

- **767 total / 642 pass / 109 fail / 16 skip** (`tmp/phase4-final.log`).
- Phase 3'e göre **9 yeni geçen test, 0 yeni başarısızlık kimliği, 0 değişen hata mekanizması**: `PHASE4_TEST_COMPARISON_2026-10-23.json`.
- Aradaki bir tam koşumda CAD vertical testinde Windows atomic rename EPERM oluştu (767/641/110/16). İzole dosya 5/5 ve nihai tam koşumda geçti; bu OS sorunu düzeltilmiş sayılmamalı.
- Son birleşik core/index/semantic odaklı koşum 12/12; native adapter ek doğrulaması 3/3; son belge testi 1/1; son planner NO_CHANGE/archetype testi 2/2 başarılı.
- Typecheck ve web build başarılı; mevcut büyük bundle uyarısı sürer. Son küçük plan sunumu ve sanal seçim görünürlüğü, odaklı test/build ve gerçek UI ile ayrıca doğrulandı.

## Kodun devam noktaları

1. `apps/manager-mcp/src/modeling-planner.ts`: workflow DAG, implicit resource prerequisites, bounded intent ve extensible archetype knowledge.
2. `packages/bim/src/family-resolution.ts`: SI normalizasyonu, şema dışı semantik alan reddi, family/type equivalence. `Builder` gerçek domain normalizasyonunu kullanır.
3. `packages/bim/src/assembly-types.ts`: aynı BIM event stream içinde tanım, occurrence binding ve atomik bağlı revizyon.
4. `apps/manager-mcp/src/modeling-documents.ts`: existing immutable evidence reader ve reviewed tabular mapping. Yeni parser framework'ü yoktur.
5. `apps/manager-mcp/src/modeling-engine-capabilities.ts`: mevcut domain şemaları arkasında native capability adaptörleri.
6. `packages/bim/src/modelling-policy.ts`: component sweep broad-phase; kesin intersection matematiği korunur.
7. `packages/bim/src/ifc.ts`: component, assembly, hosted opening ve MEP segment type/occurrence ilişkileri.
8. `apps/web/src/ui/ProjectExplorer.tsx`: büyük gruplarda virtual rows; identity ve semantic parent'lar korunur.

## Açık kapsam

Gerçek LLM provider kabulü; bütün doğal dil mühendislik taleplerini çözen planner; derin archetype knowledge; bütün legacy düşük seviye/infra create yollarında semantik dedup; arbitrary native family geometry; assembly topoloji/child type değiştirme; bütün donatı hostları için parametrik planner; güvenilir otomatik PDF/CAD/IFC proje çıkarımı; native DWG ve LAS/LAZ; doğrulanmış standart profilleri ve her uzman discipline için ayrı uçtan uca kabul açık kalır. Kapsam dışı mühendislik yük/kapasite/boyutlandırma hesapları eklenmedi.

```powershell
npm run typecheck
npm run build:web
node --import tsx --test apps/manager-mcp/test/phase4-planner.test.ts apps/manager-mcp/test/phase4-resources.test.ts apps/manager-mcp/test/phase4-documents.test.ts packages/bim/test/component-index.test.ts packages/bim/test/mep-network-scope.test.ts
node --import tsx scripts/phase4-live-acceptance.mts http://localhost:8789
node --import tsx scripts/phase4-ifc-oracle.mts
npm test
```

Acceptance scripti yalnız izole sunucuya yönlendirilmeli; model/family kaynaklarını kullanıcı projesinde topluca yeniden oluşturmak için kullanılmamalıdır. Output/tmp/artifact/token dosyaları git'e alınmaz.
