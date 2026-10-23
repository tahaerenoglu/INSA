# INSA Infrastructure Phase 01B — Teslim raporu

Tarih: 14 Ekim 2026. Kapsam: ortak koordinatlar ve mevcut altyapı geometrisinin yerel 3D çalışma alanında gösterimi.

## A. Önceki durum

Mevcut altyapı paketi yatay/düşey güzergâh, doğrusal parça, dairesel yay, klotoid ve tünel süpürme geometrisini sağlıyordu. Önceki Codex çalışması altyapı modülünü ortak Platform çalışma zamanına bağladı; registry, yetki, öneri/onay, olay geçmişi, geri alma ve FileStores akışları yeniden kullanıldı. Bu aşamada bu motorlar ve BIM mimarisi korundu. Önceki teslim kaydı: `INFRA_HANDOFF_2026-10-14_TR.md`.

## B. Yeni uygulama ve dosyalar

| Dosya | Değişiklik ve amacı |
|---|---|
| `apps/web-server/src/infrastructure.ts` | Mevcut mühendislik geometrisinden türetilmiş sahne, koordinat adaptörü, kaynak kimlikleri ve tanılama üretimi. |
| `apps/web-server/src/app.ts` | Ortak yetkilerle korunan proje altyapı sahnesi uç noktası ve sınırlı türetilmiş önbellek. |
| `apps/web-server/tsconfig.json` | Mevcut altyapı paketine derleme referansı. |
| `apps/web/src/infrastructure-view.ts` | Mevcut Three.js dünyasında güzergâh çizgisi/tünel katmanları; seçim, görünürlük ve GPU kaynak temizliği. |
| `apps/web/src/viewer.ts` | Native BIM ile ortak koordinasyon, raycast seçimi, odaklama, güncelleme ve eski model temizliği. |
| `apps/web/src/api.ts` | Mevcut oturum üzerinden sahne isteği. |
| `apps/web/src/App.tsx` | Altyapı ağacı, katman görünürlüğü, kaynak özellikleri ve mevcut yenileme akışına bağlantı. |
| `apps/web-server/test/infrastructure.test.ts` | Koordinat, yetki, izolasyon, yeniden açma, güncelleme/geri alma ve katman yarıçapı kontrolleri. |
| `apps/web/test/infrastructure-view.test.ts` | Float32 öncesi koordinat indirgeme, kaynak temizliği, seçim/görünürlük ve native koordinasyon kontrolleri. |
| `scripts/infra-01b-demo.mjs` | İzole FileStores kökünde tekrar üretilebilir demo. |
| `scripts/infra-01b-update.mjs` | İzole demoda mevcut araçlarla yükseklik değişikliği ve geri alma doğrulaması. |

Yeni modelleme motoru, kalıcı veri deposu, üretim MCP sunucusu veya IFC dışa aktarıcısı eklenmedi. Görünüm verileri kaynak durumdan türetiliyor.

## C. Koordinat modeli

Kanonik otorite mevcut BIM proje Georeference kaydıdır. Altyapının orijinal E/N/H mühendislik koordinatları değiştirilmez. CRS adları yalnızca boşluk/büyük-küçük harf normalizasyonundan sonra eşleşirse mevcut BIM `toLocal/toMap` dönüşümü kullanılır. Eksik veya uyumsuz CRS açık tanılama üretir; sahte reprojeksiyon yapılmaz.

Akış: mühendislik `[E,N,H]` → BIM proje `[x,y,z]` → Three.js `[x,z,-y]` → gerçek Fragments coordination matrix → mevcut model dünyası. Tarayıcıda coordination matrix yönünün proje→model olduğu doğrulandı. Büyük koordinatlar GPU Float32 dizisine yazılmadan önce JavaScript double hassasiyetinde indirgenir. BIM olmayan projede yalnızca görüntüleme başlangıcı kaydırılır.

Sayısal kontrol: E=412000, N=4561000, H=62; döndürülmüş eksen ve ölçek 2 altında `[411980,4561040,68]` → proje `[20,10,3]` → görünüm `[20,3,-10]`; ters dönüşüm kaynak noktayı geri verir. GPU indirgeme testi milimetrelik farkları 1e-7 m toleransında korur. Native referans kolonun tarayıcıda geri dönüştürülen proje sınırları `[19.5,0,-10.5]`–`[20.5,5,-9.5]` ile beklenen konumu eşleşir.

## D. Kullanıcı demonstrasyonu

İzole demo: http://localhost:8790/ — proje `infra-01b-demo`. Mevcut uygulama ve çalışma zamanı kullanılır; veri kökü `test-results/infra-01b/data`. Üretim projelerine demo elemanı yazılmadı. Ana sunucular 8787 ve 8788 portlarında yeniden çalıştırıldı.

Demo; 524.968 m güzergâh, doğru/yay/klotoid, düşey kurp, 20–450 m istasyonları arasında iki kaplama katmanlı tünel ve aynı koordinat sistemindeki BIM referans kolonunu içerir. Katman dış yarıçapları 3.30 ve 3.50 m'dir.

