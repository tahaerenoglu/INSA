# INSA Phase 2 — çatı, koordinasyon ve güvenli onarım ara teslimi

23 Ekim 2026. Phase 2'nin tamamı bitmedi. Bu teslim P1'in çok düzlemli çatı, indeksli clash ve sınırlı güvenli onarım bölümüdür. Genel eğimli cephe/serbest çatı motoru, bütün disiplinlere ait ortak ilişki grafı ve P2–P5 genişletmeleri tamamlanmış sayılmamalıdır.

## 1. Korunan ilk aşama

Mevcut BIM/altyapı/dosya modülleri, kategori–motor ayrımı, ortak tipler, Platform yetki/onay/event/audit/undo/snapshot/replay zinciri ve IFC → ThatOpen Fragments yolu korunur. Yeni kalıcı mesh, paralel viewer veya alternatif model veritabanı yoktur. Yeni bağımlılık eklenmedi. Git deposu `tahaerenoglu/INSA`; aktarım başlangıcı `fbaad76`.

## 2. Eklenen hesaplar ve araçlar

Yeni LLM aracı eklenmedi; sekiz ortak giriş aynı kaldı. `solid-geometry.ts` mevcut elemanlardan türetilen konveks katı hücreleri, SAT temas/kesişim, gerçek polyhedral mesafe ve sonlu doğru–katı kırpma hesaplarını içerir. `coordination.ts` bunları sweep-and-prune aday indeksiyle kullanır. Bunlar yeni bir authoring motoru veya saklanan mühendislik nesnesi değildir.

Mevcut `pitched_roof` motorunun gerçek beşik/kırma çatı düzlemleri `wallRoof` içine bağlandı. Duvarın parça parça üst sınırı, temsili, quantities ve IFC clipping aynı düzlemleri kullanır. Mahya duvarın ortasından geçiyorsa iç maksimum da hesaba katılır. Çatı pitch/type/storey değişiklikleri mevcut bağımlılık doğrulamasından geçer; kullanılan çatı silinemez. Çatı boşluğunu kesen duvar bağlantısı reddedilir.

Çatı desteği dikdörtgen beşik/kırma çatı ve mevcut tek düzlemli boundary çatısıdır. Dış sınırda mevcut aks bağlantısı kontratı korunur; sıfır saçakta duvar kalınlığının tamamının çatı planında kapsanması garanti edilmez. Genel eğimli cephe, vadi, keyfi kademeli çatı ve serbest çok yüzeyli kabuk desteklenmez.

## 3. Ortak araç → capability eşlemesi

| Araç | Davranış |
|---|---|
| `project_analyze` | Mevcut capability şemaları, motorlar, kaynak revizyonları ve sorgular |
| `project_query` | Yetki kontrollü mevcut BIM/infra/files kanıt sorguları |
| `model_plan` / `model_generate` | building → conceptual-frame; reinforcement → hosted-rebar; network → service-network; corridor → alignment-corridor; array → shared-component-array |
| `model_revise` | Mevcut domain editörleri üzerinden atomik revizyon |
| `model_validate` | Domain/rebar/infra kontrolleri + yeni koordinasyon raporu; `ids`, metrik `tolerance`, `clearance` |
| `model_repair` | Issue kimliğiyle sınırlı onarım; eski açık roof+walls kontratı korunur |
| `model_export` | Mevcut IFC/Fragments ihracı; altyapı legacy IFC kapsam sınırı korunur |

Building requirements artık `roofForm: mono | gable | hip` ve pitched roof için `roofOverhang` kabul eder. Üretim, yeni elemanlar ve komşularını denetler; en fazla iki tur tek anlamlı güvenli onarım ekler. Sonuçta desteklenen kontrollerde hata kalırsa hiçbir child komut commit edilmez. Plan aynı adımları yalnız simüle eder; onarım adımları da Platform yetki ve onay zincirinin içindedir.

## 4. Donatı kapsamı

Bu teslimde yeni donatı host'u eklenmedi. Yüksek seviye otomatik layout hâlâ dik duran dikdörtgen kolonlarda boyuna çubuk ve etriyedir; döndürülmüş kolonun yerel çerçevesi ve cover kontrolleri korunur. Alt seviye mevcut reinforcement motorunun daha geniş host kabul etmesi, beam/slab/wall/footing/raft için otomatik geometrik layout'un tamamlandığı anlamına gelmez. Bu P2 işi bekliyor. Kapasite veya gerekli donatı alanı hesabı yapılmadı.

## 5. MEP kapsamı

