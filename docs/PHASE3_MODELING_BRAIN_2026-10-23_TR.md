# INSA Phase 3 — ortak modelleme çekirdeği

Tarih: 23 Ekim 2026. Bu rapor tamamlanan ortak çekirdeği ve henüz tamamlanmayan geniş kapsamı ayırır. Phase 3 şartnamesinin bütünü tamamlandı olarak kabul edilmemelidir.

## 1. Mevcut mimari incelemesi

Native BIM tipleri, parametrik component aileleri, MEP sistem/connector/junction kayıtları, assembly motoru, IFC ürün kimlikleri, altyapı componentType/section/family kayıtları zaten vardı. Yeni veritabanı veya ikinci model grafiği kurulmadı. Platform'un mevcut event, yetki, insan onayı, atomik işlem, undo, snapshot ve replay yolları kullanıldı.

## 2. Eklenen ortak davranış

Sekiz yüksek seviye araç korunuyor. `model_plan` / `model_generate` içine `definitions`, `instances`, `assembly`, `assembly-array` yetenekleri eklendi. `semantic.library` ve `semantic.graph`, `project_query` üzerinden okunur. Ortak katalog, mevcut kayıtların projeksiyonudur.

## 3. Family / type / instance

Saklanan component aileleri mevcut parametrik box mekanizmasını kullanır. Native kolon/profil/donatı aileleri mevcut tip şemalarından türetilen `native:*` tanımlayıcılarıdır; yeni, serbestçe düzenlenebilir native aile şemaları değildir. Tanımlar içerik eşitliğiyle yeniden kullanılır; aynı adın farklı tanımla kullanımı reddedilir. Her yerleşim ayrı model ve IFC kimliğini korur. Katalog proje kapsamındadır; global kütüphane eklenmedi.

## 4. Assembly

Mevcut assembly motoruna isteğe bağlı doğrudan `primary` üye eklendi. Genel tarif açık parçalar, yerel yerleşimler, tekrar yerleşimleri ve isteğe bağlı connector bağlantıları içerir. Recipe kimliği ve içerik revizyonu assembly özelliklerine yazılır. Kalıcı, düzenlenebilir bir assembly-type kütüphanesi henüz yoktur; recipe değişikliği bütün mevcut assembly'leri otomatik güncellemez.

## 5. Betonarme kolon

Upright dikdörtgen kolonun açık cover, çap, etriye aralığı ve çelik sınıfıyla iki parametrik donatı seti üretilir. Kolonun konumu, dönüşü, yüksekliği veya bağlı tipleri değişince mevcut set kimlikleri korunarak geometri aynı işlem içinde yenilenir. Sığmayan geometri atomik olarak reddedilir. Diğer kolon kesitleri ve eski, açık path ile çizilmiş donatılar bu otomatik yenilemenin kapsamı dışındadır. Büklüm geometrisi modelleme varsayımıdır; yönetmelik veya taşıma gücü doğrulaması değildir.

## 6. Model ağacı

Host ve primary assembly projeksiyonu genel semantik referansları kullanır. Donatılar kolon altında ayrı satırlardır. İç içe primary assembly'lerin görünür üst elemanları çözülür. Kat, kategori, disiplin, sistem, family/tip, host ve assembly görünümleri vardır. Kütüphane occurrence ağacından ayrıdır. Bir donatı setinin tüm gerçek IFC ürün GUID'leri seçim/gizleme/izolasyon yoluna aktarılır.

## 7. Tekrar ve geometri paylaşımı

Kolonlar aynı native tipi; ekipman/panel tekrarları aynı component tipini; koridorlar mevcut componentType kimliğini paylaşır. IFC dışa aktarımında aynı profil tanımı yeniden kullanılır; 20 kolon tek profile rağmen 20 ayrı üründür. GPU instancing veya yeni Fragments geometri paylaşım motoru uygulanmadı. Binlerce eleman için DOM sanallaştırması ve ölçülmüş yoğun model performans kabulü henüz yoktur.

