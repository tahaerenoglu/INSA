# D2A-DWG-02A — Onaylı CAD → Kanonik Yatay Alignment

15 Ekim 2026. Sonuç: onaylı DXF yatay planı, INSA'nın mevcut alignment kaynağında kesin parametrik doğru/yay elemanları olarak oluşturuluyor; native görüntüleyicide seçiliyor, sorgulanıyor ve düzenleniyor. İzole demo: **http://localhost:8800/**, proje **cad-engineering-demo-v2**, kaynak **AL-001**, üç kanonik segment. Düşey profil oluşturulmadı.

## A. Yeniden kullanılan bileşenler

D2A-DWG-01 raporu ve gerçek CAD/infra kaynakları incelendi. Immutable ArtifactStore, DXF okuyucusu, plan kalibrasyonu, onaylı CAD bölgeleri, Platform, Shared Tool Registry, AI önerisi/insan onayı, event store, undo, snapshot ve proje georeference kullanıldı. Kanonik hesaplar mevcut `HElement`, `evalElement`, `evalH`, `sampleStations`, `AlignmentDef`, `AlignmentSet` üzerinden yürür. Kaynak ve kanonik önizleme aynı InfrastructureView / Three.js sahnesini, kamerayı ve seçim mekanizmasını kullanır. Yeni alignment motoru, Scene/Camera/Renderer, veri tabanı veya MCP sunucusu eklenmedi.

Önemli uyarlama: eski AlignmentDef yalnızca PI ve zorunlu PVI taşıyordu. Her kaynak yayı genel durumda PI fillet tanımıyla kayıpsız temsil edilemez; ayrıca bu aşamada PVI üretmek yasaktır. Bu yüzden aynı kanonik kaynağa opsiyonel **exact elements** alanı eklendi; hesap motoru değiştirilmedi. Eski PI/PVI kaynakları aynı yoldan çalışır. Düşey profili olmayan exact kaynak `pvis: []` taşır. Sıfır kotlu sahte düşey profil üretilmez.

## B. Değişen / eklenen dosyalar

| Dosya | Sorumluluk |
|---|---|
| `packages/infra/src/cad-conversion.ts` | Uygunluk, yön, istasyon, kesin dönüşüm, analitik kesişim, önizleme, lineage, idempotency |
| `packages/infra/src/alignment.ts` | Mevcut HElement'e opsiyonel kalıcı segment kimliği, exact dizi doğrulaması; düşey profilsiz 3B işlem engeli |
| `packages/infra/src/module.ts` | Aynı AlignmentDef/AlignmentSet; create/update/report/station uzantıları; 3B tüketici korumaları |
| `packages/infra/src/cad-source.ts`, `cad-tools.ts` | Kaynak revizyonu uyumluluğu, geriye uyumlu conversion preview sorgusu |
| `packages/infra/src/index.ts` | Ortak dışa aktarımlar |
| `packages/infra/src/render.ts` | Yatay plan çiziminin PVI gerektirmeden mevcut evalH ile çalışması |
| `apps/manager-mcp/src/runtime.ts` | Oluşturma anındaki aynı optimistic snapshot içinde proje CRS/georeference doğrulaması |
| `apps/web-server/src/infrastructure.ts` | Gerçek kanonik segment kaynakları ve kaynak durumları; mevcut georeference ile native çizim |
| `apps/web/src/CadConversion.tsx` | Yön/başlangıç, etiket karşılaştırması, önizleme/onay, bağımsız seçim, kanonik sorgu/edit |
| `apps/web/src/CadInterpretation.tsx`, `App.tsx`, `styles.css` | Mevcut CAD paneli bütünleştirmesi; undo düğmesinde geri alınabilir komut adının doğru gösterilmesi |
| `packages/infra/test/cad-conversion.test.ts`, `cad-source.test.ts` | Bağımsız analitik geometri ve olumsuz kaynak testleri |
| `apps/manager-mcp/test/cad-conversion-runtime.test.ts` | Gerçek Platform/MCP, approval, kaynak/georeference değişimi, undo, kopya, snapshot |
| `apps/manager-mcp/test/parity.test.ts` | Gerçek tools/list alanları ve tools/call geçişi |
| `apps/web/test/cad-conversion.test.ts` | Native kaynak/model/preview seçim ayrımı, UI kontrolleri |
| `scripts/cad-d2a-02a-demo.mjs`, `cad-d2a-02a-performance.mjs`, `test-d2a-dwg02a.ps1` | İzole kabul hazırlığı/doğrulaması ve sentetik performans |

