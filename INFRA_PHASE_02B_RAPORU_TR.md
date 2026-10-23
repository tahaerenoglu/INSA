# INSA Infrastructure Phase 02B — Kesit İncelemesi ve İstasyon Metrajı

14 Ekim 2026. İzole uygulama: http://localhost:8793/ — `road-02-demo`.

## A. Mevcut durum ve yeniden kullanılan kod

Phase 02 raporu ve gerçek kaynak/testler incelendi. Mevcut alignment değerlendirmesi (`point3d`), kesit enterpolasyonu (`roadSectionAt`), katman halkası (`roadRing`), geometri/metraj motoru (`roadGeometry`), kanonik BIM materyalleri ve ortak Platform/MCP akışı kullanıldı. Native Fragments/Three.js sahnesi ve PBR varlık sistemi korunur. Kesit, kayıtlı yolun türetilmiş bir görünümüdür; yeni geometri/metraj veritabanı, CAD uygulaması veya MCP sunucusu yoktur.

Phase 02 demonstrasyon verisi `test-results/road-02/data` klasöründen `test-results/road-02b/data` içine ayrı test kopyası olarak alındı. Kaynak demo ve üretim projeleri değiştirilmedi. Yeni kopyada test genişlik değişikliği onaylandı ve onaylı undo ile geri alındı; son sürüm 70, temel yol parametreleri başlangıçla aynı.

## B. Dosyalar ve mimari kararlar

Yeni dosyalar:

- `packages/infra/src/road-inspection.ts`: istasyon kesiti ve aralık metrajı için türetilmiş değerlendirme.
- `apps/web/src/RoadInspection.tsx`: mevcut inspector içinde SVG, katman seçimi ve aralık tablosu; büyütülebilen kesit.
- `packages/infra/test/road-inspection.test.ts`: bağımsız sayısal kesit/aralık doğrulaması.
- `apps/web/test/road-inspection.test.ts`: gerçek SVG üretimi ve gösterim ölçeği testi.
- `scripts/road-02b-demo.mjs`: izole demo doğrulaması, snapshot/reopen, uzlaştırma ve süre ölçümü.

Değişiklikler:

- `packages/infra/src/road-tools.ts`: mevcut query'ye opsiyonel `station` ve `interval` alanları; materyal isimleri aynı projenin BIM durumundan çözülür.
- `packages/infra/src/index.ts`: değerlendirme işlevlerinin export'u.
- `packages/infra/src/module.ts`: mevcut parseStation artık `Km 0+250` önekini kabul eder, boş girişi reddeder; normal metre ve km+m biçimleri korunur.
- `apps/web/src/App.tsx`, `styles.css`: yol inspector entegrasyonu ve kesit görünüm stilleri.
- `apps/manager-mcp/test/road-runtime.test.ts`: yeni sorgunun onay, undo, materyal, appearance ve snapshot/replay kontrolü.
- `apps/manager-mcp/test/parity.test.ts`: gerçek MCP tools/list şemasındaki opsiyonel alanların doğrulanması.

Mevcut yol motorunun matematik algoritması değiştirilmedi. Aralık değerlendirmesi yalnız koridorun kontrol noktalarını istenen uç istasyonlarda değerlendirip mevcut roadGeometry çağrısını kullanır. Geçiş içindeki tüm özgün kontrol noktaları korunur. Event şeması, otoritatif proje durumu ve kayıt formatına yeni kesit objeleri eklenmedi.

## C. Kesit veri modeli ve hesaplar

`roadEngineeringSection(road, alignment, station)` şunları döndürür:

- Gerçek sayısal station_m ve gösterim etiketi; merkez XYZ.
- Yatay yön açısı, boyuna eğim, eğrilik; normalize 3B tangent ve yatay sağ vektörü.
- Enterpole edilmiş kaplama/banket genişlikleri ve sol/sağ crossfall.
- Merkez, kaplama ve banket kenarlarında ofset, mutlak kot ve dünya XYZ.
- Her katmanın sabit layerId, materialId, rol, düşey kalınlık ve kapsamı.
- Ofset/kot/XYZ olarak üst-alt sınırlar ve kesit alanı.
- Eğrilik Jacobianını içeren birim yatay uzunluk hacmi ve tanı bilgisi.

