# Phase 5 devam notu

Önce `PHASE5_AUTONOMOUS_WORKFLOW_2026-10-23_TR.md` ve karşılaştırma JSON’unu okuyun. Phase 5 tamamen bitmiş değildir. Gerçek sağlayıcı yoktur; test fixture gerçek LLM diye sunulamaz.

Son tam koşu: `tmp/phase5-final.log`, 773/648/109/16. Phase 4 ile yeni hata kimliği/mekanizması yok. Son küçük kaynak koordinatı/provenance ve UI öneri durumu değişiklikleri ayrıca hedefli test edildi. Normal `data/` kullanılmadı.

Gerçek uygulama: 8790, `tmp/phase5-live-data`, `INSA_APPROVAL=ai`. Scripted UI: 8791, `tmp/phase5-ui-data`. Fixture yalnız bu veri kökünü kabul eder; üretim girişine bağlı değildir. 8787’deki kullanıcı sürecini durdurmayın. 8789 Phase 4 süreci ayrıca var olabilir.

Tekrarlanabilir kabul: `node --import tsx scripts/phase5-live-acceptance.mts http://localhost:8790`. UI fixture: önce `INSA_DATA` tam olarak workspace altındaki `tmp/phase5-ui-data`, `INSA_PG_URL` boş, `INSA_APPROVAL=ai`; sonra `node --import tsx scripts/phase5-ui-fixture.mts`. Aynı portta ikinci süreç başlatmayın.

Kaynaklı kolon yolu: `project_query` içinde `documents.requirements`; 1–10 açık kaynak/revizyon/rol/alan eşlemesi. Plan/generation için `kind:document-set-model`, aynı `sources`, `reviewedMapping:true`, `storey`. SI’ye dönüştürülen kolon boyutları, yerel XY ve kat gereklidir. Tip tablosu ve yerleşim açık tip kodundan birleşir. Diğer geometri kategorileri için mevcut domain capability’sini kullanın. `local-project-SI` dışı koordinatlar onay/dönüşüm ister; bu adapter dönüşüm yapmaz. BOQ geometri kaynağı değildir.

Genişletilecek işler: gerçek sağlayıcı ile A–F, çok görünüşlü PDF/CAD yorumlama, aks/kot/station ilişkileri, daha geniş kaynaklı requirement kategorileri, metin/sayfa kanıtından gözden geçirilebilir yapılandırılmış gereksinimler, mevcut proje revizyonlarının tam sohbet kabulü. Native DWG/LAS/LAZ ve mühendislik hesapları mevcut değildir. İlk önce mevcut source/CAD/infra motorlarını inceleyin; paralel motor/DB/viewer kurmayın.

gstack `/browse` zorunlu. Tarayıcı kanıtları `output/phase5-live-qa-2026-10-23` altında, git dışındadır. Son temiz kabulde plan/öneri öncesi 0, onay sonrası 40 BIM; aynı sohbet doğrulaması hatasız. Eski ara başarısız ekranları final kanıtı saymayın.
