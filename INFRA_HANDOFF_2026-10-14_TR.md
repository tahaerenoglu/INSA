# INSA altyapı devir ve doğrulama kaydı — 14 Ekim 2026

## A. Claude → Codex devir

Çalışma kökü bu belgenin bulunduğu INSA dizinidir. Git deposu bulunmadı; branch, HEAD, commit listesi ve uncommitted/untracked ayrımı yoktur. Yerel AGENTS.md/CLAUDE.md bulunmadı; sohbetle sağlanan AGENTS talimatları uygulandı. Dosya tarihleri yazarlık kanıtı değildir: mevcut kodun hangi satırlarının Claude tarafından yazıldığı kesin olarak belirlenemez.

Mevcut `packages/infra/src` paketi alignment, section, sweep, tunnel, render, IFC ve event-sourced module içeriyor. Kaynak dosyaları mevcut; yeniden yazılmadı. Son kaynak tarihi module.ts için 7 Ekim; derlenmiş dosyalar 13 Ekim tarihli. Yol koridoru veya terrain/TIN uygulamasına ait kaynak bulunmadı. İlk devam noktası Faz 01 ortak runtime entegrasyonuydu; Phase 02 başlatılmadı.

## B. Mimari ve bu çalışmanın değişiklikleri

Korunanlar: `packages/core` Platform/registry, FileStores/PostgresStores, izinler, AI önerileri ve insan onayı, undo/history; BIM kategorileri/motorları, mevcut IFC ve PBR/Poly Haven sistemi.

Yeni Codex değişiklikleri yalnızca:

- `apps/manager-mcp/src/runtime.ts`: önce yalnızca `[bimModule]` yükleniyordu; aynı Platform artık `[bimModule, infraModule]` yükler. Web entry de bu factory'yi kullanır. Yeni sunucu/platform/depo oluşturulmadı.
- `apps/manager-mcp/tsconfig.json`: var olan infra workspace için TypeScript proje referansı eklendi.
- `apps/manager-mcp/test/infra-runtime.test.ts`: runtime araçları, proje/modül yalıtımı, undo, FileStores reopen ve AI önerisi/insan onayı testleri.
- Bu devir belgesi.

Yeni bağımlılık yok. Commit, veri temizliği, proje silme veya üretim model yazması yapılmadı. Üretim sunucuları yeniden başlatılmadı. Git olmadığından önceki değişiklikler için yeni bir yazarlık iddiası yapılmadı.

## C. Kaynaktaki gerçek durum

| Yetenek | Durum | Kanıt / sınır |
|---|---|---|
| Yatay güzergâh | COMPLETE AND VERIFIED | alignment.ts; arc, spiral ve süreklilik testleri |
| Düşey güzergâh | COMPLETE AND VERIFIED | checkVertical/evalV; parabol ve orta ordinat testi |
| Doğru, daire, klotoid | COMPLETE AND VERIFIED | Fresnel ve kiriş sapması testleri |
| İstasyonlama | IMPLEMENTED BUT UNVERIFIED | evalH/point3d/parseStation var; tüm istasyon girdi çeşitleri bu çalışmada ayrıca sınanmadı |
| Tünel kesiti | COMPLETE AND VERIFIED | section.ts; analitik alanla yakınsama testi |
| Tünel sweep | COMPLETE AND VERIFIED | sweep.ts; kapalı/yönlü katı ve Pappus testi |
| Kaplama katmanları | PARTIALLY IMPLEMENTED | Katı katmanlar mevcut; material alanı serbest metin, kanonik BIM ID garantisi yok |
| Altyapı miktarları | COMPLETE AND VERIFIED | Alan × uzunluk, eğimli/dairesel güzergâh ve gerçekçi tünel karşılaştırmaları; desteklenen tünel kapsamı |
| Infra MCP araçları | COMPLETE AND VERIFIED | Var olan 13 araç ortak runtime'a alındı; gerçek stdio araç listesi parity testi |
| Proje persistence/undo/onay | COMPLETE AND VERIFIED | Yeni runtime testleri + mevcut core politikası; PostgreSQL ortamı ayrıca test edilmedi |
| Uygulama içi altyapı 3D | NOT IMPLEMENTED | render.ts SVG/PNG üretir; React/Fragments viewer'a infra bağlayan kod yok |
| Paylaşılan koordinatlar | PARTIALLY IMPLEMENTED | Infra kendi CRS ve localOrigin'ini, BIM kendi Georeference/toMap/toLocal'ını kullanıyor; aralarında bağ yok |
| IFC | PARTIALLY IMPLEMENTED | Mevcut infra IFC4 çıktısı çalışıyor; tünel katmanları IfcBuildingElementProxy, güzergâh IfcAnnotation; tam IFC4.3 altyapı semantiği değil |
| Kanonik malzeme/PBR bağlantısı | NOT IMPLEMENTED | Mevcut BIM kaynak sistemi var; infra malzeme metni ve viewer henüz ona bağlanmıyor |
| Parametrik yol koridoru | NOT IMPLEMENTED | Kaynak/araç/test bulunmadı |
| Terrain/TIN/earthworks | NOT IMPLEMENTED | Kaynak/araç/test bulunmadı |

