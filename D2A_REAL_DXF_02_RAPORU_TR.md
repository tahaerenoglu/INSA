# D2A-REAL-DXF-02 — Gerçek demiryolu DXF kaynak incelemesi

Son doğrulama: 16 Ekim 2026. Typecheck ve web derlemesi tamamlandı; `build-web-final.log` kanıtı saklandı. 8803 kabul sunucusu yeniden açıldı ve gerçek kaynak/snapshot doğrulaması tekrar geçti. Son tarayıcı oturumunda uygulama exception'ı görülmedi; WebGL sürücüsü `ReadPixels` GPU stall uyarıları verdi. Bunlar uygulamanın renderer warning sayacından ayrıdır; performans sınırı olarak kaydedilmiştir.

## A. Mevcut kaynak başlangıcı

`Drawing1_INSA_on_test.dxf`: 2.423.497 bayt; SHA-256 `2d31cc8a1bae9607433126db92a7c3a9ac9c2a853f437b08c4a1c32e1e3a8749`. Kaynak 4.765 entity, 19 katman; önceki sonuç 26.574 segment ve 232 destek dışı/kusurlu entity idi. Özgün baytlar, handle'lar, katmanlar ve kaynak revizyonu değişmedi. Önceki veri dizini korunarak `test-results/real-dxf02/data` içinde ayrı kabul kopyası kullanıldı.

## B. Değişen dosyalar

- `packages/infra/src/cad-source.ts`: düzlemsel OCS dönüşümü, özgün segment indeksleri ve dejenerasyon kayıtları.
- `packages/infra/src/cad-inspection.ts`: sınırlı kaynak topolojisi, analitik projeksiyon, istasyon bağlamları, birim kanıtı, inceleme doğrulaması ve dönüşüm engelleri.
- `packages/infra/src/cad-tools.ts`: mevcut `infra_query_cad` üzerinde inspection; mevcut `infra_review_cad` üzerinde alignment-review.
- `packages/infra/src/module.ts`, `index.ts`: mevcut olay akışına `CadAlignmentReviewSet` v1 ve dışa aktarımlar.
- `apps/web/src/cad-source-overlay.ts`: katman bazında çizgi batch'leri, kaynak parça eşlemesi.
- `apps/web/src/CadEngineeringInspection.tsx`: mühendislik inceleme paneli, kaynak zinciri/OCS/etiket/birim/karar denetimleri.
- `apps/web/src/CadInterpretation.tsx`: mevcut CAD akışında yeni panel ve toplu çizim kullanımı.
- `apps/web/src/infrastructure-view.ts`: LineSegments, özgün parçaya raycast, highlight/focus ve kaynak temizliği.
- `apps/web/src/viewer.ts`: BIM modeli olmadan kaynak seçimi ve konum tamponu sayacı.
- Testler: `packages/infra/test/cad-inspection.test.ts`, `apps/web/test/cad-batching.test.ts`, `apps/manager-mcp/test/cad-inspection-runtime.test.ts`.
- Yeniden üretim: `scripts/real-dxf02-{parse,inspect,demo,verify}.mjs`, `scripts/real-dxf02-reference.py`.

Yeni MCP sunucusu, kanonik eksen motoru veya veri tabanı eklenmedi.

## C. Gerçek OCS geometrisi kurtarma

137 negatif-Z OCS yayı geri kazanıldı. Yeni toplam 26.711 segment, 95 destek dışı/kusurlu entity. Keyfi 3B normal ve sıfır normal düzleme zorlanmıyor; sıfır olmayan elevasyon/kalınlık destek dışı kalıyor. Negatif Z için OCS X ekseni WCS -X, OCS Y ekseni WCS +Y olur; merkez, uçlar ve sweep birlikte dönüştürülür. INSERT dönüşümleriyle bileşim korunur.

Bağımsız Python referansı ham DXF tag'lerinden çapraz çarpımlarla OCS bazını hesapladı. 309 ARC kontrolünde en büyük sayısal artık **1,626953582672133e-11 çizim birimi**, negatif normal sayısı 137. ezdxf çalıştırıldığı iddia edilmez; bağımsız formüller, [ezdxf OCS kaynak uygulaması](https://github.com/mozman/ezdxf/blob/master/src/ezdxf/math/ucs.py) ile karşılaştırıldı.

