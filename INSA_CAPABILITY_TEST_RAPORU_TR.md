# INSA mevcut BIM yetenekleri test raporu

## A. Test ortamı

- Sunucu: bağlı `insa` MCP; 105 araç, 146 kategori, 17 motor kaydı. Kayıt sayıları uygulama olgunluğu kanıtı değildir.
- Proje: `INSA_CAPABILITY_TEST_20261013_110354`; INSA Multi-Discipline BIM Capability Test.
- Tarih: 13 Ekim 2026; son dışa aktarım 11:18 Türkiye saati.
- Birim: metre; X/Y proje düzleminde, Z kat kotu + eleman ofseti. Duvar dış yüzüyle 12 × 8 m çevre; kiriş Z değeri üst yüz, döşeme ofseti üst yüzdür.
- Oturum: `codex`, `ai_agent`, onay modu `ai`. Yazmalar öneri olarak oluşturuldu; kullanıcı onaylarından sonra sorgulandı. AI kendi önerilerini onaylamadı.
- Test boyunca kaynak kodu, araçlar ve MCP yapılandırması değiştirilmedi. Modelleme/silme çağrıları yalnızca izole proje kimliğine gönderildi. Önceki projeler için karşılaştırmalı dosya hash denetimi yapılmadı.
- Gerçekten çağrılan araçlar: platform_whoami, platform_list_proposals, platform_history, platform_audit_log, platform_undo; bim_list_categories, bim_list_disciplines, bim_list_engines, bim_get_category_capabilities, bim_get_coordinate_system, bim_set_georeference, bim_convert_coordinates, bim_set_project, bim_create_storeys, bim_create_grids, bim_create_spatial_units, bim_query_spatial_units, bim_create_materials, bim_query_materials, bim_update_materials, bim_create_types, bim_get_types, bim_update_types, bim_create_families, bim_query_families, bim_create_components, bim_create_walls, bim_detect_wall_connections, bim_join_walls, bim_split_wall, bim_merge_walls, bim_extend_wall, bim_place_openings, bim_rehost_opening, bim_create_columns, bim_create_beams, bim_create_braces, bim_create_boundaries, bim_create_stairs, bim_create_railings, bim_create_ramps, bim_create_curtain_walls, bim_create_mep_systems, bim_query_mep_systems, bim_create_pipes, bim_create_ducts, bim_create_cable_trays, bim_create_mep_fittings, bim_query_mep_connectors, bim_connect_mep, bim_query_mep_network, bim_query_structural_connectivity, bim_get_element, bim_query_elements, bim_model_summary, bim_update_elements, bim_reassign_storey, bim_set_properties, bim_delete_elements, bim_validate, bim_render_plan, bim_export_ifc, bim_export_frag.

## B. Yetenek matrisi

VERIFIED: çalıştırıldı ve ayrı sorgu/okuyucuyla kontrol edildi. PARTIAL: belirtilen sınırlamalarla kontrol edildi. NOT TESTED: güvenilir uygulamalı test tamamlanmadı. NOT EXPOSED: mevcut MCP arayüzünde yok.

