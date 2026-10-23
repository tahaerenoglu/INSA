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

Reporter'ın son başarısız test blokları artık `scripts/compare-modeling-test-runs.mjs` ile kimlik bazında ayrıştırılıyor. 109 kayıt mekanizmaya göre sınıflandırıldı: 54 duplicate join, 18 diğer domain reason, 23 assertion, 2 Windows tsx launcher, 2 response shape, 1 symlink yetkisi, 9 üst dosya/suite kaydı. Ayrıntı yeni Phase 2 teknik raporundadır. Bütün legacy assertion'ların ürün düzeyindeki kök nedeni henüz çözülmedi; mekanizma sınıflandırması bunun yerine geçmez.

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

Git aktarımından sonra P1'in çatı/koordinasyon/güvenli onarım bölümü uygulandı. Gerçek beşik/kırma düzlemleriyle parçalı duvar üst sınırı, quantities, IFC clipping; polyhedral solid derivation; sweep-and-prune broad phase; SAT/gerçek mesafe/sonlu MEP merkez hattı narrow phase; sekiz koordinasyon sınıfı; ortak validate/repair ve üretimde sınırlı güvenli onarım döngüsü eklendi. Yeni kalıcı model veya LLM aracı yoktur.

Gerçek MCP/HTTP, IFC tessellation, Fragments, preview/onay/undo/replay testleri çalıştırıldı. Üç gerçek izole örnek `output/umb-phase2-2026-10-23/` altında üretildi; `scripts/phase2-modeling-demo.mts` ile yeniden üretilebilir.

Tam kapsam ve nihai test kanıtı: `docs/PHASE2_GEOMETRY_COORDINATION_2026-10-23_TR.md` ve `docs/PHASE2_TEST_COMPARISON_2026-10-23.json`.

Sonuç: 751/625/110/16 (toplam/pass/fail/skip); yeni 11 test geçti, eski 109 başarısız kimlik aynı kaldı, ek 1 eski altyapı testinde Windows proposals.json rename EPERM. İki eski altyapı testi son sıralı tekrar koşusunda 2/2 geçti; bu tam koşudaki hatayı silmez. Odak geometri/ortak araç testleri 22/22, typecheck ve web build başarılı. Tam paket yeşil değil.

Sıradaki iş P1'i tamamlamaktır: genel eğimli cephe/kademeli çatılar, genel ilişki grafı, duvar hosted boşlukları/eğrisel profiller, MEP zarf/gövde clash ve yoğun model artımlı indeks. P2–P5 bu teslimde genişletilmedi. Donatı otomatik layout hâlâ dik dikdörtgen kolon; MEP ortak üretim hâlâ onaylı şaft + kısıtlı ortogonal rota. Doküman anlamlandırma ve chat-first UI ilk aşama düzeyindedir. Bunları bitmiş gibi sunma.

Devam ederken önce `git status --short` ve bu teknik raporu oku. Canlı `data/` üzerinde test yapma. İlgisiz 109 legacy hatayı tek seferde yeniden yazma. Yeni iş için yakın geometri/governance testlerini ve typecheck'i çalıştır; yeni değişiklikten sonra tam koşuyu baseline ile aynı karşılaştırıcıdan geçir.

## Araştırma ve sınırlar

gstack `/browse` kullanıldı. buildingSMART resmî IFC sayfası 403 güvenlik doğrulaması döndürdü; ayrıntılı standart maddeleri doğrulanmış sayılmıyor. Three.js'in mevcut `ShapeUtils.triangulateShape` API'si kurulu tipler ve resmî belgeyle kontrol edildi. Context7 aracı oturumda mevcut değildi. Yeni donatı kodundan önce erişilebilir birincil teknik kaynak araştırması sürdürülmeli; erişilemeyen Eurocode/ulusal ek sayısal hükümleri varsayılmamalı.

İlgili önceki uygulama raporu: `docs/UNIVERSAL_MODELING_BRAIN_2026-10-23_TR.md`. Phase 2 talebinin tamamı bu sohbetin ekli metnindedir.
