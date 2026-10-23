# D2A-DWG-01 — Mühendislik çizimi inceleme raporu

15 Ekim 2026. Uygulanan kapsam: DXF kaynağı → kullanıcı denetimli, kalibre edilmiş mühendislik adayları. Bu aşamada kanonik alignment, yol veya BIM elemanı oluşturulmaz.

## A. Mevcut yeteneklerin yeniden kullanımı

Gerçek kaynak kodunda DWG/DXF okuyucusu, CAD bölge/ROI seçimi veya CAD mühendislik çıkarım motoru bulunmadı. Önceki görüntüden modelleme örnekleri bir CAD çözücüsü değildi. Mevcut Platform, Shared Tool Registry, izinler, AI önerisi/insan onayı, event store, undo, snapshot ve proje kapsamlı ArtifactStore kullanıldı. Görüntüleme mevcut InfrastructureView / Three.js sahnesine kaynak çizgileri ekler; ikinci renderer, kamera, veri tabanı veya MCP sunucusu eklenmedi. Sağ paneldeki SVG yalnızca kaynak nesnesi/ROI seçim ve inceleme kontrolüdür.

Ön kontrol: alignment/road/earthworks seçili grubu 23/23 geçti (`test-results/d2a-preflight.log`). Mevcut mühendislik hesaplama motorlarına müdahale edilmedi.

## B. DWG ve DXF desteğinin gerçek durumu

- ASCII/UTF-8, model-space DXF desteklenir. Özgün dosya baytları saklanır ve indirilebilir.
- Native DWG **desteklenmiyor**. `.dwg` yüklemesi 415 ve açık DXF dışa aktarım yönergesi verir; AC10 başlığı `.dxf` adıyla gönderilse de reddedilir.
- Binary DXF ve UTF-8 dışı kodlamalar açık hata verir.
- Gerçek DWG dosyası sağlanmadı; native DWG kabul testi yapılmış sayılmaz. DWG içeriğinin çözüldüğü iddia edilmez. Kaynağı hazırlayan kişiden model-space ASCII/UTF-8 DXF istenir; Civil 3D satın alma zorunluluğu yoktur. Dönüştürücü kurulmadı veya lisans varsayılmadı.

## C. Değişen / eklenen dosyalar

| Dosya | Değişiklik |
|---|---|
| `packages/core/src/artifacts.ts` | SHA-256 adresli, boyut/yol/proje/checksum denetimli değişmez CAD kaynak saklama |
| `packages/infra/src/cad-source.ts` | Sınırlı DXF okuyucu, kaynak ilişkisi ve mühendislik aday çıkarımı |
| `packages/infra/src/cad-tools.ts` | Ortak kayıt içinde `infra_review_cad`, `infra_query_cad` |
| `packages/infra/src/module.ts`, `index.ts` | Opsiyonel CAD state alanları, v1 olaylar, araç/summary bütünleştirmesi |
| `apps/web-server/src/app.ts` | Yetkili kaynak yükleme ve özgün dosya indirme uçları |
| `apps/web/src/api.ts` | Mevcut istemcide CAD dosya aktarımı |
| `apps/web/src/CadInterpretation.tsx` | Bölge, katman/nesne seçimi, rol, kalibrasyon, düzeltme ve aday sonuçları |
| `apps/web/src/App.tsx`, `viewer.ts` | Aynı native sahnede ayrı kaynak görünümü ve mühendislik modeline dönüş |
| `apps/web/src/styles.css` | İnceleme paneli ve sayısal tablo okunabilirliği |
| `packages/infra/test/cad-fixture.ts`, `cad-source.test.ts` | Deterministik çok bölgeli DXF ve sayısal testler |
| `apps/manager-mcp/test/cad-runtime.test.ts` | Onay, kimlik, undo, kaynak revizyonu, snapshot ve proje izolasyonu |
| `apps/manager-mcp/test/parity.test.ts` | Yeni iki aracın gerçek MCP tools/list paritesi |
| `apps/web-server/test/cad.test.ts` | Upload/download, yetki, proje izolasyonu ve DWG reddi |
| `apps/web/test/cad.test.ts` | Aday kaynak/düzeltme gösterimi ve native çizim bağlamı |
| `scripts/cad-d2a-demo.mjs`, `cad-d2a-performance.mjs` | İzole demo hazırlığı/doğrulaması ve sentetik yük ölçümü |

