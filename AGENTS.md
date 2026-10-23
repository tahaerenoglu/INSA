# INSA çalışma kuralları

- Tarayıcı işlemlerinde gstack `/browse` kullan. `mcp__claude-in-chrome__*` kullanma.
- Kütüphane/API kullanım belgelerinde mevcutsa Context7 kullan; kurulu sürüm ve tipleri kontrol et.
- Bina, üstyapı, tesisat ve altyapı aynı platformun kapsamıdır. Ortak arayüzü yalnız bir disipline özgü tanıtma.

## Tekrarlanan model elemanları

- Önce proje içindeki mevcut malzeme, aile, BIM tipi, tünel kesiti ve ortak bileşen tiplerini sorgula.
- Aynı geometri/malzeme düzenini bir kez tanımla; yerleşimlerde kararlı tip kimliğini kullan. Aynı kesiti her komutta yeniden üretme.
- Bina elemanları mevcut BIM tip/aile araçlarını; tüneller `section` kimliğini; koridor bileşenleri `componentType` kimliğini kullanır.
- Koridorlarda `infra_query_component_types` ile ara; eksik tipleri `infra_create_component_types` ile tanımla. `infra_create_road_corridor` / `infra_update_road_corridor` katmanlarında `{componentType, repeat:{anchor}}` yerleştir.
- Ortak profili/malzemeyi `infra_update_component_type` ile güncelle. Bu değişiklik tüm bağlı yerleşimlere etki eder. Tek yerleşime farklı profil gerekiyorsa yeni ve açıkça farklı bir tip kullan.
- Eski satır içi tanımlar geriye uyumluluk için desteklenir. Yeni tekrarlar için varsayılan yaklaşım değildir.
- Ortak GPU geometrisi/instancing görüntüleme optimizasyonudur; mühendislik katılarını, metrajları veya ayrı nesne kimliklerini tek yapıya indirgeme.
- Kaynak çizim geometri girdisidir; BOQ yalnız karşılaştırma kaynağıdır. BOQ ile tutturmak için ölçü değiştirme. Belirsizlikleri ve varsayımları kaynaklarından ayırarak kaydet.