Kesit düzlemi, yatay enine ofset ile global düşey eksenden oluşur; boyuna eğime dik bir normal kesit iddiası değildir. İleri yönde sağ ofset pozitiftir. Negatif crossfall o tarafta merkezden dışa alçalmadır. Kenar kotu `Zmerkez + |x| * crossfall` olur. Üst/alt sınırlar mevcut roadRing'den gelir; piksel veya viewer meshlerinden okunmaz.

Düşey kalınlık `t`, katman kapsamları `L/R` iken gerçek düşey enkesit alanı `(L+R)*t` m²'dir. Birim yatay kilometraj hacmi `t*(L+R+k*(R²-L²)/2)` m³/m'dir. Asimetrik eğri güzergâhta bu iki sayı aynı olmak zorunda değildir. Aralık hacmi mevcut Simpson integralinden gelir. Kilometraj **yatay chainage**'dir; PBR UV'deki gerçek 3B mesafe ile karıştırılmaz.

İstasyon aralık dışındaysa hata üretilir; sessiz clamp yoktur. Aralık artan sırada ve en az 0.01 m olmalıdır. Materyal ID/isimleri aynı proje içinden çözülür; görüntüleme rengi kanonik materyalin appearance.baseColor veya temel rengidir, doku pikselinden mühendislik bilgisi çıkarılmaz.

## D. İstasyon enterpolasyonu kontrolleri

Mevcut kaynak parametreleri üzerinden 0, 100, 200, 250, 300 ve tam son istasyon değerlendirildi. Son uzunluk **524.9676348513074 m**.

| İstasyon m | Sol/sağ kaplama m | Sol/sağ banket m | Sol crossfall | Sağ crossfall | Merkez kotu m |
|---|---:|---:|---:|---:|---:|
| 0 | 3.5 / 3.5 | 0.75 / 0.75 | -%2 | -%2 | 62.000000 |
| 100 | 3.5 / 3.5 | 0.75 / 0.75 | -%2 | -%2 | 63.200000 |
| 200 | 3.5 / 3.5 | 0.75 / 0.75 | -%2 | -%2 | 64.400000 |
| 250 | 3.75 / 3.75 | 0.875 / 0.875 | +%0.25 | -%2.25 | 64.742857 |
| 300 | 4 / 4 | 1 / 1 | +%2.5 | -%2.5 | 64.571429 |
| 524.9676348513074 | 4 / 4 | 1 / 1 | +%2.5 | -%2.5 | 62.643135 |

250 m kesitindeki kenar kotları, bağımsız `Z+ofset*eğim` hesabıyla:

- Sol banket: ofset -4.625 m, kot 64.754420 m.
- Sol kaplama: -3.750 m, kot 64.752232 m.
- Sağ kaplama: +3.750 m, kot 64.658482 m.
- Sağ banket: +4.625 m, kot 64.638795 m.

| Katman | Materyal | Kalınlık m | Kesit alanı m² | Merkez üst kot m | Merkez alt kot m |
|---|---|---:|---:|---:|---:|
| Wearing Course | M-0002 Asphalt Wearing | 0.04 | 0.3000 | 64.742857 | 64.702857 |
| Binder Course | M-0003 Asphalt Binder | 0.06 | 0.4500 | 64.702857 | 64.642857 |
| Bituminous Base | M-0004 Bituminous Base | 0.12 | 0.9000 | 64.642857 | 64.522857 |
| Granular Base | M-0005 Granular Base | 0.20 | 1.8500 | 64.522857 | 64.322857 |
| Subbase | M-0006 Subbase | 0.25 | 2.3125 | 64.322857 | 64.072857 |

Komşu katmanların ortak ofsetlerde alt/üst kotları eşittir. Kalınlık tüm enine noktalarda düşey olarak korunur. Alt geniş katmanların sınırında üst katman kenarları da bulunur. Sayısal testler kontrol noktaları, ara noktalar, ofset yönü, dünya XYZ, katman sürekliliği ve alanları kontrol eder.

## E. Bağımsız metraj uzlaştırması

Demo [0,100], [100,200], [200,250], [250,300], [300,son] aralıklarına ayrıldı. Hacim ve plan alanı mevcut integralden; eğimli üst alan mevcut mühendislik loft üçgenlerinden gelir.