## D. Bölgeler ve koordinat bağlamları

Tek çizim içinde yatay plan, boykesit, enkesit, açıklama tablosu veya sınıflandırılmamış bölgeler tutulur. ROI, katman filtresi, açık include/exclude ve mühendislik rolleri kalıcıdır. ROI ile kesişen çizgi/yaylar, uçları kutu dışında olsa da seçilebilir; seçilmiş nesneler otomatik kırpılmaz. Açık include seçimi ROI dışındaki etiketi de alabilir.

Plan: kullanıcı onaylı kaynak birimi, kaynak orijini, mühendislik orijini, dönüklük ve başlangıç istasyonu. Metre/mm/cm/foot/inch dönüşümü açıktır. DXF başlık birimiyle uyuşmazlık uyarılır.

Boykesit: X istasyon, Y kot; her eksen için en az iki bilinen referans ve bağımsız ölçek. Enkesit: X ofset, Y kot; ayrıca açık kesit istasyonu. Ters eksenler desteklenir. Plan ile çizelge koordinatları birbirine karıştırılmaz. Native kaynak görünümü merkezlenmiş **çizim birimleri** kullanır; mühendislik dünya geometrisi değildir. Kalibrasyon yalnızca aday sonuca uygulanır.

## E. Yatay eksen sonucu

Fixture A/B/C kaynaklarından sıralanan kesin geometri:

| Nesne | Geometri | Uzunluk m | Yarıçap m | İstasyon aralığı m |
|---|---|---:|---:|---:|
| A | Doğru | 100 | — | 0–100 |
| B | Çeyrek daire yay | 78,5398163397 | 50 | 100–178,5398163397 |
| C | Doğru | 100 | — | 178,5398163397–278,5398163397 |

Toplam **278,5398163397 m**. Uç ve teğet sürekliliği sayısal testlerle doğrulandı. Bulge ayrıca r=10 m, sweep=π/2 fixture ile doğrulandı. Kopuk, dallanmış, kapalı veya yinelenen eksen reddedilir. Kaynaktaki teğet kırıkları uyarılır; otomatik spiral/clothoid uydurulmaz. İstasyon metinleri geometriye izdüşürülür; fark ve etiket uzaklığı raporlanır. Başlangıç ucu mevcut adayda kaynak koordinatlarına göre deterministik sıralanır; istasyon yönü kaynak etiketleriyle kontrol edilmelidir. Kullanıcı kontrollü ters yön seçeneği henüz yoktur.

## F. Boykesit

X dönüşümü: kaynak 300→0 m, 400→1000 m; bağımsız Y dönüşümü: 200→50 m, 250→100 m. Üçüncü X referansı 350→500 m ile kontrol edildi.

Mevcut PE: (0,60), (500,65), (1000,70). Tasarım PD: (0,62), (500,68), (1000,72). Gerçek tarayıcıda PD/1 noktası gerekçeli **68,25 m** olarak düzeltildi. Özgün kaynak (350,218) değişmedi; sonuç `user-corrected` olarak işaretlendi.

`Siyah kot: 60,00` ve `Kırmızı kot: 62,00` metinleri ayrı kanıttır. Geometrinin mevcut/tasarım rolü açık kullanıcı seçimidir; çizgi rengi tek başına karar vermez. PVI/vertical curve veya geçiş parametresi kanıt yoksa null kalır; chart yayları spekülatif PVI üretmek yerine hata verir.

