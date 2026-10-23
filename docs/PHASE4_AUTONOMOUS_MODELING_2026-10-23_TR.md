# INSA Phase 4 — çalışan ortak planlama ve parametrik kaynak altyapısı

Tarih: 23 Ekim 2026. Başlangıç commit'i `c2c4e8a`; referans test sonucu 758 total / 633 pass / 109 fail / 16 skip. Bu çalışma kaynak kod uygulaması, gerçek HTTP/Fragments çıktıları ve UI kontrollerini içerir. Bütün proje türlerini eksiksiz ve otonom tasarlayan sistemin tamamlandığı iddia edilmez.

## 1. Başlangıçtaki Family sistemi — IMPLEMENTED, mevcut altyapı korundu

Native `BimState.types`, component aileleri, infra componentType/section/family kayıtları, tipten türeyen occurrence geometrileri ve host/assembly ilişkileri vardı. Phase 3'teki `Builder.type` eşleştirmesi bazı alan adlarını elle dönüştürerek tam içerik karşılaştırıyordu; genel birim normalizasyonu yoktu. Assembly recipe bilgisi occurrence özelliklerinde tutuluyor, kalıcı assembly type ve bağlı revizyon bulunmuyordu. Model state, Registry/Platform, authorization, approval, audit, undo, snapshot/replay ve ThatOpen viewer değiştirilerek ikinci kez kurulmadı.

## 2. Bütün motorlarda reuse — PARTIALLY IMPLEMENTED

Ortak yüksek seviyeli oluşturma yolları `Builder.family/type` üzerinden aynı çözümleyiciyi kullanır. Yeni uzman capability adaptörleri de bu yolu kullanır. Yerleşim girdisi mevcut bir tip kimliği içeriyorsa yeni tanım üretmez. Altyapıda mevcut componentType ve section kimlikleri korunur.

Eski düşük seviyeli `bim_create_types` / `bim_create_families` komutlarının bütün doğrudan kullanım yollarına semantik otomatik birleştirme zorlanmadı. Bu komutların mevcut, açık kaynak oluşturma davranışı ve geçmiş kimlikleri korunur. Altyapı tanımlarını BIM ile tek bir yeni kaynak veritabanında birleştiren çözümleyici eklenmedi. Dolayısıyla “bütün yazma yollarında zorunlu global dedup tamamlandı” denemez.

## 3. Eksik motor desteği — PARTIALLY IMPLEMENTED

Native aileler hâlâ mevcut motor şemalarından türeyen descriptor'lardır; serbest düzenlenebilir native Family geometrisi değildir. Component aileleri mevcut parametrik box mekanizmasını kullanır. Eğri/serbest biçimli ekipman aileleri, otomatik çelik birleşim tasarımı, bütün donatı hostları için parametrik layout üretimi ve uzman köprü/ray/GES proses tasarımı tamamlanmadı. Açık path/section/route girdileri mevcut uzman motorlarda kullanılabilir; bu, eksik uzman tasarımın otomatik çözüldüğü anlamına gelmez.

## 4. Family Resolution — IMPLEMENTED, yüksek seviyeli ortak yol

`packages/bim/src/family-resolution.ts` birim normalizasyonu ve semantik imzayı sağlar. Yeni tip adayı, mevcut `bim_create_types` şeması ve gerçek domain `decide` normalizasyonu kullanılarak bir kopya üzerinde oluşturulur. Böylece default değerler, material referansları ve API/state alan adları için ikinci bir tip dönüştürücü yazılmaz. Eşdeğer kaynak bulunursa mevcut ID kullanılır; bulunmazsa normal domain komutu çalışır.

Eşzamanlı iki insan komutunda Platform'un optimistic concurrency/re-decide yolu kullanılır; ayrı paralel kilit/veritabanı eklenmedi. Metre ve milimetre tanımlarının eşzamanlı iki instance üretiminde tek type'a bağlandığı test edildi. AI önerileri mevcut pin ve insan onayı kurallarına tabidir. Aynı requestId ikinci kez uygulanmaz.

