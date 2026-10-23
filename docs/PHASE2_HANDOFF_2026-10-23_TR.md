# Universal Modeling Brain — Phase 2 devam kaydı

## Çalışma deposu

Kullanıcının 23 Ekim 2026 talebiyle mevcut çalışma klasörü Git deposuna dönüştürüldü ve `origin` olarak `https://github.com/tahaerenoglu/INSA.git` bağlandı. Çalışma dizini aynı klasördür; kullanıcı modelleri, belgeleri veya bağımlılıklar fiziksel olarak taşınmadı/silinmedi. Bundan sonraki geliştirmeler bu checkout üzerinde izlenmelidir.

Kaynaklar, testler, örnekler ve teknik belgeler depoya alınır. `data/`, `node_modules/`, `dist/`, `output/`, `outputs/`, `tmp/`, `logs/`, hata/test çıktıları ve gizli `.env` dosyaları yerel kalır. `.env.example` izlenir.

## Phase 2 isteği ve öncelikler

Önceki Universal Modeling Brain mimarisi korunacak. Sekiz ortak yüksek seviye araç dışında disipline özel yeni LLM aracı eklenmeyecek. Platform yetki/onay/event/audit/undo/snapshot zinciri ve mevcut Fragments/IFC altyapısı korunacak.

Sıra: P1 geometri/bağlantı/çok düzlemli çatı/clash/güvenli repair; P2 kiriş-döşeme-perde-temel/radye parametrik donatısı; P3 genel 3B routing ve MEP ağı/fittings; P4 kaynak atıflı çok belgeli Project Context; P5 capability entegrasyonları, sohbet başlangıcı ve uçtan uca doğrulama. Statik kapasite, donatı alanı hesabı veya MEP boyutlandırması kapsam dışıdır.

## Yeniden doğrulanan başlangıç

Phase 2 ürün kodu değiştirilmeden `npm test` yeniden çalıştırıldı:

- 740 test; 615 başarılı; 109 başarısız; 16 atlanan.
- Typecheck başarılı.
- Tam yerel log: `tmp/umb-phase2-baseline.log`.
- Typecheck logu: `tmp/umb-phase2-baseline-typecheck.log`.
- Değişiklik öncesi 363 kaynak/test/config dosyasının SHA-256 manifestli kopyası: `output/umb-phase2-source-baseline/` (yerel; depoya alınmaz).

Önceki rapordaki 738/612/110/16 sonucu güncel başlangıç kabul edilmedi. Yeni koşu yukarıdaki sayıları verdi.

İlk hata incelemesi: mevcut otomatik duvar birleşimleri ile bazı eski fixture/testlerin ayrıca aynı birleşimi oluşturması arasındaki uyumsuzluk belirgin (`DUPLICATE_WALL_JOIN`: logdaki 54 reason örneği). Diğer reason örnekleri `INVALID_GEOMETRY`, `WALL_INTERSECTION`, `WALL_EDIT_HOSTED_CONFLICT`, `ELEMENT_IN_USE`, `INVALID_DIMENSION`, `INVALID_WALL_JOIN`. Bu sayılar başarısız test sayısı değildir; stack/alt test tekrarları içerir. Bütün 109 hatanın tek tek kök neden sınıflandırması henüz tamamlanmadı. Sadece logdaki beklenen snapshot/event-version tanı mesajları test başarısızlığı sayılmamalıdır.

## İncelenen mevcut kod

- `apps/manager-mcp/src/modeling.ts`: ortak araçlar, Builder, capability/rule registry, generation/revision/repair akışı.
- Mevcut capability'ler: `conceptual-frame`, `hosted-rebar`, `service-network`, `alignment-corridor`, `shared-component-array`.
- `packages/bim/src/wall-roof.ts`: tek düzlemli çatı alt sınırı bağımlılığı.
- `packages/bim/src/engines/pitched-roof.ts`: mevcut gerçek beşik/kırma çatı düzlemleri ve IFC writer; yeni bağımsız çatı motoru yazılmamalı.
- `packages/bim/src/connectivity.ts`: mevcut türetilmiş taşıyıcı temasları; bazı sorgular bütün çiftleri tarıyor.
- `packages/bim/src/modelling-policy.ts`: mevcut fiziksel duplicate, wall/component overlap ve güvenli duvar onarımı.
- `apps/manager-mcp/src/modeling-routing.ts`: altı orthogonal sıra ile muhafazakâr sınır kontrolü; genel 3B arama yok.
- Mevcut IFC clipping, geometry primitives, host/dependency handler'ları, MEP connector/junction doğrulaması incelendi.

## Uygulama durumu

Git aktarımı istenmeden önce Phase 2 ürün kodunda değişiklik yapılmadı. Kaynak inceleme, yeniden test, yedekleme ve araştırma yapıldı. P1 uygulaması sıradaki iştir; önceki Phase 1 raporundaki özellikler mevcut kaynakta korunuyor.

Planlanan ilk somut adım: mevcut `roofGeometry` düzlemlerini `wallRoof` içinde kullanarak beşik/kırma çatıya bağlı duvarların parçalı üst sınırını, quantities ve IFC geometrisini tek türetilmiş hesaptan üretmek. Ardından spatial broad-phase ve gerçek narrow-phase geometri kontrolüyle koordinasyon kayıtlarını ortak validate/repair araçlarına bağlamak. AABB tek başına kesin clash kanıtı olarak kullanılmamalı.

## Araştırma ve sınırlar

gstack `/browse` kullanıldı. buildingSMART resmî IFC sayfası 403 güvenlik doğrulaması döndürdü; ayrıntılı standart maddeleri doğrulanmış sayılmıyor. Three.js'in mevcut `ShapeUtils.triangulateShape` API'si kurulu tipler ve resmî belgeyle kontrol edildi. Context7 aracı oturumda mevcut değildi. Yeni donatı kodundan önce erişilebilir birincil teknik kaynak araştırması sürdürülmeli; erişilemeyen Eurocode/ulusal ek sayısal hükümleri varsayılmamalı.

İlgili önceki uygulama raporu: `docs/UNIVERSAL_MODELING_BRAIN_2026-10-23_TR.md`. Phase 2 talebinin tamamı bu sohbetin ekli metnindedir.
