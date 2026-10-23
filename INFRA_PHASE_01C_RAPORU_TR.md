# Infrastructure Phase 01C — Türkçe teknik teslim raporu

14 Ekim 2026. Kapsam: mevcut tünel kaplama katmanlarının kanonik BIM malzemeleriyle kalıcı ilişkisi ve mevcut 3D dünyasında PBR gösterimi. Phase 02 başlatılmadı.

## A. Mevcut durum

Phase 01B; ortak Platform/runtime, proje georeference adaptörü, yerel Three.js/Fragments dünyasında güzergâh/tünel gösterimi, seçim, görünürlük, odaklama ve yeniden açma/geri alma akışını sağlamıştı. BIM malzeme araçları, appearance şeması, Poly Haven adaptörü, güvenli project artifact texture depolaması ve BIM PBR görünümü zaten mevcuttu. Bunlar korundu; yeni malzeme veritabanı, MCP sunucusu, geometri motoru veya viewer eklenmedi.

## B. Uygulama ve değişen dosyalar

| Dosya | Amaç |
|---|---|
| `packages/core/src/platform.ts` | Aynı iyimser komut snapshot'ı üzerinde isteğe bağlı modüller arası referans doğrulaması. |
| `apps/manager-mcp/src/runtime.ts` | Altyapı→BIM malzeme referansının proje kapsamında doğrulanması; kullanımda malzeme silmenin reddi. |
| `packages/infra/src/section.ts` | Geriye uyumlu katman `id`/`materialId` alanları ve legacy kimlik çözümü. |
| `packages/infra/src/module.ts` | Tek `infra_update_section_type` komutu; katman güncelleme/atama/kaldırma ve export'ta kanonik malzeme çözümü. |
| `packages/infra/src/ifc.ts` | Mevcut IFC4 proxy ihracında kanonik ad/ID ve `IfcRelAssociatesMaterial` ilişkileri. |
| `apps/web-server/src/infrastructure.ts` | Geometri anahtarını appearance'dan ayırma; güncel malzeme referansları ve canonical registry verisini sahneye bağlama. |
| `apps/web-server/src/infrastructure-uv.ts` | Mevcut sweep mesh'inden metre bazlı UV ve dikiş/cap normal grupları türetme. |
| `apps/web-server/src/app.ts` | Önbellekteki geometriye güncel malzeme görünümünü bağlama. |
| `apps/web/src/appearance-resources.ts` | Mevcut texture yükleme mantığını BIM ve altyapı için tek proje kapsamlı GPU önbelleğine çıkarma. |
| `apps/web/src/material-appearance.ts` | BIM PBR görünümünün aynı kaynak/texture uygulamasını kullanması. |
| `apps/web/src/infrastructure-view.ts` | PBR atama, fiziksel UV ölçeği, dikiş normalleri, görünüm güncelleme ve highlight korunması. |
| `apps/web/src/viewer.ts` | Altyapı görünümünü aynı world güncellemesine bağlama. |
| `apps/web/src/App.tsx` | Katman inspector'ında canonical malzeme ID/adı, PBR durumu ve yönetilen atama seçicisi. |
| `apps/web/src/api.ts` | Tarayıcı dışı testlerde güvenli localStorage başlangıcı; transport değişmedi. |
| `apps/manager-mcp/test/infra-materials.test.ts` | Atama/onay/geri alma, kimlik, lifecycle, proje izolasyonu, snapshot/reopen ve IFC kontrolleri. |
| `apps/web-server/test/infrastructure-uv.test.ts` | Bağımsız fiziksel UV/seam/ölçek ve cache anahtarı kontrolleri. |
| `apps/web/test/infrastructure-materials.test.ts` | Geometriyi koruyan görünüm değişimi, seçim/görünürlük ve ortak texture fallback/cache kontrolleri. |
| `packages/core/test/project-validation.test.ts` | Windows'ta taşınabilir Node başlatıcısıyla bağımsız çoklu süreç onay kontrolü. |
| `apps/web-server/test/fixtures/infrastructure-demo.ts` | Eski demo kurulumunu test kaydı yan etkisi olmadan tekrar kullanılabilir fixture'a çıkarma. |
| `apps/web-server/test/infrastructure.test.ts`, `scripts/infra-01b-demo.mjs` | Yalnızca fixture import düzenlemesi; eski test beklentileri değiştirilmedi. |
| `scripts/infra-01c-demo.mjs`, `scripts/infra-01c-change.mjs` | İzole demo hazırlığı ve yönetilen görünüm/atama/geri alma deneyleri. |

