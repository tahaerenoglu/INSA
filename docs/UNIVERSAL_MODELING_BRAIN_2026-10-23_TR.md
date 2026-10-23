# INSA Universal Modeling Brain — uygulama ve doğrulama raporu

23 Ekim 2026. Kaynak kodda çalışan bir ortak modelleme zinciri uygulandı. **İstenen bütün mimari ve disiplin kapsamı tamamlanmadı.** Aşağıdaki çalışan yeteneklerle kalan kapsam birbirinden ayrılmıştır. Canlı proje verileri üzerinde örnek model üretilmedi; testler geçici depolarda, somut örnekler ayrı çıktı klasöründe çalıştırıldı.

## 1. İncelenen ilk durum

Monorepo: `packages/core`, `bim`, `infra`, `files`, `agent`; `apps/manager-mcp`, `web-server`, `web`. Platform; ortak araç kayıtları, roller, AI önerileri, insan onayı, audit, iyimser eşzamanlılık, olaylardan yeniden kurma, snapshot ve undo içeriyordu. MCP ve Fastify aynı çekirdeği kullanıyordu. Uygulama asistanı mevcut Anthropic sağlayıcısını kullanıyordu.

Category/Engine ayrımı, genişletilebilir geometri handler'ları, mimari/yapısal elemanlar, çatı motorları, host'lu parametrik bar setleri, MEP segment/sistem/junction kaynakları, güzergâh/kesit/koridor/terrain/CAD araçları zaten vardı. Bunlar yeniden yazılmadı. IFC çıktısından ThatOpen Fragments üretimi mevcut altyapıda korundu. Bu çalışma genel bir semantik IFC importer eklemedi.

`AGENTS.md`, README, `MODELLING_RULES.md`, proje dosyası belgeleri ve ilgili kaynak/test akışları incelendi. Çalışma klasöründe Git deposu bulunmadığından temiz commit tabanına göre diff veya önceki kullanıcı değişikliklerinin otomatik ayrımı mümkün değildi.

Başlangıç `npm test` komutu Windows'ta sıfır test seçip başarılı çıkıyordu. Platformlar arası açık dosya keşfiyle düzeltildi. İlk gerçek toplu koşu: **727 test, 601 başarılı, 110 başarısız, 16 atlanan**. Bu koşu test çalıştırıcısı düzeltmesi ve çekirdeğin kompozisyon eklemesi sonrasındadır; tamamen değişiklik öncesi temiz Git tabanı değildir. İlk typecheck başarılıydı.

## 2. Konsolidasyon

Yeni bir BIM veritabanı, ikinci geometri modeli veya ayrı LLM framework'ü oluşturulmadı. Ortak planlayıcı, mevcut kayıtlı domain komutlarını derler. Yetki, girdi doğrulama, domain invariants, proje kontrolleri, öneri/onay, commit ve undo çekirdekte kalır.

`CommandTool.expand` kayıtlı alt komutları birden fazla modülde **tek atomik olay eklemesi** altında çalıştırır. Her alt komutun yetkisi kontrol edilir. Tek komut geçmişi ve tek undo, bütün alt adımları kapsar. Domain komutlarının başka modül adına doğrudan olay yazması reddedilir. Başarısız plan hiçbir kısmi model olayı bırakmaz.

Tipler adları ve normalize edilmiş semantik tanımları üzerinden yeniden kullanılır. Aynı adlı farklı tanım sessizce değiştirilmez. Koridor yerleşimleri ortak `componentType` kimliğini zorunlu kullanır. Eski araçlar ve uyumluluk sarmalayıcıları silinmedi.

## 3. Ortak araçlar ve iç motorlar

Araç başlıkları kanonik noktalı adları kullanır. LLM sağlayıcılarıyla uyum için kablodaki/kayıttaki adlar alt çizgilidir.

