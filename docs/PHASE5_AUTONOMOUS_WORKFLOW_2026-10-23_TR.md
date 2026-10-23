# INSA Phase 5 — uygulama ve kabul raporu

Tarih: 23 Ekim 2026. Genel durum: **PARTIALLY IMPLEMENTED**. Bu teslim, mevcut çekirdekte asistan korumalarını, kaynaklı tablo birleştirmeyi, plan sözleşmesini ve sohbet başlangıcını geliştirir. Evrensel belge yorumlama veya bütün disiplinlerde uçtan uca otonom tasarım tamamlanmış değildir.

## 1. Mevcut LLM entegrasyonu — IMPLEMENTED

Mevcut `ModelClient`, Anthropic istemcisi, SSE ve Platform yürütmesi kullanılır. Üretim kataloğu sekiz yüksek seviyeli araç olarak kalır. Yeni LLM aracı, veritabanı veya viewer eklenmedi.

Asistan döngüsü 24 model turuyla sınırlıdır. Model çağrısı 90 saniyede sonlandırılır; SDK isteği 60 saniye ve en fazla bir yeniden denemeyle sınırlandırıldı. Platform yazıları belirsiz süre aşımından sonra otomatik tekrar edilmez. Kullanıcı iptali sağlayıcı sinyaline iletilir. Aynı başarısız çağrı iki kez görülürse döngü durur. Aynı başarılı çağrı aynı tur içinde yeniden yürütülmez; sorgu önbelleği proje olay sırasına bağlıdır. İç içe girdilerin tamamı karşılaştırılır.

İstek uzunluğu, geçmiş mesaj rolleri ve bağlam boyutu sınırlıdır. Yetki, dry-run, requestId/planId, kaynak revizyonları, onay, audit, atomik commit ve undo mevcut Platform tarafından uygulanır. Onay aracı modele verilmez. Kaynak metni yetki değildir.

## 2. Gerçek LLM durumu — NOT TESTED

Gerçek uygulamanın `GET /api/assistant/status` yanıtı: `enabled:false, model:null`. Gerçek sağlayıcı kabulü ve gerçek token tüketimi ölçülmedi. Hiçbir API anahtarı rapora veya test çıktısına yazılmadı.

8791 portundaki kabul sunucusu açıkça **SCRIPTED UI FIXTURE** yanıtı verir. Üretim girişinde etkinleşmez ve yalnız `tmp/phase5-ui-data` ile çalışır. Tarayıcı kanıtı gerçek HTTP/SSE/Platform/Fragments yolunu kullanır; model kararı önceden yazılmıştır. Bu bir gerçek LLM başarısı değildir.

## 3. Project Understanding — PARTIALLY IMPLEMENTED

`project_query → documents.requirements` üzerinden birden fazla kayıtlı belge revizyonu okunabilir. İnsan tarafından gözden geçirilmiş alan eşlemeleriyle tip tablosu ve yerleşim tablosu açık tip kodundan birleştirilir. Geometri, şartname ve BOQ rolleri ayrılır. Ölçüler SI birimine çevrilir; aynı tipin çelişen ölçüleri/material değerleri kaynaklarıyla gösterilir. BOQ değerleri üretim geometrisine katılmaz.

`document-set-model` capability’si bu gereksinimleri üretimden önce derler. Salt okunur sorgu ve `model_plan` hiçbir eleman oluşturmaz. Çelişki, eksik ölçü, formül veya bilinmeyen koordinat çerçevesi üretimi engeller. Model, mevcut profil kolon motoruyla, ortak tip ve ayrı occurrence kimlikleriyle oluşturulur. Modelde hücre atıfları, parametre kimlikleri, tip kodu ve kaynak etiketi saklanır. Yapısal parametre paketi kaynaklardan türetilen bir sorgudur; yeni bir kalıcı teknik-fakt veritabanı kurulmadı.

## 4. Format desteği — PARTIALLY IMPLEMENTED

