# Phase 2 — çalışan uygulama testi

23 Ekim 2026. Gerçek Fastify sunucusu localhost:8787 üzerinde, `tmp/phase2-live-qa-data` adlı ayrı FileStores deposuyla çalıştırıldı. Kullanıcıların mevcut `data/` projeleri değiştirilmedi. Arayüz işlemleri gstack browse üzerinden yapıldı; API kontrolleri aynı tarayıcı oturumunun gerçek HTTP istekleridir, app.inject sonuçlarıyla karıştırılmamalıdır.

| Kontrol | Gerçek sonuç |
|---|---|
| Giriş ve proje oluşturma | Taha/bim_manager ile UI üzerinden üstyapı projesi oluşturuldu |
| Kırma çatılı bina | UI araç konsolunda model_generate dry-run ve uygulama; 40 eleman; 3B Fragments görüntüsü açıldı |
| Çatı/bağlantı koordinasyonu | 40 indexed element, 200 broad candidate, 593 narrow pair; 0 validation issue, 200 expected interface |
| Eksik MEP bağlantısı | HTTP ile hazırlanan iki uyumlu açık boru ucunda MissingConnection + DisconnectedSystem tespit edildi |
| Güvenli onarım | UI önizlemesinde tek bağlantı, bir iterasyon; UI uygulamasından sonra 0 issue |
| Undo | UI Geçmiş panelinden model_repair geri alındı; MissingConnection + DisconnectedSystem geri geldi |
| Donatı ve MEP | Yeniden onarım sonrası iki kolona donatı ve temiz su riser/branşman ağı eklendi; toplam 51 eleman; 0 issue |
| Gerçek ihracat | model.frag HTTP 200, 21.399 byte; model.ifc HTTP 200; IFCROOF, IFCREINFORCINGBAR ve IFCPIPESEGMENT mevcut |
| Beşik çatı | Ayrı gerçek HTTP projesinde üretim ve validation başarılı, 0 issue |
| Yetki | Viewer ile geçerli model_revise çatı pitch isteği HTTP 403 / UNAUTHORIZED; bim.write engellendi |
| Kalıcılık | Sunucu düzeltme için yeniden başlatıldı, aynı FileStores projeleri tekrar açıldı |
| Altyapı | Ayrı altyapı projesinde KM 1+000–3+000, M-0001 malzeme ve CT-001 ortak tip ile model_generate koridor üretimi; 0 issue. Görüntüleme için açık QA-local-metres eşlemesi kuruldu; infrastructure HTTP 200 ve 2 sahne nesnesi; 3B genel görünüm açıldı |

Canlı testte bulunan hata: altyapı projesinin HTTP araç filtresi ortak BIM malzeme oluşturma/sorgulama araçlarını kapatıyordu. `bim_create_materials` HTTP 400 / TOOL_NOT_AVAILABLE_FOR_PROJECT_TYPE verdi ve koridor hazırlığı durdu. Hata sahibi `packages/core/src/project-tools.ts` içindeki ortak araç listesiydi. Sadece malzeme query/create/update/delete araçları ortak listeye eklendi. Bina elemanı araçları altyapıda kapalı kalır; Core yazma yetkileri/onayları değişmedi.

Yeni regresyon testi önce başarısız oldu. Düzeltmeden sonra `projects-page.test.ts` ve `universal-modeling.test.ts`: **17/17 pass**. Typecheck başarılı. Aynı canlı altyapı HTTP senaryosu da düzeltmeden sonra başarıyla tekrarlandı. Bu küçük düzeltme için tüm tarihsel test paketi tekrar çalıştırılmadı; önceki Phase 2 raporundaki tam paket hataları çözülmüş sayılmaz.

Sınırlar: yerel sunucuda sohbet modeli yapılandırılmamış (`enabled:false`, `model:null`); gerçek LLM sohbeti ve sohbetten AI önerisi/onay akışı bu canlı testte sınanamadı. Bunların mevcut otomatik governance testleri geçti. Tarayıcı konsolunda GPU ReadPixels performans uyarıları görüldü; görüntüleme durmadı. Ret testleri ve sunucu yeniden başlatılırken 400/403/401 ve bağlantı kesilme kayıtları da oluştu. Altyapı koordinatları sentetik test verisidir, gerçek arazi konumu veya ölçüm değildir; 2 km genel görünümde 6 m genişlik ince bir şerit görünür. Mobil/responsive ve yoğun model performansı bu çalışmanın kapsamı değildir.

Yerel kanıtlar (Git'e alınmaz): `output/phase2-live-qa/hip-building.png`, `final-model.png`, `infrastructure.png`, `repair-preview.json`, `repair-applied.json`, `live-checks.json`, `other-checks.json`. Test logları: `tmp/phase2-live-regression-before.log`, `phase2-live-regression-after.log`, `phase2-live-typecheck.log`.

Uygulama başlatma: `INSA_DATA` bu izole klasöre, `INSA_PG_URL` boş, `INSA_APPROVAL=ai`, `PORT=8787`, `HOST=127.0.0.1`; `node --import tsx apps/web-server/src/index.ts`. Son sunucu bu ayarlarla açık bırakıldı. Bu test deposu esas kullanıcı deposu değildir.