| Kanonik ad / kayıt adı | Çalışan işlev |
|---|---|
| `project.analyze` / `project_analyze` | Yetkili proje/dosya envanteri, capability ve requirement şemaları, rule pack ve sorgu keşfi |
| `project.query` / `project_query` | Kayıtlı salt okunur BIM/infra/dosya sorgularını kendi yetkileriyle çağırır; export/upload çalıştıramaz |
| `model.plan` / `model_plan` | Kaynak ve requirement kontrolü, deterministik plan, bağımlılık sırası, motorlar ve plan kimliği; model değişmez |
| `model.generate` / `model_generate` | Bina: wall/profile_member/boundary; donatı: reinforcement; tesisat: mep_network + sınırlı orthogonal routing; altyapı: mevcut alignment/corridor; dizilim: point_component |
| `model.revise` / `model_revise` | Eleman/kat/tip ve güzergâh/koridor/ortak bileşen tiplerinin kontrollü atomik güncellemesi |
| `model.validate` / `model_validate` | BIM domain/host/bağlantı, işaretli donatı pas payı, bağlı çatı-duvar ve infra invariants; yapısal temasları ayrı döndürür |
| `model.repair` / `model_repair` | Açıkça seçilen duvarları tek düzlemli çatı alt yüzeyine bağlar |
| `model.export` / `model_export` | Mevcut BIM IFC/Fragments; açık scope ile legacy altyapı IFC. Eksik koridor export'u açık kısmi çıktı izni olmadan reddedilir |

Hepsi Shared Platform Registry, HTTP ve MCP üzerinden çalışır. Uygulama içi LLM kataloğu düşük seviyeli BIM/infra araçlarını gizleyerek ortak araçlara geçer. **MCP'nin eski domain araçları geriye uyumluluk için hâlâ ilan edilir.** MCP envanterini yalnız küçük ortak arayüze indirme kriteri bu nedenle tamamen sağlanmış değildir.

## 4. Gerçekten çalışan Brain parçaları

- Context: aynı proje snapshot'ından yetki kapsamlı model/dosya envanteri.
- Planner: kayıtlı capability'nin runtime requirement şeması, sıralı adımlar, kaynaklar, motorlar, varsayımlar ve hash tabanlı plan kimliği.
- Capability Registry: yeni capability eklemek için ortak araç şemasını değiştirmek gerekmez; entegrasyon testi bunu gösterir.
- Rule Registry: universal domain invariants ve parametrik kolon pas payı pack'leri kodla değerlendirilir. Standard profile eksik olarak raporlanır; ulusal standarda uygunluk iddia edilmez.
- Constraint/Dependency: mevcut domain kuralları, yeni çatı-duvar ilişkisi ve geçişli bağımlılık doğrulaması; ilgisiz model baştan üretilmez.
- Validation/Repair: domain kontrolleri, sınırlı engel kontrollü rota seçimi ve açık çatı host onarımı.
- Güvenlik: plan sonrası değişiklikte stale-plan reddi; requestId tekrarında yinelenen üretim reddi; kaynak revizyonunun proje içinde varlığı; belirsiz/çelişkili/onay bekleyen kaynakların reddi.

Kaynağa bağlanan düz parametreler için birim normalizasyonu ve requirement değeriyle uyuşmazlık kontrolü vardır. BOQ'nun geometrik parametre otoritesi yapılması reddedilir. Ancak dokümandaki bütün teknik değerleri otomatik çıkarıp doğrulayan genel bir proje anlamlandırma motoru tamamlanmamıştır. `Verified` gibi durumlar çağıranın beyanıdır; dosya içeriğinin bağımsız mühendislik doğrulaması anlamına gelmez.

## 5. Bina, birleşim ve çatı

Boş projede katlar, kolonlar, kirişler, döşemeler, çevre duvarları ve tek düzlemli eğimli çatı oluşturulur. Örnek kesitler/kalınlıklar ve döşemelerde ayrılan servis şaftı kavramsal varsayımlardır. Toplam alan brüt kat alanları toplamıdır. Eğimli cephe, ayrıntılı ev yerleşimi veya taşıyıcı yeterlilik tasarımı üretilmez.

Duvarın `topRoof` alanı mevcut BIM nesnesinde kararlı çatı kimliğini tutar. IFC gerçek çatı alt düzleminde kesilir; Fragments aynı IFC'yi kullanır. Duvar metrajı bağlı düzleme göre hesaplanır. Çatı, çatı tipi veya kat değişince bağlı duvarlar ve açıklıklar yeniden doğrulanır. Bağlı çatı silinemez. Gerçek IFC mesh hacmi bağımsız analitik değerle test edildi.

Mevcut yapısal bağlantı tespiti ve boolean birleşim davranışları korundu. Beklenen taşıyıcı temasları genel hata listesine dönüştürülmez. **Genel katı-katı clash sınıflandırma ve otomatik birleşim tasarımı eklenmedi.**

## 6. Donatı: kaynak, kapsam ve kurallar