| Handle | WCS merkez | R | Özgün yönlü sweep (radyan) |
|---|---|---:|---:|
| 1414A | 55664,34 / 46815,13 | 3000 | -0,14538592669112838 |
| 1414C | 53793,18 / 47979,46 | 3000 | -0,06667157742618457 |

Tam uç noktaları ve bazlar `test-results/real-dxf02/independent-ocs.json` içinde.

## D. AX-01 / AX-02 ve yeniden hesaplanan topoloji

`0_Prj_Eksen`: 94 entity, 2.751 segment, 2.839 düğüm; 2.663 uç karşılaştırması. Uç eşitliği toleransı 1e-6 çizim birimi. Yakın uçlar için 1 çizim birimlik ayrı arama yalnız tanı üretir; snap veya otomatik birleşme yoktur. İç kesişmeler otomatik bağlantı sayılmaz.

| Aday | Handle'lar | Segment | Ham uzunluk (çizim birimi) |
|---|---|---:|---:|
| AX-01 | 1414D, 142C6, 142C7 | 1183 | 60675,226349811615 |
| AX-02 | 14153, 14155, 142C5 | 1249 | 60150,84705216278 |

86 yerine **88 kaynak bileşeni** var. Bu sayı 88 ayrı demiryolu hattı anlamına gelmez. Geri kazanılan 1414A ve 1414C, AX-11 ve AX-16 olarak ayrı kaldı. Gerçek uç boşlukları 0,0084439308065–0,254445981169 çizim birimi aralığında; daha büyük toleransla yapay birleşme yapılmadı. AX-01/02 sırası deterministiktir, mühendislik kilometraj yönü değildir.

## E. Dejenere polylineler

94 LWPOLYLINE ve bir sıfır uzunluklu LINE üzerinde 112 kusur: 104 tam eşit ardışık köşe, 7 kapalı dikiş tekrarı, 1 zero-length-LINE. Kusurlu entity'lerde özgün 3.592 segment girişine karşılık 3.480 sıfır olmayan segment bulunur. Kaynak değişmez; varsayılan karar `keep-unresolved`.

Yalnız 111 tam eşit/sıfır-bulge tekrar, açık inceleme kararıyla türetilmiş adayda yok sayılabilir. Her işlem entity/segment/reviewRevision ile kaydedilir. Bağımsız sıfır LINE ve sıfır mesafeli sıfır olmayan bulge bu normalizasyona dahil değildir. Gerçek kabul kopyasında normalizasyon uygulanmadı.

## F. Eğri sınıflandırması ve belirsizlik

AX-01: 7 exact-source-line, 27 exact-circular-arc, 1149 polyline-chord-unresolved. AX-02: 20 / 28 / 1201. Kaynak yaylar analitik tutulur; ekrandaki tessellation yalnız gösterimdir. Dönüşlü polyline kirişleri clothoid ya da yeniden kurulmuş parametrik kurp sayılmaz. Bağımsız geçiş parametreleri bulunmadığından geçiş geometrisi doğrulanmış değildir.

## G. TS / SC / CS / ST ve kilometraj

58'er TS/SC/CS/ST, 367 KM ve 147 diğer station occurrence korunur. Sayılar benzersiz yapı ya da doğrulanmış kilometraj bağı değildir. Etiketler analitik çizgi/yay üzerine projekte edilir; başka bileşene benzer yakınlık ayrıca belirsiz olarak gösterilir. Yakınlık mühendislik doğrulaması değildir.

13CC6 `31+551` ile 13CC7 `0+000`, kaynak sıra yönünde yaklaşık 20,46 birim arayla sıfırlama uyarısı üretir. İki bağımsız bağlam, candidate durumunda arayüzden kaydedildi. Yön unknown; yetkili station equation kurulmadı. Negatif `-0+453` işareti tam değere uygulanır. Bağlam, etiket kararı ve gerekçe mevcut onay/olay akışından kalıcıdır.

## H. Birim ve koordinat kanıtı

Başlık `$INSUNITS=4` (mm). 14+000–15+000 örneği yaklaşık 1000,000329 çizim birimi: mm varsayımı yaklaşık 1 m, metre varsayımı yaklaşık 1000 m verir. Bu çelişki salt okunur kanıttır; onaylanmış ölçek değildir. AX-01'de 59, AX-02'de 57 karşılaştırılabilir çift bulunur. Kullanıcının **unresolved** kararı korunur. CRS, datum, georeferencing veya Z değerleri icat edilmedi.

