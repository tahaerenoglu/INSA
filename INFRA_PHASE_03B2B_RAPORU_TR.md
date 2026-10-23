# Infrastructure Phase 03B-2B — Kapalı kazı/dolgu katıları

15 Ekim 2026. Sınırlı ve açıkça doğrulanmış geometri aileleri için uygulanmıştır. Genel amaçlı, sınırsız arazi grading çözümü veya üretim yeterliliği iddiası değildir.

## A. Önceki durum ve yeniden kullanım

Phase 03B-2A raporu ve gerçek kaynaklar incelendi. Önceki sürüm yalnızca kesit alanları/daylight referansları üretir. Yeni çözüm mevcut `earthworksSection`, `formationAt`, `zoneStatus`, kaynak imzaları, alignment, LandXML parser/validated TIN, georeferans, `sweepSolid`, yerel tetrahedron hacmi ve yönlü kenar kontrolünü kullanır. Platform, event sourcing, FileStores, snapshot, onay/undo, Shared Tool Registry ve aynı native Three.js/Fragments görüntüleyici korunmuştur. Yeni bağımlılık, veritabanı, viewer veya MCP sunucusu yoktur.

## B. Dosyalar

Yeni:

- `packages/infra/src/earthworks-solids.ts`: kaynak üçgen/önerilen yüzey kırpması, katı bileşenler, hacim ve doğrulama.
- `packages/infra/test/earthworks-solids.test.ts`: 11 analitik/topolojik/bölgesel test.
- `apps/manager-mcp/test/earthworks-solids-runtime.test.ts`: izin, proje izolasyonu, salt okunurluk, onay, undo, kaynak değişimi ve reopen.
- `apps/web-server/test/earthworks-solids-scene.test.ts`: gerçek native mesh, cache, görünürlük, seçim, disposal ve ilgisiz geometri korunması.
- `apps/web-server/test/fixtures/earthworks-solids-demo.ts`: izole doğrulama fixture'ı.
- `scripts/earthworks-03b2b-demo.mjs`, `earthworks-03b2b-edit.mjs`, `earthworks-03b2b-preserved.mjs`, `earthworks-03b2b-benchmark.mjs`, `test-earthworks-03b2b.ps1`: tekrar üretim ve kabul ölçümleri.

Değişen:

- `packages/infra/src/index.ts`: mevcut paketten export.
- `packages/infra/src/earthworks-tools.ts`: mevcut sorguya isteğe bağlı `solids` ve `zone` girdileri.
- `apps/web-server/src/infrastructure.ts`: aynı sahneye türetilmiş seçilebilir katılar, kaynak metadata ve ayrı geometri cache girdileri.
- `apps/web/src/EarthworksInspection.tsx`: bölge seçimi, ayrı m³, geçerlilik, kaynak bilgisi, görünürlük ve odaklama.
- `apps/web/src/App.tsx`: bu kontrollerin mevcut viewer seçim/odaklama/görünürlük metotlarına bağlanması.
- `apps/manager-mcp/test/parity.test.ts`: gerçek stdio MCP şemasında yeni isteğe bağlı girdiler ve eski zorunlu alan uyumu.

BIM pencere/modelleme değişiklikleri önceki görevlerdendir; bu fazda değiştirilmemiştir.

## C. Geometrik üretim

### Düz hat, parçalı düzlemsel TIN

Hesap yerel, yatay istasyon/sol-ofset düzleminde Float64 ile yapılır. Kaynak TIN üçgenleri yeniden triangüle edilmez; kaynak yüz düzlemleri kullanılır. Formasyon iki düzlemsel şeride, sol/sağ şevler ayrı düzlemsel parçalara ayrılır. Formasyon kontrolü, doğrusal boyuna eğim kırılması, kaynak TIN kenarıyla formasyon kenarı/merkez kesişimleri ve sıfır derinlik geçişleri tam aralık sınırlarıdır.

Her TIN üçgeni grading şeridinin XY alanıyla kırpılır. Fark düzleminin sıfır doğrusu hücreyi kazı/dolgu olarak böler. Üst-alt yüzler aynı XY hücresinden üretilir. Paylaşılan bütün XY kenarlar, triangülasyondan önce düğümlenir; farklı hücrelerin köşeleri dizi indeksleriyle birbirine bağlanmaz. İç düşey yüzler üretilmez; dış kenarlar ve istasyon kapakları kapatılır. Sıfır kalınlık uçlarında aynı geometrik köşe kullanılır ve sıfır alanlı yan yüz eklenmez. Yalnızca bir noktada temas eden hacimler tek bileşen sayılmaz.

