# INSA malzeme görünümü ve Poly Haven V0.1

## Denetim

- Kanonik kaynak `Material { id, name, color?, category? }` idi. Katmanlı tipler `layers[].material`, kolon/kiriş/bileşen tipleri `material` alanıyla aynı kimliği kullanıyor. Yeni malzeme veritabanı veya modelleme motoru eklenmedi.
- Kaynak değişiklikleri mevcut `MaterialCreated`, `MaterialUpdated`, `MaterialDeleted` olaylarından geçiyor. Undo, replay ve JSON snapshot mevcut nesneyi saklıyor. Opsiyonel `appearance` ek alanı eski olayları/snapshotları geçersiz kılmıyor; yeni olay sürümü gerekmiyor.
- IFC mevcut `IfcMaterial`, katman kümeleri/kullanımları ve `IfcRelAssociatesMaterial` ilişkilerini sürdürüyor. PBR haritaları IFC rengiyle eşitlenmiyor; görünüm tanımı IFC'ye yazılmıyor.
- Gerçek kurulu sürümler: Fragments 3.4.7, Components 3.4.8, Components-front 3.4.4, Three.js 0.186.1.
- Fragments `MaterialDefinition` renk/opacity sunuyor; PBR map/metalness/roughness veya UV alanı yok. `MeshData` positions/indices/transform sunuyor. Bu yüzden resmi `getItemsGeometry` üzerinden alınan aynı üçgenler mevcut OBC World içinde standart Three.js malzemeleriyle çiziliyor. Kaynak IFC/BIM geometri verileri değiştirilmiyor.

## Uygulama

`Material.appearance` semantik alanlardan ayrı, aynı kararlı `Material.id` üzerinde saklanan doğrulanmış bir görsel tanımdır:

```json
{"baseColor":"#ffffff","opacity":1,"metallic":0,"roughness":0.8,
 "textureSize":[2,2],"normalConvention":"OpenGL",
 "baseColorTexture":"tex-<32 karakter içerik özeti>.jpg"}
```

Normal ve roughness doku referansları opsiyoneldir. Referanslar URL/dosya yolu değil, proje içindeki değişmez içerik kimlikleridir. `appearance:null` görünümü kaldırır. Semantik ad, renk ve kategori korunur. Atama mevcut tip/eleman güncelleme araçlarıyla yapılır; çok katmanlı tiplerde V0.1 yalnızca ilk katmanın malzemesini tek görünüm olarak kullanır.

Shared Tool Registry içine yalnızca iki yetenek eklendi:

- `material_search`: resmi Poly Haven texture kataloğunu arar ve kaynak metadatasını döndürür.
- `material_import`: 1K/2K JPG diffuse, OpenGL normal ve roughness dosyalarını mevcut `ArtifactStore` proje `exports` alanına indirir; doğrulanmış appearance döndürür. BIM kaynaklarını değiştirmez. Export araçları gibi yalnızca değişmez dosya cache'i üretir; `bim.write` izni gerektirir. Malzeme oluşturma/atama mevcut, onaya tabi BIM araçlarından geçer.

İstekler `INSA-BIM-MaterialAppearance/0.1` uygulama kimliğini gönderir. API UI'da [Powered by Poly Haven](https://polyhaven.com) olarak kredilendirilir. [Güncel API koşulları](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md) canlı API için uygulama kimliği ve görünür kredi gerektiriyor; indirilen varlıklar CC0. Dosyaların kaynağı/sürümü görünüm tanımında saklanır.

URL güvenliği: yalnızca HTTPS `dl.polyhaven.org/file/ph-assets/Textures/jpg/` kabul edilir; kullanıcı bilgisi, port, query/fragment ve redirect reddedilir. İndirme süre ve streaming boyut sınırına tabidir (30 saniye, dosya başına 20 MiB). Metadata boyutu, JPEG imzası ve yayınlanan dosya özeti doğrulanır. Yerel cache tekrar okunurken özet kontrol edilir; path traversal ve symlink reddedilir. Kullanıcı dosya yolu gönderemez.

## Görüntüleyici

- Gerçek Fragments üçgenlerinden yüzey normaline göre metre bazında planar UV üretimi; tile tekrar ölçeği `textureSize` ile belirlenir. Aynı boydaki desen, farklı boydaki duvar/döşemede aynı ölçekte kalır.
- Base-color sRGB; normal/roughness linear veri. OpenGL normal varsayılan, DirectX için Y işareti terslenir. MeshStandardMaterial opacity, metalness, roughness ve haritaları kullanır.
- Aynı kaynak doku proje/model başına paylaşılır. Geometri ve görünürlük sorguları batch yapılır. Eski malzemeler ve ayrılan modellerin GPU kaynakları dispose edilir.
- Malzeme görünümü değişimi `geometryKey` değerini değiştirmez: yeniden Fragments üretme/yükleme olmadan malzeme ve UV güncellenir. Tip veya geometri değişimi mevcut model yükleme yolunu kullanır.
- Eksik doku halinde model kaybolmaz: temel renk + kullanılabilir haritalar gösterilir ve görünür bir uyarı sunulur.
- PBR elemanlar ID/GlobalId üzerinden seçilir; mevcut özellik paneli çalışır. Seçilen görünüm mevcut World içinde bir sınır kutusuyla işaretlenir.