Bağımlılık eklenmedi. Mevcut BIM geometri, yol/TIN/earthworks/tünel hesap motorları değiştirilmedi. Alignment motoruna eklenen kontroller, yeni yatay-only tanımı mevcut tüketicilerden güvenli biçimde ayırır.

## C. Dönüşüm mimarisi

1. `infra_query_cad` mevcut kaynağı, onaylı bölgeyi, proje CRS/georeference bilgisini okur.
2. Aynı query'nin opsiyonel `conversion` girdisi **salt okunur** önizleme hazırlar. Kaynak hash/revizyon, bölge onayı/revizyonu, birimler, geometri, yön, istasyon etiketleri ve koordinat bağlamı doğrulanır.
3. Önizleme exact HElement dizisini, artık değerleri, kaynak ilişkilerini, istasyonları ve `previewHash` değerini verir. Geçici sahne yalnızca görüntü içindir. Olay veya kanonik kaynak yazılmaz.
4. Mevcut `infra_create_alignment`, geriye uyumlu `{name, cad: {...conversion, previewHash}}` girdisini kabul eder. Kaynak dosya ve tüm koşullar güncel durumdan tekrar denetlenir.
5. Platform'un mevcut approval ve optimistic commit yolu tek AlignmentSet + sayaç olayıyla gerçek kanonik kaynağı atomik oluşturur. Onay beklerken kaynak veya georeference değişirse oluşturma başarısız olur.

Yeni MCP aracı eklenmedi. Mevcut araç şeması **object** olarak korundu; MCP adaptörünün `.shape` sözleşmesi hem tools/list hem gerçek tools/call ile doğrulandı.

## D. Kesin kaynak geometrisi

LINE, ARC, desteklenen LWPOLYLINE doğru/bulge ve klasik planar POLYLINE, mevcut exact değerlendiricide temsil edilir. Doğru: start XY, azimut, uzunluk, sıfır eğrilik. Yay: start XY, başlangıç teğeti, uzunluk, işaretli sabit eğrilik ±1/R. Yay merkezi/sweep/uçlar kaynakla karşılaştırılır. Viewer örnekleri kanonik giriş olarak kullanılmaz; r=50 m yay çizgi zincirine dönüştürülmez.

Kaynak dosya ve entity geometrisi değişmez. Kalibrasyon kaynak birimini, ötelemeyi ve dönüklüğü yalnızca mühendislik verisine uygular. Segment uç/süreklilik ve istasyon artık toleransı **0,00001 m**, teğet inceleme eşiği **1e-8 rad**, kaynak etiketi istasyon çelişki eşiği **0,02 m**. Bunlar önizlemede gösterilir. Sıfır uzunluk, kopuk/dallanan/kapalı/yinelenen yol reddedilir. Boş sayısal alanlardan veya eksik block/INSERT koordinatlarından sıfır orijin üretilmez. Analitik line-line, line-arc ve arc-arc kontrolleri beklenmeyen kesişme/örtüşmeyi engeller. Kasıtlı açı noktası için açık inceleme gerekçesi gerekir; geometri teğet yapmak için değiştirilmez.

SPLINE, proxy veya çizilmiş bir eğriden clothoid parametresi tahmin edilmez. Kaynakta doğrulanmış geçiş parametreleri olmadığı için bu sürüm CAD→clothoid üretmez. Kanonik motorun mevcut clothoid desteği korunur.

## E. Yön, istasyon ve koordinatlar

Kullanıcı kaynak başlangıç ucunu ileri/ters seçeneklerindeki gerçek DXF koordinatlarıyla seçer, başlangıç istasyonunu girer ve yönü ayrıca onaylar. Ters yönde sıra, doğru uçları, yay sweep/eğrilik işareti, teğetler ve istasyonlar birlikte değişir. Seçilen başlangıç ucu yönle uyuşmazsa hata verilir.

İstasyon metinleri geometriyle karşılaştırılır; ölçülen istasyon, metindeki istasyon, artık ve etiketin geometriden uzaklığı gösterilir. Fixture ters çevrildiğinde STA0 için 0 yerine 278,539816 m, STA1 için 100 yerine 178,539816 m hesaplandığı için onay engellenir. Etiketler düzeltilmiş gibi gösterilmez. Kullanıcı kaynak rollerini/yorumunu yeniden inceleyip onaylamalıdır. İstasyon denklemleri/chainage kesintileri açık tanıyla reddedilir.

