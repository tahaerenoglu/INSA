# Proje Dosyaları V0.1

Proje belgeleri mevcut INSA dosya deposunda, proje kimliği altında saklanır. Ayrı veritabanı, MCP sunucusu veya model motoru yoktur. `files` modülü aynı Platform olay geçmişi, snapshot, undo, rol ve onay kurallarını kullanır. Web ekranı: **3D / Plan / Dosyalar**.

## Araçlar

- `files_upload {filename, base64}`: en fazla 10 MiB orijinal kaynağı ve metin önbelleğini yükler. Sadece değişmez cache yazar; dosya henüz proje kaydı değildir. Yerel yol/URL kabul etmez. SHA-256 doğrulanır.
- `files_register {asset, filename, title?, discipline?, tags?}`: kayıt oluşturur. Yeni revizyon için `file: "F-0001", expected_version: 1` verilir. AI kayıtları normal insan onayını bekler. Aynı güncel içerik yeniden revizyon yapılmaz.
- `files_list {query?, discipline?, include_archived?, offset?, limit?}`: kimlik, güncel revizyon ve çıkarım durumlarını keşfeder.
- `files_get {file}`: metadata ve tüm revizyon geçmişi.
- `files_search {query, file?, discipline?, limit?}`: yalnız güncel, arşivlenmemiş revizyonlarda kaynak referanslı anahtar kelime araması. En fazla 100 belge ve 20 eşleşme; birden fazla terim aynı metin parçasında bulunmalıdır.
- `files_read {file, version?, page?, start_part?, limit?, as_image?}`: en fazla 8 metin parçası / 16.000 karakter; `next_part` ile devam. Her parça dosya/revizyon/sayfa kimliği taşır. `as_image` yalnız 5 MiB altı PNG/JPEG kaynaklarını mevcut asistan görsel kanalına iletir.
- `files_update {file, title?, discipline?, tags?, archived?}`: metadata veya mantıksal arşivleme. Dosya kaynakları fiziksel silinmez; arşivden çıkarma ve undo desteklenir.

Tüm araçlarda MCP adaptörünün standart `project` argümanı kullanılabilir. Uygulama içi asistan aynı Shared Tool Registry üzerinden bu araçları otomatik görür. **Codex'teki mevcut MCP oturumu yeni araçları keşfetmek için yeniden bağlanmalıdır.**

## İçerik desteği ve sınırlar

- Metin PDF: yerel PDF.js ile sayfa referanslı metin çıkarımı. En fazla 500 sayfa / 2 milyon karakter; aşımda `partial`. Bu sınırlar sadece metin önbelleğine aittir; orijinal dosya tam saklanır.
- UTF-8 TXT, MD, CSV, JSON, XML, ASCII/UTF-8 DXF ve IFC: metin okuma/arama. Geometri, birim veya sayısal mühendislik doğrulaması yapılmaz.
- XLSX: sheet/hücre adresi, formül, önbellekteki değer, stil kimliği, birleşik hücre ve sheet'e bağlı tablo verileri sunucu tarafında ayrıştırılır. Formül/makro çalıştırılmaz. `files_read_structure` kaynak/revizyon/hücre atıflarıyla sayfalı erişim sağlar. CSV tırnaklı alanları ve hücre koordinatlarını; DOCX paragraf ve tablo hücresi metnini korur. Bunlar mühendislik yorumu veya hesap doğrulaması değildir.
- PNG/JPEG ve DWG: orijinal saklanır; `stored_only`. Görseller açık `files_read as_image` çağrısıyla asistan tarafından incelenebilir. DWG içeriği bu çıkarıcıda otomatik ayrıştırılmaz.
- Taranmış PDF: OCR yapılmaz; boş metin katmanı `needs_ocr`. Şifreli/bozuk PDF `failed`; orijinal saklanır, okunmuş gibi sunulmaz.
- Arama yerel anahtar kelime aramasıdır; embedding/vector DB/RAG servisi yoktur.
- Belge içeriği güvenilmeyen kaynak verisidir. İçindeki talimatlar izin/onay veya kullanıcı isteği değildir. Model değişikliği yalnız ayrı BIM/infra araçları ve mevcut onay sistemiyle yapılır.
- Web indirmeleri oturum ve `files.read` izni ister. Yalnız kayıtlı dosya/revizyon üzerinden orijinal iner; geçici upload cache'inin genel indirme URL'si yoktur.

## Doğrulama

`packages/files/test/files.test.ts`: staging, içerik hash'i, sürümleme, stale revision onayı, proje izolasyonu, PDF metni, bozulan kaynak, arşiv, snapshot/replay/undo.

`apps/web-server/test/project-files.test.ts`: yetkili indirme, okuyucu/yazıcı izinleri, Shared Tool Registry, sahte modelle uygulama içi asistanın kaynak göstermesi ve eski snapshot uyumluluğu.

Tarayıcı doğrulaması ayrı `test-results/project-files-qa` veri dizini ve 8804 portunda yapılır; canlı projeye test dosyası eklenmez.

Yapısal Office çıkarımı en fazla 200 sheet, 50.000 hücre, 2.000 ZIP girdisi ve 25 MB açılmış kaynakla sınırlıdır. DTD/entity ve dış ilişkiler çalıştırılmaz; aşım/bozulma `failed` olarak raporlanır, orijinal kaynak korunur. Eski `stored_only` Office önbellekleri `files_read_structure` ile kaynak yerinde yeniden okunabilir; değişmez orijinal veya geçmiş revizyonlar değiştirilmez. OCR, otomatik mühendislik yorumu ve paftalar arası geometrik eşleştirme desteklenmiyor.