| Alan | Durum | Kanıt ve sınır |
|---|---|---|
| Proje/mekânsal yapı | PARTIAL | Proje, iki kat, tesis ve sınırlandırılmış oda sorgulandı. Tesise eleman ataması ayrıca denenmedi. |
| Akslar | VERIFIED | 6 aks; X=0/6/12, Y=0/4/8 m, son model özetinde mevcut. |
| Mimari BIM | PARTIAL | Duvar, boşluk, döşeme, çatı, merdiven, korkuluk, tavan, rampa ve giydirme cephe oluşturuldu. 3D genel görsel kontrol tamamlanmadı. |
| Taşıyıcı BIM | PARTIAL | Kolon, kiriş, RHS çapraz, yapısal döşeme ve radye; kesit/miktar sorguları ve geometrik temas sorgusu kontrol edildi. Statik analiz yok. |
| MEP BIM | PARTIAL | Boru, kanal, kablo tavası, fitting ve açık uçlar sorgulandı. İki boru açıkça bağlandı; fitting bağımsız bırakıldı. |
| Malzemeler | VERIFIED | 4 kaynak; beton renk/kategori güncellemesi sorgulandı. Cam kaynağı oluşturuldu fakat ayrıntılı cam panel malzemesi ataması doğrulanmadı. |
| Tipler/aileler | PARTIAL | 19 tip ve 1 aile; kutu parametreli genel ekipman ve tip adı güncellemesi doğrulandı. Gelişmiş aile editörü test edilmedi. |
| Eleman düzenleme | PARTIAL | Böl/birleştir, uzat, host değiştir, kat değiştir, dönüş/ad düzenle, özellik yaz ve sil doğrulandı. Trim/unjoin denenmedi. |
| Geri alma/geçmiş | VERIFIED | İki deneme duvarı silindi; sorgu 0 sonuç verdi; aynı komut geri alındı; iki duvar döndü, geçmişte silme reverted=true oldu. Genel replay/snapshot testi değildir. |
| IFC dışa aktarım | VERIFIED | Son dosya açıldı; IfcOpenShell şema doğrulaması 0 hata; kat ve ilişki kayıtları kontrol edildi. Tam geometrik/MEP mühendislik uygunluğu değildir. |
| Fragments dışa aktarım | PARTIAL | Dosya, boyut ve SHA-256 doğrulandı; bağımsız 3D gösterim kontrol edilmedi. |
| 2D plan | VERIFIED | Ground Floor için 1200 px plan üretildi ve görseli incelendi. |
| Doğrulama | PARTIAL | Son model ok=true, issues=[]; negatif boyut, referans ve bağlantı denemeleri reddedildi. Çakışma/erişilebilirlik/statik uygunluk kapsanmaz. |
| Georeferans | PARTIAL | EPSG:5254, test ötelemesi ve ileri/geri koordinat dönüşümü doğrulandı. Temizleme komutu denenmedi. |
| Diğer | NOT TESTED / NOT EXPOSED | Donatı, kazık, assembly, eğimli çatı oluşturma denenmedi. Snapshot/replay yönetimi ve CAD yükleme/semantik dönüşüm için MCP aracı görülmedi. |

## C. Oluşturulan test modeli

Son MCP sorgusu 53 eleman döndürdü; kategori toplamı da 53.

| Nesne | Adet |
|---|---:|
| Kat: 0 ve +3,20 m | 2 |
| Aks | 6 |
| Duvar | 12 |
| Kolon 0,40 × 0,40 m | 8 |
| Kiriş 0,30 × 0,50 m | 8 |
| RHS çelik çapraz | 1 |
| Zemin/üst kat döşemesi, 0,20 m | 2 |
| Çatı, referans +6,40 m | 1 |
| Radye, 0,40 m | 1 |
| Kapı / pencere | 2 / 2 |
| Kapı/pencere boşluğu | 4 |
| Boru / kanal / kablo tavası / fitting | 2 / 1 / 1 / 1 |
| Merdiven / korkuluk / tavan / rampa / giydirme cephe | Her biri 1 |
| Oda / genel ekipman | 1 / 1 |
| Malzeme / tip / aile / tesis / MEP sistemi | 4 / 19 / 1 / 1 / 3 |

Duvar sayısına silme/geri alma için kullanılan iki geçici örnek dahildir. Giydirme cephe ve rampa bina dışında ayrı yetenek örnekleridir; bütünleşik uygulama projesi olarak sunulmaz. Üst kat oda alanı 92,04 m² olup araç `wall_centerline` sınır yöntemini raporlar; net kullanım alanı olarak yorumlanmamalıdır.

## D. Başarılı işlemler ve doğrulama

