# Phase 3 çalışma durumu

23 Ekim 2026. Başlangıç commit'i: `ef64ca3`. Ortak çekirdek uygulandı; tüm Phase 3 şartnamesi bitmiş değildir. Ayrıntılı durum ve 16 başlık: [uygulama raporu](PHASE3_MODELING_BRAIN_2026-10-23_TR.md).

## Çalışan ortam

- Repository: `tahaerenoglu/INSA`, mevcut çalışma klasörü.
- Son kodla izole sunucu: `http://localhost:8788`.
- Veri: `tmp/phase3-live-data`; `INSA_APPROVAL=ai`, `INSA_PG_URL` boş. Kullanıcı `data/` dizini değiştirilmedi.
- `8787` üzerindeki mevcut uygulama durdurulmadı; bu eski süreç yeni kodu otomatik yansıtmıyor olabilir.
- Son kabul projesi: `http://localhost:8788/?project=p3-mvl0y8v0-reinforced`.
- Test sunucusunda assistant enabled false; doğal dil/gerçek LLM testi yapılmadı.

## Son kanıtlar

- Gerçek HTTP kabulü, IFC/Fragments indirmeleri, viewer yazma yetkisi 403, undo ve restart/reopen başarılı.
- Gstack gerçek UI: kolon altında iki donatı seti; set seçimi/özellikleri; sistem gruplaması; family library; tip grubunda 20 benzersiz occurrence.
- 27/27 odaklı test; son küçük giriş/dönüşüm/aile alias düzeltmelerinden sonra Phase 3 6/6 tekrar geçti.
- Typecheck ve web build başarılı; büyük bundle uyarısı mevcut.
- Tam paket: 758 / 633 pass / 109 fail / 16 skip. Phase 2 karşılaştırmasına göre yeni hata kimliği veya mekanizması yok. Tam koşumdan sonraki küçük düzeltmeler odaklı testlerle tekrar doğrulandı.
- 5.000 kolon çekirdek deneyi: 1 ortak tip ve profil, 5.000 ayrı IFC ürünü. Ayrık grid; GPU/DOM stres kabulü değildir.
- Tam başarısızlık karşılaştırması: `PHASE3_TEST_COMPARISON_2026-10-23.json`.

## Devam sırası

1. Kalıcı, tip referansıyla bağlı assembly tarifleri ve mevcut occurrence'lara kontrollü revizyon/undo davranışı.
2. Native engine aile tanımlayıcıları ile düzenlenebilir native family tasarımını net ayırarak eksik parametrik kapsamı tamamlamak.
3. Belge/çizim kaynaklarını ortak planlama bağlamına bağlamak; kaynak ölçüsü, çıkarım ve varsayımı ayrı tutmak.
4. Eksik disiplin planner/constraint grupları; mevcut registry ve domain doğrulamasını genişletmek.
5. Yapılandırılmış provider ile gerçek doğal dil kabulü; key veya token loglamamak.
6. Yoğun Fragments/UI ölçümü, gerekirse sanallaştırma ve geometri optimizasyonu. Mühendislik nesne kimliklerini birleştirmemek.
7. Önceden mevcut 109 başarısızlığı ayrı mekanizmalar olarak düzeltmek; eski fixture veya assertion'ları topluca değiştirerek yeşile boyamamak.

## Yeniden çalıştırma

```powershell
npm run typecheck
npm run build:web
node --import tsx --test apps/manager-mcp/test/phase3-semantics.test.ts
node --import tsx scripts/phase3-live-acceptance.mts http://localhost:8788
node --import tsx scripts/phase3-density-check.mts 5000
npm test
```

HTTP kabul scripti yalnız sentetik test projeleri oluşturan izole sunucuya yönlendirilmelidir. Screenshot, HTTP call ve export çıktıları `output/phase3-live-qa-2026-10-23` altında yerel tutulur; git'e veri/token/export eklenmez.