Mevcut piping/HVAC/electrical sistem kaynakları, 3B polylines, açık connector/junction modeli ve domain fitting motorları korunur. Ortak network capability hâlâ açıkça onaylanmış şaft/servis bölgesi ve terminallerle kavramsal ortogonal rota üretir. Genel A*/Dijkstra, ekipmanlar arasında keyfi rota araması, otomatik fitting seçimi ve clash-aware rerouting bu teslimde yoktur. Yeni koordinasyon, tek anlamlı uyumlu açık connector çiftini bulur ve mevcut `bim_connect_mep` ile bağlar. Boyutlandırma hesabı yapılmaz.

## 6. Clash ve repair

Rapor sınıfları: `HardClash`, `ClearanceClash`, `ExpectedStructuralIntersection`, `MissingConnection`, `DisconnectedSystem`, `InvalidHostRelationship`, `DuplicateOverlappingElement`, `InvalidPenetration`.

Kayıtlar kararlı issue kimliği, elemanlar/disiplinler, konum/bölge, severity, tolerans, açıklama, öneri, autoRepairable ve kanıt türünü içerir. Başarı iddiası desteklenen geometri kapsamıyla sınırlıdır:

- AABB yalnız aday seçer. Kesin düzlemsel katı çakışması konveks hücre SAT üzerinden belirlenir.
- Clearance, desteklenen katılarda gerçek vertex/face ve edge/edge mesafesidir.
- Döşeme/boundary boşlukları triangulation ile çıkarılır; yalnız bounding box üzerinden yanlış delinme üretilmez.
- MEP için sonlu merkez hattının gerçek katı içinden geçen metrik uzunluğu delildir. Kesitin yalnız zarfıyla çakışması ve sistemler arası gövde çakışması henüz kapsanmaz.
- Kapı/pencere boşluklu duvarların katı ayrıştırması desteklenmiyorsa eleman `unsupported` listesinde görünür; dolu duvar gibi kesin sonuca zorlanmaz. Eğrisel ve dikdörtgen olmayan profiller de kapsam dışındadır.
- Mevcut açık duvar birleşimleri, bağlı çatı ve destek uç/başlık geometrileri beklenen yapısal arayüz sayılır. Bu sınıflandırma taşıyıcı yeterlilik kanıtı değildir; genel SupportedBy/ConnectedTo ilişki motorunun yerini tutmaz.
- Hücreler authoring katılarından türetilir; IFC'nin bütün yapısal ownership boolean kesileri koordinasyon hücrelerine henüz genel olarak aktarılmaz. Bilinen birleşimler bu nedenle beklenen arayüz olarak ayrı sınıflanır; her hücreyi nihai IFC CSG'sinin birebir kopyası sayma.
- Duvar duplicate ayrımı artık kesilmemiş authoring height yerine türetilmiş gerçek duvar katısını kullanır.

Otomatik onarım yalnız tek anlamlı uyumlu connector çifti, başka join/üçüncü duvar alternatifi bulunmayan uç birleşimi ve tek uygun komşu çatı bağlantısıdır. Issue seçimi eskimişse ret verilir. Genel issue onarımında `maxAttempts` 1–3 turdur; tekrar denenen issue kaydedilir, son durum yeniden doğrulanır, yeni koordinasyon hatası oluşursa işlem geri çevrilir. Hard clash için silme, taşıyıcı delme veya ölçü uydurma yoktur. Açık roof+walls isteği mevcut kullanıcı kontrollü domain revizyonudur.

İndeks her sorguda türetilir; kalıcı artımlı ağaç değildir. `ids` kesin çift kontrollerini ilgili komşulara daraltır, fakat katılar yeniden hazırlanır. Yoğun örtüşen modellerde aday sayısı karesel olabilir. Bazı domain invariants/topology ve çatı aday aramaları ayrıca tam tarama yapar; tüm platformun doğrusal ölçeklendiği iddia edilmez.

## 7. Doküman anlamlandırma

Bu teslimde P4 genişlemesi yapılmadı. İlk aşamanın dosya/revizyon atıfları, bilgi durumları, birim normalizasyonu, çelişki reddi ve BOQ'nun geometriyi yönlendirmemesi korunur. Otomatik çok paftalı Project Context, belge ilişkileri ve CAD aday eşleştirme henüz yoktur.

## 8. Bina ve altyapı

Bina örneği kavramsal çerçeve, kolon/kiriş, delikli döşeme, duvar ve seçilen çatı motorunu kullanır. Altyapı koridoru mevcut alignment ve kararlı ortak `componentType` kimliğiyle üretilir. Bina kapsamı platformun tamamı gibi sunulmaz. Koridor/terrain legacy IFC ihracında eksiktir; tam çıktı gibi raporlanmaz.

## 9. Gerçek doğrulama ve örnekler