| Katman | Tam hacim m³ | Aralıkların toplamı m³ |
|---|---:|---:|
| Wearing | 157.9896431524184 | 157.98964315241835 |
| Binder | 236.98446472862761 | 236.98446472862756 |
| Bituminous Base | 473.96892945725523 | 473.9689294572551 |
| Granular Base | 974.9352697026154 | 974.9352697026148 |
| Subbase | 1218.6690871282692 | 1218.6690871282685 |

En büyük bağıl hacim farkı **5.84e-16**'dan küçük; kabul eşiği 1e-9. Demo plan/üst alan toplamları da yaklaşık 1e-11 m² mertebesinde uzlaştı. Bu her aralıkta mesh alanının bit düzeyinde aynı olacağı anlamına gelmez: yeni aralık uçları örneklemeyi inceltebilir. Testlerde yüzey alanı bağıl uzlaştırma eşiği 1e-4, geometri yaklaşım toleransı 0.002 m olarak açıkça belirtilir.

100–300 m aralığı için bağımsız simetrik plan hesabı: ilk 100 m × 7 m + geçiş 100 m × ortalama 7.5 m = **1450 m²**. Geniş taban için 100×8.5 + 100×9.25 = **1775 m²**.

| Katman | Plan m² | Eğimli üst m² | Hacim m³ |
|---|---:|---:|---:|
| Wearing | 1450 | 1450.3321 | 58 |
| Binder | 1450 | 1450.3321 | 87 |
| Bituminous Base | 1450 | 1450.3321 | 174 |
| Granular Base | 1775 | 1775.4065 | 355 |
| Subbase | 1775 | 1775.4065 | 443.75 |

Bağımsız testler ayrıca 250–250.02 m kısa aralığı, asimetrik dairesel eğrilik için toplam yön açısı ile analitik hacmi ve düşey eğriyi kontrol eder. Kesit enterpolasyonu beklentileri engine'den alınmaz; test/demoda ayrı doğrusal hesap yapılır. Genişlik değişiminde bu aralıkta Wearing 58→66 m³; kalınlık testinde 4→8 cm ile 56→112 m³ kontrol edildi. Kanonik materyal ataması ve gerçek PBR appearance değişimi mühendislik hacimlerini değiştirmedi. Undo, eski sayısal sonuçları geri getirdi.

Tam veri: `test-results/road-02b/verification.json`.

## F. UI ve MCP akışı

Yol koridorunu kaynak ağacından seçin. Özellikler panelinin başında Mühendislik kesiti ve aralık metrajı yer alır. İstasyon ve iki aralık ucunu girip sorgulayın. `250`, `0+250`, `Km 0+250` biçimleri kabul edilir. Katman butonları veya SVG yüzleri aynı yerel kesit seçimini değiştirir; materyal kimliği/ismi, kalınlık ve alan gösterilir. 3D model seçimi/camera bundan bağımsızdır.

Varsayılan çizim gerçek oranlı 1×'tir. 5×/10× yalnız düşey görüntü koordinatlarını değiştirir ve açıkça etiketlenir. Dar panelde yatay kaydırma, Kesiti büyüt ile geniş görünüm vardır. Katman sınırları, merkez çizgisi, genişlik/banket boyutları, kot ve crossfall bilgileri görünür.

Onaylı kaynak veya materyal değişikliği sonrası inspector yeni parametrelerle query'yi tekrar çalıştırır. Tamamlanmamış eski isteğin cevabı yeni verinin üzerine yazılmaz. Hatalı sorguda önceki kesit doğruymuş gibi gösterilmez. Reload sonrası kaynak parametreleri kalır; istasyon/aralık/abartma gibi geçici görünüm seçimleri başlangıç ayarlarına döner.

Yeni MCP aracı eklenmedi. Mevcut sorgu geriye uyumlu genişletildi:

```json
{"road":"RD-001","station":"Km 0+250","interval":{"from":"0+100","to":"0+300"}}
```