## G. Enkesitler

0, 500 ve 1000 m için üç ayrı bölge/kalibrasyon oluşturuldu. Kaynak X 570→−3 m, 630→+3 m. Her kesitin kendi Y orijini vardır. Mevcut kotlar 61 / 61,5 / 61,2 m; tasarım kotları 62 / 62,1 / 62 m. Hesaplanan toplam ofset açıklığı 6 m. Segment eğimleri türetilir ve dayanağı belirtilir. `6,00 m`, `1:1,5` gibi kaynak açıklamaları saklanır; 1:1,5 ifadesi belirsiz sayısal kot olarak okunmaz. Şerit/banket sınırları açıkça tanımlanmadığı için şerit ve banket genişlikleri null bırakılır.

## H. Sayısal doğrulama

Kalibrasyonda en az iki referans/eksen gerekir; sıfır ölçek, sonsuz değer ve çelişkili ilave referans reddedilir. Ek referans toleransı 0,00001 mühendislik metresidir. Türkçe ondalık virgül ve km+metre desteklenir. Eksik zorunlu koordinatlardan sıfır koordinat üretilmez. Unsupported nesneler seçiliyse onay engellenir; boş kaynak seçimi onaylanamaz. Kaynak yaylar adayda merkez/yarıçap/sweep ile kesindir. Native/SVG ekranda yaylar yalnızca görüntü için örneklenir; metraj/aday hesaplarında bu örnekler kullanılmaz.

## I. Kaynak ilişkisi ve inceleme

SHA-256, kaynak asset kimliği, dosya adı, entity handle, layer, block instance yolu, bölge, kalibrasyon ve düzeltme gerekçeleri tutulur. Dosya hash'i demo için `85b696e94932f15ec3c5d48b51135ebbb4e97b08a10d458420ba2012ee3e8ee6`.

Düzenleme draft durumuna döner. Confirm/reject mevcut izin ve öneri/onay yolunu kullanır; reviewer actor kaydedilir. Kaynak revizyonu değişince eski aday `source-changed` olur, yeniden inceleme olmadan onay reddedilir. Değişmez kaynak dosyası undo ile silinmez; kaynak/bölge olayları geri alınır. Proje sınırları ve checksum kontrol edilir. Okuma olay üretmez. Snapshot sonrası nesne alan sırası yerine değer eşitliği test edilir; liste sırası kimlik ile deterministiktir. Eski projelerde opsiyonel CAD alanları bulunması gerekmez.

Son demo: **34 kaynak nesne, 5 onaylı bölge, 0 kanonik alignment**, snapshotLoaded=1. Detay: `test-results/d2a-dwg01/verification.json`.

## J. Gerçek tarayıcı kanıtı

Gstack /browse ile gerçek uygulamada dosya yükleme, önerilerin izole fixture için insan arayüzünden uygulanması, kaynak/katman seçimi, plan doğrulama, boykesit düzeltme, enkesit doğrulama ve yeniden açılış yapıldı. Aşağıdaki dosyalar gerçek ekran görüntüleridir; backend yanıtından türetilmiş görseller değildir:

- `test-results/d2a-dwg01/uploaded-source.png`: yüklenmiş çok bölgeli kaynak.
- `test-results/d2a-dwg01/layers-source-selection.png`: katmanlar, turuncu seçili eksen ve ROI; aynı native sahne.
- `test-results/d2a-dwg01/plan-reviewed.png`: 278,539816 m, r=50 m ve plan orijin dönüşümü.
- `test-results/d2a-dwg01/profile-calibration.png`: bağımsız boykesit X/Y ölçekleri ve sıfır referans artıkları.
- `test-results/d2a-dwg01/profile-corrected.png`: ilk gerekçeli nokta düzeltmesi.
- `test-results/d2a-dwg01/reloaded-correction.png`: yeniden açılış sonrası 68,250 m, özgün X/Y ve siyah/kırmızı metinler.
- `test-results/d2a-dwg01/cross-section.png`: 500 m kesiti, −3/0/+3 ofset ve kotlar.