Yerel kanıt klasörü: `output/umb-phase2-2026-10-23/`. Tekrar üretim: `node --import tsx scripts/phase2-modeling-demo.mts`. Canlı kullanıcı proje verisi kullanılmaz; üç ayrı MemoryStores projesi vardır.

| Gerçek istek | Ortak çağrılar ve motorlar | Sonuç |
|---|---|---|
| Üç katlı toplam 200 m² kırma çatılı bina | model_generate → wall/profile_member/boundary/pitched_roof; validate/export | 40 eleman; 0 raporlanmış validation issue; IFC ve Fragments üretildi |
| Kolon donatısı + temiz su sistemi | model_generate building/reinforcement/network → reinforcement/mep_network; validate/export | 49 eleman (40 bina + 4 donatı seti + 5 MEP segmenti); 3 açık junction; 0 raporlanmış issue; IFC ve Fragments üretildi |
| KM 1+000–3+000 ortak tipli altyapı | alignment/material/componentType hazırlığı; model_generate corridor → alignment/corridor; validate | 1 alignment, 1 componentType, 1 koridor; 0 raporlanmış issue; koridor IFC desteği iddia edilmez |

`examples.json` istekler, yüksek seviye girdiler, gerçek motorlar, sayılar, validation/coverage ve repair durumunu içerir. `calls.json` gerçek çağrı/yanıtları; ayrı BIM/infra JSON'ları ve history dosyaları olay kanıtını içerir. Bu üç düzgün üretilmiş örnekte repair gerekmemiştir. Onarımın gerçekten uygulandığı ve reddedildiği durumlar otomatik testlerdedir.

Odak doğrulamaları: mono/beşik/kırma çatı IFC'si gerçek web-ifc tessellation ile açılır; duvar hacmi bağımsız analitik oracle ile karşılaştırılır. Mahya iç maksimumu, pitch revizyonu ve undo; oriented box AABB yanlış pozitifinin reddi; gerçek clearance; delikli döşeme/boru; çatı boşluğu; dry-run, AI insan onayı, stale issue, belirsiz connector reddi, üretimde güvenli onarım ve hard clash atomik reddi sınanır. Mevcut gerçek MCP/HTTP ve Fragments testleri de çalışır.

2000 ayrık kolon örneğinde indekslenen 2000 eleman, 0 broad candidate ve 0 narrow pair; yerel tek koşuda yaklaşık 28–34 ms. Bu bir yoğun model benchmark'ı değildir.

## 10. Başlangıç/sonuç ve eski hata mekanizmaları

Başlangıç: **740 toplam / 615 pass / 109 fail / 16 skip**, typecheck başarılı. Başlangıç logu `tmp/umb-phase2-baseline.log`. Önceki rapordaki 110 hata bu çalışmanın başlangıcı sayılmadı.

Nihai kaynak sabitlenmiş tam koşu: **751 toplam / 625 pass / 110 fail / 16 skip**, 263.4 saniye. Yeni 11 test geçti. Başlangıçtaki 109 başarısız kimlik aynı mekanizmalarla kaldı; ek 1 başarısızlık eski `earthworks-solids-runtime` testinde `proposals.json` Windows atomik rename **EPERM** hatasıdır. Tam paket yeşil değildir; bu sonuç 626/109 gibi düzeltilmiş bir sayı olarak sunulmaz. Önceki ara tam koşu 750/625/109/16 vermişti; o koşuda son çatı-boşluğu testi henüz yüklenmemişti.

Son odak koşusu **22/22 pass** (yeni 11 test + önceki ilgili geometri/ortak araç testleri). Son typecheck ve web build başarılı; web build mevcut büyük chunk uyarısını veriyor. Son loglar `tmp/umb-phase2-verified.log`, `tmp/umb-phase2-p1-tests.log`, `tmp/umb-phase2-typecheck.log`, `tmp/umb-phase2-build.log`.

Karşılaştırıcı `scripts/compare-modeling-test-runs.mjs`, yalnız stack reason saymak yerine reporter'ın başarısız test kimliklerini ve değişen mekanizmalarını karşılaştırır. Tam 109 eski + 1 ek kayıt ve evidence `docs/PHASE2_TEST_COMPARISON_2026-10-23.json` içindedir; 0 eski kayıt çözüldü, 0 eski kayıt mekanizma değiştirdi. Bu kanıt geometri testleri için olumlu olsa da tüm platform için sıfır regresyon/yeşil paket iddiası yapılmaz.

Başlangıçtaki 109 başarısız kayıt:

| Mekanizma | Sayı | İnceleme |
|---|---:|---|
| DUPLICATE_WALL_JOIN | 54 | Eski fixture'lar otomatik oluşmuş uç birleşimini tekrar oluşturuyor |
| INVALID_GEOMETRY | 5 | Geçersiz geometri fixture/domain reddi |
| WALL_INTERSECTION | 5 | Yeni kuralın kabul etmediği iç kesişen duvar fixture'ları |
| WALL_EDIT_HOSTED_CONFLICT | 1 | Hosted içeriği bozan düzenleme |
| ELEMENT_IN_USE | 3 | Kullanılan nesne silme kontratı |
| INVALID_DIMENSION | 3 | Pozitif ölçü/kalınlık kontratı |
| INVALID_WALL_JOIN | 1 | Aynı yönde örtüşen/collinear join |
| Assertion sonuç farkları | 23 | Tool katalog parity, otomatik join beklentileri, HTTP 500/fixture bağlamı, eski quantities ve migration/property eşitlikleri |
| Windows tsx ENOENT | 2 | Eski testler uzantısız node_modules/.bin/tsx dosyasını doğrudan spawn ediyor |
| Response shape TypeError | 2 | assistant messages ve road parts beklentisi undefined |
| Windows symlink EPERM | 1 | Test fixture symlink oluşturamıyor |
| Dosya/suite wrapper | 9 | Bağımsız bir domain hata kökü değildir; reporter üst kayıtları |

Bu mekanizma sınıflandırması bütün legacy assertion'ların ürün düzeyindeki kök nedeninin çözüldüğü anlamına gelmez. Özellikle HTTP 500 ve migration eşitlikleri ayrı izolasyon gerektirir. İlgisiz testler topluca yeniden yazılmadı. Eski earthworks testlerinde Windows `proposals.json` atomik rename EPERM birden fazla koşuda farklı testlerde görüldü; bir ara izole koşu geçti, daha sonraki eşzamanlı odak koşusunda tekrarlandı. Son iki testin sıralı yeniden koşusu **2/2 pass** verdi (`tmp/umb-phase2-windows-recheck.log`). Bu, tam koşudaki 110 hata sayısını değiştirmez. Dosya kilidi/antivirüs gibi kesin çevresel neden kanıtlanmadı; hata noktası değişmeyen `FileStore.writeProposalsSync` rename işlemidir ve bu teslimde düzeltilmedi.

## 11. Kalan işler ve sıra

Önce P1'i tamamla: genel eğimli cephe/kademeli çatı ilişkileri; ortak türetilmiş ilişki grafı; hosted void ve eğrisel geometri; çatı alçaltılırken hosted opening'in gerçek parçalı üst sınıra göre kontrolü; MEP zarf/gövde clash; yoğun model/kalıcı artımlı indeks. Windows atomik proposal yazımının dalgalanmasını ayrıca izole araştır. Ardından P2 kiriş/döşeme/perde/temel-radye yerel çerçeve/cover/boşluk layout ve gerçek IFC oracle; P3 genel 3B rota/fittings/rerouting; P4 dosyalar arası Project Context/provenance; P5 capability kapsamı ve sohbet merkezli başlangıç.

Donatı araştırmasında gstack browse ile buildingSMART IFC4 resmî sayfası 403 döndürdü; sayısal standart hükümleri doğrulanmış sayılmadı. JRC Eurocode 2 tanıtım sayfasına erişim ayrıntılı madde doğrulaması yerine geçmez. Kurulu Three ShapeUtils tipleri/kodu ve resmî API kontrol edildi; Context7 bu oturumda mevcut değildi. P2 öncesi erişilebilir birincil donatı/IFC teknik kaynakları araştırılmalı. Statik/MEP kapasite hesabı kapsam dışı kalır.

## 12. Temel dosyalar

`packages/bim/src/wall-roof.ts`, `solid-geometry.ts`, `coordination.ts`, `ifc.ts`, `engines/builtin.ts`, `index.ts`; `apps/manager-mcp/src/modeling.ts`; `packages/agent/src/agent.ts`; `packages/bim/test/phase2-roof-coordination.test.ts`; `apps/manager-mcp/test/universal-modeling.test.ts`; iki yeni scripts dosyası ve bu rapor/handoff/test karşılaştırması.

## 13. Veri korunması

Mevcut `data/`, kullanıcı belgeleri, modeller, bağımlılıklar ve önceki raporlar silinmedi/taşınmadı. Veri/event şeması değiştirilmedi. Test/örnekler izole bellek veya geçici klasör kullanır. Önceki kaynakların SHA-256 manifestli yerel kopyası `output/umb-phase2-source-baseline/` altında tutulur. Çıktılar ve bağımlılıklar Git'e alınmaz; kaynak/test/belgeler alınır.