Dört bağlam ayrıdır: özgün DXF, kalibre mühendislik XY, kanonik double-precision XY ve yalnızca görüntü için local/Float32 koordinatlar. Projenin mevcut `toLocal` / georeference dönüşümü kullanılır. CRS adları uyuşmalı ve georeference geçerli olmalıdır. Önizlemedeki georeference hash'i commit anında doğrulanır. Bilinmeyen CRS için otomatik EPSG veya datum dönüşümü yapılmaz; mevcut proje araçlarında açıkça adlandırılmış LOCAL bağlam kullanılabilir.

Demo **LOCAL:CAD-02A**, sentetik yerel mühendislik bağlamıdır; gerçek bir coğrafi CRS iddiası değildir. Georeference orijini (412000, 4561000, 0), ölçek 1'dir. Yatay-only kaynak native görünümde proje referans düzleminde çizilir. Bu çizim kanonik kot değildir: station sorgusunda `z: null`, `verticalStatus: unresolved` döner. Düşey profil olmadan tünel/yol gibi 3B tüketiciler engellenir.

## F. Bağımsız sayısal karşılaştırma

| Değer | Analitik kaynak | Kanonik sonuç |
|---|---:|---:|
| A doğru uzunluğu | 100 m | 100 m |
| B yay yarıçapı | 50 m | 50 m |
| B yay sweep | π/2 rad | π/2 rad |
| B yay uzunluğu | 25π = 78,5398163397448 m | Aynı, test toleransı 1e-7 m |
| C doğru uzunluğu | 100 m | 100 m |
| Toplam | 200+25π = 278,53981633974485 m | 278,53981633974485 m |
| Başlangıç XY | (412000, 4561000) | Aynı |
| Yay merkezi XY | (412100, 4561050) | Eğrilik/teğetten aynı merkez |
| Bitiş XY | (412150, 4561150) | Aynı |

İstasyonlar: 0 → 100 → 178,53981633974485 → 278,53981633974485 m.

Yay ortasında s=100+12,5π=139,26990816987242 m:

- Bağımsız formül: X=412100+50/√2, Y=4561050−50/√2.
- Kanonik sorgu: **X=412135,3553390593; Y=4561014,64466094**.
- Teğet azimutu π/4; yön vektörü (1/√2,1/√2).
- Başlangıç yönü (1,0), bitiş yönü (0,1).

Ters yönde kaynak sırası C/B/A; yayın sweep'i −π/2, eğriliği −0,02; aynı orta noktadaki yön (−1/√2,−1/√2). Başlangıç istasyonu 700 m için bitiş 978,5398163397448 m. Metre→milimetre yorumunda uzunluk /1000 ve yarıçap /1000; 90° dönüşümde bitiş (−0,15; 0,15) m bağımsız test edildi. Bulge r=10 m yayı ve klasik POLYLINE de doğrudan kanonik elemana çevrilerek test edildi. Doğrulama yalnızca aynı yardımcı fonksiyonun iki çıktısının karşılaştırılmasına dayanmaz.

Plan 278,54 m iken diğer boykesit/enkesit bölgeleri 1000 m'ye uzanır. `CAD_PROFILE_NOT_COMBINED` tanısı gösterilir. Dört bağımsız kaynak yorumunun önceki D2A-01 kaydıyla **tam eşitliği** demo doğrulamasında kontrol edildi. Boykesit kesilmedi, plan uzatılmadı/ölçeklenmedi ve PVI üretilmedi.

## G. Kaynak→model izlenebilirliği

AlignmentDef.cadSource: kaynak asset, özgün dosya adı, SHA-256, çizim/bölge kimlikleri, kaynak ve inceleme revizyonları, kalibrasyon, yön/istasyon/CRS dönüşüm yapılandırması, dönüşüm kimliği, entity handle/layer/block instance yolu ve kalıcı kanonik segment kimliklerini taşır. Orijinal DXF baytları bu metadata içine kopyalanmaz. Segment kimlikleri saklanır; ekran satır sırası kimlik olarak kullanılmaz.

`cadLineageStatus`, **current / source-outdated / review-outdated** ile kaynak durumunu, **as-converted / edited-after-conversion** ile kanonik geometri düzenlemesini ayırır. Kaynak değişince mevcut kanonik geometri korunur; yeniden dönüşüm veya karşılaştırma kullanıcı eylemidir. Aynı baytlarla bile yeni kaynak revizyonu kaydedildiğinde eski bölge onayı geçerli sayılmaz. Eski D2A-01 bölgeleri ilk kaynak revizyonuyla geriye uyumlu okunur.