Altyapı ağacından veya gerçek 3D yüzeyden seçim, kaynak özelliklerini açar. Tünel/katman görünürlüğü ve odaklama çalışır. Native BIM kolon seçimi mevcut highlighter ile çalışmaya devam eder. Mevcut güzergâh güncelleme araçlarıyla yapılan değişiklik canlı sahneye yansır; geri alma eski geometriyi geri getirir. Sahne için yeni düzenleme araçları eklenmedi.

Tekrar üretim: depo kökünde `node --import tsx scripts/infra-01b-demo.mjs`; ardından mevcut web sunucusunu `INSA_DATA=test-results/infra-01b/data`, `PORT=8790` ile çalıştırın. Güncelleme: `node --import tsx scripts/infra-01b-update.mjs`; geri alma: aynı komuta `--undo` ekleyin. Bunlar yalnızca izole demo kökünü hedefler.

## E. Doğrulama

- İlgili geometri, runtime, gerçek stdio MCP parity, koordinat, viewer ve mevcut BIM/PBR regresyon grubu: **32/32 geçti**.
- Son eklenen bağımsız tünel katman yarıçapı kontrolleriyle backend sahne grubu tekrar çalıştırıldı: **3/3 geçti**.
- `npm run typecheck`: geçti; TypeScript proje derlemesini de içerir. `npm run build:web`: geçti.
- Mevcut altyapı export/drawing regresyonları geçti; tam IFC4.3 desteği iddia edilmiyor.
- FileStores ile yeniden açma, kaynak izolasyonu, yükseklik güncellemesi ve geri alma sahne eşitliği doğrulandı.
- Gerçek tarayıcı yenilemesi sonrası demo korundu. Tünel yüksekliği +2 m değiştiğinde native BIM geometri yükleme sayısı 1'de kaldı; geri alma önceki sahne anahtarını geri getirdi.
- Tarayıcıda gerçek canvas pointer seçimi dış kaplama katmanını ve doğru kaynak kimliğini açtı. JavaScript hatası gözlenmedi; ekran görüntüsü sırasında WebGL ReadPixels/GPU bekleme uyarıları görüldü.

Mevcut baseline: API/authoring grubunda 5 testin 3'ü geçti, **2 önceki hata sürdü**: `apps/web-server/test/api.test.ts:49` birleşmiş duvar silme dry-run beklentisi; `apps/manager-mcp/test/authoring.test.ts:34` eski W4/W5 kesişen duvar fixture'ı. İkincisi BIM-only çalışma zamanında da tekrarlandı. Duvar kesişim doğrulaması, eski fixture'lar veya HTTP dry-run sözleşmesi değiştirilmedi.

Tarayıcı kanıtları, `test-results/infra-01b/`:

- `scene-pick.png`: gerçek 3D yüzey seçimi ve özellikler.
- `final-native-view.png`: ortak dünyada native BIM ve iki katmanlı tünel.
- `inner-layer-visible.png`: dış katman gizliyken iç katman.
- `after-height-update.png`: canlı yükseklik güncellemesi.
- `bim-reference.png`: native BIM seçim ve özellikleri.

Performans: demo 1 çizgi ve 2 katman mesh'i kullanır; istasyon başına ayrı draw oluşturulmaz. Eski geometri/material dispose ve aynı anahtarda yeniden kullanım test edildi. Backend türetilmiş önbelleği 8 kayıtla sınırlı. Büyük projeler için yük/performance benchmark yapılmadı; geometri üretimi senkron ve JSON aktarımı kademeli değil. Mevcut büyük Vite chunk uyarısı devam ediyor.

## F. Sınırlar

CRS reprojeksiyonu yok. Katman malzemeleri eski metin alanlarından deterministik renklerle gösteriliyor; kanonik BIM malzemelerine bağlanmadı. Görünürlük tercihleri sayfa yenilemesinde sıfırlanır. Range/layer kimlikleri indeks tabanlıdır; yeniden sıralamada değişebilir. Kalıcı snapshot şeması değişmedi; zorlanmış snapshot eşiği ayrıca sınanmadı. Yol koridoru, hafriyat, demiryolu, köprü, tam altyapı IFC4.3 veya tam PBR entegrasyonu bu teslimin kapsamında değildir.

## G. Sonraki en küçük adım — Phase 01C

Tünel katmanlarını mevcut BIM material ID'lerine kararlı biçimde bağlamak; mevcut Poly Haven asset/appearance akışını ve GPU texture önbelleğini yeniden kullanmak; katman bazında PBR görünümü mevcut mesh üzerinde uygulamak. Kabul kontrolleri: atama/güncelleme/geri alma/yeniden açma, gerçek metre ölçekli UV, paylaşılan texture kullanımı, eksik asset fallback ve highlighter uyumu. IFC semantik malzeme ilişkileri viewer texture'larından ayrı doğrulanmalıdır. Yol koridoru aşaması başlatılmadı.