Görseller ayrıca dosyadan açılıp incelendi. Son temiz oturumda JS/resource hatası görülmedi; screenshot sırasında Chromium GPU ReadPixels stall uyarıları vardı. Önceki oturumun sunucu kapanışı/oturum açma hataları başarı sayılmadı. Fiziksel GPU/FPS veya gerçek büyük DWG performansı doğrulanmış değildir.

## K. Testler ve mevcut hatalar

| Kontrol | Gerçek sonuç |
|---|---|
| Son CAD grubu: parser + runtime + HTTP + UI kaynak gösterimi | **11/11 geçti** (`cad-tests.log`) |
| Kaynak revizyonu, onay, undo, snapshot/proje izolasyonu | Son CAD grubu içinde geçti; ayrıca `stale-source-test.log` |
| Alignment/road/inspection/TIN/earthworks/BIM material/IFC/MCP seçili regresyon | **101 test, 100 geçti, 1 başarısız** (`regression.log`) |
| Ek BIM geometri/resources/replay/spatial/structural/güvenlik grubu | **36 test, 32 geçti, 4 başarısız** (`bim-regression.log`) |
| Typecheck: `tsc -b` ve web `tsc --noEmit` | Geçti (`typecheck.log`) |
| Web production build | Geçti (`web-build.log`); mevcut büyük bundle uyarısı sürüyor |
| Gerçek MCP stdio tools/list paritesi | Geniş seçili regresyon içinde geçti |

Hatalar gizlenmedi veya testler zayıflatılmadı. 101'lik grubun tek hatası, Windows'un test dizini symlink oluşturmasına izin vermemesi: `packages/bim/test/exports.test.ts`, EPERM. Önceki earthworks kabulünde de kayıtlıdır.

Ek BIM grubunda: `security.test.ts` Windows'ta uzantısız `node_modules/.bin/tsx` çalıştırması ENOENT; `replay.test.ts` fixture'ı iki join ilişkisi hâlâ varken duvar silmeye çalıştığı için mevcut ELEMENT_IN_USE kuralına takılıyor. Spatial ve structural dosyaları bu çalıştırmada ayrıntılı alt-test çıkarmadan dosya düzeyinde başarısız oldu; ayrı spatial denemesinde de aynı durum var (`spatial-test.log`). Bu dosyaların python3/IfcOpenShell kontrolü var ancak sessiz dosya hatasını kesin olarak buna bağlamıyorum. Bu test/uygulama dosyaları CAD çalışmasında değiştirilmedi; tüm BIM paketinin yeşil olduğu iddia edilmez.

## L. Performans ve sınırlar

Gerçek mühendislik DWG/DXF örneği sunulmadı. Deterministik kabul fixture'ı 2361 bayt / 34 nesnedir. Gerçekçi yoğunlukta, fakat **sentetik** LINE yükü ölçüldü (`performance.json`):

| Nesne | Dosya boyutu | Isınma sonrası parse aralığı | Seçim/aday sorgusu | JSON veri boyutu |
|---:|---:|---:|---:|---:|
| 1000 | 48.309 B | 3,35–9,49 ms | 1,00 ms | 231.534 B |
| 5000 | 254.709 B | 13,84–21,41 ms | 0,93 ms | 1.181.934 B |

Bu değerler Node/backend ölçümüdür; tarayıcı FPS ölçümü değildir. Demo kaynak sorgusu yaklaşık 17,6 ms / 28 KB; makineye ve ısınmaya bağlıdır. Limitler: 10 MiB dosya, 10.000 model/genişletilmiş entity, 20.000 kayıt, 50.000 genişletilmiş segment, 5000 köşe/polyline, 8 block derinliği, 2000 kesin eksen segmenti/bölge. Büyük entity listesinde sanallaştırma ve gerçek saha dosyası performans kabulü sonraki iş olarak kalır.

