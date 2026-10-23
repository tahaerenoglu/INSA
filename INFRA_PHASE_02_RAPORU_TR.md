# INSA Infrastructure Phase 02 — Yol Koridoru V0.1

14 Ekim 2026. İzole demonstrasyon: http://localhost:8792/ — `road-02-demo`.

## A. Handoff

Mevcut `packages/infra` yatay/düşey güzergâh ve tünel motoru, BIM Core malzemeleri, Shared Tool Registry, Platform onay/geçmiş/undo, FileStores snapshot/replay, proje varlık deposu ve Fragments/Three.js görüntüleyicisi kullanıldı. Phase 01B ortak koordinatlar ve Phase 01C kanonik malzeme/PBR altyapısı korundu. Ayrı modelleme motoru, malzeme veritabanı veya MCP sunucusu oluşturulmadı. Kullanıcının mevcut bina projesine demo yazılmadı.

## B. Değişiklikler

Yeni dosyalar:

- `packages/infra/src/road.ts`: parametreler, doğrulama, örnekleme, katmanlı kapalı loft ve metraj.
- `packages/infra/src/road-tools.ts`: ortak registry için oluştur/güncelle/sorgula.
- `apps/web-server/src/road-uv.ts`: görünüm için metre tabanlı UV ve yüz grupları.
- `apps/web/src/RoadEditor.tsx`: mevcut onay akışına bağlı oluşturma/düzenleme formu.
- `packages/infra/test/road.test.ts`, `apps/manager-mcp/test/road-runtime.test.ts`, `apps/web-server/test/road-scene.test.ts`.
- `scripts/road-02-demo.mjs`, `scripts/road-02-change.mjs`, `scripts/road-02-benchmark.mjs`: izole demo, bağımsız sayısal kontrol ve ölçüm.

Değişen dosyalar:

- `packages/infra/src/module.ts`, `index.ts`: geriye uyumlu opsiyonel `roads` durumu, RoadCorridorSet olayı, yaşam döngüsü/doğrulama ve tool kaydı.
- `apps/manager-mcp/src/runtime.ts`: mevcut kanonik malzeme referansı ve silme korumasının yol katmanlarına genişletilmesi.
- `apps/web-server/src/infrastructure.ts`, `app.ts`: türetilmiş yol sahnesi, katman kaynakları, kaynak başına geometri önbelleği ve görünüm çözümleme.
- `apps/web/src/infrastructure-view.ts`, `material-appearance.ts`, `viewer.ts`: değişmeyen geometrinin korunması, ortak GPU varlıkları, UV tamponlarının yerinde güncellenmesi ve salt okunur performans tanılaması.
- `apps/web/src/App.tsx`, `styles.css`: yol formu, metraj ve katman malzeme paneli.
- `apps/web/test/infrastructure-materials.test.ts`: seçili/gizli durum, kaynak bazlı yeniden üretim ve UV tamponu regresyonları.

Kaynak durum yalnızca parametreleri ve sabit kimlikleri saklar. Meshler proje kaydının otoritatif parçası değildir. Nesne alan sırası malzeme güncellenirken değişebildiğinden geometri imzaları Core `canonicalJson` ile hesaplanır; yalnız malzeme/appearance değişimi geometriyi geçersiz kılmaz.

## C. Mühendislik modeli

Bir koridor mevcut alignment kimliğini, başlangıç/bitiş istasyonunu, kesit kontrol noktalarını ve sıralı katmanları tutar. Katmanlar sabit ID, rol, kanonik BIM materialId, düşey kalınlık ve iki tarafta `pavement`, `full` veya mutlak metre açıklığı taşır. Güncellemelerde eski kimlikler korunur; yeni katman için yeni kimlik üretilir.

İleri bakışta yerel x sağa pozitiftir. Negatif crossfall merkezden ilgili kenara doğru aşağı eğimdir. Taç kesitte iki taraf -%2; tek yön eğimde sol +%2.5, sağ -%2.5 kullanıldı. Banket aynı taraftaki eğimi izler. Kalınlık yüzeye normal değil **düşeydir**; katmanlar üstten aşağı sıralanır. Merkez kotu düşey güzergâhı izler.

Kesit istasyonları artan sırada, başlangıç ve bitişle tam eşleşir. Genişlik, banket ve crossfall arada doğrusal enterpole edilir; ani kesit atlaması yoktur. Alt katman üsttekini taşımak zorundadır. Sınırlar: 1–12 katman, 0.001–3 m kalınlık, 0.1–50 m taraf genişliği, 0–20 m banket, mutlak crossfall en fazla %15, en fazla 20 km koridor ve 5000 örnek istasyonu.