Şev dalı kenardaki gerçek kazı/dolgu durumundan seçilir. Tam arrangement olay istasyonlarında ve aralarındaki aralıklarda mevcut analitik daylight yeniden kontrol edilir. Çoklu/çakışık kök kabul edilmez. Konservatif kapsam kuralı, daylight'tan da öteye uzanan tanımlı arama şeridinin tamamında TIN kapsamı ister. Boşluk/dış sınır varsa etkilenen bölgenin tamamı eksik sayılır; kayıp zemin sıfır kabul edilmez.

Sabit enkesit eğimleri altında genişlik ve merkez ofseti boyuna doğrusal değişebilir. Kotlar parçalı doğrusal olabilir. Boyuna değişen enkesit eğimi düzlemsel olmayan yüzey oluşturursa bu sürüm reddeder.

### Sınırlı dairesel hat ailesi

Tek dairesel eleman, sabit formasyon, yatay boyuna profil, düz TIN, en çok 180° dönüş ve güvenli ofset/Jacobian sınırı desteklenir. Mevcut alignment frame/sweep motoru kullanılır. Bütün kesin yay alanını çevreleyen konservatif dikdörtgenin orijinal TIN üçgenleriyle tam kaplandığı doğrulanır. Böylece örnek noktaları arasındaki bir delik gizlenmez. Sabit kesit ve düz zemin olduğundan kaynak TIN kenarları aynı düzlemde ek yüz kırılması oluşturmaz.

Yay aralık sayısı, bağımsız `L∫h(u)(1+k·u)du` sektör/Jacobian hacmiyle karşılaştırılarak artırılır. Bağıl hacim hata sınırı `1e-6`, asgari mutlak tolerans `1e-5 m³`; sagitta metre cinsinden ayrıca raporlanır. Genel eğrisel/parçalı TIN ve klotoid grading bu aileye dahil değildir.

## D. Geçerlilik

- Yönlü her kenar tam bir ters eşle eşleşir.
- Her köşede incident yüz fanı bağlantılıdır; salt kenar sayımıyla yetinilmez.
- Pozitif yerel signed-tetrahedron hacmi ve dışa yönelim aranır.
- Tekrarlı yüzler ve sıfır alanlı üçgenler reddedilir. Dairesel ailede de bu kontroller çalışır.
- Düz hat hücreleri, geçerli kaynak TIN ve birbirini örtmeyen grading şeritlerinin ortak düzlemsel ayrışımıdır. Her hücrede üst/alt sıra korunur. Desteklenen ailede bu yapı öz-kesişme ve pozitif hacimli hücre örtüşmesini engeller; rastgele üçgen çorbası için genel mesh boolean/self-intersection doğrulayıcısı iddiası yoktur.
- Dairesel ailede basit kesit, tek yay, açı/Jacobian sınırı ve pozitif eşleştirme kullanılır.
- Bağımsız affine hücre integraliyle toplam mesh hacmi farkı `max(1e-6 m³, 1e-8 × hacim)` sınırında olmalıdır.
- Eksik/bozuk bölgede `status=incomplete`, iki hacim `null`, katı listesi boştur.

## E. Bağımsız hacim sonuçları

Birincil miktar yerinde geometrik m³'tür. Kabarma, sıkışma, taşıma, fiyat veya zemin sınıfı katsayısı yoktur.

| Örnek | Bağımsız kazı m³ | Bağımsız dolgu m³ | Hesaplanan | Mutlak hata |
|---|---:|---:|---|---:|
| A, 100 m sabit dolgu | 0 | 750 | 0 / 749.9999999998545 | 1.46e-10 m³ |
| B, 100 m asimetrik kazı | 775 | 0 | 775 / 0 | 0 |
| C, karma sabit kesit | 54 | 51.75 | 53.99999999999944 / 51.74999999999938 | <7e-13 m³ |
| D, kot 59→61 m | 179.1666666666667 | 175 | 179.1666666666667 / 175.00000000000003 | <3e-14 m³ |
| E, parçalı düzlemsel TIN | 0 | 537.5 | 0 / 537.5000000000005 | <5e-13 m³ |
| F, R=30 m dairesel/asimetrik kesit | 379.02006368621846 | 0 | 379.0199150409453 / 0 | 0.0001486453 m³ |