| Format | Gerçek destek ve sınır |
|---|---|
| PDF | Metin katmanı ve sayfa/parça atıfları. Taranmış çizim için OCR ve otomatik plan-kesit geometrisi yok. |
| DXF | Mevcut CAD entity/bölge/kalibrasyon motorları ve metin kanıtı. Yeni evrensel çizim yorumlayıcısı yok. |
| DWG | Özgün dosya saklama. Yerel DWG geometri okuma yok. |
| IFC | Mevcut IFC→Fragments görüntüleme ve modelden IFC dışa aktarma yolları; dosya metni okunabilir. Otomatik IFC belge ilişkilendirme eklenmedi. |
| LandXML | Mevcut terrain/altyapı parser ve georeferans denetimleri. Her LandXML alignment varyantından otomatik proje kurma iddiası yok. |
| XLSX | Hücre/sayfa/formül kanıtı ve gözden geçirilmiş tablo eşleme. Formüller çalıştırılmaz. |
| DOCX | Paragraf ve mevcut yapı çıkarımı. Otomatik teknik şartname yorumu yok. |
| CSV | Hücre tabanlı kaynaklı gereksinim ve çoklu belge kolon üretimi canlı test edildi. |
| LAS/LAZ | NOT IMPLEMENTED; dosya biçimi kayıt listesinde yok. |

Yeni bir OCR, CAD, IFC veya nokta bulutu motoru eklenmedi. Yükleme, içerik çıkarımı ve modelleme desteği aynı şey olarak raporlanmaz.

## 5. Yapılandırılmış parametreler — PARTIALLY IMPLEMENTED

Her eşlenmiş hücre: kararlı parametre kimliği, ad, değer/birim, SI değer/birim, belge/revizyon/hash, sayfa adı/hücre, atıf, koordinat referansı, güven açıklaması, rol ve doğrulama durumu taşır. `Derived`, `Missing`, `RequiresApproval`, `Conflicting` gerçek kanıttan türetilir; belge varlığı `Verified` sayılmaz.

İlişkilendirme yalnız açık tip kodundan yapılır. Aks, tag ve station alanları kanıt olarak korunur; otomatik mekânsal ilişki veya kilometraj dönüşümü çıkarılmaz. Yeni çoklu tablo üretimi yalnız gözden geçirilmiş dikdörtgen kolonlar ve `local-project-SI` koordinatları içindir. Kaynak koordinatından projeye dönüşüm yapılmış gibi davranılmaz. PDF plan/kesit/type-table semantik eşlemesi tamamlanmadı.

## 6. Planlayıcı — PARTIALLY IMPLEMENTED

Türkçe bir–on kat sayıları desteklenir. “Üç katlı, toplam 300 m² bir bina oluştur.” üç kat ve toplam 300 m² girdili, pinlenebilir önizlemeye dönüşür. Bu, sınırlı deterministik yorumlayıcıdır.

Planın `operationSteps` alanı işlem kimliği, capability, girdiler, bağımlılıklar, önkoşullar, beklenen çıktılar ve doğrulama kurallarını verir. Transaction sözleşmesi açıkça tüm plan için tek Platform olay paketi, başarısız derlemede sıfır olay ve commit sonrasında undo olarak raporlanır. Kısmi commit yoktur. Mevcut DAG ve kaynak bağımlılık sıralaması korunur. Her keyfi doğal dil isteği için otomatik workflow çıkarımı tamamlanmadı.

## 7. Archetype bilgisi — PARTIALLY IMPLEMENTED

Konut, demiryolu, metro istasyonu, GES, endüstriyel tesis ve köprü için koşullu sistem/capability/girdi/assembly rolü/kapsam kuralları eklendi. Bunlar kaynak, terrain, alignment, station, seviye, açıklık, servis alanı veya yerleşim bilgisi ister. Önce ortak kaynak kütüphanesi aranır. Olası sistemlerin tümü otomatik etkinleştirilmez. Bu bilgi bir tasarım hesabı veya bütün proje otomasyonu değildir.

## 8. Model generation capability’leri — PARTIALLY IMPLEMENTED

Mevcut mimari, taşıyıcı, donatı, MEP, altyapı ve ortak bileşen motorları korunur. Bu teslimde yeni üretim yolu, mevcut `profile_member` motorunu çağıran çoklu tablo kolon capability’sidir. GES ve endüstriyel ekipman mevcut generic component/assembly yollarını kullanır. Özel çelik birleşimi, köprü tasarımı ve araziye otomatik panel yerleştirme eklenmedi.