## Gerçek doğrulama

Yalıtılmış fixture: `test-results/material-appearance/data/pbr-demo-v01-final`; aynı INSA web sunucusu port 8788. Ana projelerin verileri değiştirilmedi.

| Kontrol | Sonuç |
|---|---|
| Beton kolon, tuğla duvar, meşe parke, saydam cam | Gerçek tarayıcı ekran görüntüsünde görüldü |
| Farklı boyda 6×3 ve 3×3 parke yüzeyleri | Aynı metre ölçeği; ayrıca UV sayısal testi geçti |
| Canlı renk ve tile boyutu değişimi | Sayfa yenilemeden görüldü; geometryLoads=1 kaldı |
| Sayfayı yeniden açma | Saklanan malzemeler ve görünümler tekrar doğru yüklendi |
| Eksik doku | Temel renk ve uyarı görünür; ekran görüntüsü alındı |
| Doku paylaşımı | 8 eleman, 4 malzeme, 9 paylaşılan harita; kaynak JPG toplamı 3.181.372 bayt |
| GPU / ağ gözlemi | Demo gözleminde yaklaşık 10 GPU texture (9 map + görüntüleyici), 9–12 draw call; sıcak browser cache'inde 9 benzersiz map isteği 1–3 ms. Bu büyük model performans garantisi değildir |
| Material CRUD, undo, replay/snapshot, URL/boyut/dosya/asset, cache/UV/fallback testleri | Geçti |
| Mevcut resources ve wall/slab testleriyle birleşik gate | 29/29 geçti |
| Mevcut IFC category sweep ve schema selection | 2/2 geçti; Windows Python yolu `INSA_PYTHON` ile seçilebiliyor |
| IfcOpenShell demo IFC | 0 şema hatası; 4 semantik malzeme ve 7 ilişki; kolonlar beton malzemesine bağlı |
| Eski projeler | 252 ve 329 elemanlı projeler, yeni appearance olmadan yüklendi; model doğrulamasında 0 hata. Sekiz katlı model tarayıcıda da görüntülendi |
| Typecheck / web build | Geçti; önceden büyük olan bundle için Vite boyut uyarısı sürüyor |

Kanıtlar: `test-results/material-appearance/browser-final.png`, `browser-live-change.png`, `browser-reopened.png`, `browser-missing-texture.png`, `browser-existing-project.png`, `demo.ifc`.

## Değişen kaynak dosyalar

- `packages/bim/src/appearance.ts`: doğrulama ve appearance DTO.
- `packages/bim/src/model.ts`, `tools.ts`, `invariants.ts`, `index.ts`: mevcut kaynaklara opsiyonel görünüm ve araç kaydı.
- `packages/bim/src/polyhaven.ts`: resmi API adaptörü.
- `packages/core/src/artifacts.ts`: mevcut depoya içerik adresli texture cache.
- `apps/web-server/src/app.ts`: appearance/asset endpoints ve görünümden bağımsız geometry key.
- `apps/web/src/api.ts`, `App.tsx`, `viewer.ts`, `material-appearance.ts`: mevcut görüntüleyiciye PBR entegrasyonu, kredi, uyarı, seçim ve kaynak yaşam döngüsü.
- `packages/bim/test/material-appearance.test.ts`, `apps/web/test/material-appearance.test.ts`: yeni regresyon testleri.
- `packages/bim/test/ifc-category-sweep.test.ts`: kurulu Python executable'ını testlerde seçme desteği.
- `packages/bim/src/vertical.ts`: kaynak silme doğrulamasını gölgeleyen eski missing-storey durumuna koruma; resources gate tekrar geçti.
- `scripts/material-appearance-demo.mjs`, `scripts/material-demo-refresh.mjs`: yalıtılmış gerçek API/browser fixture.

## V0.1 sınırları ve sonraki en küçük adım

Çok katmanlı wall/slab yüzlerini farklı malzemelerle kaplama, displacement, EXR/PNG, gelişmiş PBR IFC export, fiziksel refraction/transmission, özel cylinder UV ve büyük-model LOD entegrasyonu eklenmedi. Planar projeksiyon eğik/eğrisel yüzeylerde distorsiyon üretebilir. Cam gösterimi gerçek hosted pencere cam alt bileşeni değil, mevcut generic component engine'in panelidir. PBR için render buffer'ları tutulur; büyük modellerde bellek maliyeti ayrıca ölçülmelidir. Başarısız doku yüklemesi yeniden açmada tekrar denenir.

Sonraki en küçük adım: mevcut malzeme araçlarını kullanan bir seçim/arama/önizleme UI'sı ve temsilî daha büyük bir projede bellek/LOD ölçümü. Yeni rendering motoru veya katmanlı yüzey sistemi otomatik başlatılmadı.

Kullanım: `material_search` → `material_import` → dönen `appearance` ile `bim_create_materials`/`bim_update_materials` → mevcut tip ataması. Codex'in çalışan MCP bağlantısı eski şemayı tutuyorsa yenilenmelidir. Ana sunucu 8787 güncellendi; demo 8788 mevcut web uygulamasının yalıtılmış test verisiyle çalışır.
