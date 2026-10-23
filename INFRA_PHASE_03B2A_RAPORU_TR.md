# Infrastructure Phase 03B-2A — Formasyon, daylight ve yapım bölgeleri

15 Ekim 2026. Bu sürüm açık formasyon, kesin 2D şev/TIN kesişimi ve sabit yapım bölgesi kimlikleri sağlar. Doğrulanmış 3D hafriyat solidleri veya hacimleri sağlamaz.

## A — Korunan mimari

Mevcut yol/alignment motoru, `roadEngineeringSection`, Phase 03B-1 karşılaştırması, orijinal TIN ve uzamsal indeksi, ortak BIM georeferansı, malzemeler, Platform/Shared Tool Registry, event sourcing, onay, undo ve snapshot/replay kullanıldı. React/SVG RoadInspection ve aynı native Fragments/Three.js dünyası genişletildi. Yeni veritabanı, koordinat sistemi, ayrı hesaplama servisi, viewer, MCP sunucusu veya scheduling motoru kurulmadı. Önceki projeler değiştirilmeden ayrı demo kopyası kullanıldı.

## B — Dosyalar

Yeni:

- `packages/infra/src/earthworks.ts`: formasyon interpolasyonu, daylight, ayrı kesit bölgeleri/alanları, bölge uzlaştırma ve türetilmiş 3D çizgiler.
- `packages/infra/src/earthworks-tools.ts`: üç ortak kayıtlı araç.
- `apps/web/src/EarthworksInspection.tsx`: mevcut yol inspectorünün mühendislik tanımı, sonuçları ve bölge yönetimi.
- `packages/infra/test/earthworks.test.ts`, `apps/manager-mcp/test/earthworks-runtime.test.ts`, `apps/web-server/test/earthworks-scene.test.ts`.
- `scripts/earthworks-03b2a-demo.mjs`: izole örnek, kaynak değişimi/undo önerileri, performans ve reopen kontrolü.

Değişen:

- `packages/infra/src/module.ts`, `index.ts`: isteğe bağlı kaynak state'i, event reducer/versiyonları, doğrulama, ortak silme/özet ve eski IFC export hariç tutma uyarısı.
- `apps/manager-mcp/src/runtime.ts`: proje kapsamlı kaynak, georeferans/datum ve asset doğrulaması.
- `apps/web-server/src/infrastructure.ts`: native sahne kaynakları, türetilmiş çizgiler, cache ve bölge güncelleme imzası.
- `apps/web/src/RoadInspection.tsx`, `App.tsx`, `styles.css`: aynı kesit çiziminin genişlemesi ve bağlantılar.
- `apps/manager-mcp/test/parity.test.ts`, `apps/web/test/road-inspection.test.ts`: MCP ve SVG regresyonları.

Core store, BIM modelleme motoru ve mevcut road/TIN motorları yeniden yazılmadı; yeni bağımlılık eklenmedi.

## C — Kalıcı formasyon modeli

`EW-*` tasarımı yol/TIN kimliklerini, başlangıç/bitiş istasyonlarını, metre birimini, açık onaylı kot referansını, istasyon kontrollerini, dört bağımsız şev oranını, arama sınırını ve revision değerini saklar.

Kot referansı iki seçeneklidir:

- `road-center-offset`: kontrolün `elevation` değeri gerçek yol merkez kotuna eklenen düşey ofsettir.
- `absolute-global`: aynı değer mutlak global kottur.

`reference.approved=true` zorunludur ve mutasyon normal platform onayından geçer. Kaplama altı otomatik formasyon yapılmaz. Formasyon modellerin kaplama altının üstüne çıkıyorsa tanılama verilir; açık referans sessizce değiştirilmez.

Kontrollerde `station`, `centerOffset`, `elevation`, `leftWidth`, `rightWidth`, `leftSlope`, `rightSlope` bulunur. Sayısal değerler istasyonlar arasında doğrusal geçer; kontroller tam tasarım uçlarını kapsar. Son uç son aralığa aittir. Sol/sağ kazı ve dolgu H oranları ayrı ve zorunludur; gizli mühendislik şevi varsayılanı yoktur.