## 9. Family/type/assembly tekrar kullanımı — IMPLEMENTED

Yeni belge yolu da mevcut Builder/type çözümlemesini kullanır; aynı kesit/malzeme tek tiptir. Her yerleşim ayrı kimlik taşır. Canlı belge kabulünde üç kolon tek tip kullandı. Mevcut 20 kolon/50 vana/100 panel, ortak RC assembly revizyonu ve 100 panel+taşıyıcı assembly kabulü yeniden geçti. Eski bütün düşük seviyeli komutların anlamsal dedup’a zorlandığı iddia edilmez.

## 10. Validation ve repair — PARTIALLY IMPLEMENTED

Mevcut domain kuralları, ilişki bütünlüğü, indeksli koordinasyon ve en fazla iki güvenli onarım turu kullanılır. Sonuçta model/eleman bazında `CONCEPTUAL` veya `SOURCE-BASED` kanıt seviyesi ve ayrı koordinasyon durumu bulunur. `COORDINATED` otomatik verilmez; ilgili disiplin kapsamının incelenmesi gerekir. Bir testin geçmesi mühendislik yeterlilik onayı değildir. Yük, kapasite, gerekli donatı alanı, elektrik yükü, boru/kanal boyutlandırması ve hidrolik hesap yoktur.

## 11. Gerçek HTTP/UI kabulü — PARTIALLY IMPLEMENTED

gstack `/browse` ile tarayıcıda:

- Yeni proje, ilk sohbet isteği ve sentetik CSV yükleme çalıştı.
- İlk istek proje asistanında taslak olarak açıldı; kullanıcı Gönder ile başlattı.
- Temiz kabulde plan ve model üretim önerisi oluştu; onay öncesi eleman sayısı sıfırdı.
- İnsan “Onayla ve uygula” seçince 40 BIM elemanı Fragments görünümünde açıldı.
- Aynı sohbetten “Modeli doğrula” tamamlandı. Son temiz kontrolde sohbet hatası ve console error yoktu.
- Yeni önerilerde öneri kimliği sohbette saklanır; mevcut Onaylar durumundan uygulanma/reddedilme durumu görüntülenir.
- Sohbet geçmişi mevcut tarayıcı saklama mekanizmasında proje bazında korunur; sunucu taraflı çok cihazlı sohbet arşivi eklenmedi.

HTTP kabulünde üç belge, 23 parametre, üç occurrence/tek tip, önizleme, üretim, doğrulama, IFC, Fragments ve undo geçti. MEP/assembly/GES motor senaryoları ayrıca gerçek HTTP ile tekrarlandı. Yüklenmiş alignment+kesitlerden sohbetle koridor kurma ve sohbetle bütün revizyon dizisi **NOT TESTED**; gerçek LLM kabulü de **NOT TESTED**.

Yerel kanıtlar: `output/phase5-live-qa-2026-10-23/acceptance.json`, `clean-chat-proposal.png`, `clean-applied-building.png`, `verified-building.png`; motor kanıtları `regression/acceptance.json`. Bu çıktılar sentetik ve git dışındadır. Test sırasında yakalanan kesik büyük JSON sorunu giderildi; başarısız ara ekranlar başarı kanıtı olarak kullanılmaz.

## 12. IFC ve Fragments — IMPLEMENTED

Mevcut dışa aktarma zinciri kullanıldı. Son belge modeli: IFC 6939 bayt, Fragments 3103 bayt. Yoğunluk senaryosu: IFC 8.007.823 bayt; Fragments 1.516.177 bayt. Byte sayısı dosya oluşumunu kanıtlar; bağımsız viewer doğruluğunun yerine geçmez. Bina Fragments modeli tarayıcıda görsel olarak kontrol edildi. Bu teslim yeni bir IFC şema motoru eklemedi.

## 13. Performans/token verimliliği — PARTIALLY IMPLEMENTED

`project_analyze` artık capability ve sorgu adıyla hedefli şema döndürür. Model planından LLM’e tekrar bütün leaf komutlar ve occurrence listeleri gönderilmez; plan pini, durum, onay, varsayım, uyarı, bağımlılık ve onarım bilgisi korunur. Büyük JSON kesilerek bozulmaz; açık `truncated` işareti ve hedefli sorgu yönlendirmesiyle geçerli JSON zarfında aktarılır. Bağlam üst sınırı 240.000 mesaj karakteridir; bu bir token tahmini değildir.