- `bim_create_walls`: dış yüz esaslı 12 × 8 m çevre, her katta dört duvar ve zeminde iki iç duvar; `bim_get_element` kalınlığı 0,20 m, yüksekliği 3,20 m ve boşluk ilişkilerini gösterdi.
- `bim_join_walls`: sekiz çevre köşesi açıkça birleştirildi; `bim_get_element` JOINED_TO ilişkileri ve sınırlandırılmış oda sorgusu kontrol edildi. İç duvarların kesişimi otomatik bağlantı sayılmadı.
- `bim_place_openings` / `bim_rehost_opening`: iki kapı, iki pencere; N-0001 boşluğu W-0001'den W-0002'ye taşındı; üretilen planda yeni host üzerinde görüldü. IFC'de 4 void ve 4 fill ilişkisi mevcut.
- `bim_create_columns` / `bim_create_beams` / `bim_create_braces`: kesit ve miktarlar ayrı sorgulandı. Kolon için 0,16 m² kesit ve 3,20 m yükseklik; kiriş için 0,15 m² kesit; çapraz için yaklaşık 11,6482 m uzunluk alındı.
- `bim_query_structural_connectivity`: 63 geometrik temas ilişkisi döndü; araç bunun saklanan bağlantı tasarımı olmadığını açıkça bildiriyor.
- `bim_create_stairs`: 18 rıht, 3,20 m yükseliş, 4,50 m koşu; sorguda rıht=0,17778 m, basamak derinliği=0,26471 m ve basamak profili görüldü. Üst döşemeye ayrı boşluk verildi.
- `bim_create_curtain_walls`: 3 × 3,20 m örnek; sorgu 12 panel, 4 dikme ve 15 yatay parça hesapladı.
- `bim_create_ramps`: 4 m koşu ve 0,30 m yükseliş; sorgu %7,5 eğim verdi.
- `bim_create_families` → `bim_create_types` → `bim_create_components`: mekanik kategoriye ait 0,8 × 0,6 × 1 m genel kutu. Kat/dönüş değişiminden sonra z=3,2–4,2 m ve 30° dönüş sorgulandı. Bu detaylı mekanik ekipman geometrisi değildir.
- `bim_connect_mep`: [3,1,2,5] m ortak noktasındaki boru uçları açıkça bağlandı. Öncesinde 2 ağ bileşeni/4 açık uç; sonrasında iki boru için 1 bileşen/2 açık uç görüldü. Bağımsız fitting eklendiğinde nihai piping ağı 3 eleman, 2 bileşen, 1 junction ve 4 açık uç içeriyor.
- `bim_split_wall` / `bim_merge_walls`: W-0010, t=0,25 ile 2,9 ve 8,7 m parçalara ayrıldı; yeni kimlik onay sırasına bağlı olduğundan gerçek sorgudan W-0013 olarak alındı. Birleştirme sonrası 11,6 m ve tek eleman doğrulandı.
- `bim_extend_wall`: geçici W-0011 uzunluğu 2→3 m; uç x=17→18 m sorgulandı.
- `bim_delete_elements` / `platform_undo`: yalnızca W-0011/W-0012; silme CMD-e19362c3, geri alma CMD-c0caeb19. Kaydedilen geçmiş ve bağımsız eleman sorgusu doğrulandı.
- `bim_convert_coordinates`: [12,8,6,4] → [500012,4500008,106,4] → [12,8,6,4]; dönüşüm tutarlılığı doğrulandı.

## E. Hatalar ve sınırlar

