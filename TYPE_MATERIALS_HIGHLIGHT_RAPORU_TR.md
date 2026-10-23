# Tip malzemeleri, katman detayları ve PBR seçimi

Sağ panelde **Tipler / Malzemeler** sekmesi eklendi. Duvar, döşeme, çatı, tavan, radye temel, kolon ve kiriş tipi oluştururken mevcut malzemeler seçilebilir. Aynı form içinde yeni malzeme adı, renk, opaklık, pürüzlülük ve metalik değer tanımlanabilir. Katmanlı tiplerde dıştan içe / üstten alta malzeme, kalınlık ve işlev sıralanır. İşlemler mevcut `bim_create_materials` ve `bim_create_types` araçları ile, mevcut izin/onay kuralları altında yürür.

Katmanlı obje model ağacında tek eleman kalır. `bim_get_element` yanıtındaki `material_details`, her katmanı mevcut kararlı malzeme kimliği ve tanımıyla ilişkilendirir. **Özellikler** panelinde katman adı tıklandığında renk, PBR değerleri, metre bazlı doku boyutu, doku önizlemesi ve Poly Haven kaynağı açılır. Gizli iç katman için ayrı BIM elemanı üretilmez.

PBR seçiminde sınır kutusu kaldırıldı. Gerçek render üçgenlerini paylaşan ayrı opak seçim maskesi kullanılıyor. PBR malzeme veya doku kaynağı değiştirilmez; seçim kalkınca görünüm geri gelir. PBR elemanlar için native Fragments highlight çizimi uygulanmaz; native elemanlar mevcut Highlighter ile seçilir. Canvas picking en yakın PBR/native hit'i karşılaştırır; boş alana tıklama hem görsel seçimi hem özellik seçimini temizler.

## Doğrulama

- Malzeme/katman/selection testleri ve mevcut resource regresyonları: **23/23 geçti**.
- Web build ve TypeScript denetimi geçti.
- Gerçek tarayıcıda yeni **İç Sıva** malzemesi ve üç katmanlı duvar tipi form üzerinden oluşturuldu.
- Demo `W-0001`: 2 cm tuğla kaplama + 20 cm beton çekirdek + 1,5 cm iç sıva. Atama sonrası aynı eleman kimliği korundu; demo toplamı 8 eleman kaldı.
- Ağaçtan ve canvas üzerinden yüzey highlight, seçim kaldırma ve dokunun geri gelmesi ekran görüntüsüyle kontrol edildi.
- Katman malzeme önizlemesi tarayıcıda açıldı.
- IfcOpenShell denetimi: **0 şema hatası**; tek duvarın layer usage ilişkisi üç malzemeyi doğru sırada içeriyor, toplam kalınlık 0,235 m.

Kanıtlar: `test-results/material-appearance/type-layer-editor.png`, `layer-material-detail-final.png`, `highlight-surface-final.png`, `highlight-cleared-pbr.png`, `highlight-pointer-pick.png`, `layered-wall.ifc`.

Değişen dosyalar: `apps/web/src/TypeMaterials.tsx`, `App.tsx`, `styles.css`, `viewer.ts`, `material-appearance.ts`; `packages/bim/src/tools.ts`; malzeme görünümü regresyon testleri.

Bu değişiklik katman tanımı ve malzeme detayının seçilmesini sağlar. V0.1'in 3D kaplaması hâlâ ilk katmanın malzemesini tek görünüm olarak kullanır; her katmanın ayrı yüzey çizimi veya katmanları patlatarak gösterme eklenmedi. Demo değişiklikleri yalnızca yalıtılmış 8788 test verisinde yapıldı. Ana 8787 uygulaması da yeni paneli kullanır.
