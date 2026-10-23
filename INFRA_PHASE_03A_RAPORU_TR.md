# Infrastructure Phase 03A — Terrain/TIN raporu

## A — Kapsam ve yeniden kullanılan mimari

LandXML TIN içe aktarma, kalıcı arazi kaynağı, kot sorgusu ve mevcut 3D sahnede görüntüleme tamamlandı. Shared Tool Registry, izin/onay akışı, event store, snapshot, ArtifactStore, BIM georeferansı ve mevcut malzeme/görünüm altyapısı kullanıldı. Yeni MCP sunucusu, veritabanı veya görüntüleme motoru oluşturulmadı. Phase 03B başlatılmadı.

## B — Değişen dosyalar

- `packages/infra/src/terrain.ts`: XML/TIN doğrulama, geometri, alanlar ve barycentrik sorgu.
- `packages/infra/src/terrain-tools.ts`: iki ortak kayıtlı araç ve koordinat bağlantısı.
- `packages/infra/src/module.ts`, `index.ts`, `package.json`, kök `package-lock.json`: kaynak/event entegrasyonu ve sabit fast-xml-parser 5.7.2 bağımlılığı.
- `packages/core/src/artifacts.ts`, `platform.ts`, `errors.ts`: değişmez kaynak dosyaları ve proje kapsamlı doğrulama.
- `apps/manager-mcp/src/runtime.ts`: kanonik malzeme, CRS/datum ve kaynak doğrulaması.
- `apps/web-server/src/app.ts`, `infrastructure.ts`: yükleme/indirme, birleşik sahne ve geometri önbelleği.
- `apps/web/src/TerrainPanel.tsx`, `App.tsx`, `api.ts`, `infrastructure-view.ts`, `viewer.ts`, `styles.css`: yükleme, özellikler, sorgu, görünürlük ve wireframe.
- `packages/infra/test/terrain-fixture.ts`, `terrain.test.ts`; `apps/manager-mcp/test/terrain-runtime.test.ts`, `parity.test.ts`; `apps/web-server/test/terrain.test.ts`; mevcut infrastructure-view testi: regresyon kanıtları.
- `scripts/terrain-03a-demo.mjs`: izole örnek ve sayısal doğrulama.

## C — Desteklenen format