`scripts/phase3-density-check.mts 5000` çekirdek ölçümünde 5.000 ayrı kolon ürünü, 1 tip ve 1 IFC profil tanımı doğrulandı. Bu makinede beş batch üretimi yaklaşık 30,59 s; grafik sorgusu 141,68 ms; koordinasyon 79,58 ms; IFC yazımı 297,51 ms sürdü (3.356.759 byte). Ayrık QA gridinde broadCandidates/narrowPairs 0; bu çakışmalı yoğun sahne stres testi değildir. Sonuç `output/phase3-live-qa-2026-10-23/density.json` içinde. GPU, Fragments yükleme ve 5.000 satırlı UI bu ölçüme dahil değildir.

## 8. Tip revizyonu

İçerik hash'i ve mevcut event geçmişi revizyon kanıtını sağlar. Tip/aile/storey değişikliklerinin bağlı yerleşim ve engine bağımlılık kapanımı, revizyonun koordinasyon kapsamına alınır. Böylece yalnız tip büyüterek oluşan kolon çakışması da reddedilir. Sayısal resource version/CAS protokolü eklenmedi. Undo/snapshot/replay mevcut Platform mekanizmasını kullanır.

## 9. IFC / Fragments

Mevcut native IFC motorları korunur. Betonarme örnekte decomposition Assembly → Column → gerçek donatı ürünleri şeklindedir; donatılar iki farklı IFC decomposition parent'ına eklenmez. Gerçek IFC ve Fragments dosyaları HTTP'den üretildi; native testte de gerçek IFC→Fragments dönüşümü çalıştı. Yeni viewer/Scene oluşturulmadı.

## 10. Planner ve archetype

Analyze çıktısına konut, demiryolu, metro istasyonu, güneş santrali, endüstri ve köprü için capability/missing listeleri eklendi. Bunlar yetenek açıklamalarıdır; tam proje tasarlayan otomatik planner değildir. Asistan sistem talimatı mevcut kaynakları sorgulama, tipi yeniden kullanma ve açık assembly girdileri için güncellendi.

## 11. Semantic graph

Tip, aile, kat, sistem, host, engine dependency, assembly ve açık connector referansları ortak düğüm/kenarlara yansıtılır. Altyapı alignment, corridor layer placement, section ve aile üyelikleri adapte edilir. İsteğe bağlı gerçek koordinasyon kanıtı Intersects/Penetrates/SupportedBy ilişkileri sağlar. Sistem üyeliği açık connector bağlantısı üzerinden yayılır; yakınlıktan türetilmez. Grafik revizyonu düğüm içerik değişikliklerini de kapsar. Her ilişki adı için otomatik bir geometrik çıkarım motoru bulunmaz.

## 12. Constraints

Mevcut engine doğrulamaları, rulepack registry ve koordinasyon kanıtı ortak raporda kullanılır. BIM referans bütünlüğü raporlanır; engineeringAdequacy false'tur. Bütün disiplinlere ait bağımsız bir universal constraint DSL/solver, yapısal analiz veya standart uygunluğu hesabı eklenmedi. Altyapı kendi mevcut domain doğrulayıcısını kullanmaya devam eder.

## 13. Disiplin kapsamı ve belge sınırı

Bina, üstyapı, tesisat ve altyapı aynı platform kapsamındadır. Genel ekipman/panel örnekleri parametrik box geometrisi ve açık connector'larla çalışır. Ayrıntılı pompa/panel imalat aileleri, ray/makas travers otomasyonu, köprüye özel geometrik planner, arazi takipli enerji yerleşimi ve elektrik hesabı henüz yoktur. Bu değişiklikte yeni document-understanding motoru veya çizimden otomatik ölçü çıkarımı uygulanmadı. Canlı test ölçüleri sentetik QA girdileridir; gerçek kaynak çizim veya BOQ kanıtı olarak sunulamaz.

## 14. Gerçek kabul senaryoları

`scripts/phase3-live-acceptance.mts` gerçek fetch kullanarak izole `tmp/phase3-live-data` sunucusunda çalıştı. Kullanıcı `data/` dizini değiştirilmedi. Sonuçlar `output/phase3-live-qa-2026-10-23/acceptance.json` ve `calls.json` içindedir.