Yeni otomatik layout, **dikdörtgen kesitli yukarı yönlü kolonlar** için dört boyuna bar ve aralıklı kapalı etriye seti üretir; Z etrafında dönmüş kolonlar desteklenir. Host, tip, çelik sınıfı, çap, pas payı, aralık ve kat referansı korunur. Kesit dışına çıkma, çapı da içeren bar dış yüzeyi üzerinden kontrol edilir. Boyuna donatılar yuvarlatılmış etriye köşelerinin içine yerleştirilir. Kapalı path'in kapanış köşesi de fillet edilir. Host veya tipi değişince yeni doğrulanmış setler yeniden kontrol edilir.

Eski düşük seviye motorun kolon/kiriş/perde/döşeme/temel/radye üzerine açık path'le set/mesh/tendon yazabilmesi korunur. **Bu, bütün host türleri için yeni otomatik ve pas payı doğrulanmış layout desteği değildir.** Dairesel/değişken kesitler, otomatik kiriş/perde/döşeme/temel/radye donatısı bu yüksek seviye capability'de reddedilir. Eski bar setleri geriye dönük olarak doğrulanmış sayılmaz.

IFC'de bar occurrence'ları `IfcReinforcingBar`, ortak tipler `IfcReinforcingBarType` ve `IfcRelDefinesByType` ile temsil edilir. Mevcut host ilişkisi ve parametrik set kimliği korunur.