## H. Önizleme, onay, undo, idempotency

Başarılı tekrar önizlemelerinde event seq değişmedi ve kanonik kaynak sayısı sıfır kaldı. AI oluşturma çağrısı mevcut approval=ai modunda öneri üretir; AI kendi önerisini onaylayamaz. İnsan onayı sonrası tek kanonik kaynak oluşur. Oluşturma başarısızsa kısmi geometri veya sayaç yazılmaz.

Aynı onaylı kaynak revizyonu ve aynı dönüşüm kimliği tekrar gönderilirse mevcut AL kimliği gösterilir; write `CAD_ALREADY_CONVERTED` ile yinelenen kaynak oluşturmaz. İsim değişikliği aynı geometriyi çoğaltmaz. Ayrı kopya istenirse **newModelReason** açık gerekçesi gerekir; mevcut kaynak korunur. Güncelleme ayrı `infra_update_alignment` eylemidir; başka bir alignment sessizce üzerine yazılmaz.

Gerçek tarayıcıda kanonik isim değiştirildi; edit undo edildi; create undo edildi; kaynak aynı önizleme/onay yoluyla yeniden oluşturuldu. Son durumda **1 canlı alignment, 3 segment** vardır. Snapshot ile yeniden açılışta kanonik state ve lineage tam eşittir (`snapshotLoaded: 1`).

## I. Gerçek UI ve MCP akışı

CAD paneli → onaylı Yatay Plan → INSA Alignment'a dönüştür → kaynak başlangıç yönü ve başlangıç istasyonu → yön/koordinat onayı → Salt okunur dönüşüm önizlemesi → etiket/parametre/artık incelemesi → ayrı kanonik oluşturma onayı. Oluşan AL-001 ve segmentleri soldaki mevcut Altyapı ağacındadır. Model görünümüne dönüp alignment/segment seçildiğinde Özellikler panelinde kanonik istasyon sorgusu, isim ve exact eleman tanımı düzenlemesi bulunur.

MCP sırası:

1. `infra_query_cad {drawing}` → kaynaklar + georefHash + proje CRS.
2. `infra_query_cad {drawing, conversion:{drawing,region,reviewRevision,sourceHash,direction,sourceStart,startStation,directionConfirmed,coordinateCrs,coordinateConfirmed,georefHash}}` → salt okunur önizleme + previewHash.
3. `infra_create_alignment {name,cad:{...conversion,previewHash}}` → mevcut yönetişim akışı.
4. `infra_alignment_report`, `infra_station`, `infra_update_alignment` → gerçek kanonik kaynak üzerinde sorgu/edit.

Gerçek stdio MCP **tools/list parity** ve **tools/call preview → AI proposal → human approval → canonical resource** uçtan uca geçti. Araç başına segment üretimi veya ayrı MCP servisi yoktur. Önceden açılmış bir MCP süreci eski şemayı önbellekte taşıyorsa mevcut bağlantı son kodla yeniden başlatılmalıdır; üretim yapılandırmasına ikinci sunucu eklenmez.

## J. Gerçek tarayıcı kanıtları

Gstack /browse kullanıldı. Dosyalar `test-results/d2a-dwg02a/` altında; görüntüler ayrıca açılıp incelendi:

| Ekran görüntüsü | Kanıt |
|---|---|
| `reverse-conflict.png` | Ters uç/yön, negatif yay sweep'i ve engellenen istasyon çelişkisi |
| `readonly-preview.png` | Event sürümü 32, 278,5398163397 m, r=50 m, üç geçici segment; kanonik kaynak yok |
| `canonical-segment.png` | AL-001 ve kalıcı yay segmenti native sahnede seçili |
| `source-segment.png`, `source-selection-id.png` | Aynı sahnede bağımsız `cad:B:0` seçimi |
| `canonical-station.png` | Son kod/sunucu, gerçek kanonik istasyon sorgusu; z=null |
| `undo-canonical.png` | Edit ve create geri alınmış; kanonik model kaldırılmış |
| `reopen-idempotent.png` | Yeniden açılışta aynı AL-001, tekrar oluşturmanın engellenmesi |