| Araç / durum | Gerçek hata veya sınırlama | Yorum / öneri |
|---|---|---|
| bim_create_types; negatif genişlik | -32602: Too small: expected number to be >0 at types[0].profile.b | Beklenen giriş reddi. |
| bim_create_columns; olmayan kat | RESOURCE_NOT_FOUND: Storey 'MISSING_STOREY' not found. Available: none | Beklenen kaynak reddi. |
| bim_create_walls; kiriş tipi | INVALID_REFERENCE: 'BT-0001' is a beam type, not wall. | Beklenen kategori/tip reddi. |
| bim_place_openings; olmayan host | INVALID_HOST_RELATION: Host 'INVALID_HOST' is not an existing wall. | Beklenen ilişki reddi. |
| bim_connect_mep; uzak uçlar | MEP_CONNECTION_DISTANCE: uçlar 4 m ayrı; tolerans 0,001 m | Beklenen reddetme; otomatik snap yapılmadı. |
| Malzeme önerisinin onayı | material name 'Concrete C30/37' is already used by M-0002. | Tipler önce onaylanınca otomatik malzemeler oluştu. Dört kaynaklık öneri failed oldu; yalnız eksik cam malzemesiyle tek düzeltilmiş çağrı yapıldı. Onay sırası/kaynak tekrar kullanımına açık ürün akışı gerekli. |
| IFC/Fragments dosya adı | INVALID_EXPORT_PATH: uzun tire karakterli ad reddedildi | Düz ASCII adla tek düzeltilmiş deneme başarılı. Kullanıcıya dosya adı kuralı önceden gösterilmeli. |
| Kapı/pencere | hosted_insert, sabit 0,06 m derinlik; duvar ortasında basit katı | Host/void/fill doğru sorgulandı. Kasa/kanat/cam detayları ve yüz esaslı ofset ayarı doğrulanmadı. Kullanıcının 3D görünümde gömülme gözlemi ayrı tutuldu. |
| Oda | wall_centerline sınırı, 92,04 m² | İç yüz/net alan standardı bu testte doğrulanmadı. |
| Fitting | Parametrik gövde ve iki port mevcut; bu örnek ağdan bağımsız | Gerçek fitting bağlantısı ayrıca denenmedi; dokunan geometri bağlantı yerine geçmez. |
| 3D tarayıcı denetimi | gstack browse: Server failed to start within 15s | 3D/Fragments görsel doğrulaması NOT TESTED. Bu uygulama motoru hatası olarak sınıflandırılmadı. |

Negatif işlemlerden sonra ilgili model sorguları ve son doğrulama kontrol edildi. Bunlar denenen sınırlı örneklerdir; tüm bozuk girdilere dayanıklılık kanıtı değildir. Kodda düzeltme yapılmadı.

## F. Dışa aktarma doğrulaması

Dosyalar: `data/INSA_CAPABILITY_TEST_20261013_110354/exports/`.

| Dosya | Bayt | Kontrol |
|---|---:|---|
| INSA_Capability_Test_Final.ifc | 80.077 | IfcOpenShell açtı; IFC4X3, 1.561 kayıt; şema doğrulaması 0 hata. |
| INSA_Capability_Test_Final.frag | 20.994 | Dosya mevcut, dolu ve SHA-256 araç çıktısıyla aynı. Görsel yükleme doğrulanmadı. |

Son IFC'de 12 IfcWall, 2 IfcDoor, 2 IfcWindow, 8 IfcColumn, 8 IfcBeam, 3 IfcSlab, 1 IfcRoof, 1 IfcStair, 1 IfcRailing, 1 IfcRampFlight, 1 IfcCurtainWall, 1 IfcSpace, 2 IfcPipeSegment, 1 IfcDuctSegment, 1 IfcCableCarrierSegment ve 1 IfcPipeFitting bulundu. 10 IfcDistributionPort, 4 IfcRelVoidsElement, 4 IfcRelFillsElement, 29 IfcRelAssociatesMaterial ve 12 IfcRelDefinesByType mevcut. IFC alt parça sayıları platform ana eleman sayılarıyla bire bir eşleşmek zorunda değildir.

IFC SHA-256: b9f0474d40dffbc5ff569c39164c640b3a34d623626e7f5b141f12d8d7a47729.
Fragments SHA-256: 778dd50afa7bd8f5549cf7fdcf1a091ea851cccefaa6ab9b81c9e28db7c687f0.

Bağımsız kontrol şema/kayıt ilişkilerine yöneliktir. Bütün geometrilerin tessellation, çakışma, hacim ve mesleki uygunluk testi değildir. Snapshot/replay: **Uygulanmış olabilir; bu MCP testi üzerinden doğrulanmadı.**

## G. Ürün hazırlığı değerlendirmesi