gstack `/browse` ile [JRC Eurocode 2 resmî kapsam sayfası](https://eurocodes.jrc.ec.europa.eu/EN-Eurocodes/eurocode-2-design-concrete-structures) okundu. buildingSMART IFC4.3 lexical sayfası 403; JRC ayrıntılı yayın deposu erişim reddi verdi. IFC type sözleşmesi ayrıca kurulu `web-ifc` şemasındaki attribute sırasıyla kontrol edildi. **Erişilemeyen ayrıntılı standart maddeleri kullanılmış gibi gösterilmedi.**

Uygulananlar geometrik kontroller ve kullanıcı parametreleridir. Seçili standart/ulusal ek kuralları, minimum kod pas payı, agregaya bağlı net mesafe, bindirme/ankraj hesabı, imalat büküm yeterliliği ve statik kapasite desteklenmez. Modeldeki örnek büküm yarıçapı geometrik varsayımdır; Eurocode minimumu değildir.

## 7. MEP ve routing

Mevcut sistem kimlikleri, storey-aware segmentler ve açık connector/junction ilişkileri kullanılır. Çok katlı örnekte üç branşman + iki riser, üç junction ile tek bağlı ağ oluşturur. Aynı kesit tipi tekrar kullanılabilir. Piping, dikdörtgen duct ve cable-tray kategorilerine yönlendirme kodu bulunur; uçtan uca referans senaryosu piping üzerindedir.

Terminal ve onaylı şaft/servis bölgesi girdileri gereklidir. Her dağıtım kotunda bir terminal desteklenir. Altı orthogonal eksen sırası duvar/taşıyıcı/döşeme sınırlarına karşı denenir; riser mevcut gerçek açıklıktan geçmelidir. Engel çözülemiyorsa işlem tamamen reddedilir. Kontrol muhafazakârdır; bazı geçerli rotaları da reddedebilir.

Genel hacim içinde A*, ayrıntılı fitting ürün üretimi, fixture/ekipman kapasite seçimi, bütün sistemler arası clash, otomatik şaft keşfi ve yeniden routing tamamlanmadı. Açık terminal uçları fixture bağlıymış gibi gösterilmez. Pis su eğim/debi/basınç/kapasite ve HVAC/elektrik mühendislik hesapları yapılmaz.

## 8. Altyapı ve diğer proje türleri

Aynı `model_generate`, mevcut yatay/düşey güzergâhı ve ortak componentType'ları kullanarak kilometre aralığında koridor üretir. Kaynak kilometre ve koordinatlar yeniden uydurulmaz. Mevcut infra doğrulaması yatay/düşey kapsam ve enkesit tutarlılığını denetler. CRS dönüşümü eklenmedi.

Mevcut terrain, tunnel ve family motorları korundu; hepsine yeni otomatik high-level capability eklenmedi. Karayolu/demiryolu formasyon koridoru bir üst kullanım alanıdır; eksiksiz demiryolu/metro/köprü/havalimanı tasarım otomasyonu değildir. Legacy IFC export, koridor/terrain/earthwork kaynaklarını dışarıda bırakır; bu sınırlama ortak araçta görünürdür.

`array` capability'si mevcut ortak component tipinden deterministik ekipman dizisi üretir. Semantik kategori tip/aileden gelir. Ayrıntılı GES, enerji nakil hattı, çelik birleşim veya endüstriyel proses tasarımı iddia edilmez.

## 9. Document Intelligence

Mevcut PDF metin çıkarımı, dosya revizyonları, orijinal depolama, DXF/CAD ve LandXML altyapısı korundu. XLSX'te worksheet, hücre, formül, cached değer, stil kimliği, merge ve sheet'e bağlı tablolar; CSV'de tırnaklı alanlar/hücreler; DOCX'te paragraf ve tablo hücresi metni eklendi. `files_read_structure`, `project_query` üzerinden kaynak/revizyon/hücre atıflarıyla erişilebilir.

Formül/makro/dış ilişki çalıştırılmaz. Bozuk veya limit aşan kaynak okunmuş sayılmaz; orijinal korunur. Stil kimliği korunması bütün Excel görünümü ve birim semantiğinin çözüldüğü anlamına gelmez. OCR, DWG native çözümleme, LAS/LAZ, genel IFC semantic import ve paftalar arası otomatik geometrik ilişki çıkarımı tamamlanmadı.

## 10. Test sonuçları ve regresyon sınırı

| Kontrol | Sonuç |
|---|---|
| İlk gerçek toplu koşu | 727 test: 601 başarılı, 110 başarısız, 16 atlanan |
| Son toplu koşu | 738 test: 612 başarılı, 110 başarısız, 16 atlanan |
| Son odaklı paket | 33 test: 32 başarılı, 0 başarısız, 1 atlanan PostgreSQL senaryosu |
| Typecheck / TypeScript build | Başarılı |
| Web production build | Başarılı; mevcut büyük bundle uyarısı var |
| Gerçek IFC mesh hacmi | Analitik duvar hacmiyle eşleşti |
| IFC/Fragments dönüşümü | Yeni bina ve donatı geometrileriyle başarılı |
| MCP / HTTP / LLM | Gerçek MCP in-memory transport, yetkili HTTP ve scripted ModelClient üzerinden başarılı |
| Atomiklik / onay / undo / replay / snapshot | Odaklı pakette başarılı; iki modüllü eklenti senaryosu dahil |

Windows `execFile` ile uzantısız tsx başlatan mevcut süreçler arası onay testi `node --import tsx` ile düzeltildi ve geçti. Son toplu koşuda ilk kez görülen ek altyapı hatası `proposals.json` rename EPERM idi; aynı dosyanın tekil tekrar koşusu geçti. Böylece kalan toplu başarısızlıklar, önceki 109 başarısız test ve bir geçici Windows dosya hatasından oluşuyor. Temiz Git tabanı olmadığı ve önceki hatalar giderilmediği için **platformun bütün testleri temiz veya hiçbir mevcut özellik bozulamaz** iddiasında bulunulamaz. Son küçük high-level tip yeniden kullanım değişiklikleri ve son ek testler ayrıca odaklı paketle doğrulandı.

Loglar: `tmp/umb-real-baseline-tests.log`, `umb-final-tests.log`, `umb-focused-tests.log`, `umb-road-recheck.log`, `umb-typecheck.log`, `umb-build.log`, `umb-web-build.log`, `umb-geometry-tests.log`.

## 11. Üç çalıştırılmış kullanım örneği

Tekrar üretim: `node --import tsx scripts/universal-modeling-demo.mts`. Yeni, izole MemoryStores ve ayrı artifact klasörü kullanır. LLM sağlayıcısına canlı ücretli çağrı yapılmadı; doğal dilin araç girdisine dönüştürülmesi scripted model ile test edildi.

1. **“Üç katlı, toplam 200 m² eğimli çatılı ev ve taşıyıcı sistem oluştur.”** `model_plan` → `model_generate {requirements:{kind:"building",floors:3,totalArea:200}}`. Backend level, profile member, boundary ve wall motorlarını seçer; 40 model elemanı üretir; üst duvarları tek düzlemli çatıya bağlar. Domain/host/bağımlılık ve IFC geometri kontrolü yapılır. Eğimli cephe ve ayrıntılı plan yerleşimi bu örnekte yoktur.
2. **“Aynı binaya kavramsal temiz su ağı ve kolonlara 30 mm pas payı, Ø16 boyuna, Ø8 etriye, 150 mm aralıkla donatı ekle.”** Aynı `model_generate`, önce `network`, sonra `reinforcement` requirements'ıyla kullanılır. Şaft `[2,2]`, her katta terminal `[4,2]` ve 2.5 m offset açık örnek girdileridir. Beş segment/üç junction, kolonlarda parametrik bar/etriye setleri oluşur. Rota engelleri, gerçek şaft açıklıkları, bağlantı ve pas payı kontrol edilir. Kapasite/statik hesap yapılmaz.
3. **“Mevcut yatay güzergâh, boykesit ve enkesitlerle KM 1+000–3+000 aralığını modelle.”** Kaynak alignment ve `CT-001` önceden mevcut olacak şekilde `model_generate {requirements:{kind:"corridor",definition:{alignment:"AL-001",from:1000,to:3000,...,layers:[{componentType:"CT-001"}]}}`. Mevcut infra motoru koridoru üretir; istasyon/düşey kapsam/enkesit invariants uygulanır. Örnek kaynak geometrisi açıkça sentetiktir, gerçek proje belgesinden çıkarılmış gibi sunulmaz.

Çıktılar `output/universal-modeling-demo-2026-10-23/` altında: `evidence.json`, proje durumları, işlem geçmişleri ve `building/exports/Yeni_Proje.ifc`, `Yeni_Proje.frag`. IFC son birleşik bina + tesisat + donatı durumudur. Koridorun tam IFC çıktısı üretilmiş gibi gösterilmedi.

## 12. Değiştirilen temel dosyalar

| Dosya | Neden |
|---|---|
| `packages/core/src/platform.ts`, `errors.ts` | Atomik çok modüllü kompozisyon, alt komut yetkisi, pin context, tipli hata kodları |
| `packages/core/src/project-tools.ts` | Uygulama asistanının ortak modelleme araç yüzeyi |
| `apps/manager-mcp/src/modeling.ts` | Ortak araçlar, context/planner/capability/rule registry, kaynak kontrolü, export sınırları |
| `modeling-rebar.ts`, `modeling-routing.ts` | Deterministik kolon layout ve sınırlı güvenli orthogonal rota seçimi |
| `runtime.ts`, `server.ts`, `packages/agent/src/agent.ts` | Shared Registry, MCP ve uygulama LLM entegrasyonu; eski MCP araçları korunur |
| `packages/bim/src/wall-roof.ts` | Persisted çatı bağımlılığı ve ortak türetilmiş geometri hesabı |
| `model.ts`, `invariants.ts`, `resources.ts`, `engines/builtin.ts`, `dispatch.ts`, `ifc.ts` | Mevcut BIM ilişkileri, geçişli doğrulama, quantities, IFC kesimi ve donatı tipi |
| `engines/reinforcement.ts` | Kapanış köşesi fillet'i, opt-in cover doğrulaması, IFC type ilişkisi |
| `packages/files/src/structured.ts`, `extract.ts`, `index.ts` | Kaynak atıflı Office/CSV ayrıştırma ve sayfalı erişim |
| `package.json`, `scripts/run-tests.mjs`, governance testi | Windows'ta gerçek test keşfi ve süreç başlatma |
| `packages/files/package.json`, `package-lock.json` | Zaten kurulu fflate/XML parser'ın doğrudan bağımlılık olarak kaydı |
| Yeni entegrasyon/geometri/doküman testleri ve demo script'i | Gerçek ortak çağrı zincirinin tekrar üretilebilir kanıtları |

Kullanıcı kaynakları, orijinal dokümanlar, canlı modeller, asset'ler ve node_modules silinmedi. Fragments altyapısı değiştirilmedi. Çalışan sunucu süreçleri yeniden başlatılmadı veya sonlandırılmadı.

## 13. Tamamlanmamış kabul kriterleri

MCP'nin yalnız ortak araçları ilan etmesi; tamamen doğal dilden genel proje planlama; eğimli cephe/genel çok düzlemli çatı birleşimi; tüm host türlerinde otomatik donatı layout; ulusal standart pack'leri; bütün MEP terminal/fitting/routing ve intersystem clash işlemleri; genel connection/clash sınıflandırması ve repair; geniş document intelligence/OCR/LAS-LAZ; koridor/terrain IFC4.3 export; sade başlangıç ekranı değişikliği ve mevcut 109 test başarısızlığının giderilmesi tamamlanmadı.

Bu rapor, çalışan ve doğrulanmış bir ortak yürütme çekirdeği ile sınırlı modelleme capability'lerini belgeler; tüm Universal Modeling Brain vizyonunun bitirildiği anlamına gelmez.