Eski `{"road":"RD-001"}` çağrısı aynı road/quantities/sampling/conventions alanlarını döndürür. Opsiyonel girdilerde `section` ve `interval` eklenir. Query salt okunurdur; onay veya yeni event üretmez. Gerçek stdio MCP tools/list şemasında station/interval alanları ve yalnız road'un zorunlu olması test edildi. Önceden açık kalan bir MCP istemcisi şemayı önbelleğe almışsa yeniden bağlanması gerekir.

## G. Ekran görüntüleri ve gerçek tarayıcı doğrulaması

Gstack browse skill ile gerçek http://localhost:8793/ uygulaması açıldı. API yanıtı tek başına görsel kanıt sayılmadı; çizim ekran görüntüsüyle incelendi.

Kanıtlar `test-results/road-02b/` içinde:

- `section-250-true.png`: 1× kesit, gerçek tabaka kalınlığı, boyutlar ve materyal kimliği.
- `section-250-exaggerated.png`: 5× gösterim, seçili Bituminous Base ve 0.900000 m² alan.
- `section-auto-updated.png`: diğer sekmeden onay sonrası açık kesitte 4.250 m genişlik ve 1.020000 m² alan.
- `interval-quantities.png`: yerel katman detayı ve aralık metraj paneli.
- `section-reopened.png`: reload sonrası kaynak korunumu ve 1× görünüm.

İki sekmeli testte ilk sekmenin kesiti açık kaldı. İkinci sekmede genişlik önerisi mevcut UI ile onaylandı. İlk sekme sayfa yenilenmeden mevcut SSE/refresh akışından güncellendi; istasyon 250, aralık 100–300, seçili layerId ve 5× ayarı korundu. Aynı yöntemle undo onaylandı: genişlik 3.750 m, alan 0.900000 m² ve hacim 58 m³ geri geldi. Geometri anahtarları başlangıçla aynı; GPU 12 geometri/7 texture, shared cache 6 texture olarak kaldı. Yeni kesit için 3D nesne/renderer yaratılmadı.

Tarayıcıda yeni uygulama JS exception gözlenmedi. Screenshot okumasından kaynaklanan WebGL ReadPixels GPU stall uyarısı vardı. Bir komut otomatik onay incelemesi kullanım limiti nedeniyle çalışmadı; kullanıcı devamından sonra aynı onay akışıyla tekrar denendi. Gstack daemon yeniden açıldı ve kalan kontroller tamamlandı.

## H. Gerçek test sonuçları ve korunan baseline

İlgili regresyon grubu **57/57 başarılı**. Phase 02'deki 52 teste 3 mühendislik kesit/aralık testi, 1 governed query testi ve 1 SVG testi eklendi. Son materyal/appearance ve gerçek MCP şema ek kontrolleri kendi odaklı testlerinde de geçti.

Kapsam: kontrol/ara istasyonlar; katman sınırları; düşey kalınlık; yön/eğim; invalid/out-of-range sorgular; kısa/geçişli/eğri/düşey aralıklar; alan/hacim uzlaştırması; materyal referansları; width/thickness/appearance değişimleri; onay/undo; snapshot/reopen; gerçek MCP paritesi; mevcut BIM/tünel/koordinat/PBR regresyonları.

`npm run typecheck`, `npm run build`, `npm run build:web` başarılı. Vite mevcut büyük bundle uyarısını verdi.

Geniş Core/API/authoring grubu bu turda yeniden çalıştırıldı: **58 test, 51 başarılı, 3 hata, 4 PostgreSQL testi atlandı**. Önceki üç hata aynı:

1. `apps/manager-mcp/test/authoring.test.ts:34`: W-0004/W-0005 kesişen fixture, WALL_INTERSECTION.
2. `apps/web-server/test/api.test.ts:49`: joined-wall delete dryrun, preview beklentisi.
3. `packages/core/test/governance.test.ts`: Windows .bin/tsx child spawn ENOENT.

Bu testlerin beklentileri ve mevcut model doğrulaması gevşetilmedi. Portable node süreçler arası tek-onay testi başarılı.

## I. Performans gözlemleri

Son ölçüm, aynı makinede:

- Saf kesit değerlendirme: 1000 çağrı ortalaması **0.0296 ms**.
- 100–300 m aralık metrajı: 10 çağrı ortalaması **29.32 ms**; mevcut kapalı loft/geometri doğrulaması dahildir.
- Altı kesit, full/partial sorgular, snapshot ve yeniden açma içeren doğrulama grubu yaklaşık **883 ms**; ağ/render süreleri değildir.

