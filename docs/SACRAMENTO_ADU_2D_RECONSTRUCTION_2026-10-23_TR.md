# Sacramento ADU: 2D paftalardan yerel INSA modeli

Model: http://localhost:8790/?project=sacramento-adu-from-2d-20261023

Bu çalışma hazır IFC açma işlemi değildir. Asistan, belediyenin yayımladığı PDF plan/kesit/görünüşleri inceleyip ölçüleri ve vektör çizgilerini yorumladı; mevcut, denetim kayıtlı INSA araçlarıyla ayrı bir projede yerel elemanlar oluşturdu. Genel amaçlı, tam otomatik bir PDF-to-BIM okuyucusu geliştirildiği iddia edilmez. Önceki klinik referans projesi ve çerçeve projesi değiştirilmedi.

## Kaynak

- Yayıncı: City of Sacramento, Community Development. [Shelf Ready ADU Plans](https://adu.cityofsacramento.org/Shelf-ready-plans).
- [20x40 Two Bedroom Plan, ADU_2_BEDROOM.pdf](https://adu.cityofsacramento.org/content/dam/cityofsacramento/adu/plan/ADU_2_BEDROOM.pdf), pafta tarihi **26.11.2025**; erişim 23.10.2026.
- Orijinal PDF SHA-256: `cac7bc5f01be4691e9dd07e8c51984ef21c2d774947204a559565ddf788d3e8d`.
- PDF 19 sayfa. T1.1 indeksi 20 kalem içerir; başvuru sahibinin hazırlayacağı C1.1 vaziyet planı bu dosyada bulunmaz.
- A2.1 ölçülü mimari plan; A2.2 elektrik/çatı planı; A3.1 görünüşler; S1.1 temel/duvar kuşaklama; S1.2 çatı/tavan taşıyıcı planı; S2.1 kesit; SN.1 notlar; SD.1 detaylar kullanıldı. Enerji/yeşil bina/erişilebilirlik sayfaları da orijinal dosyada korunur.
- Belediyenin ücretsiz standart planları 2022 California Residential Code kapsamındadır. Kaynak, Sacramento içinde yapım ve gerekli başvuru/taahhüt şartları koyar; plan değişikliklerine izin vermediğini belirtir. Bu model bir ruhsat uyarlaması veya başka yerde yapım yetkisi değildir. PDF pafta içerikleri değiştirilmedi; yalnız boyut sınırı için sayfa alt kümeleri oluşturuldu. Kaynak dosyalar Git'e eklenmedi.

## Ölçü ve koordinat temeli

| Parametre | Kaynak değer | Model (m) |
|---|---|---:|
| Karkas dış yüzleri arası genişlik | 20 ft | 6,096 |
| Karkas dış yüzleri arası derinlik | 40 ft | 12,192 |
| Sundurma genişliği | 8 ft | 2,4384 |
| Sundurma derinliği | 5 ft 6 in | 1,6764 |
| Duvar üst kotu / ana tavan seviyesi | 8 ft 1 in | 2,4638 |
| Mahya kotu | 12 ft 7 1/4 in | 3,84175 |
| Ana döşeme kalınlığı | 4 in | 0,1016 |
| Çatı eğimi | 5:12 | 22,61986495° |
| Seçilen saçak taşması | 1 ft (paftada maksimum) | 0,3048 |

Başlangıç ön sol karkas dış yüzü `(0,0)`, +X genişlik ve +Y arkaya doğrudur. Bu bir yerel çizim koordinatıdır; aplikasyon, kuzey veya kadastro koordinatı değildir. A2.1 yazılı ölçüleri **face of stud** tanımlıdır; kaplama dışı ölçüsü gibi kullanılmadı. Duvar katıları karkas/yalıtım boşluğu zarfıdır; tek tek dikme ve bitiş katmanları modellenmedi. Bu nedenle duvar hacmi saf ahşap metrajı değildir.

A2.1 vektör planında dış karkas dikdörtgeni PDF koordinatlarında `x=458.94..818.94`, `top=504..1224` noktadır: inç koordinatları `x=(pdfX-458.94)/1.5`, `y=(1224-pdfTop)/1.5`. Asistanın duvar yorumları 1/4 in adımla kaydedildi. Bu hassasiyet, yorum doğruluğunun veya bitmiş yüzey ölçülerinin sertifikası değildir. Elektrik sembolleri ölçekli raster görünümden yaklaşık ±5 cm plan hassasiyetiyle sayısallaştırıldı.

Kaynak S2.1'deki “TOP OF SLAB 8'-1\"” etiketi, A3.1'deki açık `0'-0\"` döşeme kotuyla çelişir. Döşeme için A3.1'deki 0 kabul edildi; bu kaynak tutarsızlığı giderilmiş sayılmaz. Cihaz ebatları, işaretlenmemiş montaj kotları, pencere denizlik yorumları, ahşap gerçek kesit ebatları, tekrarların başlangıcı ve mertek oturmaları varsayım içerir.

## Oluşturulan yerel model

| Yerel nesne | Adet |
|---|---:|
| Duvar | 24 |
| Taşıyıcı profil elemanı | 100 |
| Kapı + pencere | 9 + 9 |
| Bağlı açıklık boşluğu | 18 |
| Temel / döşeme sınır elemanı | 7 |
| Çift eğimli çatı | 1 |
| Elektrik / armatür / cihaz temsili | 57 |
| Bağlı ve sınırlı mahal | 6 |
| **Toplam kimlik** | **231** |

Model ağacında boşlukların ayrı satır olarak gösterilmemesi nedeniyle **213 ürün satırı** görülür. 100 profil içinde 44 mertek, 40 tavan kirişi yarısı, 11 kuşak, mahya tahtası, iki sundurma kirişi, bir iç tavan kirişi ve bir sundurma dikmesi vardır. Mertekler mevcut eğik profil motorunun `structure.brace` kategorisindedir; kaynak işlevleri ad ve pafta özelliklerinde korunur. Bu kategori bir çapraz tasarımı yapıldığı anlamına gelmez.

57 bileşen: yorumlanan 15 aydınlatma, 26 priz, 8 anahtar ve 8 sıhhi armatür/cihaz/egzoz temsili. Bunlar katalog ürünü veya kesin elektrik metrajı değildir. Basit kutu temsilleri konum gösterir; cihaz servis boşlukları/çalışma hacimleri değildir. Her nesnede `INSA_Source` pafta, kaynak belge/revizyon, özgün PDF hash'i ve yorum/varsayım notları bulunur. Tekrarlanan mertek ve kirişler kararlı ortak tip kimliklerini kullanır.

Yerel projeye `architecture-electrical.pdf`, `structure.pdf` ve `reconstruction-basis.json` kaydedildi. PDF alt kümeleri orijinal pafta içeriklerini korur. `reconstruction-basis.json` güncellemeleri ayrı revizyonlardır; ilk taslaklar da tarihte tutulur. Kaynak IFC/IFCZIP kaydı yoktur. Modelden **yeni IFC ve Fragments çıktısı** alındı.

## Açık kapsam ve koordinasyon

**Uygulamaya hazır veya koordinasyonu tamamlanmış model değildir.** Son kontrolde 64 `HardClash` ve 12 `MissingConnection`, toplam **76 hata düzeyinde koordinasyon bulgusu** vardır. Alan/kimlik/host/topoloji alan kurallarında ayrıca hata çıkmadı; bu, 76 bulguyu geçersiz kılmaz.

- 40 bulgu tavan kirişlerinin düz uçlarının eğimli çatı ile kesişmesidir. 22 bulgu merteklerin kesilmemiş oturmaları ile duvar zarfı arasındadır. Motor uç kesisi/birdsmouth üretmediği için gerçek detay modellenmemiştir. Bunlar düzeltilmiş veya mühendis tarafından kabul edilmiş değildir.
- 2 bulgu monolitik sundurma döşemesi ile temel/perdeciğin örtüşmesidir; ayrı katıların net hacimleri çözülmedi. Bu haliyle beton metrajını kesin kabul etme.
- 12 bulgu otomatik çatı bağlama önerisidir. İç duvarları sırf bu kontrolü susturmak için çatı arasına uzatmadık; tavan kotunda kalmaları kaynak yorumudur. Önerilerin tasarım incelemesi gerekir.

Eksikler: vaziyet planı, tam ahşap dikme/lento/bağlantı elemanları, temel donatısı/ankrajlar, kaplama/yalıtım katmanları, sundurma eğimi; su/atıksu/soğutucu/kanal/kablo/boru güzergâhları, devre/pano/yük ve PV yerleşimi. Isı pompası performans bilgisi kaynakta vardır fakat cihaz yerleşimi ve ayrıntılı MEP hat planları yoktur; eksik hatlar veya cihaz konumları üretilmedi. Statik kapasite, deprem, yangın/enerji/mevzuat uygunluğu hesabı yapılmadı.

## Doğrulama ve tekrar üretim

`scripts/model-sacramento-adu-2d.mjs` ölçü ve yerleşim yorumunu açıkça içerir. Dosyalar `output/adu-2d/` altında bulunmalıdır. Yeni proje kimliği için `INSA_PROJECT`, sunucu için `INSA_URL` kullanılabilir. Özgün PDF hash'i değişirse script durur. Yazmalar Platform API üzerinden, mevcut kullanıcı/yetki/onay/audit mekanizmasıyla yapılır; veri dosyaları doğrudan düzenlenmez. İlerleme kaydı aynı adımların yanlışlıkla tekrar eklenmesini önler. Bu bir kullanıcı tarafından incelenmiş geometri betiğidir, genel PDF tanıma servisi değildir.

`scripts/verify-sacramento-adu-2d.mjs` gerçek HTTP üzerinden **14 kabul kontrolü** yaptı: 231 yerel kimlik; bütün nesnelerde kaynak; ölçü/kot/eğim; ortak tiplerin tekrar kullanımı; 18 kapı/pencere host bağı; yatay banyo kapısı; 6 sınırlı mahal; kaynak IFC bulunmaması; native dışa aktarım; eski projelerin korunması. 14'ü de geçti. Kontrollerden biri açık koordinasyonun raporlandığını da doğrular; koordinasyonun geçtiği iddia edilmez.

gstack `/browse` ile gerçek 3B görünüm ve yüklü 1400px plan görüntüsü görüldü. Çatı görünürlüğü değiştirildi; `N-0001` yerel pencere seçilerek `Host=W-0001`, `sourceFile=F-0001`, `sheet=A2.1; A3.1`, özgün PDF hash'i ve `sourceIFCImported=false` panelde doğrulandı. İlk geçici boş plan görüntüsü yükleme tamamlanmadan alınmıştı, başarı kanıtı sayılmadı. Gstack oturumu bir kez yeniden başladı; uygulamaya yeniden giriş yapıldı. Geçerli 3B ekran kanıtı `native-initial.png` / `native-delivery.png`, seçim kanıtı `native-selected.png` dosyalarıdır. Önceki web araştırma sayfalarının console hataları modelin hatası diye sınıflandırılmadı.

Sonuçlar ve native dışa aktarımlar git dışında `output/adu-2d/` içindedir. 14 kabul kontrolünün makine raporu `SACRAMENTO_ADU_2D_ACCEPTANCE_2026-10-23.json` olarak saklanır. Bu görevde uygulama motoru değiştirilmedi; tüm depo testlerini yeniden çalıştırmak yerine mevcut model üzerinde ölçü/kimlik/kaynak/host/dışa aktarım kontrolleri yapıldı.
