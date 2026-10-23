# Infrastructure Phase 03B-1 — Yol/TIN kesit karşılaştırması

## A — Yeniden kullanılan modüller

Phase 03A raporu ve gerçek kaynaklar incelendi. Mevcut `roadEngineeringSection`, yol kesit interpolasyonu/katman sınırları, `roadGeometry` metrajları, TIN doğrulaması ve XY uzamsal indeksi, ortak proje georeferansı, Shared Tool Registry, yetkilendirme/onay, event/snapshot ve RoadInspection React/SVG paneli kullanıldı. Yeni model kaynağı, event türü, veritabanı, koordinat otoritesi veya görüntüleyici oluşturulmadı. Karşılaştırma türetilmiş ve salt okunurdur.

## B — Dosyalar

- `packages/infra/src/terrain.ts`: indeks üzerinden kesin TIN kesit profili.
- `packages/infra/src/road-terrain.ts`: uyumluluk, kot farkları ve sınırlı türetilmiş önbellek (yeni).
- `packages/infra/src/road-tools.ts`, `index.ts`: mevcut yol sorgusunun geriye uyumlu genişlemesi.
- `apps/web-server/src/infrastructure.ts`: yolun mühendislik geometri anahtarını mevcut kaynak özelliklerine ekler.
- `apps/web/src/RoadInspection.tsx`, `App.tsx`, `styles.css`: arazi seçimi, birlikte çizim, kot tablosu ve görsel kontroller.
- `packages/infra/test/road-terrain.test.ts` (yeni), `apps/manager-mcp/test/road-terrain-runtime.test.ts` (yeni), `apps/manager-mcp/test/parity.test.ts`, `apps/web/test/road-inspection.test.ts`: sayısal, runtime, MCP ve SVG testleri.
- `scripts/road-terrain-03b1-demo.mjs`: izole demo ve performans/kalıcılık doğrulaması (yeni).

## C — Çıktı modeli

Mevcut yol sorgusuna `terrain` ve isteğe bağlı `comparisonExtent:{left,right}` eklenir; karşılaştırma için `station` gereklidir. Eski yalnızca yol/istasyon/aralık çağrıları korunur. `comparison` alanı yol ve arazi kimliğini, revision/hash/version anahtarlarını, istasyon etiketini, merkez XYZ ve gerçek yatay sağ yönünü, uyumluluğu, TIN segmentlerini ve kaynak yüz/nokta kimliklerini, yol üstünü, her katmanın üst/altını, en alt kaplama sınırını, kot/fark tablosunu, no-data aralıklarını ve toleransları içerir. TIN mesh'i yanıta gönderilmez; event geçmişine karşılaştırma geometrisi yazılmaz.

## D — Koordinat ve datum kuralları

İki kaynak aynı sorgu projesinin state/asset alanından çözülür. Yolun mevcut altyapı CRS'si, TIN CRS'si ve BIM proje CRS'si eşleşmelidir. Georeferans sayıları ve yönü geçerli olmalıdır. Yolun mevcut kanonik birimi metredir; TIN XY/Z birimleri açıkça onaylı metre/foot/USSurveyFoot olabilir ve mevcut motor bunları metreye dönüştürür. Her iki mühendislik motorunun çıktısı zaten projeksiyon/map XY ve global Z metre uzayındadır; GPU/Float32 veya yerel viewer koordinatlarından kot çıkarılmaz.

Bilinen farklı datum reddedilir. Bilinmeyen ilişki açık onaylı varsayım yoksa reddedilir; varsayım varsa durum `acknowledged-assumption` ve uyarıdır, doğrulanmış uyumluluk sayılmaz. CRS reprojeksiyonu veya datum dönüşümü yapılmaz. Döndürülmüş ve ölçeklenmiş georeferanslı runtime testi, mühendislik kotlarının viewer dönüşümünden bağımsız olduğunu doğrular.

## E — Kesin TIN profili

İstasyon kesitinin yatay sağ birim vektörü ile `merkezXY + ofset × sağXY` doğrusu oluşturulur. Doğrunun TIN sınır kutusu ve mevcut grid hücre sınırlarıyla kesişimleri bulunur. Yalnızca kesilen/komşu hücrelerin üçgen adayları toplanır; her görüntüleme noktası için bütün TIN taranmaz.