Yalnız zaten var olan tanımları içeren plan `NO_CHANGE` durumuyla gösterilir; yazma gerektirmeyen bu durumda generation çağrısı atlanmalıdır. Platform'un boş event yazmayı reddeden davranışı korunur.

## 5. Type eşdeğerliği — IMPLEMENTED

- ID ve üst seviye ad, eşdeğerlik anahtarı değildir.
- Family category, parametrik şema, scope/dataType/required/default/limits, representation; type kind, profil, material kimliği, connector tanımları, type parametreleri ve saklanan diğer semantik alanlar önemlidir.
- Parametre ve connector listeleri kararlı makine anahtarına göre karşılaştırılır.
- `m`, `mm`, `cm`, `ft`, `in` açık uzunluk birimleri normalize edilir. Açı/sayı parametreleri uzunluk gibi ölçeklenmez. Family length parametrelerinin açık birimi/default/min/max değerleri SI'ya dönüştürülür.
- Sayısal imza 12 anlamlı basamağa normalize edilir; keyfi büyük geometrik toleransla tipler birleştirilmez.
- Şemanın tanımadığı bir semantik alan sessizce düşürülmez; yüksek seviyeli çözümleyici girdiyi reddeder. Ek anlam gerekiyorsa mevcut Family type parametre şemasında temsil edilmelidir.
- Önceden eşdeğer iki farklı Family ID'si bulunan veride bile eşdeğer mevcut component type aranır. Eski Family/Type kimlikleri yeniden numaralanmaz veya birleştirilmez.

## 6. Kalıcı Assembly Type — IMPLEMENTED, sınırları açık

`BimState.assemblyTypes` isteğe bağlı ek alanı ve `AssemblyTypeSet v1` mevcut BIM event akışında saklanır. Eski snapshot'larda bu alanın bulunmaması desteklenir. Ayrı assembly veritabanı yoktur.

Tanım: ID, ad, içerik revizyonu, sayısal parametreler, child type kimlikleri, yerel placements/routes, explicit connector ilişkileri, isteğe bağlı kolon donatısı, min/max parametre constraints ve dosya/revizyon/atıf kaynakları. Kaynaklar proje dosya kayıtları ve okuma yetkisiyle doğrulanır. Library API ve UI reusable assembly tanımlarını occurrence ağacından ayrı gösterir; material/profil tanımları da kütüphane verisinde yer alır.

`assembly-type` capability tanımı oluşturabilir/yeniden kullanabilir ve çok sayıda yerleşim üretebilir. Native component/kolon ve MEP route parçaları aynı altyapıdadır. Betonarme kolon, bağlı pompa-boru ve panel-mount örnekleri doğrulandı. Genel kapasiteler veya standart tasarım hesabı yapılmaz.

## 7. Assembly / Type revizyonu — IMPLEMENTED, kontrollü kapsam

`model_revise` mevcut `bim_update_assembly_type` editörünü çağırır. `expectedRevision` zorunludur. Bağlı bütün assembly occurrence'ları yeniden değerlendirilir; child element ID, host, junction, sistem, kaynak properties ve instance parametre override'ları korunur. Yönetilen alanlardaki elle düzenlemeyle çakışan revizyon atomik olarak reddedilir. Parametrik kolon donatıları aynı kimlikle yenilenir. Undo, snapshot ve replay test edildi.

Rol/topoloji değiştirme, child type atama veya donatı tipi/çapını recipe revizyonuyla değiştirme otomatik olarak yapılmaz; açık yeni type/model değişikliği gerekir. Bu sınır, mevcut üyeleri silip yeni ID'lerle üretmeyi önler. Bütün keyfi override/topoloji dönüşümleri tamamlanmış değildir. Native tip revizyonlarının mevcut bağımlılık doğrulama/koordinasyon ve nicelik yolları korunur.