## I. Dönüşüm uygunluğu

İnceleme durumu `requires-engineering-review`, `eligible:false`. Engeller: yakın uç boşlukları, doğrulanmamış polyline geçişleri, bilinmeyen istasyon yönü, sıfırlama/çoklu bağlam, doğrulanmamış ilişkiler, belirsiz birim, belirsiz koordinat referansı ve kullanıcı mühendislik doğrulaması. Panelde verified inceleme kararı dahi bu fazda kanonik dönüşüm izni vermez. Güncel hash/revizyon/imza ve optimistic review revision kontrol edilir; eski kaynak kararları stale gösterilir. Kanonik eksen **0**, BIM elemanı **0**.

## J. Native viewer ve UI

Mevcut Three.js altyapısında kaynak çizgiler katmana göre batch edilir. Her primitive özgün entity/segment kimliğine geri eşlenir; seçim, yeşil highlight ve focus kaynak parçaya uygulanır. Kaynak geometrisi sadeleştirilmez. Ana AX-01/02, geri kazanılmış 1414A yayı, birim çelişkisi ve inceleme engelleri gerçek tarayıcıda görüntülendi.

Kaynak bütünüyle saklanır. 5.000 segment / 150.000 çizim noktası bütçesi aşıldığında bütün çizim açık tanıyla engellenir; sessiz kırpma yoktur. Dar katman seçimi gerekir. Kaynak etiketleri panelde okunur; 3D yazı render'ı eklenmedi. Kapalı/branşlı bileşenler yetkili açık eksen olarak sıralanmaz. Orta kesişimlerin mühendislik anlamı otomatik çözülmez.

AX-01 kararı gerçek tarayıcıdan kaydedildi; iki bağlam/iki ilişki, gerekçe ve unresolved kararı korundu. Sunucu yeniden başlatıldıktan sonra arayüz tekrar `current · Kanonik model: yok` gösterdi. Snapshot yeniden açılış durumu birebir eşit bulundu.

## K. Gerçek tarayıcı kanıtları

`test-results/real-dxf02/`:

- `01-ax01-source.png`: AX-01 bağımsız kaynak vurgusu.
- `02-readiness-blockers.png`: mühendislik inceleme engelleri.
- `03-ax02-source.png`: AX-02 bağımsız kaynak vurgusu.
- `04-recovered-ocs-1414A.png`: 1414A yayının native görünümü, özgün handle ve OCS baz kaydı.
- `05-unit-conflict.png`: mm başlığı / metre hipotezi / unresolved kararı.
- `browser-reopen.json`: sunucu yeniden açılışı sonrası güncel karar ve bağımsız bağlamlar.
- `browser-batch-axis-km.json`: gerçek renderer sayaçları.

## L. Sayısal testler ve mevcut başarısızlık

Odaklı test grubu: **21/21 geçti**. +/-Z OCS, merkez/uç/sweep, yansıtılmış/döndürülmüş INSERT, bulge, öncesi/sonrası topoloji, yakın boşluk, 2000 entity indeks sınırı, tekrar/dikiş normalizasyonu, sıfır LINE, paralel aday belirsizliği, negatif kilometraj, reset, birim çelişkisi, chord belirsizliği, eski revizyon, izin/proje izolasyonu, AI kendi onayını verememesi, undo/snapshot/reopen, gerçek MCP şeması ve batch raycast/highlight/disposal kontrol edildi.

Geniş mevcut regresyon grubu: **133 test, 132 geçti, 1 başarısız**. Başarısızlık `packages/bim/test/exports.test.ts` symlink testi: Windows `EPERM` ile bağlantı oluşturmayı reddetti. Test atlanmadı veya tolerans gevşetilmedi; uygulama regresyonu olarak gizlenmedi. Bu geniş koşum son eklenen bir testten önceydi; odaklı 21 test son test revizyonunu kapsar. Yol, arazi/TIN, tünel/altyapı, earthworks, malzeme ve IFC export testleri mevcut grupta korundu. Tüm mevcut özelliklerin tarayıcıda yeniden elle modellenmesi yapılmadı.

Bağımsız gerçek kaynak sonuçları `independent-ocs.json`, `defects.json`, `AX-01.json`, `AX-02.json`, `persistence-actual.json` ve loglarda bulunur. Typecheck, çekirdek derleme ve web derlemesi çalıştırıldı; web paket boyutu uyarısı mevcut.