Son temiz oturum konsolunda **hata görülmedi** (`browser-console.log`). Sunucu yeniden başlatmasıyla oturumun yeniden açılması ayrıca yapıldı; önceki oturumun 401'leri geometri hatası olarak sunulmadı. Native kaynak/model seçim ayrımı CPU testinde de doğrulandı; otoritatif sayı dizileri değiştirilmedi.

## K. Testler ve mevcut hatalar

| Grup | Sonuç | Log |
|---|---|---|
| Son odaklı CAD/parser/conversion/HTTP/UI/runtime/gerçek MCP grubu | **26/26 geçti**, 0 skip | `focused.log` |
| Son bağımsız analitik dönüşüm kontrolleri | **7/7 geçti** | `analytic-final.log` |
| Seçili alignment/road/tunnel/TIN/earthworks/BIM material/IFC/MCP regresyonu | **119 test: 118 geçti, 1 başarısız**, 0 skip | `regression.log` |
| Typecheck (backend + web) | Geçti | `typecheck.log` |
| Backend build | Geçti | `backend-build.log` |
| Web production build | Geçti; mevcut büyük bundle uyarısı sürüyor | `web-build.log` |
| Demo query/snapshot/reopen/profile bağımsızlığı | Geçti | `verification.json`, `reopen.log` |

Gruplar örtüşür; toplam bağımsız test sayısı gibi toplanmamalıdır. Geçen olumsuz testler: onaysız/stale kaynak, geçersiz kalibrasyon, SPLINE, sıfır uzunluk, gap/branch, ters yay, yön/uç çelişkisi, geçersiz istasyon/denklem, belirsiz CRS, değişmiş georeference, başarısız onay, yinelenen create, açık gerekçeli ayrı kopya, undo/reconversion, kaynak değişimi sonrası kanonik koruma ve çapraz proje erişimi.

119'luk grubun tek hatası önceki çalışmada da kayıtlı Windows **EPERM symlink**: `packages/bim/test/exports.test.ts`, dışa aktarım dizini symlink oluşturma testi. Test değiştirilmedi, atlanmadı ve güvenlik iddiası başarılı sayılmadı.

Önceki D2A-01 geniş BIM çalışmasındaki uzantısız `tsx` spawn ENOENT, join ilişkili duvarı silmeye çalışan replay fixture ve sessiz spatial/structural dosya başarısızlıkları önceki rapor/logda ayrı kayıtlıdır (`test-results/d2a-dwg01/bim-regression.log`). Bu aşamada tüm geniş BIM/Core paketinin tamamen yeşil olduğu iddia edilmiyor. Son seçili mühendislik regresyonunun kapsamı yukarıdaki 119 testtir; mevcut kontroller zayıflatılmadı.

## L. Performans, sınırlar ve desteklenmeyenler

`cad-d2a-02a-performance.mjs`, monoton ilerleyen karışık doğru/çeyrek yay içeren **sentetik LWPOLYLINE** üretir. Gerçek saha DWG performansı değildir. Her boyutta dört tekrar önizleme olay yazmadan yapıldı; gerçek FileStores commit ve mevcut native scene payload ölçüldü.

| Exact segment | DXF B | Tekrar önizleme ms | Hazırlık / doğrulama ms (son tekrar) | Kanonik commit ms | Model scene / kaynakla beraber JSON B |
|---:|---:|---:|---:|---:|---:|
| 20 | 665 | 6,05–11,70 | 0,19 / 0,24 | 42,94 | 28.846 / 64.432 |
| 500 | 15.788 | 83,52–90,35 | 19,66 / 36,74 | 112,30 | 723.580 / 1.678.456 |
| 1000 | 31.914 | 268,87–291,92 | 64,73 / 145,58 | 264,68 | 1.455.811 / 3.383.927 |

Her örnekte tek kanonik alignment kaynağı vardır; N adet ayrı seçilebilir segment çizgisi türetilir. Bu sayılar Node/backend + JSON ölçümüdür; büyük sahnede GPU/FPS kabulü yapılmış sayılmaz. Gerçek tarayıcıda kaynak ve kanonik geometri birlikte küçük fixture ile doğrulandı.

D2A-01 dosya/nesne limitleri korunur. Dönüşüm en çok **2000 exact eleman**, önizleme görüntü örnek bütçesi **50.000**; analitik çift kontrolleri bu sınırda sonlu tutulur. İleri aşamada büyük dosya draw-call/batch iyileştirmesi ancak gerçek saha ölçümünde gerekirse ele alınmalıdır.