INSA bu testte basit çok disiplinli BIM elemanlarını gerçek semantik kategoriler, kaynak referansları, miktarlar ve onay/geçmiş akışıyla oluşturabildi. Duvar katmanları, profil süpürmeleri, döşeme sınırları, merdiven basamakları, rampa eğimi, cephe panel bölünmesi ve MEP rota/fitting geometrileri parametrik sorgu çıktıları üretti.

Genel ekipman yalnızca parametreli kutudur. Kapı/pencere gösterimi de basit 6 cm katıdır; ayrıntılı imalat/familial temsil olarak sunulmamalıdır. Cam kaynağının varlığı cam panel materyalinin gerçekten atandığı anlamına gelmez. Geometrik temas statik birleşim hesabı, boru bağlantısı hidrolik tasarım, sıfır şema hatası profesyonel teslim yeterliliği değildir.

Pratik bina akışında kapı/pencere detayları, net oda sınır konvansiyonları, bütünleşik merdiven/boşluk koordinasyonu, malzeme-onay sırası ve 3D dışa aktarım doğrulaması eksikleri önemlidir. EPC için sınanan fitting/ağ örnekleri çok sınırlıdır; ekipman detayları, disiplin standardizasyonu, sistem mühendisliği, bağlantı imalat detayları ve koordinasyon uygunluğu test edilmedi. Ticari hazır ürün kararı bu testten çıkarılamaz.

## H. Drawing-to-BIM için önerilen en küçük geliştirme sırası

Mevcut MCP araç envanterinde aşağıdaki uçtan uca CAD işlemleri bulunmadı. Bu, başka bir kod yolunda hiç uygulanmadıkları iddiası değildir.

1. **DWG/DXF alma ve kaynak izlenebilirliği:** dosya/katman/entity kimliği, birim ve koordinat metadatasını taşıyan ayrı giriş katmanı. Önce desteklenen tek CAD formatıyla sınırlı akış.
2. **3D çalışma alanında CAD çizimi ve seçim:** çizgileri gerçek CAD katman/entity kimlikleriyle gösterme, seçim kümesi oluşturma. BIM kutusu üretmek yerine kaynak CAD görünümü korunmalı.
3. **Seçimden semantik eşleme:** seçili geometriyi kategori/motor/tip/kata eşleyen yapılandırılmış öneri. Mevcut bim_get_category_capabilities, tip sorguları ve create araçları yeniden kullanılmalı; desteklenmeyen kategori reddedilmeli.
4. **Tek ve izlenebilir önizleme/onay akışı:** CAD kaynağı → normalleştirilmiş eksen/sınır → dry_run → kaynak bağımlılık sıralaması → insan onayı. Bu testte görülen malzeme-onay sırası sorunu bu aşamada çözülmeli.
5. **Düzenlenebilir çıktı ve doğrulama:** mevcut update/split/join/rehost araçlarıyla dönüşüm sonrası düzenleme; kaynak entity bağlantısını koruma; IFC şema kontrolüne ek olarak 3D görsel ve geometri/çakışma kontrolleri. Kapı/pencere temsili iyileştirilmeli.

Önerilen ilk kapsam: seçili DXF çizgileri → duvar eksenleri → onaylı duvar tipi → dry_run → BIM duvarları → join → kapı/pencere host eşleme → plan/IFC kontrolü. Mevcut çalışan duvar ve yönetişim motorlarını yeniden kullanır; testte kanıtlanmayan genel otomatik bina dönüşümünü vaat etmez.

## Test kapsamının açık sınırı

Trim/unjoin, donatı, kazık, assembly, eğimli çatı, gerçek fitting bağlantısı, georeferans temizleme, tüm eksik-parametre örnekleri, snapshot/replay ve 3D viewer denetimi tamamlanmadı. Bunlar başarılı kabul edilmedi. İki geçici duvar geri alma kanıtı olarak modelde bırakıldı. Bekleyen öneri yok; son platform doğrulaması ok=true, issues=[].