## D — Koordinat, birim ve eğim kuralları

Mühendislik hesabı Float64 projeksiyon XY/global Z metre uzayındadır. Sağ ofset pozitiftir; doğrultu mevcut alignment'ın yatay normalidir. 3D tangent'e dik eğik kesit üretilmez. Kalınlıklar/kot ofsetleri düşeydir.

Formasyon eğimi m/m cinsindedir; negatif değer merkezden ilgili dış kenara alçalır. `1V:1.5H`, bir düşey metre için 1.5 yatay metre demektir. Kazı şevi dışa `+1/H`, dolgu şevi dışa `−1/H` yükselme/alçalmasıyla değerlendirilir.

Yol, arazi ve proje CRS'si eşleşmelidir. Önceki doğrulanmış XY/Z birim dönüşümleri kullanılır. Bilinen farklı datum reddedilir; bilinmeyen datum ilişkisi açık onaylı varsayım olmadan kabul edilmez. Varsayım doğrulanmış datum uyumu olarak etiketlenmez. Reprojeksiyon yoktur. Aynı proje kaynakları ve checksum kontrollü proje asset alanı kullanılır.

## E — Kesin daylight ve kesit alanları

Formasyon kenarında zemin varsa `formasyon − zemin` farkı sınıflandırılır: pozitif dolgu, negatif kazı, 1e-8 m toleransında eşitlik at-grade. İlgili tarafın açık H oranıyla şev doğrusu oluşturulur. Mevcut kesin TIN enkesitinin her doğrusal parçasıyla analitik kesişim çözülür.

Yalnızca kenardan başlayan kesintisiz TIN kapsamı değerlendirilir. İlk boşlukta durulur; boşluğun arkasındaki kök kullanılmaz. Birden fazla kesişimde ilk dışa doğru kök seçilir ve tanılama verilir. Bir TIN aralığıyla çakışan ilk kök `ambiguous` olur; benzersiz nokta uydurulmaz. `no-data`, `not-found`, `ambiguous`, `resolved` ve `at-grade` ayrıdır. Kaynak TIN yüz/nokta kimlikleri sonuçta bulunur.

Formasyon, geçerli şevler, TIN kırılmaları ve tam sıfır geçişlerinde kesit bölünür. Kazı/dolgu bölgeleri ve m² alanları ayrı toplanır; net farkla birbirini götürmez. Daylight veya kapsam eksikse `partial-cross-section` bildirilir. **Hiçbir m³ hafriyat miktarı hesaplanmaz.**

## F — Bağımsız sayısal kanıt

Analitik düz zemin Z=60 m, 6 m genişliğinde yatay formasyon:

- Z=61 m, iki dolgu şevi H=1.5: kenarlardan 1.5 m daylight; toplam dolgu alanı `6×1 + 2×(1.5×1/2)=7.5 m²`.
- Z=59 m, sol kazı H=1.5/sağ H=2: daylight mesafeleri 1.5/2 m; kazı alanı 7.75 m².
- Merkez Z=60, sol +0.1/sağ −0.1 eğim: solda dolgu, sağda kazı; daylight mesafeleri 0.45/0.60 m; ayrı alanlar 0.5175/0.54 m².
- Gerçek TIN eğim kırılmasının ötesindeki dolgu kökü bağımsız denklemle 43.25 m ve 59.675 m kot olarak doğrulandı.

Geçişler, sağ/sol dünya yönü, çoklu kök, çakışık aralık, TIN deliği, yetersiz arama sınırı, eksik daylight, georeferans dönüşümü ve bölge uzlaştırma test edildi. CRS/datum ve uyumlu birimlerin ortak doğrulayıcı regresyonları da korunur.

Gerçek demo, açık merkez ofseti **−1.00 m**, iki formasyon genişliği 4.5 m, sol/sağ eğimler +0.04/−0.04; sol kazı/dolgu H=1.5/2, sağ H=2/1.5, arama 80 m:

| İstasyon | Kesit | Sol daylight ofset/kot m | Sağ daylight ofset/kot m |
|---:|---|---|---|
| 0 | dolgu | -6.333333 / 60.263333 | +5.512690 / 60.144873 |
| 100 | karma | -4.764706 / 62.247647, dolgu | +4.764706 / 62.152353, kazı |
| 200 | kazı | -5.512316 / 64.254877 | +6.361668 / 64.150834 |
| 250 | kazı | -6.567514 / 65.301200 | +7.826186 / 65.225950 |
| 300 | kazı | -8.448413 / 66.383704 | +10.426086 / 66.354471 |
| 524.967635 | kazı | -18.875508 / 71.406807 | +24.356165 / 71.391217 |

100 m'de yol merkezi 63.2, formasyon merkezi ve zemin 62.2 m'dir. Kenar farkı ±0.135 m, ilave daylight mesafesi `0.135/(0.5+0.01)=0.264705882 m`. Her ayrı alan `0.5×4.5×0.135 + 0.5×0.264705882×0.135 = 0.321617647 m²` olur. Bu bağımsız düzlem hesabı uygulama sonucuyla örtüşür.

## G — Sabit yapım bölgeleri

`EZ-UUID` kaynakları tasarımdan ayrı kayıtlar/eventlerdir. Kimlik; mesh sırası, adaptif örnek veya dizi indeksinden üretilmez. Mevcut `id` verilerek güncelleme/uzlaştırma yapılır; `id` olmayan satır yeni bölgedir. Gönderilmeyen bölgeler silinmez. Yeni öneri kimlikleri mevcut Platform `pin` mekanizmasıyla öneri/onay arasında da korunur.

Her bölgede ad, parent design, istasyon aralığı, both/left/right alt bölümü, amaçlanan cut/fill/mixed işlem, kaynak tasarım revizyonu, mühendislik kaynak imzası, `quantityStatus=not-calculated` ve `geometryStatus=reference-only` vardır. Kaynak imzası yol/alignment/TIN ve açık tasarım temelini izler.

Tasarım değişiminde `review-design-revision`, yol/TIN temelinin değişiminde `review-source-geometry`, kapsam dışında `invalid-range` üretilir. Kimlikler korunur; uzlaştırma açık komuttur. Bölge tanımı, mühendislik geometrisi, gelecekteki iş paketi ve aktivite ilişkisi ayrıdır; P6 tarih/aktivite alanı yoktur.

Demo bölgeleri: A 0–100, B 100–200, C 200–524.967635 m. Güncel kaynak tasarım revizyonu 2; üçü de `current` durumundadır. Gerçek tam kimlikler [verification.json](test-results/earthworks-03b2a/verification.json) içindedir.

## H — UI ve MCP