| Kabul | Sonuç ve sınır |
| --- | --- |
| A/B | 20 kolon, 1 tip, 1 native aile tanımlayıcısı; 20 yerleşimi etkileyen revizyon; undo başarılı. |
| C/D | 1 kolon, 2 donatı seti, 1 assembly; 2 set yenilendi; undo başarılı; gerçek UI'de setler kolon altında. |
| E/F | Pompa-vana-boru assembly, 2 açık bağlantı, 3 sistem üyesi; dört pompa yerleşimi tek tipi kullanıyor. |
| G | İki koridor katmanı tek componentType kullanıyor; sentetik metre koordinatlarında 1000–3000 aralığı. |
| H | 8 panel + 8 mount + 8 assembly, tek panel tipi. Genel geometrik tarif; elektrik/enerji hesabı değil. |
| I | Gerçek HTTP, yetki reddi (viewer write 403), IFC/Fragments ve gstack UI kontrolleri yapıldı. Gerçek LLM sağlayıcısı test sunucusunda yapılandırılmadığı için doğal dil testi yapılmadı. |
| J | Hip roof Phase 2 gerçek HTTP örneğinde 0 issue; tam paket karşılaştırması ayrı JSON'da. Eski tüm testlerin geçtiği iddia edilmiyor. |

Gstack arayüzünde 20 kolon için 20 farklı DOM kimliği ve tek canvas doğrulandı. Betonarme modelde donatı seçimi özellik panelinde doğru seti açtı. Ekipman projesinde bağlı üç eleman `CW`, bağımsız üç pompa `Sistemsiz` grubunda göründü. Kütüphane native aile/tip/yerleşim sayılarını gösterdi. Kontrollerde JavaScript error görülmedi; headless WebGL ReadPixels performans uyarıları vardı. Ekran görüntüleri aynı output klasöründedir.

Son kodla test sunucusu yeniden başlatıldı; ilk projelerin 20/3/16 ağaç satırı ve kimlikleri korundu (`reopen.json`). HTTP kabul scripti yeniden başarılı çalıştırıldı (`final-restart/acceptance.json`).

## 15. Otomatik testler

Phase 3 testleri tip paylaşımı, IFC occurrence/profil sayıları, nicelikler, revizyon/undo, imkânsız revizyonda atomiklik, donatı yenileme, snapshot/replay, gerçek Fragments dönüşümü, HTTP ağaç metadata'sı, ekipman bağlantısı, enerji tarifleri, AI onayı ve iç içe assembly hiyerarşisini kapsar. Tam paket ve son derleme sonuçları test karşılaştırma dosyası ve handoff notunda kaydedilir.

Tam koşum: **758 test / 633 pass / 109 fail / 16 skip**. Phase 2'nin saklanan 751/625/110/16 koşumuna göre **0 yeni başarısızlık, 0 değişen hata mekanizması**. Aradaki yedi test altı yeni Phase 3 testi ve önceki material-filter düzeltmesinin testidir. Önceki aralıklı Windows atomic-rename hatası bu koşumda oluşmadı; bu bir düzeltme kanıtı değildir. Kalan 109 başarısızlık eski baseline kimlikleriyle aynıdır. Karşılaştırma: `docs/PHASE3_TEST_COMPARISON_2026-10-23.json`. Odaklı koşum **27/27 pass**. Typecheck ve web build geçti; mevcut büyük bundle uyarısı sürüyor.

## 16. Açık işler

Tam şartnameyi kapatmak için: kalıcı ve bağlı assembly type revizyonları; native aile düzenleme kapsamı; belge girdilerinin ortak planlama bağlamına aktarılması; eksik disiplin planner/constraint uygulamaları; yapılandırılmış gerçek LLM kabulü; yoğun model performansı ve gerekiyorsa geometri/DOM optimizasyonları; kalan eski regresyonların ayrı kök neden düzeltmeleri gereklidir. Mevcut ortak çekirdek bu işlerin yerine tamamlanmış bir evrensel mühendislik sistemi olarak sunulmamalıdır.