Native DWG, proprietary Civil 3D, spline→clothoid tahmini, istasyon denklemleri, düşey profil dönüşümü ve enkesitten otomatik yol üretimi desteklenmiyor. Datum/CRS reprojeksiyonu yoktur. Exact eleman düzenleme UI'ı bu sürümde doğrulanan JSON parametre editörüdür; sürükleyerek tasarım editörü eklenmedi. Düşey-only olmayan 3B fonksiyonlar PVI gerektirir. Kaynak dosyasının gelişmiş CAD font/çizelge semantiği önceki sürüm sınırlarıyla aynıdır.

## M. Tekrarlama komutları

Workspace kökünde:

```powershell
npm run typecheck
npm run build
npm run build:web
node --test --test-concurrency=1 --import tsx packages/infra/test/cad-source.test.ts packages/infra/test/cad-conversion.test.ts apps/manager-mcp/test/cad-runtime.test.ts apps/manager-mcp/test/cad-conversion-runtime.test.ts apps/manager-mcp/test/parity.test.ts apps/web-server/test/cad.test.ts apps/web/test/cad.test.ts apps/web/test/cad-conversion.test.ts
powershell -ExecutionPolicy Bypass -File scripts/test-d2a-dwg02a.ps1
node --import tsx scripts/cad-d2a-02a-performance.mjs
node --import tsx scripts/cad-d2a-02a-demo.mjs verify
```

Geniş seçili regresyonun dosya listesi: `packages/infra/test/*.test.ts`; manager-mcp altında cad-runtime, cad-conversion-runtime, earthworks-runtime, earthworks-solids-runtime, road-runtime, road-terrain-runtime, terrain-runtime, infra-materials, infra-runtime, parity; web-server altında cad, earthworks-scene, earthworks-solids-scene, road-scene, infrastructure, infrastructure-uv, terrain; web altında cad, cad-conversion, material-appearance, infrastructure-materials, road-inspection; bim altında material-appearance ve exports. Her bir ad `.test.ts` uzantısıyla kullanılır. `--test-concurrency=1` dosya deposunun mevcut Windows rename yarışını önler; test iddiaları değişmez.

Hazır demo **8800** portunda çalışır; önceki **8799 D2A-01** veri kökü korunur. Veri: `test-results/d2a-dwg02a/data/cad-engineering-demo-v2`.

Sıfır 02A fixture kurulumu, önceki onaylı D2A-01 fixture mevcutken:

```powershell
node --import tsx scripts/cad-d2a-02a-demo.mjs prepare
$env:PORT='8800'
$env:INSA_DATA=(Join-Path (Get-Location) 'test-results/d2a-dwg02a/data')
$env:INSA_APPROVAL='ai'
node --import tsx apps/web-server/src/index.ts
```

Dolu portta ikinci süreç başlatmayın. Tarayıcıda Taha test kullanıcısı → cad-engineering-demo-v2 → CAD / DXF yorumla → Yatay Plan. İleri (0,0) başlangıcı, 0 m başlangıç istasyonu, yön/CRS onayı, önizleme, kanonik oluşturma onayı. Altyapı ağacından AL-001 veya segment seçip 139.26990816987242 m sorgulayın. Geçmişten create geri alındığında aynı kaynak tekrar oluşturulabilir. Hazır projede yeniden önizleme mevcut AL-001'i döndürür, yeni kopya oluşturmaz.

Fixture hazırlığı ana kullanıcı projesini değiştirmez; D2A-01'in onaylı kaynak olaylarını ayrı veri köküne kopyalar. Node'un bu Windows/OneDrive ortamında recursive cp işlemi çöktüğü için script kontrollü dizin/dosya kopyası kullanır, symlink kabul etmez. Uygulama özelliğinin parçası olan yeni depolama sistemi değildir.

## N. Önerilen sonraki aşama

Onaylı boykesit adayını mevcut kanonik düşey alignment tanımına dönüştürmek. Önce yatay/düşey istasyon başlangıç yönü, datum, aralık ve kaynak revizyonu uyumu açıkça kontrol edilmeli. Bu fixture'da 278,54 m plan ile 1000 m boykesit **uyumlu varsayılamaz**. Eşleşme çözülmeden profil kesilmemeli, plan yeniden ölçeklenmemeli ve PVI/kurp parametresi uydurulmamalı. Bu sonraki aşama başlatılmadı.