Eski query kontratı tam koridor metrajını da döndürdüğü için istasyon sorgusunun toplam süresi saf section değerlendirmesinden büyüktür. Aralık metrajı mevcut engine'i yeniden kullanır; ayrı hızlı metraj algoritması eklenmedi. Bu ölçümler SLA/FPS garantisi değildir. Yeni SVG GPU kaynak tüketmez; viewer kaynak sayıları testte sabit kaldı.

## J. Sınırlamalar

Terrain/TIN, earthworks, kavşak, raylı sistem, köprü, tam IFC4.3, otomatik tasarım standardı uyumu, ikinci CAD veya fiyat/4D/5D eklenmedi. Phase 02 yol geometrisinin mevcut sınırları devam eder. Kesit global düşey/yatay enine düzlemde değerlendirilir. Banket aynı tarafın crossfall'ını kullanır. Kalınlık her katman için güzergâh boyunca sabittir.

SVG materyal temel renkleriyle çizilir; PBR doku kesite bindirilmez. Katmanlar semantik ID ile seçilir; viewer'deki mesh yerine kendi kalıcı geometri formatı oluşturulmaz. Baskı/PDF/DXF kesit export'u bu aşamada yoktur. Geçici görünüm ayarları proje event log'una yazılmaz.

## K. Yeniden üretim

Repo kökünde PowerShell. Mevcut demo klasörünü kopyalarken önce hedefin varlığını kontrol edin; mevcut test verisini tekrar üzerine yazmayın:

```powershell
npm run typecheck
npm run build
npm run build:web
if (-not (Test-Path -LiteralPath 'test-results/road-02b/data')) {
  New-Item -ItemType Directory -Path 'test-results/road-02b' -Force | Out-Null
  Copy-Item -LiteralPath 'test-results/road-02/data' -Destination 'test-results/road-02b/data' -Recurse
}
node --import tsx scripts/road-02b-demo.mjs
$env:INSA_DATA = (Resolve-Path 'test-results/road-02b/data').Path
$env:INSA_APPROVAL = 'ai'
$env:PORT = '8793'
node --import tsx apps/web-server/src/index.ts
```

8793 zaten çalışıyorsa ikinci süreç başlatmayın. Fixture önceki Phase 02 demo klasörünü ve materyal assetlerini kullanır; yeni texture indirmesi gerektirmez. Önceki demo yoksa Phase 02 raporundaki hazırlığı uygulayın.

```powershell
node --test --import tsx packages/infra/test/*.test.ts apps/manager-mcp/test/infra*.test.ts apps/manager-mcp/test/road-runtime.test.ts apps/manager-mcp/test/parity.test.ts apps/web-server/test/infrastructure*.test.ts apps/web-server/test/road-scene.test.ts apps/web/test/infrastructure*.test.ts apps/web/test/material-appearance.test.ts apps/web/test/road-inspection.test.ts packages/bim/test/material-appearance.test.ts packages/core/test/project-validation.test.ts
node --import tsx scripts/road-02b-demo.mjs width
# Yalnız izole projede Öneriler panelinden onaylayın ve kesit/aralık güncellemesini izleyin.
node --import tsx scripts/road-02b-demo.mjs undo
# Geri alma önerisini onaylayın.
node --import tsx scripts/road-02b-demo.mjs
```

Sunucular 8787/8788/8790/8791/8792 yeni backend ile mevcut veri klasörlerini koruyarak güncellendi. İzole 8793 ve diğer portların tamamı HTTP200 ile doğrulandı.

## L. Sonraki en küçük aşama

Mevcut türetilmiş kesit verisini, istasyon/metraj bazını ve materyal kimliklerini içeren mühendislik kontrol çıktısı olarak SVG/CSV dışarı vermek. Aynı otoritatif hesapları kullanarak kesitler ve aralık toplamı için taşınabilir doğrulama dosyası üretmek, başka bir modelleme motoru veya arazi geliştirmesine başlamadan doğrudan kontrol değeri sağlar. Bu turda sonraki aşama başlatılmadı.