## 8. Universal Modeling Planner — PARTIALLY IMPLEMENTED

Çalışanlar: salt okunur plan, gerçek motorlarla kopya üzerinde geometri doğrulama, capability seçimi, kaynak/tip/instance/assembly özeti, approval gereği, validation/repair adımları, planId, stale-plan ve requestId kontrolü. `workflow` birden çok subsystem'i mevcut projeyi yeniden oluşturmadan atomik bir komuta toplar. Açık bağımlılıklara ek olarak yeni type/family/storey sağlayıcılarıyla kaynak referanslarından ön koşul kenarları çıkarılır. Döngü, eksik/yanlış dependency ve belirsiz sağlayıcı reddedilir.

Requirements verilmeden açık kat sayısı ve toplam brüt alan içeren Türkçe/İngilizce bina isteği kavramsal building capability'ye çevrilebilir. Eksik/ambiguous alan `REQUIRES_INPUT` döndürür; model değişmez. Proje türü için sınırlı amaç tanıma vardır; bunun sonucunda geometrik ölçü uydurulmaz. Diğer disiplinlerde LLM/kullanıcının açık capability geometrisi, placement ve kaynak girdileri gerekir. Genel amaçlı bütün doğal dil mühendislik isteklerinin deterministik çözücüsü tamamlanmadı.

## 9. Archetype Knowledge — PARTIALLY IMPLEMENTED

Residential, railway, metro-station, solar-plant, industrial, bridge tanımları ve programatik kayıt noktası vardır. Olası sistemler, kullanıcının seçtikleri, seçilmemiş sistemler, ön koşullar ve eksik uzman yetenekler raporlanır. Yeni archetype için sekiz ortak tool değiştirilmez. Bilgi, koşulsuz çizilen sabit bina/tesis şablonu değildir. Otomatik ayrıntılı disiplin tasarımı veya bütün proje tiplerinin uzman modelleme sırası bilgisi tamamlanmadı.

## 10. Document Intelligence — PARTIALLY IMPLEMENTED

`project_query` → `documents.understand`, mevcut immutable dosya deposu/ayrıştırmasını yeniden kullanır. Tablo hücresi, formula/cache uyarısı, sheet/row/cell, dosya/revizyon/hash, confidence ve verification status korunur. Metin için page/part atıfları döner. İçerik untrusted data'dır.

`document-model`: açık ve gözden geçirilmiş kolon eşlemesi, kategori/Family, geometrik rol ve birimlerle tabloyu ortak type çözümleyicisine bağlar. Tekrarlanan native kolonlar veya component ekipmanlar aynı type'a bağlanır; her satır ayrı instance'dır. Kaynak properties her elemana yazılır. Aynı source type etiketi için çelişkili boyut, başlık birimiyle mapping uyuşmazlığı, belirsiz sayı ve formula kaynaklı değer reddedilir. BOQ quantity alanından geometri/tekrar sayısı üretmez.

| Format | Gerçek durum |
| --- | --- |
| CSV | IMPLEMENTED: gerçek upload → hücre kanıtı → 40 kolon/tek type; ayrıca iki vana/tek component type testi. |
| XLSX | PARTIALLY IMPLEMENTED: mevcut bounded sheet/cell/formula/cache ayrıştırması ve aynı tablo adaptörü; mevcut parser testleri var, yeni semantik generation için ayrı XLSX uçtan uca kabulü NOT TESTED. |
| DOCX | PARTIALLY IMPLEMENTED: mevcut paragraph/table-cell metni; otomatik mühendislik family çıkarımı yok. |
| PDF | PARTIALLY IMPLEMENTED: metin/page/part; tarama OCR'si ve paftadan otomatik güvenilir vektör/BIM çıkarımı yok. |
| DXF | PARTIALLY IMPLEMENTED: mevcut CAD entity/region/calibration ve teknik geometry araçları korunur; layer adından kesin BIM classification yapılmaz. |
| DWG | NOT IMPLEMENTED: native semantik/geometrik ayrıştırma yok; orijinal saklama/dönüşüm iş akışları açıkça ayrıdır. |
| IFC | PARTIALLY IMPLEMENTED: kaynak STEP metni saklanır/okunur; bu fazdaki bağımsız IFC oracle export doğrulamasıdır, tam source-IFC family import motoru değildir. |
| LandXML | PARTIALLY IMPLEMENTED: mevcut alignment/vertical/TIN motorları ve yeni registry adaptörleri; her LandXML nesnesi için genel document-understanding yok. |
| LAS/LAZ | NOT IMPLEMENTED: yeni point-cloud semantic extraction veya dosya format desteği eklenmedi. |