Yeni bağımlılık eklenmedi. Mevcut Poly Haven adaptörü ve mühendislik sweep hesapları değiştirilmedi.

## C. Malzeme veri modeli

Katman, mevcut SectionType içinde isteğe bağlı `materialId` tutar. Malzeme tanımı/texture verisi katmana kopyalanmaz; aynı projenin `bim.materials` kaydından çözülür. Eski `material` metni korunur ve ad eşleşmesiyle otomatik ID dönüşümü yapılmaz. Atanmamış katman deterministik fallback rengi ve `unassigned` tanılamasıyla gösterilir.

Yeni katmanlar kalıcı UUID alır. Legacy katman için `legacy-N` kimliği düzenleme sırasında açıkça kalıcılaştırılır; eski viewer slot kimliği korunur. Mevcut katmanı taşırken/güncellerken ID zorunludur; ID'siz satır yeni katmandır. Ekleme, kaldırma ve yeniden sıralama test edildi; malzeme ilişkisi aynı katmanda kaldı.

Atama bölüm tipi katmanı düzeyindedir; o tipi kullanan bütün tünel aralıklarını etkiler. Aralık bazlı override eklenmedi. Viewer aralık kimlikleri halen Phase 01B'deki indeks yapısını kullanır; malzeme sahipliği bu indekslere bağlı değildir.

Olmayan/başka projede bulunan ID, desteklenmeyen referans biçimi ve bilinmeyen katman reddedilir. Malzeme kullanımdaysa silme `RESOURCE_IN_USE` ile reddedilir; atama kaldırıldıktan sonra silinebilir. Kontrol preview, proposal ve gerçek commit'in aynı proje durumunda çalışır.

## D. PBR ve fiziksel eşleme

Kaynak appearance tanımı mevcut kanonik malzemeden gelir. BIM ve tünel aynı `AppearanceResources` yükleyicisini kullanır: proje+asset+color-space başına Promise/Texture önbelleği, sRGB base color, linear normal/roughness, RepeatWrapping, OpenGL/DirectX normal yönü, metallic, roughness, opacity ve temel renk. Aktif sahipler texture'ları paylaşır; artık kullanılmayan kaynaklar ve son sahip kapandığında GPU kaynakları temizlenir.

UV'nin U yönü, alignment başlangıcından deterministik 1 m aralıklarla entegre edilen 3D merkez hattı mesafesidir. V yönü ilgili iç/dış kesit sınırının birikimli yüzey mesafesidir. UV metre değerleri appearance `textureSize` ile bölünür. Cap yüzeyleri kesit düzleminde eşlenir. Dikiş vertex kopyaları yalnızca türetilmiş viewer mesh'indedir; yan yüzey normalleri paylaşılır, cap kenarı ayrı tutulur. Mühendislik geometrisi ve metraj değişmez.

1×1 m ile 2×2 m ayarı pattern sıklığını tam 2 kat değiştirir. Boyut verilmemiş appearance için mevcut şemanın 2×2 m varsayımı kullanılır; mevcut BIM malzeme güncelleme araçlarıyla düzeltilebilir.

Geometri ve appearance invalidation ayrıdır. Atama veya appearance değişikliği alignment/sweep geometri cache anahtarını değiştirmez; viewer aynı BufferGeometry'yi tutar, yalnızca material ve UV attribute güncellenir. Eksik asset durumunda ID korunur; temel renk/fallback ve uyarı gösterilir.

## E. Yönetim akışı

Mevcut `infra_update_section_type` ortak registry/MCP/HTTP üzerinden kullanılabilir. `assignments` ile atama/reassignment/null reset; `layers` ile bölüm tipi katman düzenlemesi aynı olay mimarisini kullanır. Yeni bağımsız atama servisi yoktur.

Katman inspector'ında malzeme adı/ID ve PBR durumu görüntülenir; mevcut proje malzemesi seçilip gönderilir. Aktif `ai` modunda insan yazıları doğrudan uygulanır, AI yazıları mevcut proposal/human approval akışından geçer. Mevcut undo, audit, FileStores ve snapshot sistemi korunmuştur.