Demo tam güzergâh uzunluğu **524.9676348513074 m**:

| Aralık | Pavement sol/sağ | Banket sol/sağ | Crossfall |
|---|---:|---:|---|
| 0–200 m | 3.5 / 3.5 m | 0.75 / 0.75 m | -%2 / -%2 |
| 200–300 m | 3.5→4 / 3.5→4 m | 0.75→1 / 0.75→1 m | doğrusal geçiş |
| 300–son | 4 / 4 m | 1 / 1 m | +%2.5 / -%2.5 |

## D. Geometri

Mevcut yatay/düşey güzergâh sınırları ve tüm kesit istasyonları örneklemeye katılır. Başlangıç adımı en fazla 10 m; katman köşe noktalarının orta nokta kiriş sapması **2 mm** sınırına kadar deterministik adaptif bölünür. Yerel eğrilik Jacobianı `1+x*k` en az 0.1 olmalıdır. Keskin radyussuz yön kırıkları, katlanma ve kendisiyle kesişen plan ayak izi reddedilir.

Her katman kapalı yan yüzler ve uç kapaklar ile üretilir. Birleşimlerde tüm ilgili üst katman kenarlarının ortak yanal kolonları kullanılır. Komşu alt/üst yüzler aynı mekânsal köşegenle ters yönlü üçgenlenir; değişen genişlikte farklı köşegenlerin yarattığı ince hacim çakışması böyle engellendi. Sıfır bankette çakışık köşeler aynı halkada birleştirilir. Testler kapalı manifold, pozitif hacim, dejenere olmayan üçgenler ve ortak arayüzlerin tam üçgen eşitliğini denetler.

Dünya koordinatları → mevcut BIM proje koordinatları → Three eksenleri → gerçek Fragments koordinasyon matrisi dönüşümü çift hassasiyette yapılır; GPU Float32 dönüşümü bundan sonradır. Native BIM ve tünel aynı sahnede kalır.

Demo: 161 halka, 6118 mühendislik köşesi, 12216 mühendislik üçgeni. UV/yüz normali ayrımları için görünümde 36648 köşe kullanılır; kaynak şekli değişmez.

## E. Metraj

Otoritatif hacim `∫ t*(L+R+k*(R²-L²)/2) ds` parametrik Simpson integraliyle hesaplanır. Plan alanı bu integralin kalınlıksız halidir. Eğimli üst alan mühendislik loft üçgenlerinden ölçülür. Mesh hacmi ayrı bir yaklaşık değer olarak raporlanır; plan alanı ile gerçek üst alan karıştırılmaz.

| Katman | Düşey kalınlık | Hacim m³ | Plan alanı m² | Eğimli üst alan m² |
|---|---:|---:|---:|---:|
| Wearing Course | 0.04 m | 157.989643 | 3949.741079 | 3950.891317 |
| Binder Course | 0.06 m | 236.984465 | 3949.741079 | 3950.891317 |
| Bituminous Base | 0.12 m | 473.968929 | 3949.741079 | 3950.891317 |
| Granular Base | 0.20 m | 974.935270 | 4874.676349 | 4876.098644 |
| Subbase | 0.25 m | 1218.669087 | 4874.676349 | 4876.098644 |

İlk üç katman pavement, son ikisi full açıklıktadır. Bağımsız simetrik plan hesabı pavement için `7*200+7.5*100+8*(son-300)`, full için `8.5*200+9.25*100+10*(son-300)` kullanır. Ayrı 0.05 m orta nokta integrasyonu hacimleri sırasıyla 157.989643190, 236.984464786, 473.968929571, 974.935269988, 1218.669087485 buldu; bağıl fark 1e-6 eşiğinin altında. Eğri/asimetrik test ayrıca bağımsız analitik toplam yön açısı hesabını kullanır.

Wearing mesh hacmi 157.989521362 m³; parametrik hacimden bağıl fark yaklaşık 7.7e-7. Bu eşitlik iddiası değil, toleranslı loft yaklaşımıdır. İlk iki kesitte yalnız sol genişliği 3.5→4 m yapmak Wearing hacmini 162.972290768 m³ yaptı; bağımsız kontrol ve undo doğrulandı. Wearing kalınlığı 5 cm olduğunda 197.487053941 m³; diğer dört katman hacmi değişmedi.

Kanıt: `test-results/road-02/numerical-verification.json`, `observed-final.json` ve düzenleme gözlemleri.

## F. Malzemeler