A: `100×(6×1+1.5×1²)=750`. B: `100×(6×1+1.75×1²)=775`. C: önceki doğrulanmış düzlem/enkesit örneğinin `.5175` ve `.54 m²` değerlerinin 100 m boyunca bağımsız ekstrüzyonudur. D: sıfır geçişinin iki yanında doğrusal derinliğin `6h + Htoplam·h²/2` integrali kullanılır. E: `h=1−|s−50|/100`, `∫6h ds=450`, şev katkısı `87.5`; toplam `537.5`. F: kurp iç/dış asimetrisi moment integraline dahildir; yalnızca alan × merkez uzunluğu değildir. F bağıl hata yaklaşık `3.92e-7`; 1024 yay aralığında sagitta `8.824e-6 m`.

Ek testler: doğrusal genişlik/ofset geçişi için `900 m³`, iki ayrık dolgu bileşeni, ortak sınırda çift sayım olmadan üç bölge toplamı, bozuk mesh reddi ve eksik TIN.

## F. Bölge ve bileşen kimlikleri

Mevcut `EZ-UUID` kaynakları değiştirilmez. Kaynak imzası, tasarım revizyonu, arazi revizyon/hash'i, istasyon ve yanal kapsam her bileşende bulunur. Amaçlanan `operation=cut/fill/mixed` gerçek geometrinin sınıflandırmasını değiştirmez.

Komşu bölgelerin ortak istasyon yüzeyi sıfır hacimlidir. Örnekte `250+250+250=750 m³`. Örtüşen aralıklarda genel toplam `null` olur; sahnede çifte sayılacak katılar gösterilmez. Kısmi aralık sonuçları `selected-partial-ranges` etiketiyle tanımlı bölge kapsamını belirtir; tüm tasarım hacmi gibi sunulmaz.

Türetilmiş bileşen kimliği; zone, tür, mühendislik kaynak imzası ve bileşenin fiziksel domain imzasını içerir. Üçgen/örnek/renderer sırası kimlik değildir. Tekrar hesap ve undo aynı kaynaktan aynı ID'yi üretir. Kaynak değişiminde eski bileşen kimlikleri geçersizleşir; aynı zone altında yeni türetilmiş kimlikler oluşur. Farklı revizyonlardaki bileşenler arasında otomatik fiziksel eşleme iddiası yoktur; sorgunun `componentIdentity` tanısı bu sınırı açıklar. Tam bileşen-topoloji correspondence/reconciliation sonraki geliştirmedir.

## G. Düzenleme, invalidation ve kalıcılık

Mevcut governed tasarım/zone/terrain komutları kullanılır. Kaynak değişince eski zone `review-*` durumuna geçer ve önceki hacim kullanılmaz. Açık zone uzlaştırması aynı kimlikle yeni kaynağı etkinleştirir.

Gerçek izole arayüz kabulü: formasyon 61→62 m önerisi onaylandı; eski hacimler kaldırıldı. Aynı üç bölge uzlaştırıldı; her biri 600, toplam 1800 m³ oldu. Uzlaştırma ve tasarım değişikliği onaylı undo ile geri alındı; aynı bölge ve türetilmiş katı kimlikleriyle 750 m³ geri geldi. Sunucu yeniden açılıp tekrar giriş yapıldı; aynı sonuç görüldü. Yedi örneğin snapshot/reopen sonuçları karşılaştırıldı. Ayrı testte terrain kaynağı değişimi eski hacmi geçersizleştirdi; undo geri getirdi. Malzeme rengi değişimi hacmi değiştirmedi.

Mesh dizileri event log'a yazılmaz. Tüm katılar tanımlardan/TIN asset'inden deterministik üretilir. Sahneye özgü türetilmiş cache, yol/tünel/BIM geometrisini yeniden modellemez. GPU katıları ID/geometri anahtarıyla yenilenir ve eski geometri dispose edilir.

## H. UI ve MCP