LandXML 1.2 içindeki açık `P` noktaları ve üç köşeli `F` yüzleri desteklenir. Bağlantı korunur; yeniden triangülasyon yapılmaz. Birden fazla yüzeyde isim seçimi gerekir. Görünmez yüzler kapsamdan çıkarılır; boşluklar doldurulmaz. Resmî [LandXML 1.2 şeması](http://www.landxml.org/schema/LandXML-1.2/LandXML-1.2.xsd) noktaları Northing/Easting/Elevation sırasıyla tanımlar; INSA bunları E/N/Z olarak saklar. Uygulama tam XSD doğrulayıcısı değil, açık TIN alt kümesi doğrulayıcısıdır. CSV ertelendi.

## D — Kaynak yaşam döngüsü

Orijinal UTF-8 XML baytları proje ArtifactStore alanında SHA-256 isimli değişmez dosya olarak tutulur. Event/snapshot yalnızca küçük metadata ve kaynak referanslarını içerir; üçgen dizileri event içine yazılmaz. Kaynak değiştirme aynı TR kimliğinde revision artırır. Eski dosyalar geri alma için korunur. Okumada hash doğrulanır; önbellek bunu atlamaz. Yedekler proje exports/asset dosyalarını da içermelidir. Tekil kaynak silme/GC eklenmedi.

## E — Koordinatlar

XY ve Z birimleri ayrı ayrı kullanıcı tarafından doğrulanır. metre, foot ve USSurveyFoot desteklenir. Sessiz birim dönüşümü veya CRS reprojection yapılmaz. Kaynak/proje CRS uyumsuzluğu ve bilinen datum uyumsuzluğu engellenir. Bilinmeyen datum, açık varsayım onayı olmadıkça `comparisonReady=false` üretir. Mevcut BIM dönüşümü ve Fragments proje dönüşümü kullanılır. Yaygın coğrafi EPSG kodları engellenir; genel EPSG sınıflandırma servisi eklenmedi.

## F — TIN geçerliliği

Sonlu koordinat, kimlik/indeks, yinelenen XY ve yüzler, sıfır alan, winding, manifold kenarlar, sınır döngüleri, örtüşme ve uyumsuz T birleşimleri kontrol edilir. Winding yukarı yönlü normalize edilir; nokta konumu ve connectivity korunur. DTD/entity ve desteklenmeyen açık Boundaries reddedilir. Breakline bağımsız yeniden işlenmez; mevcut yüzler esas alınır ve kaynak korunur. Dışarıda ve deliklerde sorgu `no-data` döndürür.

## G — Sayısal doğrulama

Örnek düzlem: `Z=60+0.02*(E-412000)+0.01*(N-4561000)`.

| Kontrol | Sonuç |
|---|---:|
| Nokta / üçgen | 78 / 120 |
| Yatay alan | 150000 m² |
| 3D alan | 150037.49531367127 m² |
| Bağımsız analitik 3D alan | 150037.49531367153 m² |
| E=412025, N=4561010 kotu | 60.6 m |
| Proje yerel XYZ | 25, 10, -1.4 m |
| Dış nokta E=411990 | no-data |
| Min / max kot | 60 / 74.5 m |

Delik testinde 18 kaynak yüzden 16 görünür yüz, iki sınır döngüsü ve merkezde no-data doğrulandı. Döndürülmüş/ölçeklenmiş georeferans ve aynı dosyayı kullanan iki ayrı arazi kimliği de test edildi.

## H — UI ve MCP

`+ Arazi/TIN` ile dosya yüklenir, yüzey ve metadata doğrulanır; oluşturma ve kaynak değiştirme mevcut öneri/onay sistemi üzerinden yürür. Özelliklerde kaynak, revision, hash, alan, sınırlar, datum, wireframe ve üç koordinat uzayında kot sorgusu bulunur. Mevcut ağaçta görünürlük/seçim kullanılır.

İki araç: `infra_import_terrain` ve `infra_query_terrain`. Gerçek stdio MCP `tools/list` parity testi kayıtlarını doğruladı. Açık Codex INSA bağlantısı eski araç kataloğunu tutuyor; yeni araçların bu sohbetten çağrılabilmesi için INSA MCP bağlantısı yeniden bağlanmalı veya Codex yeniden açılmalıdır. Yapılandırma zaten doğru kaynak sunucuyu gösteriyor.

## I — Gerçek tarayıcı kanıtları

İzole örnek: http://localhost:8794/ — `road-02-demo`, TR-001. Dosya UI üzerinden yüklendi. Görünürlük, wireframe, kot sorgusu, başka sekmede onaylanan kaynak değiştirme ve otomatik yenilenme gözlendi.

- [Yükleme metadata](test-results/terrain-03a/import-metadata.png)
- [Arazi özellikleri](test-results/terrain-03a/terrain-properties.png)
- [Wireframe](test-results/terrain-03a/terrain-wireframe.png)
- [Kot sorgusu](test-results/terrain-03a/elevation-query.png)
- [Kaynak değişimi](test-results/terrain-03a/source-replaced.png)
- [Arazi tek başına](test-results/terrain-03a/terrain-alone.png)
- [Yol ve arazi](test-results/terrain-03a/terrain-road.png)
- [Mevcut tünel seçimi](test-results/terrain-03a/native-tunnel-selection.png)
- [Mevcut BIM kolon seçimi](test-results/terrain-03a/native-column-selection.png)
- [Yeniden açılmış sahne](test-results/terrain-03a/scene-reopened.png)

## J — Kalıcılık ve geri alma

Kaynak değişimi aynı TR-001 için revision 2 ve +1 m kot üretti. Onaylı undo revision 1/geometriyi geri getirdi. Diğer kaynakların geometri anahtarları değişmedi. Snapshot yükleme, yeniden açma, orijinal dosya baytları, checksum ve proje kapsamlı kaynak erişimi test edildi. Demo üretim verisine yazmaz.

## K — Test ve build sonuçları

İlgili altyapı/BIM/malzeme/parity grubu: **66/66 başarılı**. Son metadata/önbellek düzeltmelerinden sonra odaklı kernel/runtime/HTTP grubu **8/8**, döndürme ve aynı kaynaklı iki nesne HTTP testi başarılı. Typecheck, backend build ve web build başarılı. Vite mevcut büyük bundle uyarısını üretir.

Geniş mevcut regresyon grubu: **58 test; 51 başarılı, 3 mevcut hata, 4 PostgreSQL testi atlandı**. Önceden bulunan W4/W5 WALL_INTERSECTION fixture hatası, joined-wall delete dryrun preview beklentisi ve Windows `.bin/tsx` ENOENT hatası korunuyor; bunları gizlemek için assertion değiştirilmedi.

## L — Performans ve sınırlar

Yerel tek ölçüm; SLA/FPS iddiası değildir. 78/120 örnekte XML parse 9.78 ms, hazırlama 3.85 ms, birleşik sahne 138.36 ms. Arazi sahne JSON'u 2675 bayt; mevcut büyük tünelle birleşik sahne yaklaşık 15.36 MB. Bunlar tam kullanıcı yükleme/onay süreleri değildir.

8281 nokta/16200 üçgen, 652436 bayt XML: parse 102.62 ms, hazırlama 293.43 ms; mühendislik geometri JSON'u 423514 bayt. Tarayıcıda 13 GPU geometrisi ve 7 texture görüldü; kaynak değiştirme/undo sonrası sayılar sabit kaldı. Texture kaynakları mevcut önbellekle paylaşılır.

Koruma sınırları: 5 MiB XML, 20000 nokta, 40000 kaynak yüz, XML derinliği 32, 64 yüzey, 120 karakter metadata, bir milyon spatial-grid girdisi, iki milyon doğrulama aday kontrolü. Hazırlanmış kaynak önbelleği dört kayıtla sınırlıdır. Büyük dosyalar bölünmelidir.

## M — Bilinen kısıtlar

CSV/Delaunay, grading, kazı/dolgu, yol-arazi tie-in, tam LandXML/XSD ve IFC4.3 arazi export yoktur. Eski IFC export arazi/yolu açık uyarı ile hariç tutar. Geliştirme kimlik/rol sistemi yeniden kullanılır; yeni tenant ACL uygulanmadı. Kaynak yolları proje kapsamlı ve hash kontrollüdür. Eksik/bozuk dosya sessizce sahte geometriye dönüşmez.

## N — Tekrar üretme

Repo kökünde `node scripts/terrain-03a-demo.mjs prepare` ve `node scripts/terrain-03a-demo.mjs verify` çalıştırın. İzole veri kökü `test-results/terrain-03a/data` ve proje `road-02-demo` kullanılır. UI'da `test-results/terrain-03a/plane.landxml` yükleyin; EPSG:5254, metre/metre, QA datum metadata ve birim onayını doğrulayın. Var olan TR-001'i tekrar oluşturmak yerine kaynak değiştirme kullanın. Script `replace` ve `undo` modları onaylanacak öneriler oluşturur.

Sunucu için izole veri köküyle mevcut web-server başlangıcını PORT=8794 kullanarak çalıştırın. Sayısal ölçümler ve kalıcılık kanıtı [verification.json](test-results/terrain-03a/verification.json) içinde bulunur. Üretim projelerini silmeyin veya demo verisiyle değiştirmeyin.

## O — Sonraki en küçük adım

Phase 03B için önce datum/CRS karşılaştırma kapısını kullanan, sabit istasyonlarda yol tasarım kotu ile mevcut TIN kotunu yalnızca raporlayan bir kesit karşılaştırması yapılabilir. Bu sürümde otomatik kesme/doldurma veya model değişimi başlatılmadı.
