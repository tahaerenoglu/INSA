# INSA çalışma alanı tasarımı

## Amaç
Model, kaynak dosyaları ve inceleme araçlarını aynı çalışma alanında anlaşılır tutmak. Geniş 3B görünüm, kolay eleman seçimi, proje dosyalarına doğrudan erişim ve görünür insan onayı akışı.

## Düzen
- Üst çubuk: aktif proje, bağlantı, oluşturma ve oturum.
- Sol modül şeridi: Model, Dosyalar, Harita, Gezin, Araçlar, Malzeme, Onaylar, Geçmiş.
- Proje gezgini: kimlik/ad araması, kategori → nesne → alt eleman hiyerarşisi. Alt elemanlar yalnız açıldığında DOM'a alınır.
- Orta alan: mevcut 3B viewer, kat planı veya dosyalar. Görünüm değişimi viewer'ı yeniden oluşturmaz.
- Sağ panel: özellikler, asistan, onaylar ve modüle özel kontroller. Harita denetimleri panel değişimlerinde monte kalır.
- Alt durum: bağlantı, nesne sayısı, seçim, birim ve revizyon.

## Görsel sistem
Koyu arduvaz başlık/modül şeridi; açık çalışma yüzeyleri; petrol yeşili eylem/seçim rengi. Sarı yalnız bekleyen onaylar, kırmızı yalnız hatalar. Segoe UI/system fontları; dış font isteği yok. 6–9 px köşe, ince kenarlık, düşük kontrastlı arka plan. Yoğun mühendislik verisinde süsleme yerine hiyerarşi.

## Bileşenler
- `src/ui/WorkspaceChrome.tsx`: modül şeridi, panel gezinmesi, oluşturma araçları.
- `src/ui/ProjectExplorer.tsx`: BIM ve altyapı model ağacı.
- `src/ui/workspace.css`: çalışma alanı tokenları, bileşen ve duyarlı düzen.
- Mevcut `ProjectFiles`, `GoogleMapPanel`, inceleme panelleri ve viewer tekrar kullanılır.

## Bağımlılık
[Lucide React](https://github.com/lucide-icons/lucide), ISC: erişilebilir metin/etiketlerle birlikte kullanılan SVG ikonları. Yalnız kullanılan ikonlar içe aktarılır. İkon paketi iş kuralları veya veri katmanını değiştirmez.

## Etkileşim ve erişim
Paneller kapanabilir; 950 px altında gezgin, 650 px altında inceleyici çekmeceye dönüşür. Dar ekranda model alanı önceliklidir. Görünür klavye odağı, anlamlı düğme etiketleri, açık/seçili durumlar ve reduced-motion desteği bulunur. Onay ekranı varsayılan olarak bekleyenleri gösterir; kimlik araması ve parametre ayrıntıları sağlar. Onay/ret yetkisi ve dört göz kuralı mevcut API'de kalır.

## Sınırlar
Bu değişiklik BIM/IFC, model geometrisi, koordinat eşlemesi, araç kayıt sistemi veya onay politikasını değiştirmez. Gerçek harita erişimi kullanıcı oturumundaki sağlayıcı kimlik bilgilerine bağlıdır.