Her aday görünür üçgende barycentrik yarı düzlemler kullanılarak doğru aralığı kırpılır. Kot üçgen düzlemi üzerinde doğrusaldır; tüm üçgen giriş/çıkış kırılmaları korunur. Ortak kenardaki sahiplik kaynak yüz numarasıyla deterministiktir. Boş aralıklar ayrı tutulur; delik veya dış alan üzerinden çizgi çekilmez. Sabit adımlı yaklaşık örnekleme, yumuşatma veya yeni triangülasyon yoktur. Ofset toleransı 1e-8 m; sayısal sınır yuvarlanması segment uçlarına kırpılır. Geçerli segmentlerde doğrusal süpürmeyle kot eşleştirilir.

## F — Kot farkı anlamı

`deltaZ = yol üst kotu − mevcut zemin kotu`. Pozitif üstünde, negatif altında demektir. Eşitlik toleransı 1e-8 m olarak bildirilir; hesaplar Float64'tür. En alt modellenmiş kaplama sınırının farkı ayrıca verilir. Katman kalınlıkları düşeydir; kesit yatay enkesit ofseti/global düşey kot kullanır. Formasyon/subgrade referansı tanımlanmamıştır ve `unavailable` döner. Bu değerler otomatik kazı/dolgu derinliği ya da hacmi değildir.

## G — Bağımsız sayısal doğrulama

Analitik TIN: `Z=60+0.02×localX+0.01×localY`. Düz, yatay 61 m yolunda merkez başlangıç farkı +1 m, X=10 m farkı +0.8 m olarak doğrulanır. Testler ayrıca düşey eğim, iki farklı crossfall, 3→5 m genişlik interpolasyonu, 250 m istasyonu ve bağımsız dairesel yay XY formüllerini kontrol eder. Düzlemsel olmayan bir hücrenin iki üçgeni, ofset 5 m'deki gerçek kot kırılmasıyla doğrulanır. Delik, dış kapsam, ortak kenar, feet/survey feet, CRS/datum reddi ve açık datum varsayımı test edilir.

Mevcut demoda merkez değerleri:

| İstasyon m | Mevcut zemin m | Yol üstü m | ΔZ m |
|---:|---:|---:|---:|
| 0 | 60.200000 | 62.000000 | +1.800000 |
| 100 | 62.200000 | 63.200000 | +1.000000 |
| 200 | 64.206577 | 64.400000 | +0.193423 |
| 250 | 65.266865 | 64.742857 | -0.524008 |
| 300 | 66.370619 | 64.571429 | -1.799191 |
| 524.967635 (son) | 71.400000 | 62.643135 | -8.756865 |

## H — UI ve MCP