## 11. Doğal dil / gerçek LLM — NOT TESTED (gerçek sağlayıcı)

Mevcut Anthropic entegrasyonu incelendi; bu test sunucusunda `enabled:false, model:null`. Anahtar eklenmedi, loglanmadı veya koda yazılmadı. Scripted ModelClient ve bounded intent parser gerçek LLM gibi raporlanmaz. Gerçek provider ile user prompt → LLM → plan → human approval → model kabulü açık kalır. Test J NOT TESTED'dır. Yapılandırılmış güvenli provider olduğunda mevcut assistant SSE/Platform yolu kullanılmalıdır.

## 12. Discipline capability ve constraints — PARTIALLY IMPLEMENTED

Yeni registry adaptörleri: storeys, walls, members, surfaces, openings, stairs, ramps, curtain-walls, roofs, explicit-reinforcement, mep-routes, mep-fittings, alignment, tunnel, terrain. Her biri mevcut uzman tool şemasını kullanır; yüksek seviyede yeni discipline tool yoktur. Ortak tool sayısı sekizdir. Mevcut building, network, corridor, instances, assembly/array ve yeni typed assembly/document/workflow yetenekleri birlikte çalışır. Members/surfaces adaptörleriyle kolon-kiriş-döşeme üretimi ayrıca test edildi; bütün adapter varyantları için ayrı canlı kabul yapıldığı iddia edilmez.

Parametrik donatı üretimi hâlâ upright rectangular column kapsamındadır. Diğer hostlar için mevcut explicit reinforcement geometry girişi, otomatik tasarım/layer planner yerine geçmez. Çelik generic profile/member/assembly, enerji ve endüstri generic family/assembly mekanizmasıyla temsil edilir; uzman kapasite/bağlantı/elektrik/proses tasarımı yoktur.

Constraint raporu gerçekten değerlendirilen rulepack'leri, domain geometry/identity/host/dependency/connection ve indexed coordination kapsamını açıklar. Clearance yalnız açık eşik verildiğinde anlamlıdır. Infra kendi domain doğrulayıcılarını kullanır; BIM koordinasyonu altyapının bütün interferanslarını kanıtlamaz. Standart profilleri NOT IMPLEMENTED olarak gösterilir. Structural/rebar/MEP/steel/infra/energy/industrial destek sınırları çıktıda listelenir; engineeringAdequacy false'tur. Yeni genel DSL veya mühendislik hesap solver'ı eklenmedi.

## 13. Model Tree / Semantic Graph / IFC — IMPLEMENTED, tanımlanan kapsamda

Host ağacı, sistem/tip/assembly filtreleri aynı ID'leri kullanır. Shared equipment'ın ayrı portlarından sistem üyeliğinin yanlış yayılması düzeltildi; mevcut connector sistem çözücüsü kullanılır. LocatedOn, açık altyapı alignment referansları ve assembly type ilişkileri grafiğe eklendi. İlişkiler ayrı model veritabanında tutulmaz.