[İzole uygulama: localhost:8798](http://localhost:8798/). `solid-fill`, `solid-cut`, `solid-mixed`, `solid-vary`, `solid-tin`, `solid-curve`, `solid-hole` projeleri vardır. Ana bina verisi ve önceki demolar değiştirilmedi.

Yol veya `EW-001` → Özellikler → mevcut kesit panelinin altındaki **3D kazı/dolgu hacimleri**. Bölge seçimi, ayrı hacimler, katı sayısı, kaynak revizyonu, hesap yöntemi/toleransı, tanılar, kazı/dolgu/arazi görünürlüğü ve bölge odaklama bulunur. Katı düğmesi veya 3D yüzeyi seçilebilir; mevcut özellik paneli bileşenin gerçek hacmini ve kimliğini gösterir. Mevcut kesit paneli çalışır.

Yeni MCP aracı yoktur. Mevcut sorgu geriye uyumlu genişledi:

```json
{"design":"EW-001","solids":true}
```

İsteğe bağlı `zone` tek bölgeyi sınırlar. `solidResults` metadata ve doğrulanmış miktarları döndürür; mesh dizilerini MCP cevabına eklemez. Eski yalnızca `design` veya `design+station` çağrıları korunur. Sorgu izin/izolasyon kontrollerinden geçer ve event üretmez. Yeni alanlar gerçek stdio MCP tools/list şemasında test edildi. Açık Codex MCP bağlantısı eski şemayı önbellekte tutuyorsa yeniden bağlanmalıdır.

## I. Gerçek tarayıcı kanıtı

Gstack `/browse` ile kaydedilen görüntüler:

- [Üç bölge / 750 m³ dolgu](test-results/earthworks-03b2b/fill-three-zones.png)
- [775 m³ kazı](test-results/earthworks-03b2b/cut-solid.png)
- [Karma kırmızı kazı ve mavi dolgu](test-results/earthworks-03b2b/mixed-solid.png)
- [Değişken formasyon](test-results/earthworks-03b2b/vary-solid.png)
- [Parçalı TIN](test-results/earthworks-03b2b/tin-solid.png)
- [Dairesel seçilebilir kazı](test-results/earthworks-03b2b/curve-solid.png)
- [Dolgu gizlenmiş](test-results/earthworks-03b2b/fill-hidden.png), [dolgu ayrı seçilmiş](test-results/earthworks-03b2b/fill-selected.png)
- [3D yüzeye pointer ile seçim](test-results/earthworks-03b2b/viewport-pick.png)
- [Onaylı kaynak değişimi / stale](test-results/earthworks-03b2b/edit-stale.png), [1800 m³ yenileme](test-results/earthworks-03b2b/edit-regenerated.png), [undo](test-results/earthworks-03b2b/undo-restored.png), [yeniden açılış](test-results/earthworks-03b2b/reopened.png)
- [Boşlukta doğrulanamayan miktar](test-results/earthworks-03b2b/hole-incomplete.png)
- [Aynı sahnede tünel seçimi](test-results/earthworks-03b2b/tunnel-preserved.png), [BIM kolon seçimi](test-results/earthworks-03b2b/bim-preserved.png)

Katılar gerçek kapalı mesh'tir; arazi kapatıldığında da görünürler. Ekran görüntülerindeki yeşil, mevcut seçim vurgusudur; seçimsiz kazı kırmızı/dolgu mavidir. Console'da uygulama JavaScript hatası görülmedi; screenshot okumasına bağlı WebGL `GPU stall due to ReadPixels` performans uyarıları var. Kayıt: `test-results/earthworks-03b2b/browser-console.txt`.

## J. Testler ve build

Uygulama öncesi mevcut alt grubun **20/20** testi geçti. Önceki fazın raporundaki 79/79 sayısı bu fazın baseline çalıştırması olarak gösterilmemiştir.

Nihai tek işçili çalışma: **91 test, 90 başarılı, 1 başarısız, 0 atlanan**. Tek hata, değiştirilmemiş BIM exporter güvenlik testinin Windows'ta symlink oluşturamaması (`EPERM: symlink`). Geometri/hacim veya IFC içeriği assertion hatası değildir. Core dosya güvenliği testi başarısızlığı gizlenmemiştir. Önceki paralel tekrar 89/91 geçti: buna ek olarak eski road-runtime testi `proposals.json` rename `EPERM` hatası verdi; tek işçili son çalışmada geçti. İlk paralel genişletilmiş çalışmada da 90/91 geçmişti.

Backend `npm run build`, web TypeScript kontrolü ve `npm run build:web` başarılı. `test-results/earthworks-03b2b/final-tests.log`, `parallel-tests.log`, `broad.log`, `backend-build.log`, `typecheck-web.log`, `web-build.log` kayıtları korunur. Geometri assertion'ları veya mevcut testler başarı elde etmek için gevşetilmedi. Web build mevcut büyük bundle uyarısını sürdürür.

Geniş Core/API/BIM grubu: **60 test, 51 başarılı, 4 başarısız, 5 atlanan**. Önceki rapordaki joined-wall dryrun preview, WALL_INTERSECTION fixture, DUPLICATE_WALL_JOIN ve Windows `.bin/tsx` ENOENT sorunları sürmektedir. Bunlar bu fazın kapsamı dışında bırakıldı.

## K. Performans

Süreler yerel ölçümdür, SLA veya FPS değildir. [Sayısal sonuçlar](test-results/earthworks-03b2b/verification.json), [artan TIN yoğunluğu](test-results/earthworks-03b2b/scale.json).

| Örnek | Query ms | Sahne ms | Cache ms | Sahne byte | Katı üçgen / köşe |
|---|---:|---:|---:|---:|---:|
| Dolgu + bağımsız tünel/BIM | 37.11 | 25.53 | 0.67 | 400034 | 332 / 172 |
| Kazı | 12.30 | 9.04 | 0.60 | 23198 | 244 / 124 |
| Karma | 11.63 | 7.36 | 0.36 | 25555 | 240 / 124 |
| Değişken | 11.22 | 6.15 | 0.33 | 26684 | 236 / 122 |
| Parçalı TIN | 13.99 | 7.17 | 0.40 | 24017 | 244 / 124 |
| Dairesel | 53.78 | 54.41 | 0.95 | 597828 | 10246 / 5125 |

8 / 200 / 800 kaynak üçgeninde aynı 750 m³: yaklaşık 13.88 / 42.65 / 72.75 ms; üretilen katı üçgenleri 160 / 752 / 1172. Ayrı dolgu tarayıcı ölçümünde 13 GPU geometrisi, 1 texture, 8 draw call, 0 asset uyarısı görüldü; bu sayı bağımsız tünel eklenmeden önceki sahneye aittir. Native geometri/cache koruma ayrıca otomatik testte ölçülür.

Kaynak sınırları: zone ≤1000 m, TIN ≤10000 yüz, ≤256 mühendislik aralığı, aralık×TIN aday bütçesi ≤200000, ≤2500 kırpılmış hücre, ≤5000 arrangement köşesi. Dairesel yakınsama en fazla 2048 aralık. Aşımda eksik durum/tanı, geçerli hacim yoktur. Çok sayıda bölge kullanıcı tarafından bölünmelidir; katı üretimi multi-km tek nesneye dönüştürülmez.

## L. Destek sınırları

Doğrulanmış: tek doğrultulu düz hat, doğrusal/parçalı doğrusal kot, sabit enkesit eğimleri, doğrusal genişlik/merkez geçişi, geçerli parçalı düzlemsel TIN, ayrı kazı/dolgu ve ayrık bileşenler. Ayrıca düz TIN/sabit formasyonlu tek daire yayı için tolerans kontrollü hacim.

Reddedilen: klotoid, bir zone içinde keskin doğrultu kırılması veya line/arc karışımı, genel eğrisel/parçalı TIN, boyuna değişen crossfall kaynaklı warp, parabolik düşey kurp, tek taraflı zone, çoklu/çakışık daylight, eksik arama şeridi kapsamı ve kaynak limitleri. Tek taraflı zone tanımı önceki fazda saklanabilir; bu sürüm onun hacmini hesaplamaz. Daha dar alan içinde daylight geçerli olsa bile konservatif arama şeridi kuralı nedeniyle bazı gerçek araziler reddedilir.

Güçlü kaynak topolojisi değişiminde eski/yeni fiziksel bileşenler otomatik eşleştirilmez. Genel B-rep boolean, IFC4.3 earthwork katı export'u, şev palyesi, hendek/istinat ve genel grading çözümü eklenmedi. Eski IFC mimarisi değiştirilmedi. P6, 4D, scheduling, maliyet, nakliye veya tünel kazısı geliştirilmedi.

## M. Tekrar üretim

Repo kökünde:

```powershell
node --import tsx scripts/earthworks-03b2b-demo.mjs
node --import tsx scripts/earthworks-03b2b-preserved.mjs
node --import tsx scripts/earthworks-03b2b-benchmark.mjs
./scripts/test-earthworks-03b2b.ps1
npm run build
npm run build:web
$env:INSA_DATA=Join-Path (Get-Location) 'test-results/earthworks-03b2b/data'
$env:INSA_APPROVAL='ai'
$env:PORT='8798'
node --import tsx apps/web-server/src/index.ts
```

İzole proje dizini: `test-results/earthworks-03b2b/data`. Demo builder yalnızca bu kökteki eksik projeleri kurar; mevcut proje üstüne tekrar geometri eklemez. Fixture setup sentetik test verisini insan test rolüyle kurar. Etkileşimli edit/uzlaştırma/undo script'i AI rolüyle yalnızca öneri üretir; web arayüzündeki onay akışı ayrıca kullanılmıştır. Kullanıcının ana `data` alanına yazılmaz.

## N. Sonraki modelleme adımı

Öncelik: değişen crossfall ve genel eğrisel/parçalı TIN için yüzey yaklaşımının kanıtlanmış sapma/hacim yakınsaması; tam eğrisel domain/TIN kırpması, source-topology correspondence ve daha az konservatif daylight alanı kapsam doğrulaması. Her yeni aileye önce bağımsız integral/topoloji referansı eklenmeli. Scheduling entegrasyonu önerilmemektedir.