Faz 01 bütünü tamamlanmış değildir. Bu çalışmada yalnızca ilk eksik runtime bağlantısı tamamlandı; 3D/material/coordinate entegrasyonu tamamlandı denemez.

## D. Gerçek doğrulamalar

Başlangıç: `npm run typecheck` geçti. Infra testleri + MCP parity + HTTP api.test.ts grubunda 19 testin 18'i geçti. Başlangıçtan beri mevcut HTTP testinin 49. satırında `bim_delete_elements` dry-run için `preview` bekleniyor, yanıt bu alanı taşımıyor. Test, join ilişkileri olan duvarı silmeyi deniyor; joined wall deletion kuralıyla test senaryosu birlikte incelenmeli. Test değiştirilerek hata gizlenmedi.

Son: yeni runtime testleri, gerçek MCP parity ve bütün infra alignment/sweep/tunnel testleri 18/18 geçti. Typecheck tekrar geçti. Bunlar gerçek geometri/alan/hacim karşılaştırmaları içerir. Test çıktısının export başarısı, browser render kanıtı olarak sunulmadı.

Tarayıcıda yeni infra çizimi doğrulanmadı: bu bağlantı henüz uygulanmadı. Infra için kanonik materyal/PBR doğrulaması da yapılmadı. Mevcut renderer veya IFC4.3 desteğinin tamamı yeniden doğrulandı iddiası yoktur.

Ek BIM regresyon grubu: 8 testin 7'si geçti (MCP resources ve altı material/appearance testi). Authoring senaryosu başlangıç duvarlarını oluştururken W-0004/W-0005 kesişmesi nedeniyle WALL_INTERSECTION ile reddediliyor. Yalnızca bimModule kullanan, infra içermeyen bellek fixture'ı aynı hatayı üretti: bu yeni runtime bağlantısının regresyonu değil, mevcut test senaryosu/politika uyuşmazlığıdır. Testin kesişmeleri meşru junction'lara bölen authoring akışına uyarlanması ayrı, dar kapsamlı bir düzeltme olmalıdır; kesişme koruması kaldırılmamalıdır.

## E. Yeniden üretim

```powershell
npm run typecheck
node --test --import tsx apps/manager-mcp/test/infra-runtime.test.ts apps/manager-mcp/test/parity.test.ts packages/infra/test/*.test.ts
$env:INSA_APPROVAL='ai'
npm run mcp
# Ayrı terminal: aynı INSA_DATA veya INSA_PG_URL ile
npm run web
```

Mevcut çalışan süreçlerin yeni runtime'ı yüklemesi için yeniden başlatılması gerekir. MCP istemcisi de araç listesini yeniden keşfetmelidir. Web Araçlar sekmesinden `infra_create_alignment`, `infra_create_section_types`, `infra_create_tunnel`, `infra_tunnel_quantities`, `infra_render`, `infra_export_ifc` mevcut ortak yönetişim üzerinden kullanılabilir. Çizimler SVG/PNG/IFC çıktılarıdır; mevcut 3D sahnede infra görünmesi henüz desteklenmez. Kullanıcı projeleri üzerinde deneme yapmak yerine ayrı test projesi kullanılmalıdır.

## F. İlk kalan mühendislik adımı

Faz 01: mevcut BIM Georeference'ı esas alan, infra CRS uyuşmazlığını açıkça reddeden ortak coordinate adapter ve aynı viewer içinde gerçek tunnel sweep gösterimi. Sonra kanonik BIM malzeme ID bağlantısı ve referansların silme/undo koruması.

Kabul: büyük mühendislik koordinatlarının korunması ve ileri/geri dönüşüm toleransı; CRS uyuşmazlığının sessiz kabul edilmemesi; ortak sahnede ID tabanlı seçim/görünürlük ve değişiklik sonrası güncelleme; save/reopen/undo; aynı materyal ID'sine PBR ataması; gerçek browser ekran görüntüsü; mevcut BIM regresyonlarının korunması. Ancak bundan sonra 500 m Road Corridor V0.1'e geçilmeli.