Kanonik BIM materyalleri M-0002 Asphalt Wearing, M-0003 Asphalt Binder, M-0004 Bituminous Base, M-0005 Granular Base ve M-0006 Subbase. Referans kolon aynı M-0002 malzemesini paylaşır. Malzeme silme referans varken reddedilir; bilinmeyen proje materyali atanamaz. Tünelin eski metin fallback davranışı korundu.

Poly Haven `asphalt_01` mevcut yerel varlık deposundan tekrar kullanıldı; `bicolour_gravel` mevcut material_search/material_import üzerinden 1K olarak alındı. API adaptörü, doğrulama, dosya boyutu/tipi kontrolleri ve içerik adresli depolama korunur. Görünüm kaynak atıfları ve Powered by Poly Haven bağlantısı bulunur. Asphalt tekrar ölçeği 2×2 m, gravel 1.9×1.9 m. Basecolor doğru renk uzayıyla, normal/roughness veri dokusu olarak yüklenir; mevcut normal harita kuralları kullanılır.

UV U güzergâh merkezinin gerçek 3B mesafesi; yüzlerde V enine eğimli mesafedir. Yanlar ve kapaklar ayrı yüz gruplarındadır. 100 m, %10 boyuna eğim testi `100*sqrt(1.01)` U sonucunu doğrular. Fiziksel boyut 2→1 m olduğunda desen sıklığı iki katına çıkar; aynı geometri ve UV tamponu korunur.

Gerçek tarayıcıda 6 asset texture isteği, GPU'da toplam 7 texture (mevcut viewer dokusu dahil), 12 geometri görüldü. Malzeme ve textureSize düzenlemesinde geometri anahtarlarının tamamı, GPU geometri/texture sayıları korundu; yeni texture indirilmedi. Eksik/bozuk varlık fallback testleri geçti.

## G. UI / MCP

Ortak MCP registry içinde üç araç vardır:

1. `infra_create_road_corridor`
2. `infra_update_road_corridor`
3. `infra_query_road_corridor`

Silme mevcut infra_delete, onay/undo mevcut Platform araçlarıyla yapılır. Gerçek MCP tools/list ile Platform listesinin tam eşitliği testi geçti.

Arayüzde alignment varken **+ Yol koridoru** açılır. Mevcut alignment ve malzemeler seçilir; istasyonlar, kesitler ve katmanlar girilir. Kaynak ağacındaki koridor metraj ve düzenleme formunu açar; katman ayrı seçilebilir/gizlenebilir ve kanonik materyal atanabilir. AI değişiklikleri mevcut Öneriler panelinde onay bekler. Onay sonrası görünüm güncellenir. Tek bir yol kaynak kimliği altında katman kimlikleri korunur.

Oluşturma registry/runtime üzerinden, düzenleme ayrıca gerçek tarayıcı formuyla doğrulandı. Tarayıcı oluşturma formunun ayrı uçtan uca gönderim testi bu turda yapılmadı.

## H. Doğrulama

Son ilgili test grubu **52/52 başarılı**: şema/geometri, kesit geçişleri, hacim/alan, malzeme yaşam döngüsü, izolasyon, onaylı değişiklik ve undo, FileStores snapshot/reopen, koordinat dönüşümü, selection/visibility, PBR paylaşımı, UV tekrar ölçeği, gerçek MCP paritesi ve mevcut tünel/BIM regresyonları.

`npm run typecheck`, `npm run build`, `npm run build:web` başarılı. Vite mevcut büyük Fragments/Three.js paket boyutu uyarısını verdi.

Geniş Core/API/authoring grubu: 58 test; 51 başarılı, 3 mevcut hata, 4 PostgreSQL testi atlandı. Korunan baseline hataları: authoring W4/W5 kesişme fixture doğrulaması; joined-wall HTTP delete dryrun preview beklentisi; Windows .bin/tsx child spawn ENOENT. Bu beklentiler ve model kuralları değiştirilmedi. Portable node ile aynı önerinin ayrı süreçlerde bir kez onaylanması testi başarılı.

Gerçek tarayıcıda PBR, metraj paneli, genişlik düzenleme/onay, malzeme atama, textureSize düzenleme, undo, katman seçimi/gizleme ve reload gözlendi. Son seq64 ve geometri SHA256 `a29e9d5d4d8360923f490fbbeb8bb5499734d5fa35a795f86c573f0edbb929e9` başlangıçla aynı. Test düzenlemeleri geri alındı. Console'daki WebGL ReadPixels GPU stall uyarıları ve sunucu yeniden başlatılırken bağlantı kesilmeleri kaydedildi; yeni uygulama JS exception gözlenmedi.

Ekran görüntüleri `test-results/road-02/`:

- `corridor-inspector.png`: koridor/metraj/form.
- `road-pbr.png`: asfalt, banket ve paralel tünel görünümü.
- `width-updated.png`: gerçek UI değişikliği sonrası metraj.
- `material-reassigned.png`: gravel materyalinin Wearing üzerinde görünmesi.
- `layer-reopened.png`: reload sonrası seçili katman ve kanonik malzeme.
- `layers-visible.png`: üst üç katman gizliyken alt katman seçimi/görünürlüğü.

Tek makinede ölçülen performans:

| Sahne | Geometri üretimi | Sahne üretimi | JSON bytes | Halka | Müh. köşe / üçgen | Viewer köşe |
|---|---:|---:|---:|---:|---:|---:|
| 524.968 m demo | 47.69 ms | 89.59 ms | 15,360,081 | 161 | 6118 / 12216 | 36648 |
| 5 km düz sentetik | 84.90 ms | 178.72 ms | 5,800,068 | 501 | 19038 / 38056 | 114168 |

İlk JSON mevcut büyük tüneli de içerir; iki boyut doğrudan yalnız yol karşılaştırması değildir. Bunlar tek koşu ölçümleri, FPS veya üretim SLA'sı değildir. Kaynak mesh cache sınırı64, sahne cache sınırı8. Büyük JSON ve seam-expanded vertex maliyeti bilinen sınırlardır; yeni engine/erken optimizasyon eklenmedi.

## I. Sınırlamalar

V0.1 bir tasarım standardı onayı değildir. Arazi/TIN, cut/fill, kavşaklar, köprü, demiryolu, otomatik dever tasarımı, şerit bazlı karmaşık kesitler yoktur. Kalınlık katman boyunca sabittir; kesit geçişleri kullanıcı kontrol noktalarıyla tanımlanır. Planı kendisiyle kesişen koridor, kotları farklı olsa da reddedilir. Ayrı yollar arasındaki genel çakışma analizi bu aşamanın parçası değildir; aynı alignment üzerinde istasyon çakışması reddedilir.

Tam IFC4.3 yol export'u yapılmadı. Mevcut legacy IFC4 infra export BIM/tünel davranışını korur; yollar dışarıda kalır ve çıktı bu kaynaklar için açık warning/excluded_resources verir. Yol semantiği ve PBR dosyaları IFC materyal rengiyle eşit kabul edilmez. Viewer grid/rebase görünümü mevcut altyapıdan gelir.

## J. Yeniden üretim

Repo kökünde PowerShell:

```powershell
npm run typecheck
npm run build
npm run build:web
node --import tsx scripts/road-02-demo.mjs
node --import tsx scripts/road-02-benchmark.mjs
$env:INSA_DATA = (Resolve-Path 'test-results/road-02/data').Path
$env:INSA_APPROVAL = 'ai'
$env:PORT = '8792'
node --import tsx apps/web-server/src/index.ts
```

Demo scripti mevcut `data/temiz-proje-20261013` içindeki asphalt_01 varlığını salt okunur olarak kullanır; bu varlık başka kurulumda yoksa mevcut material_import ile önce sağlanmalıdır. İlk gravel import ağ erişimi gerektirir. Script üretim verisini değiştirmez. Veri klasörü silinmemelidir.

```powershell
node --test --import tsx packages/infra/test/*.test.ts apps/manager-mcp/test/infra*.test.ts apps/manager-mcp/test/road-runtime.test.ts apps/manager-mcp/test/parity.test.ts apps/web-server/test/infrastructure*.test.ts apps/web-server/test/road-scene.test.ts apps/web/test/infrastructure*.test.ts apps/web/test/material-appearance.test.ts packages/bim/test/material-appearance.test.ts packages/core/test/project-validation.test.ts
node --import tsx scripts/road-02-change.mjs final
```

`width`, `thickness`, `material`, `appearance`, `undo` aksiyonları test önerisi oluşturur; otomatik onaylamaz. Tarayıcı Öneriler panelinde yetkili kullanıcı onaylar. Aynı proje üzerinde eşzamanlı test düzenlemeleri çalıştırılmamalıdır.

## K. Sonraki en küçük adım

Mevcut kanonik koridordan istasyon bazlı kesit/metraj kontrol çıktısı üretmek: seçilen istasyonda katman sınırları, eğimler, materyaller ve birim uzunluk hacmi gösterilsin; çıktılar mevcut engine sonuçlarına karşı test edilsin. Bu, IFC4.3 eşleme ve gelecekteki arazi entegrasyonu öncesinde dar kapsamlı, doğrudan mühendislik QA değeri sağlayan adımdır. Bu turda sonraki faz başlatılmadı.