[İzole demo: localhost:8796](http://localhost:8796/), `road-02-demo`. RD-001 → Özellikler → mevcut istasyon kontrolü → Formasyon/daylight paneli.

Panelde tasarım seçimi, açık kot referansı/onay kutusu, istasyon kontrol alanları, dört bağımsız H oranı ve arama sınırı bulunur. Aynı SVG yol katmanları, zemin, formasyon, şevler ve daylight noktalarını çizer. Zemin/formasyon/şev/bölge/yol katmanları ayrı gizlenebilir. 1/5/10× düşey gösterim hesapları değiştirmez. Kazı kırmızı, dolgu mavi, zemin yeşil, formasyon mordur. Bölgeler sabit kimlik ve uzlaştırma durumuyla listelenir; tanımlar düzenlenebilir.

Mevcut registry'ye üç yetenek eklendi:

- `infra_upsert_earthworks_design` — governed create/update.
- `infra_upsert_earthwork_zones` — governed create/update/reconcile; silme mevcut `infra_delete` ile.
- `infra_query_earthworks` — salt okunur tanım, bölgeler ve isteğe bağlı istasyon hesabı.

Gerçek stdio MCP parity testi kayıtları ve query/write annotations'ı doğrular. Açık Codex INSA oturumu eski katalog tutuyorsa bağlantının yeniden bağlanması gerekir; bu sohbetin görünen araç listesi yeni earthworks araçlarını henüz içermiyordu.

## I — Native 3D ve görüntü kanıtları

Formasyon kenarları/daylight çizgileri aynı kaynak dünya koordinatından mevcut georeferans ve Fragments dönüşümüyle çizilir. Yeni scene/camera/renderer yoktur. Çizgiler seçilebilir/gizlenebilir ve kaynak revizyonları incelenebilir. Bölgelere sahte mesh verilmez: demo sahnede altı earthworks çizgisi, **sıfır zone solidi** vardır.

Boyuna çizgiler türetilmiş **örneklenmiş mühendislik referanslarıdır**: örnekte 56 istasyon ve 10 m azami temel adımı, ayrıca alignment/control noktaları kullanılır. Aralarındaki bağlantının TIN deliğinden geçmesi halinde bağlantı atılır. Bunlar bütün boy boyunca kesin 3D daylight eğrisi veya hacim yüzeyi olarak sunulmaz.

Gerçek gstack tarayıcısında kaydedilip incelenen kanıtlar:

- [Açık mühendislik ayarları](test-results/earthworks-03b2a/explicit-settings.png)
- [0 m dolgu](test-results/earthworks-03b2a/fill-000.png)
- [100 m karma kesit](test-results/earthworks-03b2a/mixed-100.png)
- [300 m kazı](test-results/earthworks-03b2a/cut-300.png)
- [Native 3D daylight seçimi](test-results/earthworks-03b2a/daylight-native-3d.png)
- [Revizyon inceleme durumu](test-results/earthworks-03b2a/zones-revision-review.png)
- [Undo sonrası aynı bölgeler](test-results/earthworks-03b2a/zones-undo.png)
- [Reopen ve güncel kaynak imzası](test-results/earthworks-03b2a/zones-final-reopened.png)
- [5× gösterim](test-results/earthworks-03b2a/exaggeration-5.png)
- [BIM kolon seçimi](test-results/earthworks-03b2a/native-bim-preserved.png), [tünel](test-results/earthworks-03b2a/native-tunnel-preserved.png), [arazi](test-results/earthworks-03b2a/native-terrain-preserved.png)

Şev görünürlüğü kapatıldığında SVG daylight dairesi sayısı sıfır oldu; tekrar açıldı. BIM kolon, tünel ve arazi native seçimleri de kullanıldı. Mevcut yol/PBR görünümü korunuyor.

## J — Onay, güncelleme ve kalıcılık

İzole demoda formasyon ve üç bölge web üzerinden onaylandı. İkinci sekmede onaylanan tasarım değişimi ilk sekmede refresh gerektirmeden revizyonu ve bölge durumlarını yeniledi; onaylı undo önceki formasyonu/kimlikleri geri getirdi. Snapshot/reopen aynı formasyon ve bölge kimliklerini üretir. Kaynak değiştirme de bölgeleri açık inceleme durumuna geçirir; undo eski temeli geri getirir.

Yalnızca tanımlar/eventler kalıcıdır. TIN ve 3D çizgi dizileri yeni eventlere yazılmaz. Mevcut SSE/refresh ve async yanıt temizliği kullanılır. Bölge metadata değişimi görünümü yenilerken yol/TIN/çizgi geometri anahtarları korunur. GPU değiştirme/disposal, parent seçim/görünürlük ve ilgisiz yol geometrisinin yeniden kullanılmasına ilişkin testler geçer.

## K — Gerçek test/build sonuçları ve mevcut hatalar

Ön kontrol: önceki ilgili **72/72 test** ve typecheck başarılı. Final ilgili grup **79/79**, typecheck, backend build ve web build başarılı. [Final test kaydı](test-results/earthworks-03b2a/final-tests.log).

Yeni kanıtlar: dört bağımsız mühendislik testi; governed kaynak/bölge, pinlenmiş kimlik, invalidation, onay/undo, izin/izolasyon, snapshot/reopen testi; native georeferans/GPU testi; SVG görünürlük ve renk testi. Mevcut road/TIN, koordinat, Core doğrulama, IFC/tünel/yol metrajı, BIM malzeme/PBR ve MCP parity testleri korundu.

Geniş Core/API/BIM grubu **60 test: 51 başarılı, 4 başarısız, 5 atlanan**; önceki aşamayla aynı sonuç. Hatalar joined-wall dryrun preview beklentisi, WALL_INTERSECTION fixture, DUPLICATE_WALL_JOIN scenario ve Windows `.bin/tsx` ENOENT. [Ayrı kayıt](test-results/earthworks-03b2a/broad-tests.log). Assertion veya mevcut model doğrulama kuralları gevşetilmedi.

Bir odaklı tekrarda Windows geçici `proposals.json` rename işlemi EPERM verdi. Aynı test tek başına, sonraki odaklı grup ve final 79 testte geçti; Core store bu aşamada değiştirilmedi. Vite mevcut büyük bundle uyarısını üretir.

## L — Performans ve sınırlar

Yerel ölçümler, SLA/FPS değildir. Altı demo sorgusu yaklaşık 6.6–21.3 ms; sonuçlar 21–29 KB. 56 istasyondan altı boyuna çizgi hazırlama yaklaşık 19.2 ms; mevcut büyük tünel/yol/TIN dahil sahne hazırlama yaklaşık 155.4 ms. Çizgi çıktısı yaklaşık 16.1 KB.

Phase 03A büyük TIN fixture: 8281 nokta/16200 üçgen. 250 m formasyon hesabında 94 aday/27 kesişen üçgen; 30 ölçüm ortalaması yaklaşık 0.37 ms, aralık 0.27–2.03 ms. Bunlar hazırlanmış TIN üzerindeki hesaptır; XML import hariçtir. Gerçek tarayıcıda 20 GPU geometrisi, 7 texture ve 6 cached texture görüldü; zone solidi yoktur. [Ölçümler](test-results/earthworks-03b2a/verification.json).

Sınırlar: 100 formasyon kontrolü, her tarafta 0.1–70 m genişlik, ±20 m merkez ofseti, eğimler ±0.5 m/m, H=0.1–20, arama 0.1–500 m; bölgeler komut başına en çok 100. Türetilmiş 3D referanslarda 512 istasyon, 250000 aday ve 50000 profil parçası bütçesi vardır; aşımda tanılama verilir. Mevcut TIN limitleri korunur.

## M — Bilinen kısıtlar

Şev H oranları tasarım içinde sabittir; genişlik/ofset/kot/formasyon eğimleri istasyon boyunca geçişlidir. Palye, hendek, istinat, karmaşık formasyon katmanları ve tam yüzey grading yoktur. Kesit alanı doğrulaması 3D hacim doğrulaması değildir. Daylight bulunmayan/ambiguous veya no-data durumlar geçerli hacim gibi kullanılmamalıdır.

Boyuna görsel çizgilerin tam 3D daylight hata sınırı bu sürümde sertifikalanmaz. Güçlü kurp, yakın/çatallanan kökler ve karmaşık topoğrafyada gelecekteki yüzey/solid çözümü ayrıca doğrulanmalıdır. Formasyonun kaplama ile fiziksel tasarım ilişkisi kullanıcı mühendislik kararıdır; mevcut uyarı bunu sessizce düzeltmez.

Eski IFC4 alignment/tünel export'u road/TIN/earthworks/zone kaynaklarını açık uyarıyla hariç tutar; IFC4.3 eklenmedi. Yeni tenant ACL, P6, tarihler, 4D scheduling, fiyat ve m³ hafriyat hesabı yoktur.

## N — Tekrar üretme

Yeni, boş demo hedefinde repo kökünden:

```powershell
New-Item -ItemType Directory -Force test-results/earthworks-03b2a
Copy-Item -LiteralPath test-results/road-terrain-03b1/data -Destination test-results/earthworks-03b2a/data -Recurse
node --import tsx scripts/earthworks-03b2a-demo.mjs prepare
node --import tsx scripts/earthworks-03b2a-demo.mjs create
$env:INSA_DATA=(Resolve-Path test-results/earthworks-03b2a/data).Path
$env:INSA_APPROVAL='ai'
$env:PORT='8796'
node --import tsx apps/web-server/src/index.ts
```

Taha ile giriş yapıp formasyon önerisini onaylayın. Ayrı terminalde `node --import tsx scripts/earthworks-03b2a-demo.mjs zones`, sonra web onayı. Var olan hedef klasörün üzerine tekrar kopyalamayın ve mevcut EW-001 varsa yeniden create kullanmayın.

RD-001 inspectoründe 0, 100, 300 m sorgulayın. `edit` → web onayı → `undo` → web onayı değişim/geri almayı gösterir. `reconcile` mevcut bölge kimlikleriyle açık kaynak uzlaştırma önerir. `verify` salt okunur sorguları, büyük TIN ölçümünü ve snapshot/reopen kontrolünü kaydeder. Üretim verisinde demo komutlarını çalıştırmayın.

## O — Phase 03B-2B hacim doğrulama stratejisi

Mevcut `road.ts` kapalı loft, `sweep.ts` içindeki yerel orijine göre `meshVolume`, `isClosedOriented` ve ortak arayüz üçgenleri yeniden kullanılabilir. Ancak değişen TIN/daylight topolojisini sabit sayıda kesit noktasını naifçe loft ederek hacim saymak doğru değildir.

Önerilen sonraki en küçük uygulama:

1. Sabit zone sınırları ve açık formasyon/TIN kaynak revizyonlarıyla, önce düz güzergâh/planar analitik örneklerde ayrı kazı ve dolgu bölgelerini üretin.
2. TIN yüzleri, tasarım yüzeyi, sıfır konturları ve istasyon/yan sınırları ortak XY bölümlere kırpılmalı. Pozitif/negatif bölgeler ayrı kalmalı; delikler no-data olarak korunmalı. Komşu bölümlerde ortak arayüz geometrisi aynı olmalı.
3. Ayrı alt/üst/yan kapaklarla kapalı, yönlü mesh üretin. Kenarların ters eşleri tek olmalı; sıfır alan, self-intersection, non-manifold ve komşu solid örtüşmeleri ayrıca kontrol edilmeli. Mevcut kenar testi tek başına yeterli değildir.
4. Yerel orijinli signed tetrahedron hacmi, bağımsız analitik prizma `A×L`, değişken yükseklikli kama integrali ve ayrı karma kazı/dolgu örnekleriyle doğrulanmalı. Eğri güzergâhta Jacobian `1+k×ofset`/Pappus referansları ayrıca kullanılmalı. Örneklemeyi sıklaştırmak tek başına bağımsız doğrulama değildir.
5. Kaynak/zone sınırı hacimlerinin toplamsallığı, işaretler, mesh kapanması, tolerans yakınsaması ve eksik kapsamda sonuç vermeme test edilmelidir. Tasarım yüzeyi yaklaşıksa açık hata bütçesi gerekir.
6. Solide ait kalıcı kimlik zone/tür/source lineage üzerinden verilmeli; vertex/adaptif örnek indeksinden türetilmemeli. Topoloji split/merge kimlik uzlaştırması açık olmalı. Kanonik malzeme/işlem sınıfları yeniden kullanılmalı.
7. Gelecekte work package ↔ zone ↔ P6 activity ilişkileri ayrı, çoktan çoğa kayıtlar olmalı; mühendislik motoruna tarih/aktivite alanı gömülmemeli.

Bu strateji belgelenmiştir; 03B-2B solid/hacim üretimi ve tam 4D/P6 entegrasyonu başlatılmamıştır. Bu sürüm üretime hazır hafriyat hacim hesaplayıcısı olarak sunulmaz.