IFC'de component family type'larının eksik type/occurrence ilişkisi bağımsız parser ile bulundu ve giderildi. Native component sınıflarının type entity'si mevcut IFC schema verisinden seçilir; kapı/pencere ve MEP segment type bağlantıları da eklendi. AssemblyType, IfcElementAssemblyType ile aktarılır. Kimlikler geometri paylaşımı için birleştirilmez.

Bağımsız web-ifc sonucu: 2.500 IfcValve + 2.500 IfcSolarDevice, 5.000 benzersiz GUID, her biri 2.500 ürüne bağlı iki IfcRelDefinesByType. Betonarme dosyasında 1 assembly type ve 2 assembly occurrence; ürün başına tek decomposition parent. Gerçek Fragments conversion ve browser selection çalıştı.

## 14. Performance — IMPLEMENTED / ölçülmüş sınırlı kabul

Gerçek 5.000 component testinde eski `modellingIssues` bütün çiftlerde tekrar geometry hesaplıyordu. Component kutuları bir kez hazırlanıp X sweep ve Y/Z broad-phase elemesi uygulanıyor; kesin döndürülmüş footprint kesişimi korunuyor. 100 döndürülmüş/çeşitli kotlu kutuda exhaustive exact karşılaştırmayla aynı çiftler ve hacimler doğrulandı. Ayrık 5.000 örnek de test edildi. Wall policy veya mühendislik toleransı gevşetilmedi.

300'den büyük BIM gruplarında DOM virtualization vardır. Gerçek 5.000 occurrence ağaçta 25 satırla açıldı; sona kaydırıldığında 17 satır, son ID CO-5000; örnek iki frame scroll/render ölçümü 35,1 ms. Veri/kimlik sayısı 5.000 kalır. Fragments HTTP resource transfer örneği 56,2 ms; bu GPU hazır olma süresi veya FPS değildir. Yoğun modelde küçük vana seçimi ve araması doğrulandı. ThatOpen'un 1 m near plane'i küçük nesneyi kırpıyordu; kurulu kameraların near plane'i 0,01 m yapıldı ve gerçek görüntüyle düzeltme doğrulandı.

HTTP üretim ve son IFC/Fragments süreleri `output/phase4-live-qa-2026-10-23/acceptance.json` içindedir. Nihai başarılı ölçüm: 5.000 eleman/2 Family/2 Type için generation 5,91 s; IFC 0,48 s / 8.007.823 byte, Fragments 2,12 s / 1.516.333 byte. Önceki 5,21 s ölçümü de yerel loglarda bulunur; farklı koşumların süreleri aynı ölçümmüş gibi birleştirilmez. Tek makine, sentetik ayrık grid ve headless tarayıcı örneğidir. Genel FPS, her GPU, tam çakışmalı 5.000 sahne veya her donatı regeneration yükü için performans garantisi değildir. Yeni GPU instancing motoru yazılmadı.

## 15. Kabul ve regresyon testleri

| Test | Durum / kanıt |
| --- | --- |
| A | IMPLEMENTED: gerçek HTTP 20 kolon / 50 vana / 100 panel, üç type. |
| B | IMPLEMENTED: shared type revision, ID, nicelik ve undo; Phase 3 testleri yeniden çalıştı. |
| C | IMPLEMENTED: kalıcı RC ve connected equipment assembly type revizyonu; override ve kimlikler korundu. |
| D | IMPLEMENTED: gerçek browser'da kolon altında donatı; assembly library ayrı; sistem görünümü. |
| E | IMPLEMENTED: gerçek yüklenen CSV 40 kolon; tek type, ayrı IDs, source lineage. Ek vana ve birim çelişkisi testi. |
| F | PARTIALLY IMPLEMENTED: doğal dil açık kat/alan → deterministik kavramsal bina. Gerçek LLM kanıtı değildir. |
| G | IMPLEMENTED, kavramsal: mevcut binaya su ve elektrik sistemi, 0 issue. Generic connected pump/pipe ayrıca doğrulandı. HVAC bütün varyantları NOT TESTED. |
| H | IMPLEMENTED, mevcut kapsam: kilometre aralıklı shared componentType corridor gerçek HTTP Phase 3 regresyonunda geçti. |
| I | IMPLEMENTED, kavramsal: 100 panel/mount assembly, 1 kalıcı assembly type ve 100+100 component. |
| J | NOT TESTED: provider yok. |
| K | IMPLEMENTED: gerçek HTTP IFC/Fragments, web-ifc independent type/GUID/decomposition oracle, browser selection. |
| L | Tam test sonucu ve baseline ayrımı `PHASE4_TEST_COMPARISON_2026-10-23.json` içindedir; eski bütün testlerin geçtiği iddia edilmez. |