SSE telemetrisi model/araç çağrı adedi, önlenen tekrarlar, geçen süre, bağlam karakteri ve sağlayıcı varsa raporladığı girdi/çıktı token sayılarını taşır. Hassas prompt/anahtar loglama eklenmedi. Gerçek token/cost tasarrufu ölçülmedi; scripted testte kullanım verisi yok diye gösterilir.

5000 occurrence / iki family / iki tip canlı HTTP üretimi 9676 ms, IFC 759 ms, Fragments 3381 ms sürdü. Aynı anda tam testler çalışıyordu; Phase 4 ile kontrollü performans karşılaştırması değildir. Mevcut yaklaşık 7,38 MB web bundle uyarısı sürüyor.

## 14. Regresyon — PARTIALLY IMPLEMENTED

`npm run typecheck` ve `npm run build:web` geçti. Altı yeni test dahil son odaklı asistan/Phase 4/Phase 5 koşusu **18/18** geçti. Tam test: **773 toplam / 648 geçti / 109 başarısız / 16 atlandı**. Phase 4: 767/642/109/16. Dosya+test kimliği ve hata mekanizması karşılaştırmasında eklenen/çözülen/değişen başarısızlık sıfır. Test paketinin tamamı yeşil değildir.

109 eski mekanizma: 54 DUPLICATE_WALL_JOIN; 23 ERR_ASSERTION; 9 dosya/suite wrapper; 5 INVALID_GEOMETRY; 5 WALL_INTERSECTION; 3 ELEMENT_IN_USE; 3 INVALID_DIMENSION; 2 Windows TSX launch; 2 response shape TypeError; 1 WALL_EDIT_HOSTED_CONFLICT; 1 Windows symlink permission; 1 INVALID_WALL_JOIN. Ayrıntı `PHASE5_TEST_COMPARISON_2026-10-23.json` içindedir. Son küçük koordinat/provenance/UI durumu değişiklikleri ayrıca hedefli kontrol edilir; bu eski hatalar düzeltilmiş sayılmaz.

## 15. Açık kalanlar — NOT IMPLEMENTED / NOT TESTED

Otomatik PDF/CAD çok görünüşlü teknik yorumlama, aks/kot/station üzerinden genel çoklu belge eşlemesi, native DWG/LAS/LAZ, bütün disiplinlerde serbest doğal dil planlama, otomatik mühendislik uygunluğu ve doğrulanmış standart profilleri tamamlanmadı. Gerçek sağlayıcı uçtan uca kabulü yoktur. A–F kabul paketinin tamamı sohbetten geçmedi. Altı archetype için koşullu bilgi mevcut; derin uzman otomasyonu mevcut değildir. Bu eksikler genel “Phase 5 tamamlandı” ifadesiyle kapatılmaz.

## 16. Değişen dosyalar — IMPLEMENTED

Asistan: `packages/agent/src/agent.ts`, `anthropic.ts`, `test/phase5-guards.test.ts`.

Modelleme: `apps/manager-mcp/src/modeling.ts`, `modeling-planner.ts`, `modeling-documents.ts`, `test/phase5-understanding.test.ts`.

Web: `apps/web-server/src/app.ts`, `test/assistant.test.ts`, `apps/web/src/ProjectsPage.tsx`, `Assistant.tsx`, `App.tsx`, `api.ts`.

Kabul araçları: `scripts/phase5-live-acceptance.mts`, `phase5-ui-fixture.mts`. Raporlar ve README güncellendi.

## 17. Kullanıcı verisi koruması — IMPLEMENTED

Yeni canlı testler yalnız `tmp/phase5-live-data`, `tmp/phase5-ui-data` ve `output/phase5-live-qa-2026-10-23` kullanır. Normal `data/` için taşıma, silme, reset veya migration yapılmadı. Mevcut 8787 uygulaması durdurulmadı. Test fixture üretim sunucusuna fallback olarak bağlanmaz. Git’e test tokenı, anahtar veya canlı kullanıcı dosyası eklenmez.