Gerçek tarayıcı testinde AI atama önerisi onay öncesi uygulanmadı; onay sonrası aynı katmanda ID güncellendi. AI geri alma önerisi onaylanınca önceki atama ve texture geri geldi. Arayüzün malzeme seçip gönderme işlemi de ayrıca test edildi. Tüm deneme yazıları izole proje kökündedir; üretim/önceki kullanıcı projelerinde model değişikliği yapılmadı.

## F. Doğrulama

- Başlangıç ilgili regresyon grubu: **32/32 geçti**.
- Nihai ilgili grup: **39/39 geçti**. Mevcut altyapı motor testleri, gerçek stdio MCP parity, BIM appearance/material regresyonları, yeni referans/UV/viewer testleri ve taşınabilir çoklu süreç onay testi dahil.
- `npm run typecheck`, `npm run build:web`: geçti. Backend `npm run build`: geçti.
- FileStores snapshot yazma ve fresh Platform üzerinden yeniden açma test edildi. Gerçek sunucu restart'ı ve browser reload sonrası aynı katman UUID'leri ve M-0002/M-0003 atamaları korundu.
- Eski API/authoring grubunda **5 test: 3 geçti, 2 önceki hata**: `api.test.ts:49` joined-wall deletion dry-run beklentisi; `authoring.test.ts:34` W4/W5 WALL_INTERSECTION fixture'ı. Eski assertions veya duvar doğrulaması değiştirilmedi.
- Geniş core grubu: **52 test, 47 geçti, 1 başarısız, 4 PostgreSQL testi atlandı**. Ek hata, mevcut testin Windows'ta `.bin/tsx` executable'ını spawn edip ENOENT almasıdır. Aynı çoklu süreç davranışı `process.execPath --import tsx` ile bağımsız sınandı ve tek uygulama doğrulandı. Tam suite için yeşil iddiası yoktur.

Bağımsız sayısal kontroller:

| Kontrol | Sonuç |
|---|---|
| 50 m yatay uzunluk, %10 eğim için U mesafesi | 50.2493781056 m; analitik `50√1.01` ile eşleşti. |
| r=3.3 m çevre referansı | 20.7345115137 m; poligon UV çevresi 0.005 m toleransında. |
| Bitişik aralık U sürekliliği | Aynı sınır değerinde eşleşti. |
| Texture 2 m→1 m | Aynı vertex için tekrar sayısı 1.5→3; geometri aynı. |
| İç/dış kaplama yarıçapı | Önceki bağımsız 3.30/3.50 m kontrolleri geçti. |
| Görünüm değişiklikleri | Mesh hash ve tüm quantity sonuçları aynı kaldı. |
| 430 m iç kaplama | 2552.972 m³; analitik 2553.17235 m³, göreli fark %0.00785. |
| 430 m dış kaplama | 1837.059 m³; analitik 1837.20338 m³, göreli fark %0.00786. |

Analitik volume karşılaştırması mevcut motorun düşey kesit/horizontal station uzunluğu kuralını kullanır. Küçük fark tessellation yaklaşımıdır. Kanıt dosyası: `test-results/infra-01c/numerical-verification.json`.

Gerçek gstack tarayıcı kanıtları `test-results/infra-01c/` içinde:

- `curved-pbr.png`, `final-pbr.png`: eğri üzerinde dış kaplama texture'ı; sonuncusu nihai kaynaklarla yeniden açılışı gösterir.
- `inner-material.png`: dış katman gizlendiğinde iç kaplamanın farklı görünümü.
- `selected-canonical-material.png`: seçili layer UUID ve canonical material ID.
- `before-approval.png`, `after-approval.png`, `reassigned-pbr.png`: onay ve gerçek yüzey değişimi.
- `undo-restored.png`, `appearance-update.png`: geri alma, renk ve fiziksel ölçek değişimi.
- `missing-asset-fallback.png`: geometri korunarak fallback/uyarı.
- `bim-reference-selection.png`, `bim-and-tunnel.png`: mevcut BIM seçimi ve ortak dünya.
- `reopened-material.png`: restart/reload sonrası kalıcı ilişki.