Son odaklı birleşik core/index/semantic koşumu 12/12; ek registry adapter koşumu 3/3 ve son belge koşumu 1/1 geçti. Typecheck ve web build geçti; büyük bundle uyarısı mevcut. Tam koşumların birinde 767/642/109/16 elde edildi. Sonraki IFC değişikliğini içeren koşumda 767/641/110/16 vardı: 109 baseline hatasına ek bir Windows `proposals.json` rename EPERM. Aynı CAD vertical dosyası izole koşumda 5/5 geçti. Bu, aralıklı OS dosya hatasını giderdiğimiz anlamına gelmez. Nihai son koşum sayıları handoff ve karşılaştırma JSON'unda güncellenir.

**Nihai tam koşum: 767 total / 642 pass / 109 fail / 16 skip.** Phase 3 baseline'a göre 9 yeni geçen test; 0 yeni başarısız test kimliği, 0 değişen hata mekanizması. Son küçük NO_CHANGE plan sunumu ve sanal seçim görünürlüğü, odaklı test ve build/UI ile ayrıca doğrulandı. Eski 109 test hatası ve aralıklı Windows dosya sistemi hatası açık kalır.

## 16. Açık özellikler

PARTIALLY IMPLEMENTED: bütün disiplinlerde otomatik doğal dil planner; ayrıntılı archetype/assembly knowledge; bütün düşük seviyeli native/infra create yollarında ortak semantik dedup; arbitrary native Family geometry; bütün assembly topology/child type dönüşümleri; dokümandan otomatik güvenilir proje/aks/placement çıkarımı; her uzman discipline capability'nin tam kabulü.

NOT IMPLEMENTED: native DWG ve LAS/LAZ semantic extraction, doğrulanmış standart profilleri/standart solver, bütün hostlar için parametrik reinforcement planner, uzman çelik birleşim/bridge/rail/process/terrain-following energy automation.

NOT TESTED: yapılandırılmış gerçek LLM zinciri, XLSX'ten yeni semantik generation için bağımsız canlı kabul, her GPU/FPS ve tam yoğun etkileşimli sahne benchmark'ı. Yük/taşıma gücü/gerekli donatı alanı/elektrik yükü/MEP kapasitesi/hidrolik/HVAC hesabı kapsam dışı olduğu için uygulanmadı.

## 17. Kullanıcı verileri — IMPLEMENTED / korundu

Canlı testler `tmp/phase4-live-data` üzerinde, sentetik benzersiz proje ID'leriyle yapıldı. Kullanıcının `data/` dizini ve 8787/8788 süreçleri bu faz testleri için değiştirilmedi/durdurulmadı. Kaynak dosya orijinalleri immutable artifact deposunda tutulur. Üretim, API key, token veya export dosyaları git'e eklenmez. Son sunucu yeniden başlatıldıktan sonra önceki 5.000 occurrence ağacı ve benzersiz kimlikleri tekrar doğrulandı. Kalıcı assembly snapshot/replay/undo ayrıca test edildi.

Yeniden üretme: `scripts/phase4-live-acceptance.mts`, `scripts/phase4-ifc-oracle.mts`; yalnız izole kabul sunucusuna yönlendirin. Local kanıtlar: `output/phase4-live-qa-2026-10-23/`.
