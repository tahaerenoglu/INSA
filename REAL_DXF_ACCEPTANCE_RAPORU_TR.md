# Gerçek Demiryolu DXF — Mühendislik Kabul Testi

15 Ekim 2026. **İçe aktarma ve seçili kaynak katmanlarının görüntülenmesi doğrulandı. Mühendislik durumu: requires-engineering-review. Kanonik model oluşturulmadı.**

Kullanıcının açık kararı: “Birim belirsiz kalsın; kanonik model oluşturma.” Bu karar uygulandı. İzole [test sunucusu 8802](http://localhost:8802/), proje `real-railway-dxf-acceptance`; veriler yalnız `test-results/real-dxf/data` altında. Mevcut kullanıcı projeleri değiştirilmedi.

## A. Orijinal DXF yükleme sonucu

`Drawing1.dxf` belirtilen Masaüstü konumunda ve Masaüstü alt klasörlerinde bulunmadı. Gerçek yolu soruldu; kullanıcı yine filtrelenmiş dosyanın yolunu bildirdi. Dolayısıyla **orijinal dosyaya ait yükleme/bellek sonucu yoktur**. Talepteki 10,32 MiB / 38.926 entity / 89 katman bilgisi bu çalışmada orijinalden yeniden ölçülmüş gibi sunulmaz.

Mevcut güvenlik sınırları korunuyor: 10 MiB kaynak, 10.000 model-space entity, 20.000 kayıt, 10.000 expanded entity, 8 INSERT derinliği, 50.000 geometri parçası, polyline başına 5.000 vertex; ASCII/UTF-8 ve immutable checksum zorunlu. Orijinal gerçekten 10,32 MiB ise byte sınırını aşması beklenir; bu **öngörüdür, gerçekleştirilmiş yükleme deneyi değildir**. Orijinal için streaming seçili-katman import geliştirilmedi; mevcut filtrelenmiş dosya import sınırlarına sığdı.

## B. Filtrelenmiş test kopyası

Kaynak: `C:/Users/terenoglu/OneDrive - Kalyon Yatırım Holding A.Ş/Masaüstü/Drawing1_INSA_on_test.dxf`.

- **2,423,497 byte / 2.3112 MiB**.
- SHA-256: `2d31cc8a1bae9607433126db92a7c3a9ac9c2a853f437b08c4a1c32e1e3a8749`.
- Başlık: **AC1032**, AutoCAD 2018 DXF; **$INSUNITS=4**, parser sonucu `millimeter`.
- Ham tag envanteri ve mevcut INSA parser: **4.765 model-space entity, 19 katman**.
- 2.234 LWPOLYLINE, 576 LINE, 309 ARC, 485 TEXT, 1.161 MTEXT. Bu kopyada INSERT yok.
- Parser çıktısı: **26.574 geometri parçası**. Kusurlu entity'lerin çıkarılabilen kısımları bu sayıda bulunabilir; hepsi tam/geçerli kabul edilmedi.

Gstack dosya yükleyicisi çalışma alanı dışından upload kabul etmediği için test alanına byte özdeş kopya alındı, SHA karşılaştırıldı. Gerçek tarayıcı file input → POST cad-source → mevcut infra_review_cad register akışı kullanıldı. HTTP 200, sunucu süresi **206.825 ms**. Kaynak küçültülmedi; katman/entity çıkarılmadı. ArtifactStore kopyası kaynak byte'larıyla birebir karşılaştırıldı.

## C. Okunabilen / desteklenmeyen nesneler

**4.533 tam desteklenebilir entity; 232 kusurlu/destek dışı entity**:

| Tanı | Adet |
|---|---:|
| Desteklenmeyen extrusion bağlamı | 137 ARC |
| Sıfır uzunluklu kaynak parçası | 94 LWPOLYLINE + 1 LINE |

Kusurlu kaynak sessiz onarılmadı. Parser'ın genel “Non-planar DXF geometry/extrusion unsupported” mesajı her ARC fiziksel olarak 3B'dir diye yorumlanmadı: eksendeki **1414A ve 1414C**, z=0 fakat `(0,0,-1)` OCS normaline sahip. Mevcut okuyucu bunu desteklemiyor; yanlış yönlü yay çizilmedi veya normal değiştirilmedi.

Ham tag'lardan bağımsız chord/açı hesabıyla **271 kontrol** yapıldı: **172 standart ARC + 99 bulge arc**. Destek dışı entity'ler bu kontrole dahil değil. Yarıçap/sweep/uç/çember artıklarının en büyüğü **1.410e-11 çizim birimi**. Sonuçlar `independent-geometry.json`; metre diye adlandırılmadı.

## D. Güzergâh ekseni adayları

`0_Prj_Eksen`: 94 entity = 78 LINE, 13 LWPOLYLINE, 2 ARC, 1 MTEXT. Çıkarılabilen parçalar **2.683 line + 66 bulge arc**. İki ARC destek dışı, iki polyline sıfır parça tanısı taşıyor.

Uç noktaları yalnız **1e−6 çizim birimi** toleransıyla gruplayan salt okunur analiz **86 bağlı bileşen** buldu. Bu, 86 gerçek demiryolu güzergâhı demek değildir; kısa yardımcı işaretler/yapı parçaları olabilir. Kaynak snapping/onarım yapılmadı; sırf çizgiler kesişiyor diye bağlantı üretilmedi. Desteklenmeyen yaylar nedeniyle bu grafik kaynak topolojisinin tamamı değildir.

| Aday | Handle'lar | Uzunluk (çizim birimi) | LINE / bulge ARC | Tanı |
|---|---|---:|---:|---|
| AX-01 | 1414D, 142C6, 142C7 | 60675.226350 | 1156 / 27 | Kaynak geometri tanısı yok; mühendislik onayı yok |
| AX-02 | 14153, 14155, 142C5 | 60150.847052 | 1221 / 28 | Kaynak geometri tanısı yok; mühendislik onayı yok |
| AX-03 | 1414B, 1414E | 2175.400356 | 2 / 0 | Kaynak geometri tanısı yok; mühendislik onayı yok |
| AX-04 | 1414F | 2000.796817 | 38 / 1 | Kaynak geometri tanısı yok; mühendislik onayı yok |
| AX-05 | 14156 | 1310.721357 | 50 / 2 | Zero-length source segment. |
| AX-06 | 14158 | 1259.808086 | 47 / 2 | Zero-length source segment. |
| AX-07 | 14154 | 915.502694 | 85 / 2 | Kaynak geometri tanısı yok; mühendislik onayı yok |
| AX-08 | 141A0 | 596.674403 | 2 / 1 | Kaynak geometri tanısı yok; mühendislik onayı yok |
| AX-09 | 1418B | 571.515841 | 1 / 0 | Kaynak geometri tanısı yok; mühendislik onayı yok |
| AX-10 | 141A2 | 539.979067 | 2 / 1 | Kaynak geometri tanısı yok; mühendislik onayı yok |
| AX-11 | 14149 | 390.263880 | 2 / 0 | Kaynak geometri tanısı yok; mühendislik onayı yok |
| AX-12 | 141A1 | 353.141759 | 2 / 1 | Kaynak geometri tanısı yok; mühendislik onayı yok |
| AX-13 | 1418A | 324.962916 | 2 / 1 | Kaynak geometri tanısı yok; mühendislik onayı yok |
| AX-14 | 14189 | 291.715555 | 1 / 0 | Kaynak geometri tanısı yok; mühendislik onayı yok |

86 adayın tamamı, uç koordinatları ve handle'ları `axis-candidates.json` içinde. Desteklenebilir uç grafiğinde degree>2 dal yok; dosyanın tamamında kavşak yoktur iddiası değil. AX-01/AX-03 en yakın uçları yaklaşık **199,933615**, AX-02/AX-03 uçları **436,218240 çizim birimi** ayrık; eksik yay/geçiş diye birleştirilmedi.

İki büyük zincir çok noktalı polylineler içeriyor. Eğri görünüşlü ardışık chord'lar klotoid ilan edilmedi. Gerçek bulge-yaylar ayrı dairesel kaynak olarak tutuldu. Tüm katman tek alignment kabul edilmedi; bütün adaylar **requires-engineering-review**.

## E. TS/SC/CS/ST ve kilometraj

**58 TS, 58 SC, 58 CS, 58 ST = 232 geçiş etiketi**; ayrıca **367 KM=** ve **147 diğer km+metre ifadesi** çıkarıldı. Bunlar yazı örnekleridir, benzersiz proje noktası sayısı değildir. Handle/layer/raw/yerleşim ve işaretli değerler `station-labels.json` içinde.

İki büyük zincire 300 çizim biriminden yakın etiketler analitik doğru/yay üzerine **yakınlık hipotezi** olarak projekte edildi (`station-proximity.json`). 214 geçiş etiketi bu aralıkta; bu, onaylı TS/SC/CS/ST eşleşmesi değildir. Örneğin 133DA “TS =-0+301.86” eksenden yaklaşık 166,385 çizim birimi uzak; yazı konumu gerçek TS noktası yapılamaz. L/A/R klotoid parametreleri üretilmedi.

Önemli gerçek bulgu: AX-01 çevresinde **13CC6 “31+551” → 13CC7 “0+000”** var (`station-resets.json`). Aynı zincir çevresinde farklı kilometraj sistemleri bulunabiliyor. Tek offset veya chainage fit edilmedi. Avrupa/Anadolu section başlangıç/son yazıları var; buradaki section kelimesi enkesit kanıtı değil.

Gerçek veride bulunan mevcut parser hatası düzeltildi: `-0+453` eskiden +453 olabiliyordu. Artık −453; `KM=-0+452.560` → −452.56; `-1+250,50` → −1250.5. Kaynak metni değişmedi. TS/SC anlamlı yazıları kendiliğinden station onayı almaz. Regresyon testi eklendi.

## F. Birim / koordinat tutarlılığı

Başlık mm, kaynak kilometraj/geometri karşılaştırması metre hipotezini kuvvetle destekliyor:

- **13622 “14+000” → 13624 “15+000”**: Δetiket=1000 m, kaynak projeksiyonları arası **1000,000329276 çizim birimi**. Yazılar eksenden yaklaşık 5,06 / 5,05 çizim birimi uzak; ilişki hâlâ hipotez.
- 1 birim=1 m hipotezi farkı ≈0,000329 m.
- Başlıktaki mm uygulanırsa mesafe ≈1,000000329 m; fark ≈−999 m.
- AX-01'de 59, AX-02'de 57 komşu yaklaşık 1 km çifti için iki hipotez ayrı karşılaştırıldı. Yakınlık onaylı station bağı yapılmadı.

Bu somut çelişki kullanıcıya sunuldu. Kullanıcı **birimi belirsiz bırakmayı ve kanonik model oluşturmamayı** seçti. **CRS=null, georeference=null**; EPSG, datum, origin, ölçek veya yeni chainage atanmadı. Kaynak koordinat sınırları aynen **[71.21183592652687, 624.060366909614, 96242.4030334111, 59823.19470539508]**. Viewer'ın mevcut ekran rebasing'i yalnız GPU/görünüm içindir; mühendislik kaynağına yazılmadı.

## G. Tünel / menfez / köprü bilgileri

**332 yapı türü içeren metin örneği**: 188 tünel, 127 köprü, 4 viyadük, 13 menfez. Bunlar benzersiz yapı sayıları değildir; tekrar/çift hat/start-end yazıları var. İsim/numara adayı, aynı yazıdaki KM/L/boyut, raw, handle/layer/yerleşim koordinatı ayrı tutuldu. Yakın KM yazıları kesin bağlanmadı. 64 yazıda aynı metin içinde KM, 128 yazıda metre cinsinden L bulundu.

| Handle | İsim/numara adayı | Aynı yazıda KM | Aynı yazıda L | Boyut yazısı |
|---|---|---|---|---|
| 13F93 | CULVERT-9A | KM=53+509.000 | Yok | 2.00x2.00 |
| 13FB3 | TUNNEL 1B-2 | KM=14+339.607 | Yok | Yok |
| 13FB4 | TUNNEL 1C-2 | KM=15+145.217 | Yok | Yok |
| 13FA2 | TUNNEL 1C-2 | Yok | L= 2723.312 m | Yok |
| 13FBB | BRIDGE-5 | Yok | L=1100.00 m | Yok |
| 14135 | VIADUCT-B | Yok | L=725.00 m | Yok |

Tam liste `structures.json`; katman referansları her kayıtta bulunuyor. CULVERT-9A, KM=53+509.000, 2.00x2.00 yalnız **etiket kanıtıdır**; menfez üretilmedi. TUNNEL 1C-2 için L=2723.312 m yazısı, eksen Z/kesit/kaplama geometrisi yerine geçmez. Tekrarlar sessiz birleştirilip gerçek yapı sayısı üretilmedi.

## H. Boykesit / enkesit yeterliliği

Kalibre edilebilir boykesit/enkesit **doğrulanamadı**. `00_Tunel_Profil` yalnız **12ADA–12ADD** dört kısa LINE içeriyor; farklı plan konumlarında yaklaşık 2–8 çizim birimi uzunlukta. Station/elevation eksenleri, datum, kalibrasyon ve sürekli kırmızı profil kanıtlanmadı. Bu çizgilerden PVI veya TIN üretilmedi.

Bu, bulunmayan orijinalin kesit içermediği iddiası değildir; **filtrelenmiş kopyada yeterli kanıt yok**. D2A-DWG-03A enkesitten yol testi **yapılmadı/başarılı değil**. Gereken ek kaynaklar: gerçek boykesit + station/kot ölçeği/datum; gerçek enkesitler + istasyon/offset/kot/lane/shoulder; geçişler için yeterli doğrulanmış tasarım parametreleri/kontrol tablosu.

## I. Gerçek kanonik model sonucu

**Oluşturulmadı.** Salt okunur analiz, onaylı canonical preview/convert diye sunulmadı. Birim ve CRS onaylanmadığı için canonical dönüşüm önizlemesi de üretilmedi. Z bilinmiyor; sıfır kot/PVI uydurulmadı.

Gerçek kaynakta doğrulananlar: HTTP/registry import; byte/checksum özdeşliği; read-only sorguda seq sabitliği; başka proje erişiminin reddi; geçici **unclassified/kalibrasyonsuz** kaynak taslağı → undo; snapshot → yeni Platform ile aynı kaynak/BIM durumu. Kaynak byte'ları undo sonrası korunuyor. **0 alignment, 0 BIM element**. Kanıt: `verification.json`, `verify.log`.

Gerçek kanonik model üzerinde selection/station/save/undo yapılmış gibi raporlanmaz. z:null / eksik düşey davranışı mevcut 02A/02B regresyonlarında korunur; bu dosyaya ait gerçek station sonucu gibi sunulmaz.

## J. Gerçek tarayıcı görüntüleri ve düzeltmeler

Gstack /browse ile gerçek arayüz; ekranlar görsel olarak açılıp incelendi:

| Kanıt | Dosya (test-results/real-dxf altında) |
|---|---|
| Tam import ve açık bütçe uyarısı | 01-import-budget.png |
| İlk kamera problemi | 02-axis-km-3d-source.png |
| Ara kamera kontrolü | 03-fixed-large-extent-view.png |
| Kaynak eksen/KM katmanları gerçekten görünür | 04-real-source-visible.png |
| Son sunucu yeniden açma | 05-reopen-source.png |

Gerçek veriyle bulunan ve düzeltilenler:

1. **Büyük tam görünüm**: SVG/GPU yaratılmadan 5.000 parça / 150.000 çizim noktası bütçesi. Aşımda **hiç çizilmez** ve açık sayı/limit mesajı gösterilir; kaynak sessiz kırpılmaz. Import limitleri ayrı ve aynı. Katman temizleme sonrası eksen+KM açık seçimi **3.753 parçayı** aynen görüntüler. “Kaynağı mevcut 3D görünümde göster” artık seçili katmanlara uyar. Destek dışı/kusurlu entity sayısı panelde gösterilir.
2. **Büyük kaynak görünmüyordu**: kurulu SimpleCamera far=1000 ve OrbitMode maxDistance=300 kaynak boyutunu karşılamadı (kurulu @thatopen/components index.mjs, setupCamera/activateOrbitControls). Mevcut shared kameranın bu iki sınırı fit kutusunun boyutuna göre genişletildi. Yeni kamera/renderer veya kaynak ölçeklendirmesi yok. Son screenshot gerçek kaynak görünürlüğünü kanıtlar.

Native ölçüm: **3753 line nesnesi / grid dahil 3754 GPU geometry ve draw call**. Son aktif oturum/kaynak görüntüleme konsolu: **no console errors**. Sunucunun yeniden başlatılması sırasında bir bağlantı reseti ve eski oturumdan iki 401 kaydı ayrıca browser-console-restart.txt içinde korunuyor; yeniden girişten sonra kaynak akışı tekrar ölçüldü. Bu görüntü kaynak çizim bağlamıdır; mühendislik 3B/Z modeli değildir. Genel görünümde ufak boşlukların gözle seçilmemesi geometride birleştirildikleri anlamına gelmez.

## K. Performans / testler

| Ölçüm | Değer |
|---|---:|
| Dosya okuma + mevcut parser | 133.848 ms |
| Parser proses RSS artışı | 120.15 MiB |
| Heap artışı | 73.90 MiB |
| Parser proses peak RSS | 202.14 MiB |
| Gerçek HTTP upload | 206.825 ms |
| Web working set, önce/sonra | 168.31 / 384.89 MiB |
| Gözlenen web peak working set | 399.89 MiB |

Web ölçümü upload, JSON ve sonraki sorguları birlikte içerir; yalnız parser'a atfedilmez. Tek makine/tek ölçüm; FPS garantisi yok. Draw call sayısı yüksek; gelecekte ID bazlı batching değerlendirilebilir. Geometri sadeleştirilmedi.

| Paket | Gerçek sonuç | Log |
|---|---|---|
| İlk source/horizontal/vertical/UI/HTTP odaklı | **27/27**, 0 skip | focused.log |
| Son source/UI hedefli | **14/14**, 0 skip | final-targeted.log |
| Seçili mühendislik regresyonu | **128: 126 geçti, 2 başarısız**, 0 skip | regression.log |
| Road/TIN dosya hatası tekrar + 02B runtime | **6/6**, 0 skip | runtime-retry.log |
| Bağımsız gerçek ARC/bulge | **271/271** | independent-geometry.json |
| Gerçek source/query/undo/snapshot | geçti | verify.log |
| Typecheck, backend ve web build | geçti; mevcut büyük bundle uyarısı | typecheck.log, build-backend.log, build-web.log |

Paketler örtüşür, toplanmamalıdır. İki regresyon hatası Windows **proposals.json rename EPERM** ve bilinen **symlink EPERM**. Road/TIN ayrı tekrar geçti. Assertion kaldırılmadı veya skip yapılmadı. Tüm repository testleri yeşil iddiası yok.

## L. Engeller ve çözüm sırası

1. Orijinal Drawing1.dxf ayrıca temin edilmeli; şu an yalnız filtrelenmiş kopya var.
2. Header mm / metre hipotezi kaynak sorumlusuyla çözümlenmeli. Kullanıcının belirsiz bırakma kararı yürürlükte.
3. AX-01/02, ara parçalar, proje bölümleri ve 31+551→0+000 sıfırlaması doğrulanmalı; yakınlık station bağı sayılmamalı.
4. Negatif-Z OCS için doğrulanmış okuyucu desteği veya kaynaktan doğru WCS export; sıfır parçalar için kaynak açıklaması/düzeltmesi; tessellated geçişler için gerçek tasarım parametreleri gerekir. Hiçbiri sessiz yapılmamalı.
5. Boykesit ve enkesit, kalibrasyon/datum referanslarıyla ayrıca sağlanmalı. D2A-DWG-03A ancak sonra denenebilir.
6. Birim/CRS/chainage/kapsam doğrulanıp kullanıcı onaylarsa mevcut governed preview→create→native station→undo/snapshot akışı gerçek kaynakta çalıştırılmalı.

4D/P6/scheduling/maliyet, yeni CAD motoru veya yol/tünel/menfez üretimi yapılmadı.

### Değişen kod ve tekrar üretme

- packages/infra/src/cad-source.ts ve test/cad-source.test.ts: negatif sıfırlı kilometraj düzeltmesi/regresyon.
- apps/web/src/cad-display-budget.ts: açık sunum bütçesi.
- apps/web/src/CadInterpretation.tsx ve test/cad.test.ts: büyük kaynak güvenliği, görünür tanı ve katman seçimi testi.
- apps/web/src/viewer.ts: aynı kamerada büyük kaynak kadraj sınırları.
- scripts/real-dxf-inspect.mjs, real-dxf-topology.py, real-dxf-structures.py, real-dxf-geometry.py: mevcut parser/raw tag üzerinde salt okunur kabul analizi; yeni yetkili geometri deposu değil.
- scripts/real-dxf-demo.mjs, real-dxf-verify.mjs: yalnız izole source-only proje/kayıt testi.

```powershell
node --import tsx scripts/real-dxf-inspect.mjs 'test-results/real-dxf/Drawing1_INSA_on_test.dxf'
python scripts/real-dxf-topology.py
python scripts/real-dxf-structures.py
python scripts/real-dxf-geometry.py
node --import tsx scripts/real-dxf-verify.mjs
node --test --import tsx packages/infra/test/cad-source.test.ts apps/web/test/cad.test.ts
npm run typecheck
npm run build
npm run build:web
```

İzole proje ve browser source upload önce yapılmalı. real-dxf-demo.mjs yalnız proje adı oluşturur, georeference/model oluşturmaz. Kaynak test kopyası ve JSON/PNG/log kanıtları `test-results/real-dxf` altındadır. Native DWG/orijinal büyük dosya kapasitesi geliştirilmedi.