## M. Performans ve kaynak kullanımı

Önceki gerçek tarayıcı ölçümü (`test-results/real-dxf/browser-stats-final.json`): 3.753 kaynak nesnesi, ızgara dahil 3.754 geometry / draw call. Yeni gerçek tarayıcı: 2 kaynak batch'i, ızgara dahil **3 geometry / draw call**, texture 0, warning yok. Yeni kaynakta iki ilave kurtarılmış ARC bulunduğu için eski/yeni kaynak parça sayıları 3.753/3.755'tir.

Aynı güncel DXF, eksen + kilometraj katmanları üzerinde ayrıca eşit veri karşılaştırması:

| Ölçüm | Eski nesne/segment çizimi | Batch |
|---|---:|---:|
| Kaynak nesne | 3755 | 2 |
| Korunan kaynak parçası | 3755 | 3755 |
| Float32 konum tamponu | 104232 bayt | 118344 bayt |
| Son tek yerel kurulum ölçümü | 130,77 ms | 6,67 ms |

LineSegments ortak uçları tekrar yazar: konum tamponu %13,5 büyür. Kazanç nesne/draw-call sayısındadır; toplam RAM/VRAM azaldığı iddia edilmez. Bunlar BufferAttribute baytlarıdır, sürücü VRAM ölçümü değildir. Tek kurulum zamanı FPS veya istatistiksel benchmark değildir. Topoloji uç hash ızgarası ve projeksiyon AABB ağacı kullanır; gerçek eksen sorgusunda 50.534 projection node ziyareti raporlandı.

## N. Orijinal kaynak kullanılabilirliği

Masaüstündeki `Drawing1.dxf` bulunamadı. Kullanıcı önceki soruda mevcut filtrelenmiş `Drawing1_INSA_on_test.dxf` yolunu yeniden doğrulamıştı. Kabul bu dosyayla sınırlıdır; orijinal dosyanın test edildiği iddia edilmez. Yapı açıklamaları önceki kayıtlarıyla korunur: 332 metin occurrence (188 tünel, 127 köprü, 4 viyadük, 13 menfez); benzersiz yapı sayısı değildir. `00_Tunel_Profil` içindeki dört kısa LINE doğrulanmış boykesit/enkesit/PVI değildir. Yapı geometrisi türetilmedi.

## O. Yeniden üretim

Repo kökünde:

```powershell
node --import tsx scripts/real-dxf02-parse.mjs
node --import tsx scripts/real-dxf02-inspect.mjs
python scripts/real-dxf02-reference.py
node --import tsx scripts/real-dxf02-demo.mjs
node --test --import tsx packages/infra/test/cad-source.test.ts packages/infra/test/cad-inspection.test.ts apps/web/test/cad-batching.test.ts apps/manager-mcp/test/cad-inspection-runtime.test.ts
powershell -File scripts/test-d2a-dwg02a.ps1
npm run typecheck
npm run build:web
```

Tarayıcı kabul kopyası: `INSA_DATA=test-results/real-dxf02/data`, `PORT=8803`, `INSA_APPROVAL=ai`; `node --import tsx apps/web-server/src/index.ts`. Geliştirme oturumuyla Taha seçilir; CAD / DXF yorumla → Salt okunur eksen adaylarını incele → AX-01 / AX-02. Birim kararı değiştirilemez. `real-dxf02-verify.mjs`, tarayıcıdan kaydedilmiş AX-01 iki bağlam/iki ilişki kararını ve snapshot yeniden açılışını doğrular; temiz kopyada önce bu inceleme kaydı gerekir. Eski 8802 sunucusunun verisine müdahale edilmedi.

## P. Onaylı kanonik dönüşüm için eksikler

Yetkili kaynak birimi/ölçeği, CRS ve datum, kilometraj yönü ve iki kilometraj bağlamının mühendislik ilişkisi, TS/SC/CS/ST parametreleri ve tam geçiş eğrisi tanımı, uç boşluklarının kaynak mühendislik kararı, varsa doğrulanmış boykesit/Z/PVI verisi ve kullanıcı dönüşüm onayı gerekir. Sonraki en küçük adım bunların kaynak belgeyle doğrulanmasıdır; bu faz kendi başına yetkili demiryolu ekseni üretmez.