İzole demo [localhost:8795](http://localhost:8795/), proje `road-02-demo`. Yol seçilip Özellikler içindeki **Karşılaştırma arazisi** alanından TR-001 seçilir; istasyon metre veya `Km 0+250` girilebilir. Mevcut SVG paneli yeşil zemin, mavi yol üstü, kahverengi kesikli kaplama altı ve katman sınırlarını gösterir. Gerçek ofsetlerde kot/fark tablosu, revision/hash, datum ve no-data aralıkları vardır. Zemin görünürlüğü ve 1/5/10× düşey gösterim yalnızca görseldir. Büyük diyalogda aynı kesit/tablo bulunur.

Yeni MCP aracı eklenmedi. Gerçek stdio `tools/list` parity testi, `infra_query_road_corridor` şemasında iki isteğe bağlı alanı ve eski `required:[road]` sözleşmesini doğrular. Örnek:

```json
{"road":"RD-001","station":"Km 0+250","terrain":"TR-001"}
```

Açık Codex bağlantısı eski araç kataloğunu tutabiliyor; yeni isteğe bağlı alanları görmek için INSA MCP bağlantısı yeniden bağlanmalıdır. Üretim için ayrı MCP sunucusu oluşturulmadı.

## I — Gerçek tarayıcı kanıtları

gstack `/browse` ile gerçek uygulama kullanıldı, görüntüler incelendi:

- [Son kesit, renkler ve kot tablosu](test-results/road-terrain-03b1/section-final.png)
- [250 m kesiti](test-results/road-terrain-03b1/section-250.png)
- [5× düşey gösterim](test-results/road-terrain-03b1/exaggeration-5.png)
- [TIN değişimi sonrası otomatik yenilenme](test-results/road-terrain-03b1/terrain-replaced.png)
- [Undo sonrası kotlar](test-results/road-terrain-03b1/undo-values.png)
- [No-data kapsamı](test-results/road-terrain-03b1/no-data.png)
- [Reload sonrası](test-results/road-terrain-03b1/reloaded.png)

TR-002 `Limited coverage` sadece izole demo içinde no-data kontrolü için eklendi. 250 m kesitinde zemin/fark no-data kalırken yol kotları görünür. Zemin checkbox'ı kapatıldığında SVG zemin grubu sayısı sıfır oldu; yeniden açıldı. 5× gösterimde hesap kotları değişmedi.

## J — Kalıcılık, güncellemeler ve undo

Yol genişliği ve kalınlığı için onaylı edit/undo; TIN +1 m kaynak değiştirme ve undo; snapshot/reopen; malzeme ve ilgisiz BIM değişimlerinde aynı mühendislik sonuçları test edildi. Sorgular event sırasını artırmaz. Mevcut SSE/refresh kaynak özelliklerini yeniler; yol geometri anahtarı, seçili TIN metadata ve istasyon UI sorgusunu tetikler. Eski async yanıtlar effect cleanup ile elenir.

İkinci sekmede onaylanan kaynak değişimi ilk sekmede refresh olmadan revision 2, merkez EG=66.2669 ve ΔZ=-1.5240 gösterdi. Undo revision 1, EG=65.2669 ve ΔZ=-0.5240 değerlerini geri getirdi. Reload ardından seçim yapıldığında aynı sonuç üretildi. Ayrı tarayıcı testinde eski TR-002 yanıtı 15 saniye geciktirildi; yeni TR-001 yanıtı önce geldi ve eski yanıt serbest kaldıktan sonra da TR-001 sonucu korundu.

Önbellek 64 türetilmiş sonuçla sınırlı; anahtar proje, mühendislik yol/alignment hash'i, TIN kimliği/revision/geometri imzası, georeferans, istasyon ve kapsamı içerir. Malzeme görünümü ve ilgisiz BIM state'i anahtara girmez. Kaynak checksum doğrulaması önbellek tarafından atlanmaz.

## K — Gerçek test ve build sonuçları

Değişiklik öncesi ilgili grup **66/66** ve typecheck/web build başarılıydı. Genişletilmiş ilgili grup **72/72** başarılı: arazi motoru, yol/enkesit/metraj, koordinatlar, runtime, MCP parity, onay/undo, reopen, BIM malzeme/PBR ve SVG regresyonları. Son doğrusal süpürme iyileştirmesi sonrası ilgili 5 sayısal/runtime test yeniden geçti; son UI/MCP kontrolleri 3/3 geçti. `npm run typecheck`, `npm run build`, `npm run build:web` başarılı. Mevcut Vite büyük bundle uyarısı sürüyor.

Kapsam dışı geniş testler de çalıştırıldı; tamamı geçti denmiyor:

- Core + API + HTTP authoring + authoring-scenario: **60 test, 51 başarılı, 4 başarısız, 5 atlanan**. Hatalar: joined-wall dryrun `preview` beklentisi; HTTP fixture'da WALL_INTERSECTION; scenario'da DUPLICATE_WALL_JOIN; Windows `.bin/tsx` ENOENT. [Ham kayıt](test-results/road-terrain-03b1/broad-tests.log).
- Ek mevcut `packages/bim/test/authoring.test.ts`: **15 test, 3 başarılı, 12 başarısız**; eski join/hosted wall fixture beklentileri. [Ham kayıt](test-results/road-terrain-03b1/authoring-tests.log).

Önceki Phase 03A raporundaki 58/3/4 sayıları bu farklı geniş test seçimlerinin yerine kullanılmadı. Bu aşamada BIM authoring kuralları veya assertion'lar değiştirilmedi; bu hatalar karşılaştırma özelliği kapsamında giderilmedi.

## L — Performans

Yerel ölçüm; SLA veya FPS iddiası değildir. 250 m tam mevcut yol sorgusu (mevcut metraj hesabı dahil) yaklaşık 55.8 ms; altı demo istasyonu 43.5–85.7 ms. Karşılaştırma JSON'u yaklaşık 8.3–11.4 KB. Tüm TIN gönderilmez.

Phase 03A büyük fixture: **8281 nokta / 16200 üçgen**. 250 m kesiti 32 aday üçgen, 4 gerçek üçgen aralığı kullandı. İlk ölçüm toplam karşılaştırma 0.239 ms, TIN profil hazırlama 0.119 ms; 30 tekrar ortalaması yaklaşık 0.16 / 0.09 ms, toplam aralık 0.12–0.43 ms. Sonuç yaklaşık 11.7 KB. Bunlar önceden hazırlanmış TIN üzerinden ölçülür; XML parse/import süresi dahil değildir.

Gerçek tarayıcıda otomatik yenileme yol sorgusu HTTP yanıt süreleri 255.7 ms (replacement) ve 147.6 ms (undo) görüldü. Bunlar tam SSE→paint gecikmesi veya UI performans garantisi değildir; uçtan uca paint zamanı ölçülmedi. [Sayısal/performans kayıtları](test-results/road-terrain-03b1/verification.json).

## M — Sınırlar

Kapsam en çok her yanda 1000 m, toplam 2000 m; TIN çıktı profili en çok 4000 segmenttir. Büyük/sık kırılmalı kesitler için kapsam azaltılmalıdır. Mevcut Phase 03A kaynak/indeks limitleri korunur. UI şu anda varsayılan yol/layer genişliği kadar karşılaştırır; genişletilmiş kapsam API/MCP parametresidir. İstasyon/tercihlerin sayfa yenilemesinden sonra yeniden seçilmesi gerekir; sonuçlar yeniden aynı otoriter kaynaklardan hesaplanır.

CSV, grading, formasyon tasarımı, daylight, şevler, istinat, kazı/dolgu hacimleri, TIN/yol geometri değişimi, reprojeksiyon ve IFC4.3 export uygulanmadı. Mevcut yol miktarları yalnızca kendi önceki anlamıyla gösterilir; zemin hacmi olarak yorumlanmaz. Geliştirme oturum/rol sistemi yeniden kullanıldı; yeni tenant ACL eklenmedi.

## N — Tekrar üretme

Repo kökünde, yeni demo klasörü yoksa:

```powershell
New-Item -ItemType Directory -Force test-results/road-terrain-03b1
Copy-Item -LiteralPath test-results/terrain-03a/data -Destination test-results/road-terrain-03b1/data -Recurse
node --import tsx scripts/road-terrain-03b1-demo.mjs prepare
node --import tsx scripts/road-terrain-03b1-demo.mjs coverage
node --import tsx scripts/road-terrain-03b1-demo.mjs verify
$env:INSA_DATA=(Resolve-Path test-results/road-terrain-03b1/data).Path
$env:INSA_APPROVAL='ai'
$env:PORT='8795'
node --import tsx apps/web-server/src/index.ts
```

Var olan demo klasörünün üzerine tekrar Copy-Item yapmayın. Node `fs.cpSync` bu Windows/OneDrive ortamında native çıkış hatası verdiği için script açık PowerShell kopyası ister. Önceki örnek veya üretim verileri değiştirilmez.

UI'da Taha ile giriş, RD-001 → Özellikler → TR-001 → `Km 0+250`. TR-002 seçimi no-data üretir. `node --import tsx scripts/road-terrain-03b1-demo.mjs replace` ve `undo` komutları öneri oluşturur; ikinci UI sekmesinde onaylayıp ilk sekmeyi gözlemleyin. Üretim verilerinde çalıştırmayın.

## O — Phase 03B-2 için en küçük adım

Önce açık mühendislik formasyon/subgrade referansı ve onaylı kuralları tanımlanmalı; sonra bu kesin TIN kesitlerine karşı daylight/kazı-dolgu geometrisi geliştirilebilir. Kaplama altı otomatik formasyon sayılmamalıdır. Bu sonraki aşama başlatılmadı.
