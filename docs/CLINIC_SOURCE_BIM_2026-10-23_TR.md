# Medical–Dental Clinic: beş disiplinli kaynak BIM

23 Ekim 2026. Proje: `medical-dental-clinic-20261023`.

## Bulunan kaynak ve kapsam

[buildingSMART topluluk arşivindeki Medical–Dental Clinic](https://github.com/buildingsmart-community/Community-Sample-Test-Files/tree/main/IFC%202.3.0.1%20(IFC%202x3)/Medical-Dental%20Clinic) seçildi. Yayıncıya göre gerçek bir binadan anonimleştirilmiş, iki katlı bir klinik koordinasyon örneğidir. Mimari, taşıyıcı, elektrik, HVAC ve sıhhi tesisat IFC dosyaları ile COBie tabloları bulunur. Yayıncı örneğin tam bir uygulama dokümanı seti olmadığını açıkça belirtir. Bu teslim eksiksiz pafta, hesap, detay veya bütün disiplinlerin mühendislik onayı olarak sunulmaz.

Atıf: **BSI (2020), “Medical-Dental Test Files,” buildingSMART International**. Lisans: CC BY 4.0. Değişiklik: yalnız kayıpsız IFCZIP paketleme ve ThatOpen Fragments görüntüleme dönüşümü; özgün IFC geometrisi, boyutları, malzemeleri ve kat sayısı değiştirilmedi. Kaynakların farklı disiplin export kimlikleri korunur; aynı onaylı revizyon oldukları varsayılmaz.

Kaynak dosyaların beşi de Git LFS kaydındaki özgün SHA-256 değerleriyle doğrulandı. Projede beş IFCZIP, kaynak/lisans/kapsam notu, checksum listesi ve envanter JSON’u kayıtlıdır. İlk modeller değiştirilmedi: `p4-mvl8e6lh-assembly` dört katlı örnek olarak ayrı kalır.

## Ölçüler ve modelleme durumu

Beş kaynak da metre kullanır. Mimari ve statik dosyalardaki ana kat kotları 0,000 / 4,570 / 9,250 m; temel kotu −1,000 m’dir. Bunlar ana referans kotlarıdır; binanın tüm ekipmanları dahil maksimum yüksekliği anlamına gelmez. Kaynak koordinatları mevcut Fragments koordinasyon mekanizmasıyla birlikte görüntülenir; disiplinler ayrı ayrı merkezlenip keyfi olarak üst üste taşınmaz. Gerçek georeferans/projeksiyon dönüşümü veya kaynaklar arası mühendislik koordinasyon onayı yapılmadı.

**Kaynak BIM federasyonu uygulandı. Düzenlenebilir native INSA elemanlarına parametrik yeniden üretim yapılmadı.** Kaynak görünümü ile native model ağacı, özellikleri ve doğrulaması ayrı gösterilir. IFC kaynaklarını açmak native BIM elemanı oluşturmaz, geometri commit’i veya “model_validate geçti” iddiası değildir. Ortaya yeni bir parametrik tasarım çıkarılmış gibi davranılmaz.

| Disiplin | Geometrili kaynak öğesi | Dönüşümde uyarı veren geometri kimliği |
|---|---:|---:|
| Mimari | 2.855 | 40 |
| Statik | 1.078 | 0 |
| Elektrik | 2.384 | 0 |
| HVAC | 3.967 | 0 |
| Sıhhi tesisat | 6.587 | 0 |
| Toplam | 16.871 | 40 |

Öğe sayıları mahal hacimlerini de içerir; imalat/metraj sayısı olarak yorumlanmaz. IFCSPACE hacimleri görünümü kapatmaması için gizlenir, kaynak dosyadan silinmez. Statik kaynakta 195 IfcColumn, 738 IfcBeam, 96 IfcFooting, 13 IfcSlab ve 12 IfcRoof kaydı okunur.

Mimarideki 40 uyarı, dönüştürücünün sorun bildirdiği geometri kimlikleridir; 40 bina elemanının tamamen kaybolduğu anlamına gelmez. Tam geometri eşdeğerliği doğrulanmadı. Bu durum model listesindeki mimari satırında gösterilir. Özgün IFCZIP indirilebilir; dosyadaki özgün geometri korunur. Kaynak uygunluk/donanım/donatı hesabı yapılmadı.

## Kullanım ve teknik değişiklik

[Projeyi aç](http://localhost:8790/?project=medical-dental-clinic-20261023&sourceModels=all). Girişten sonra beş kaynak otomatik açılır. Dosyalar panelindeki “IFC kaynak modellerini birlikte aç” düğmesi de aynı yolu kullanır. Disiplinler görünür/gizli yapılabilir, kaynak elemanı dosya/revizyon/IFC GUID kimliğiyle seçilebilir ve mevcut 3B ölçüm aracı kullanılabilir. “INSA modeline dön” kaynak görünümünü kapatır. Native IFC dışa aktarma, kaynak BIM’i yeniden üretilmiş model gibi dışa aktarmaz; beş kaynak dosyanın özgünleri ayrı indirilebilir.

Yeni viewer/DB kurulmadı. Mevcut dosya kayıtları ve izinleri, immutable artifacts, ThatOpen FragmentsManager ve kamera kullanılır. Backend özgün IFC/IFCZIP’ten resmi `IfcImporter` ile Fragments üretir. Source file/revision ve izin kontrolü önbellekten önce yapılır; arşivli kaynak reddedilir. Uyarılar dosya bazında görünürdür. Dönüşümler sıralıdır; global importer logları başka bir kaynağa atfedilmez. Fragments önbelleği beş dosya / 128 MiB ile sınırlıdır. Modeller proje değişiminde mevcut component lifecycle ile dispose edilir.

Genel dosya sınırı 10 MiB kalır. Yalnız IFCZIP için sıkıştırılmış 16 MiB / açılmış 64 MiB sınırı vardır. Arşiv tam olarak bir düz isimli `.ifc` içermelidir. Dizin, traversal, çoklu dosya ve büyük açılmış içerik metadata aşamasında reddedilir; dosyalar dizine açılmaz. İçerik UTF-8 STEP başlığıyla kontrol edilir. Kaynaklar untrusted veri olarak kalır.

## Doğrulama

- `npm run typecheck` ve `npm run build:web` geçti. Mevcut yaklaşık 7,39 MB bundle uyarısı sürer.
- Üç yeni IFCZIP/kaynak testi geçti. Kaynak güvenliği ve CAD kontrolü birlikte 6/6 geçti.
- Son tam koşu: **776 toplam / 651 geçti / 109 başarısız / 16 atlandı**. Phase 5 tabanına göre yeni/çözülen/değişen başarısız test kimliği sıfır. Karşılaştırma `CLINIC_TEST_COMPARISON_2026-10-23.json` içindedir.
- İlk tam koşu 776/650/110/16 idi: CAD review testinde Windows `proposals.json` atomic rename EPERM oluştu. İzole test ve son tam koşuda geçti; filesystem sorunu düzeltilmiş sayılmaz.
- Gerçek HTTP üzerinden beş IFCZIP kaydı ve beş Fragments yanıtı alındı. `SingleThreadedFragmentsModel` ile geometri GUID’leri ve sınıfları bağımsız sorgulandı.
- gstack `/browse` ile beş disiplini birlikte açma, URL’den tercihsiz açılma, sayfa yenileme, disiplin gizleme ve statik IFC elemanı seçimi test edildi. Seçilen örnek: statik `F-0002 v1`, GUID `22_kIllv127wWuzeSbBoPm`, IfcSlab/ROOF. Son seçim kontrolünde console error yoktu.
- Statik kaynak üzerinde iki gerçek 3B nokta seçimiyle mevcut ölçüm aracı **15,283 m** gösterdi. Bu, rastgele seçilen iki yüzey noktası arasındaki mesafedir; doğrulanmış bir aks açıklığı veya pafta ölçüsü diye kullanılmaz. Ekran kanıtı `clinic-measurement-final.png` dosyasındadır.

Kanıtlar git dışında `output/clinic-source/` altındadır: `checksums.json`, `inventory.json`, `project.json`, `fragment-inspection.json`, disiplin `.frag` ve GUID dosyaları, `clinic-all-disciplines-final.png`, `clinic-structural.png`. Kaynak dosyalar Git deposuna eklenmez. `data/` için taşıma/silme yapılmadı; mevcut 8790 uygulamasının veri kökü korundu.