## M. Desteklenmeyen kaynaklar / bilinen sınırlar

LINE, ARC, planar LWPOLYLINE/POLYLINE (bulge dahil), uniform ölçek/dönüşümlü BLOCK/INSERT, TEXT/MTEXT metinleri desteklenir. Blok kaynak handle ve instance yolu korunur. Yalnızca görüntü yayları örneklenir. Yay ROI/bounds ekran sınırı muhafazakâr olabilir.

SPLINE, ellipse, circle, HATCH, DIMENSION semantiği, native Civil 3D/proxy nesneleri, 3D/nonplanar veya nonuniform/array/recursive INSERT, raster/OCR, otomatik tablo satırı ilişkilendirme desteklenmiyor. TEXT/MTEXT'in gelişmiş font/hizalama/biçimlendirmesi tam CAD tipografisiyle çizilmez; kaynak dosya değişmeden saklıdır. Transition, vertical curve, shoulder veya lane semantiği kanıtsız üretilmez. İçe aktarma bu sürümde DXF kaynak incelemesidir; arbitrary DWG'den otomatik modelleme değildir.

## N. Tekrarlama

Workspace kökünde:

```powershell
npm run typecheck
npm run build:web
node --test --test-concurrency=1 --import tsx packages/infra/test/cad-source.test.ts apps/manager-mcp/test/cad-runtime.test.ts apps/web-server/test/cad.test.ts apps/web/test/cad.test.ts
node --import tsx scripts/cad-d2a-performance.mjs
node --import tsx scripts/cad-d2a-demo.mjs verify
```

Hazır demo: `http://localhost:8799/`, proje **cad-engineering-demo-v2**, test kullanıcısı Taha. Kullanıcının ana `data` projesi ve diğer sunucu verileri değiştirilmedi. İzole veri kökü `test-results/d2a-dwg01/data`.

Sunucuyu yeniden başlatmak için boş 8799 portunda:

```powershell
$env:PORT='8799'
$env:INSA_DATA=(Join-Path (Get-Location) 'test-results/d2a-dwg01/data')
$env:INSA_APPROVAL='ai'
node --import tsx apps/web-server/src/index.ts
```

Sıfır fixture kurulumunda `node --import tsx scripts/cad-d2a-demo.mjs prepare`; arayüzden `engineering-multiregion.dxf` dosyasını yükleyip kaydedin. Sonra `...cad-d2a-demo.mjs regions` beş kaynak inceleme önerisi üretir. İzole test önerilerini arayüzden onaylayın. CAD panelinden plan/boykesit/enkesit bölgelerini seçin. Kalibrasyonu kaynak referanslarıyla kontrol edip Yorumu doğrula kullanın. Boykesit düzeltmesi: entity PD, point 1, field elevation, value 68.25, reason alanı zorunlu. Kaydedip doğrulayın; sayfayı yenileyip sonuç ve kaynak ilişkisini kontrol edin. Demo kökünde eski ilk fixture denemesi de bulunabilir; raporlanan doğru proje v2'dir.

## O. Sonraki en küçük aşama

Yalnızca onaylı ve güncel sourceHash taşıyan plan/boykesit adayını kullanıcıya dönüşüm önizlemesiyle sunmak; istasyon başlangıç yönünü açıkça seçtirmek; mevcut kanonik INSA alignment oluşturma araçlarına kontrollü dönüştürmek. Renk/çizelge koordinatlarıyla dünya geometrisi karıştırılmamalı, eksik geçiş/düşey kurp parametreleri onay öncesi çözülmeli. Bu dönüşüm **bu aşamada başlatılmadı**. Native DWG ayrı bir gerçek dosya, dönüştürücü/lisans kararı ve kaynak sadakati kabul testine ihtiyaç duyar.
