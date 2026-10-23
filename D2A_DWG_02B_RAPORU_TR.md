# D2A-DWG-02B — Onaylı boykesit → kanonik 3B alignment

15 Ekim 2026. Uygulandı. İzole demonstrasyon: [INSA 8801](http://localhost:8801/), proje `cad-engineering-demo-v2`, tek kanonik hizalama **AL-001**. XY özgün onaylı 02A yatay geometriden, Z yeni onaylı ve eşleşen gerçek DXF tasarım profilinden geliyor. Özgün 0–1000 m profil ve bütün eski kaynak incelemeleri değiştirilmedi. Kullanıcının diğer sunucu/veri dizinleri değiştirilmedi.

## A. Yeniden kullanılan mimari

Mevcut DXF parser, CAD bölge/rol/kalibrasyon modeli, immutable ArtifactStore, Shared Tool Registry, Platform command/query, AI önerisi/insan onayı, optimistic commit, AlignmentSet, event replay, undo, FileStores/snapshot ve BIM georeference kullanıldı. PVI, checkVertical, evalV, evalH, point3d ve sampleStations aynı mühendislik motorudur. Yeni düşey hesap motoru, MCP servisi, veri tabanı, Scene/Camera/Renderer oluşturulmadı. Aynı kanonik ID üzerinde yalnızca PVI ve düşey kaynak ilişkisi güncellenir.

ESM döngüsünü önlemek için mevcut align3d uyarlayıcısı alignment-resource.ts içine taşındı; module.ts eski dışa aktarımı korur. Canonical BIM/type/material ve IFC mimarisi değiştirilmedi.

## B. Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| packages/infra/src/cad-vertical.ts | Kalibre kaynak → mevcut PVI; uygunluk, aralık, datum, kurp/etiket kanıtı, preview hash, lineage/idempotency |
| packages/infra/src/alignment-resource.ts | Mevcut align3d adaptörünün döngüsüz ortak yeri |
| packages/infra/src/alignment.ts | Açık düşey kapsam, kapsam dışında extrapolation engeli, mevcut örnekleyiciyle kısmi profil |
| packages/infra/src/module.ts | Aynı infra_update_alignment içinde cadVertical; rapor/sorgu, eksik kapsamda yol/tünel engeli |
| packages/infra/src/cad-tools.ts | Mevcut infra_query_cad içinde read-only verticalConversion ve hedef hash metadata |
| packages/infra/src/index.ts | Ortak dışa aktarım |
| apps/manager-mcp/src/runtime.ts | Aynı commit snapshot içinde düşey datum/georeference doğrulaması |
| apps/web-server/src/infrastructure.ts | Kanonik XY+Z; kısmi kapsam dışında çizgi üretilmemesi; native segment özellikleri |
| apps/web/src/CadVerticalConversion.tsx | Rol/yön/kapsam/datum/etiket, önizleme ve açık onay; kaynak/model seçimleri |
| apps/web/src/CadInterpretation.tsx | Mevcut CAD paneline düşey form |
| apps/web/src/CadConversion.tsx | Mevcut kanonik özelliklerde PVI sorgu/edit |
| apps/web/src/viewer.ts | Altyapı modelinde Sığdır için mevcut kamera ve altyapı sınırlarının kullanımı |
| packages/infra/test/cad-vertical-fixture.ts | Gerçek matched, iki eğimli, parabolik, ters eksen/sıra ve uzun DXF üreticisi |
| packages/infra/test/cad-vertical.test.ts | Bağımsız analitik ve olumsuz kaynak testleri |
| apps/manager-mcp/test/fixtures/cad-vertical.ts | Gerçek kaynak/onay/registry fixture hazırlığı |
| apps/manager-mcp/test/cad-vertical-runtime.test.ts | Gerçek MCP, onay, atomiklik, snapshot/undo ve native/downstream testleri |
| scripts/cad-d2a-02b-demo.mjs | Özgün 02A'yı koruyan ayrı demo kopyası ve yeni kaynaklar |
| scripts/cad-d2a-02b-verify.mjs | Gerçek tarayıcı kaydını bağımsız doğrulama, snapshot/reopen |
| scripts/cad-d2a-02b-performance.mjs | Kısa/uzun gerçek parse→commit→scene ölçümü |
| scripts/test-d2a-dwg02b.ps1 | Mevcut seçili regresyon + yeni runtime paketi |
| D2A_DWG_02B_RAPORU_TR.md | Bu rapor |

Derlenen web çıktısı apps/web/dist içindedir. DXF, screenshot, log, JSON ve izole demo verileri test-results/d2a-dwg02b altındadır. Git çalışma ağacı mevcut olmadığı için dosya listesi bu çalışma kapsamında yapılan değişikliklere dayanır.

## C. Onaylı profil uygunluğu ve kalibrasyon

Yalnız confirmed longitudinal-profile kabul edilir. Drawing hash/revizyon, bölge sourceRevision/reviewRevision, hedef horizontalHash ve targetVerticalHash, mevcut CRS/georefHash birlikte sabitlenir. Onaysız, yeniden incelenmiş, değiştirilmiş kaynak veya hedef eski preview ile yazılamaz.

Kaynak birimi, bağımsız istasyon/kot eksenleri ve referanslar açık olmalıdır. Pozitif fixture çizelgesi: X=300→s=0, X=400→s=1000; Y=500→z=100, Y=700→z=110. Üçüncü kontroller X=310→s=100 ve Y=600→z=105. Dönüşümler s=10X−3000, z=0.05Y+75; bütün kalibrasyon artıkları sıfır. Bu çizelge XY'si mühendislik dünya XY'si değildir. Ters eksen ve açık ters kaynak sırası ayrı analitik testlerden geçti.

## D. İstasyon uyumu

Hedef aralık 0–278.53981633974485 m. Yeni matched kaynak 0–278.5398163397449 m; fark yalnız IEEE kayan nokta düzeyindedir. Özgün 0–1000 m profil tam dönüşümde STATION_RANGE_MISMATCH ile reddedilir; tarayıcı kanıtı 08-original-range-rejected.png.

Tam, açık kısmi ve doğrulanmış karşılık aralığı modları vardır. Uzun kaynak için karşılık aralığı yalnız kaynak içindeki özgün alignment kimliği metni hedef ID/adıyla eşleştiğinde, chainage aynen korunduğunda ve kullanıcı mühendislik eşleşmesini onayladığında kullanılabilir. Başlangıç/yön sessiz kaydırılmaz veya ters çevrilmez. İstasyon denklemi metni bulunursa bu sürüm desteklemiyor diyerek bloklanır.

## E. Düşey rekonstrüksiyon

Açık seçili tasarım LINE/LWPOLYLINE parçaları kalibrasyondan gerçek (station,z) çiftlerine dönüşür; bağlantılı doğru parçalarının eğimi Δz/Δs olarak hesaplanır. Mevcut PVI dizisi üretilir. Sparse text, ARC, SPLINE veya boşluk üzerinden profil uydurulmaz. Çakışan/kopuk parçalar, dal/overlap, iç kaynak süreksizliği ve birden fazla çelişkili kurp tanımı reddedilir; kot ortalaması alınmaz.

Kısmi profilin dışında infra_station z:null döndürür. evalV/point3d dışında kot uzatmaz. Native sahne yalnız bilinen düşey aralığı çizer. Mevcut yol ve tünel tüketicileri tam düşey kapsam olmadan üretimi reddeder.

## F. Eğimler ve desteklenen kurplar

Birincil tasarım z(s)=100+0.01s; eğim +%1. İki eğimli kaynak PVI(100,101) noktasında +%1 → −%0.5 keskin kırık olarak korunur. Kurp kanıtı yoksa curve alanı eklenmez.

Parabolik fixture aynı teğetleri ve özgün PVI S=100, PVI Z=101, LVC=20.00 m, GIN=1.00%, GOUT=−0.50% metinlerini taşır. Bu değerler kaynak ID'lerine açık bağlanır ve kaynak teğetleriyle karşılaştırılır; mevcut simetrik parabolik PVI motoruna curve:20 verilir. s=90..110 için bağımsız denklem, x=s−90: z=100.9+0.01x−0.015x²/40; g=0.01−0.015x/20. s=100 kotu 100.9625 m. Parametresiz kurp uydurulmaz, kurbu kesen aralık çıkarımı desteklenmez.

Bağımsız yüzde etiketleri gradeChecks ile kaynak istasyonuna bağlanır. Bağlanmamış veya geometriyle çelişen yüzde değeri dönüşümü engeller. Kaynak % birimi ratio diye yorumlanamaz. Toleranslar: istasyon/kot 1e−5 m, eğim 1e−8.

## G. Mevcut/tasarım ayrımı

Renk tek başına rol belirlemez. Onaylı VG mevcut zemin, VD tasarımdır; kullanıcı rol seçimini ayrıca onaylar. Yalnız VD kanonik Z üretir. VG, özgün çizim koordinatları ve kalibre değerleriyle source-linked reference olarak tutulur; terrain/TIN kaynağı oluşturulmaz. Siyah/kırmızı kot etiketleri station/elevation/role bağlarıyla ayrı doğrulanır. Kaynak metinleri, düzeltmeler ve gerekçeler korunur.

## H. Bağımsız analitik karşılaştırma

| İstasyon m | Analitik Z m | INSA engineering.z m | Mutlak fark m |
|---|---|---|---|
| 0.000000000000 | 100.00000000000000 | 100.00000000000000 | 0.00e+00 |
| 100.000000000000 | 101.00000000000000 | 101.00000000000000 | 0.00e+00 |
| 139.269908169872 | 101.39269908169872 | 101.39269908169872 | 0.00e+00 |
| 200.000000000000 | 102.00000000000000 | 102.00000000000000 | 0.00e+00 |
| 278.539816339745 | 102.78539816339745 | 102.78539816339745 | 0.00e+00 |

Yatay yay ortasında bağımsız kontrol: X=412100+50/√2=412135.3553390593, Y=4561050−50/√2=4561014.64466094; azimut π/4. Mevcut station API'sinin yuvarlanmış x/y/z gösterimi korunur; engineering alanı tam hassasiyetli x/y/z/grade sağlar. direction=[cos(az),sin(az),grade] istasyon türev vektörüdür.

## I. Kanonik bütünleştirme

Tek AL-001 ve üç eski segment kimliği korunur. elements, points, start_station ve cadSource değiştirilmez. Yalnız pvis ve verticalSource aynı AlignmentSet olayıyla değişir. Gerçek tarayıcı kaydı eski 02A dosya durumu ile birebir karşılaştırıldı: bütün eski kaynaklar/bölgeler ve yatay geometri aynı. Yol/tünel motorları aynı source-derived AL-001'i kullanarak ayrı izole testlerde üretim yaptı; yeni bir alignment kopyası gerekmedi. Demo projeye otomatik yol/tünel eklenmedi.

## J. Native 3B kontrolü

Mevcut Three.js InfrastructureView, kamera, kaynak ağacı, native line nesneleri ve seçim kullanılır. XY evalH'den, Z evalV'den, viewer koordinatı mevcut georeference dönüşümünden gelir. Parabolik örnekleme mevcut sampleStations üzerinden hesaplanır. Bilinmeyen Z sıfır gibi çizilmez. Sığdır yalnız altyapı bulunan veya BIM nesnesi gizli olan görünümde altyapı sınırlarını kullanır; BIM model kadraj yolu korunur. Yeniden açılan son model ve istasyon sorgusu 11-final-fit-reopen.png içinde birlikte görünür.

## K. Kaynaktan modele izlenebilirlik

verticalSource: kaynak drawing/region/asset/filename/hash/revizyon, reviewRevision, horizontalHash, orijinal kalibrasyon, kullanıcı kararları/datum, seçilmiş design kaynak kimlikleri, mevcut zemin referansı, özgün metinler, gerekçeli düzeltmeler, kurp kanıtları ve başlangıç PVI hash'i taşır. Kaynak current/source-outdated/review-outdated; yatay geometri unchanged/edited-after-vertical-conversion; düşey geometri as-converted/edited-after-conversion olarak raporlanır. infra_alignment_report ve native resource özellikleri bu bilgileri sunar. Kaynak paneli ile kanonik özellikler ayrı bağlamlardır.

## L. Onay, geri alma, kalıcılık ve yeniden dönüşüm

Önizleme read-only; seq değişmedi. AI MCP çağrısı öneri üretir, AI kendi önerisini onaylayamaz. İnsan onayında kaynak, hedef ve georeference tekrar doğrulanır. Eski preview, kaynak değişimi, hedef PVIs değişimi veya georeference değişimi atomic reddedilir.

Aynı kaynak/konfigürasyon sağlam mevcut PVI ile tekrar uygulanamaz. Kaynak incelemesi veya PVI elle değişmişse replacement onayı ve gerekçe gerekir. Manuel edit kaynak lineage'ını silmez. Tarayıcıda uç kot +1 m değiştirildi, gerçek history undo ile +1% kaynağa dönüldü. Testte dönüşüm undo edildi, aynı canonical ID'ye tekrar uygulandı. Snapshot oluşturuldu ve yeni Platform instance'ı aynı durumu yükledi; sunucu yeniden başlatılıp tarayıcıda doğru Z tekrar sorgulandı.

## M. Gerçek tarayıcı kanıtları

Gstack /browse kullanıldı; API yanıtı ekran görüntüsü yerine geçirilmedi. PNG dosyaları açılıp görsel olarak incelendi.

| Kanıt | Dosya |
|---|---|
| Mor geçici gerçek 3B önizleme, etiket bağları | test-results/d2a-dwg02b/01-preview.png |
| Onaylanmış PVI ve eğimler, mevcut zemin ayrı | test-results/d2a-dwg02b/03-approved-values.png |
| Özgün chart çizimi ayrı bağlam | test-results/d2a-dwg02b/04-source-context.png |
| Yay ortasında gerçek station sorgusu | test-results/d2a-dwg02b/05-station-query.png |
| Elle PVI düzenleme | test-results/d2a-dwg02b/06-manual-edit.png |
| Undo sonrası +1% bitiş kotu | test-results/d2a-dwg02b/07-undo.png |
| Eski 1000 m kaynağın reddi | test-results/d2a-dwg02b/08-original-range-rejected.png |
| Native gerçek segment seçimi | test-results/d2a-dwg02b/10-native-segment-selection.png |
| Son derleme, yeniden açma, Sığdır ve doğru Z | test-results/d2a-dwg02b/11-final-fit-reopen.png |

Kaynak VD seçimi cad:VD:0; kanonik segment seçimi infra:AL-001:segment:2 olarak ayrı çalıştı. Son browser-console-final.txt: no console errors. Sunucu restartında eski login token'ı sona erdi; tekrar kullanıcı seçilerek test sürdürüldü. Bu beklenen yeniden giriş test verisini değiştirmedi.

## N. MCP ve UI iş akışı

Yeni MCP tool eklenmedi. Aynı shared registry araçları genişletildi:

1. infra_query_cad → onaylı kaynak/candidate + alignmentTargets/hash metadata.
2. infra_query_cad {drawing, verticalConversion:{...}} → uygunluk, tolerans/artıklar, PVI, eğimler, ayrı existing reference ve geçici scene; event yok.
3. infra_update_alignment {alignment:'AL-001', cadVertical:{...configuration,previewHash}} → mevcut insan onayıyla aynı kanonik hizalama.
4. infra_station, infra_alignment_report, infra_query → mevcut mühendislik sorguları.
5. infra_update_alignment {alignment,vertical:[...]} → mevcut parametrik edit; platform_undo → mevcut undo.

Konfigürasyon sourceHash/reviewRevision, horizontalHash/targetVerticalHash/georefHash, seçilen designEntities, rolesConfirmed, direction/directionConfirmed, correspondenceConfirmed/reason, coordinateCrs/Confirmed, coverage, açık datum, annotationChecks, isteğe bağlı gradeChecks ve curves içerir. Full input Zod ile doğrulanır. Gerçek stdio MCP tools/call testi query→AI proposal→human approval zincirini çalıştırdı; manager config'i veya ayrı MCP servisi değiştirilmedi.

## O. Testler ve derlemeler

| Paket | Sonuç | Log |
|---|---|---|
| Odaklı analitik + yeni runtime/MCP | **12/12 geçti**, 0 skip | focused-final.log |
| Yeni runtime ayrı son doğrulama | **5/5 geçti**, 0 skip | runtime-final.log |
| Mevcut seçili infra/CAD/road/tunnel/TIN/earthworks/BIM material/IFC/native/MCP regresyonu, yeni 7 analitik dahil | **126 test: 125 geçti, 1 başarısız**, 0 skip | regression-final.log |
| Backend npm run build / tsc -b | geçti | build-backend.log |
| npm run typecheck | geçti | typecheck-final.log |
| npm run build:web | geçti; mevcut büyük bundle uyarısı | build-web-final.log |
| Gerçek kayıt/XY/5 istasyon/idempotency/snapshot-reopen | geçti | verify.log, verification.json |

Bu gruplar örtüşür; sonuçlar körlemesine toplanmamalıdır. Son seçili 126 teste yeni runtime 5 test dahil değildir. Önceki seçili 02A baseline 118/119 idi. Son tek hata aynı packages/bim/test/exports.test.ts Windows symlink oluşturma EPERM durumudur; assertion kaldırılmadı/skip edilmedi. İlk çalıştırmada ayrıca FileStore rename EPERM transient hatası çıktı; ilgili yol/TIN testi ayrı tekrarda ve son tam seçili çalıştırmada geçti. İlk log regression.log ve mcp-retry.log korunuyor.

Önceden belgelenmiş daha geniş BIM/Core sorunları (uzantısız tsx spawn ENOENT, join ilişkili duvar replay fixture, spatial/structural dosya hataları) bu aşamanın kapsamı dışında; test-results/d2a-dwg01/bim-regression.log ve D2A_DWG_02A_RAPORU_TR.md referansıdır. Bu aşamada tüm repository testlerinin yeşil olduğu iddia edilmiyor.

## P. Performans ve sınırlar

Aynı makinede gerçek FileStores/registry ve fixture; tek ölçüm, milisaniye. Bir FPS veya üretim ortamı garantisi değildir. Uzun kaynak açık 500 doğru eğim parçası taşır; mühendislik geometrisi sadeleştirilmedi.

| Kaynak | Uzunluk m / parçalar | Parse | Kalibrasyon | Dönüşüm | Preview toplam | Update | 100 sorgu | Native scene |
|---|---|---|---|---|---|---|---|---|
| short | 278.53981633974485 / 1 | 0.156 | 0.165 | 0.776 | 14.104 | 41.088 | 259.210 | 4.683 |
| long | 20000 / 500 | 1.348 | 0.483 | 1.820 | 18.327 | 44.152 | 280.402 | 13.615 |

Ham ölçüm performance.json. Native sahnede kısa 51, uzun 2001 vertex. En fazla 2000 açık eğim parçası, 500 seçili kaynak, 500 kot/eğim bağı, 100 kurp kanıtı ve 50000 preview örnek bütçesi var; mevcut CAD sınırları korunur. Eşleşen fixture parser boyutları yaklaşık 1 KB / 21 KB.

Destek dışı: ARC/SPLINE'dan parabol çıkarımı; asimetrik/delilsiz kurplar; chainage equations; datum dönüşümü; kısmi kapsam dışında extrapolation; kurbun içinden başlayan/biten interval çıkarımı; sparse metinlerden yetkili profil uydurma; özel DWG/Civil 3D parsing. Doğrulanmış interval kaynak geometriyi ve özgün chainage'ı korur; kullanıcı onayı tek başına ilişkisiz uzun profili uygun yapmaz.

## Q. Tekrar üretme

Repo kökünde:

```powershell
npm run typecheck
npm run build
npm run build:web
node --test --import tsx packages/infra/test/cad-vertical.test.ts apps/manager-mcp/test/cad-vertical-runtime.test.ts
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-d2a-dwg02b.ps1
node --import tsx scripts/cad-d2a-02b-demo.mjs
$env:INSA_DATA = Join-Path (Get-Location) 'test-results/d2a-dwg02b/data'
$env:PORT = '8801'
$env:INSA_APPROVAL = 'ai'
npm run web
```

Demo hazırlığı var olan izole veriyi silmez; ilk hazırlık için önceki 02A izole fixture gerekir. Kaynak DXF üreticisi ve bağımsız runtime fixture bu eski demo olmadan da test edilebilir. 8801 başka işlemle kullanılıyorsa başka boş port seçin.

Tarayıcı: Taha → cad-engineering-demo-v2 → CAD/DXF yorumla → matched-profile.dxf → confirmed region. Hedef AL-001; VD tasarım/VG mevcut; artan kaynak sırası; kaynak ALIGN_ID; açık eşleşme gerekçesi. Kaynak/hedef datum LOCAL:02B-Z, local karar ve gerekçe. PZ0/GZ0→PS0, PZE/GZE→PSE. Salt okunur düşey önizleme. İlk kezse onay kutusu→uygula; mevcut aynı dönüşüm varsa duplicate engeli gösterilir. Güncel kanonik 3B modeli göster veya Mühendislik modeline dön; AL-001 seç→Sığdır→istasyon sorgula. Özellikler içinden PVI JSON edit ve Geçmiş→Son işlemi geri al kullanılabilir.

Kaynak/model seçiminden sonra kanonik kaynak tree'de aynı AL-001 kalır. Özgün engineering-multiregion.dxf Boykesit kaynağı hâlâ 0–1000 m'dir. Ayrı two-grade-profile.dxf ve parabolic-profile.dxf dosyaları da mevcut; parabolik kurp kaynak ref JSON'u fixture üreticisinde belgelenmiştir. Son gerçek demo kaydı için:

```powershell
node --import tsx scripts/cad-d2a-02b-verify.mjs
node --import tsx scripts/cad-d2a-02b-performance.mjs
```

## R. En küçük sonraki aşama

Onaylı CAD enkesit bilgisini mevcut section/road corridor kaynaklarına bağlayan sınırlı bir aşama: mevcut 3B AL-001 üzerinde station uyumu, açık lane/shoulder sınırları ve canonical material layer eşlemesi; read-only preview ve tek onaylı mevcut road create/update. Yeni yol, arazi veya earthworks motoru gerekmiyor. Bu çalışma kapsamında otomatik enkesit→road üretimi başlatılmadı.