İki gerçek Poly Haven appearance altı JPEG map kullanır. İlk oturumda toplam **6 texture isteği** gözlendi; reassignment, renk ve ölçek değişikliğinde 6'da kaldı. Native BIM geometri yükleme sayısı **1** kaldı. Eksik asset deneyinde mevcut endpoint HTTP 400 döndürdü ve fallback oluştu; kaynak malzeme ve geometri korundu. Yeni JavaScript exception görülmedi; screenshot sırasında WebGL ReadPixels GPU-stall uyarıları vardı. Restart sırasında beklenen connection reset ve geliştirme oturumu için 401 kayıtları oluştu; tekrar giriş yapıldı.

## G. Sınırlamalar

- IFC4 proxy/tessellation ihracı korunur; canonical ad/ID ve gerçek IfcRelAssociatesMaterial ilişkisi metin üzerinden doğrulandı. Tam IFC4.3 altyapı veya IFC içinde Poly Haven PBR texture taşınması iddia edilmez.
- Katman ilişkisi ortak section type düzeyindedir. Instance/range override, layered road materials ve yeni material editor yoktur.
- Fiziksel U, 3D merkez hattı mesafesidir; kurbun iç/dış tarafındaki farklı fiber uzunluklarına göre ayrı distorsiyon telafisi yapılmaz. 1 m sayısal integrasyon bir yaklaşımdır.
- UV seam/cap adaptasyonu indexed engineering mesh'i viewer için üçgen vertex'lerine açar; büyük projelerde JSON/GPU vertex maliyeti artar. Geometri üretimi senkron, aktarım kademeli değildir. Büyük proje benchmark yapılmadı. Mevcut büyük Vite chunk uyarısı sürer.
- Asset cache proje kapsamlıdır; farklı projeler aynı dosya için ayrı GPU texture kullanır. Başarısız asset denemesi cache'de tutulur; düzelen dosyayı yeniden denemek için proje yeniden açılabilir.
- CRS reprojeksiyonu eklenmedi. Georeference ve legacy fallback kuralları Phase 01B ile aynıdır. Görünürlük geçici UI tercihidir.

## H. Yeniden üretim

Çalışan izole demo: **http://localhost:8791/**, proje `infra-01c-demo`. Veri kökü `test-results/infra-01c/data`. Ana sunucular 8787/8788 ve önceki demo 8790 da güncel kaynaklarla yeniden başlatıldı; dört portun dinlediği doğrulandı.

Demo hazırlığı: depo kökünde `node --import tsx scripts/infra-01c-demo.mjs`. Script önceki `temiz-proje-20261013` projesindeki gerçek `rough_concrete` ve `concrete_wall_003` appearance/asset dosyalarını salt okunur kaynak olarak kullanır; checksum doğrulanan dosyaları mevcut ArtifactStore API'siyle yalnızca izole projeye kaydeder. Uzak API isteği yoktur. Bu kaynaklar yoksa açık hata verir; sahte Poly Haven ID üretmez.

Sunucu için PowerShell:

```powershell
$env:INSA_DATA = Join-Path (Get-Location) 'test-results/infra-01c/data'
$env:PORT = '8791'
$env:INSA_APPROVAL = 'ai'
npm run web
```

Katmanı seçin → Özellikler → BIM malzemesi → Malzeme atamasını gönder. İç kaplamayı görmek için dış katmanın görünürlük kutusunu kapatabilirsiniz. Mevcut Tipler/Malzemeler ekranı ve `bim_update_materials` appearance düzenlemesi kullanılmaya devam eder.

İzole AI önerileri: `node --import tsx scripts/infra-01c-change.mjs assign`, `appearance`, `missing` veya `undo`. Bunlar yalnızca demo projesini hedefler; Öneriler ekranında mevcut insan onayı gerekir. Script kendi kendine onaylamaz.

## I. Sonraki minimum milestone

Phase 02 Parametric Road Corridor V0.1 için mevcut alignment üzerinde section template kaynakları (şerit/genişlik/enine eğim/banket), station range atamaları ve sınırlı geçiş interpolasyonu yeterli ilk dilimdir. Mevcut sweep/koordinat/world, canonical material ID ve yönetim akışı yeniden kullanılmalı; yol geometry/quantity doğrulaması, düz/kurplu güzergâh ve iki section geçişiyle bağımsız sınanmalıdır. Hafriyat, terrain birleşimi, kavşak, demiryolu veya köprü bu ilk dilime otomatik eklenmemelidir. Bu teslimde Phase 02 kodu yazılmadı.
