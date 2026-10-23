# INSA Platform

Ölçülü, beş disiplinli Medical–Dental Clinic kaynak BIM’i IFC/IFCZIP olarak mevcut görüntüleyicide açılabilir. Kaynak görünümü düzenlenebilir native modelden ayrıdır; geometri dönüşüm uyarıları gösterilir. [Kaynak, kapsam ve doğrulama raporu](docs/CLINIC_SOURCE_BIM_2026-10-23_TR.md).

Phase 5 (kısmi): asistan süre/tekrar/bağlam korumaları, kaynaklı çoklu tablo gereksinimleri, açık işlem sınırları, koşullu archetype bilgisi ve yeni projede ilk sohbet taslağı eklendi. Gerçek sağlayıcı yapılandırılmadığı için LLM kabulü yapılmadı. Uygulama ve test sınırları: [Phase 5 raporu](docs/PHASE5_AUTONOMOUS_WORKFLOW_2026-10-23_TR.md).

Phase 4: workflow bağımlılık planı, SI normalize family/type çözümleme, kalıcı assembly type revizyonları, kaynak atıflı tablo modelleme ve 5.000 eleman için indeks/sanal ağaç geliştirmeleri eklendi. Durumlar, gerçek kabul sonuçları ve açık kalan kapsam: [Phase 4 raporu](docs/PHASE4_AUTONOMOUS_MODELING_2026-10-23_TR.md).

Phase 3 modelleme çekirdeği: ortak aile/tip kataloğu, kimliği korunan tekrarlar, kolon donatısı yenileme, assembly tarifleri ve semantik model ağacı eklendi. Gerçek HTTP/UI kabul sonuçları ve açık kalan kapsam: [Phase 3 raporu](docs/PHASE3_MODELING_BRAIN_2026-10-23_TR.md).

23 Ekim 2026: ortak `project_analyze`, `project_query`, `model_plan`, `model_generate`, `model_revise`, `model_validate`, `model_repair`, `model_export` araçları mevcut Registry/Platform/MCP/HTTP üzerinden çalışır. Kapsam, gerçek test sonuçları ve henüz desteklenmeyenler: [Universal Modeling Brain uygulama raporu](docs/UNIVERSAL_MODELING_BRAIN_2026-10-23_TR.md). İzole örnekleri `node --import tsx scripts/universal-modeling-demo.mts` ile çalıştırın. `npm test` artık Windows'ta test dosyalarını açıkça keşfeder; mevcut pakette belgelenmiş başarısız testler vardır.

Yapay zekâ ile entegre BIM modelleme, veri yönetimi ve ileride inşaata özel proje ERP'si için temel.
*(INSA çalışma adıdır; değiştirilebilir.)*

```
     Claude Desktop / Claude Code                      Tarayıcı (apps/web: React + ThatOpen + Asistan)
                │  MCP (stdio)                                    │  HTTP + SSE (canlı)
  ┌─────────────▼──────────────┐                   ┌──────────────▼──────────────┐
  │   apps/manager-mcp         │                   │   apps/web-server (Fastify) │
  └─────────────┬──────────────┘                   └──────────────┬──────────────┘
                └──────────────────────┬──────────────────────────┘
                        ┌─────────────▼──────────────┐
                        │   packages/core (platform) │  yetki · dry-run · öneri/onay · olay deposu
                        │                            │  geri alma · geçmiş · denetim kaydı
                        └──────┬──────────────┬──────┘
                 ┌─────────────▼───┐   ┌──────▼─────────────────────────┐
                 │ packages/bim    │   │ ileride: metraj/hakediş, iş     │
                 │ (ilk modül)     │   │ programı, satınalma, doküman... │
                 └──┬───────┬──────┘   └────────────────────────────────┘
          IFC4 (değişim)  .frag (web viewer)  plan PNG (yapay zekânın gözü)
```

## İlkeler
* **Model veridir.** Tek doğru kaynak, IFC kavramlarıyla uyumlu BIM şemasıdır. IFC, Frag ve plan görüntüleri aynı veriden üretilir.
* **Her yetenek bir araçtır.** Modüller araçlarını platforma kaydeder; yönetici MCP hepsini tek kapıdan sunar. Arayüz, yapay zekâ ve dış sistemler aynı araçları kullanır.
* **Her yazma işlemi yönetilir.** Akış: yetki kontrolü → karar (yan etkisiz) → önizleme / öneri / uygulama → olay kaydı → denetim kaydı.
* **Olay kaynaklı (event-sourced) durum.** Model, olay günlüğünden yeniden kurulur; geri alma, geçmiş ve denetim bu yapıdan doğal olarak çıkar.
* **Modüler monolit.** Her modülün kendi durumu ve olayları vardır. ERP modülleri aynı çekirdeğe takılır.

Aynı araçlar ve aynı yönetişim kuralları hem MCP'de hem web'de geçerli. MCP sunucusu ile web sunucusu ayrı süreçlerdir ve aynı PostgreSQL veritabanını paylaşır. Claude'un yaptığı her değişiklik `NOTIFY` ile web'e anında yansır.

## Kurulum
Node.js 20+ ve PostgreSQL 16 gerekir (`docker compose up -d` ya da yerel kurulum).
```bash
npm install
cp .env.example .env          # INSA_PG_URL vb.; ortam değişkeni olarak da verilebilir
npm test                      # güncel test paketini çalıştırır (INSA_PG_URL verilirse PostgreSQL testleri de çalışır)
npm run build:web             # web arayüzünü derle
npm run web                   # http://localhost:8787  (API + arayüz)
```
Geliştirme modunda arayüz için ikinci bir terminalde `npm run web:dev` çalıştırılır (http://localhost:5173, API'ye proxy).
`INSA_PG_URL` verilmezse veriler `INSA_DATA` altında JSON dosyalarında tutulur (tek kullanıcı).

### Uçtan uca senaryo
1. PostgreSQL'i başlat, `npm run web`, tarayıcıda `http://localhost:8787` adresine git ve **Taha (bim_manager)** olarak gir.
2. Claude Desktop'ta MCP'yi `INSA_PG_URL` ve `INSA_APPROVAL=ai` ile yapılandır (`claude_desktop_config.example.json`).
3. Claude'a bir bina tarif et. Değişiklikler **Öneriler** sekmesinde onay bekler.
4. Onayla: model 3D'de anında güncellenir. Ağaçtan ya da 3D'den bir eleman seçince katmanları, miktarları ve özellikleri görünür. **Geçmiş** sekmesinden son işlem geri alınabilir. **Araçlar** sekmesi platformdaki her aracı Claude olmadan çalıştırmayı sağlar.
**Claude Desktop:** `claude_desktop_config.example.json` içeriğini `%APPDATA%\Claude\claude_desktop_config.json` dosyasına ekle ve yolları düzelt (Windows'ta `npx.cmd`).
**Claude Code:** `claude mcp add insa -- npx tsx <yol>/apps/manager-mcp/src/index.ts`

## Uygulama içi asistan
Sağ paneldeki **Asistan** sekmesi, Claude'u Desktop'a gerek kalmadan uygulamanın içine getirir. Asistan, MCP'deki araçların aynısını aynı yönetişim kurallarıyla kullanır (`packages/agent`).
* **Kullanıcının yetkilerini aşamaz.** Oturumu açan kullanıcının rolleriyle çalışır: izleyici rolündeki birinin asistanı model değiştiremez.
* **Ayrı kimlik:** Denetim kaydında ve geçmişte asistanın işlemleri `ai:<kullanıcı>` olarak görünür; kullanıcının kendi işlemlerinden ayrılır.
* **Onayı atlayamaz:** Onay modunda (`INSA_APPROVAL=ai|all`) asistanın her yazma işlemi öneriye dönüşür; kullanıcı admin olsa bile bu değişmez. Asistan öneri onaylayamaz ve reddedemez; bu kural çekirdekte zorunludur ve onay araçları asistana hiç sunulmaz.
* **Kendi işini görür:** Asistan `bim_render_plan` ile ürettiği planın görüntüsüne bakıp hatalarını düzeltebilir; plan görüntüleri sohbette de görünür.
* **Akış:** Metin, araç çağrıları ve sonuçları canlı akar; "Durdur" ile ajan durdurulur.
* **Bağlam yönetimi:** Sohbet geçmişi tarayıcıda proje bazında saklanır. Uzun sohbetlerde eski plan görüntüleri ve çok uzun araç çıktıları otomatik olarak kırpılır.
* **Yapılandırma:** `ANTHROPIC_API_KEY` yalnızca sunucuda tutulur, tarayıcıya hiçbir zaman gönderilmez. Model `INSA_AI_MODEL` ile seçilir (varsayılan `claude-sonnet-5-5`). Anahtar yoksa sekme kapalı olduğunu söyler.

## Ortam değişkenleri
| Değişken | Varsayılan | Anlamı |
|---|---|---|
| `INSA_PG_URL` | (boş) | PostgreSQL bağlantısı. Verilirse olaylar, öneriler ve denetim kaydı veritabanında tutulur |
| `INSA_DATA` | `./data` | Dosya deposu (PostgreSQL yoksa) ve dışa aktarma deposu: `<INSA_DATA>/<proje>/exports/` |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | Web sunucusu |
| `ANTHROPIC_API_KEY` | (boş) | Uygulama içi asistan (yalnızca sunucuda) |
| `INSA_AI_MODEL` | `claude-sonnet-5-5` | Asistanın kullandığı model |
| `INSA_PROJECT` | `default` | Varsayılan proje (her araçta `project` ile değiştirilebilir) |
| `INSA_APPROVAL` | `auto` | `auto`: hemen uygula · `ai`: yapay zekânın yazma işlemleri onay bekler · `all`: herkesinki onay bekler |
| `INSA_ACTOR_ID / _NAME / _KIND / _ROLES` | `claude / Claude / ai / ai_agent` | MCP oturumunun kimliği |
| `INSA_USER_ID / _ROLES` | işletim sistemi kullanıcısı / `bim_manager` | CLI'yi kullanan insan |

Roller (`packages/core/src/auth.ts`): `admin`, `bim_manager`, `modeler`, `viewer`, `ai_agent`.

## Yönetişim: öneri ve onay
`INSA_APPROVAL=ai` iken yapay zekânın yazma işlemleri **öneri** olarak bekler; model değişmez. Bir insan onaylar:
```bash
npx tsx apps/manager-mcp/src/cli.ts proposals
npx tsx apps/manager-mcp/src/cli.ts approve P-1a2b3c4d
npx tsx apps/manager-mcp/src/cli.ts reject  P-1a2b3c4d "aks ölçüsü yanlış"
npx tsx apps/manager-mcp/src/cli.ts history | undo | audit | whoami
```
* **Dört göz kuralı:** öneriyi yapan onaylayamaz. Yapay zekâ aktörleri hiçbir öneriyi onaylayamaz ve reddedemez.
* **Onay anında yeniden doğrulama:** öneri, modelin o anki haline göre tekrar doğrulanır. Arada model değiştiyse ve öneri artık geçersizse uygulanmaz.

### Yazma işlemlerinin yönetimi
Modeli değiştiren her işlem bir **komut aracıdır** ve aynı çekirdek yolundan geçer: yetki kontrolü → karar (yan etkisiz) → dry-run / öneri / uygulama → olay kaydı (iyimser eşzamanlılık) → denetim kaydı. MCP, HTTP ve asistan bu kuralları kendileri uygulamaz; yalnızca çekirdeği çağırır. Bu nedenle hiçbir adaptör yönetişimi atlayamaz.

### Geri alma (`platform_undo`)
* Sorgu değil, **yıkıcı (destructive) bir komuttur** ve **`platform.undo`** yetkisi gerektirir. Varsayılan rollerde `admin`, `bim_manager`, `modeler` ve `ai_agent` bu yetkiye sahiptir, `viewer` sahip değildir. `bim.write` yetkisi artık geri almayı örtük olarak kapsamaz.
* Diğer yazma işlemleriyle aynı yönetişime tabidir. Onay modunda (`ai`, `all`) yapay zekânın geri alma isteği bir **öneriye** dönüşür; kullanıcı admin olsa bile bu değişmez.
* Yalnızca **en son, henüz geri alınmamış** komut geri alınabilir. Geri alma işlemleri kendileri geri alınamaz. Geçersiz istekler olay günlüğüne dokunmadan tipli hatalarla reddedilir: `NOTHING_TO_UNDO`, `COMMAND_NOT_FOUND`, `COMMAND_ALREADY_REVERTED`, `NOT_LATEST_COMMAND`.
* Bir geri alma önerisi oluşturulduğunda hedef komut **öneriye sabitlenir**. Onaya kadar yeni bir komut eklenmişse, öneri başka bir komutu geri almaz; `NOT_LATEST_COMMAND` ile başarısız olur.
* Her geri alma geçmişte kendi kaydıyla (`platform_undo`) ve denetim kaydında görünür. Web'deki `POST /api/projects/:p/undo` ve CLI'daki `undo` komutu da aynı aracı kullanır.

### Öneri yaşam döngüsü ve atomik onay
```
pending ──▶ applying ──▶ applied
   │            └──────▶ failed     (komut yeniden doğrulamada başarısız oldu; kalıcı, denetlenir)
   │            └──────▶ pending    (yalnızca yazma çakışmasında; tekrar denenebilir)
   └──────▶ rejected
```
* Her geçiş deponun atomik "karşılaştır ve değiştir" işlemiyle yapılır (`transitionProposal`). Aynı öneriye eşzamanlı birden fazla onay gelirse yalnızca biri `pending → applying` geçişini kazanır; diğerleri `PROPOSAL_NOT_PENDING` / `PROPOSAL_ALREADY_APPLIED` alır. Onay ile ret yarışında da yalnızca bir sonuç gerçekleşir.
* Ek bir koruma olarak, onaylanacak öneri için olay günlüğünde zaten bir `CommandApplied` kaydı varsa komut yeniden çalıştırılmaz.
* Her önerinin `history` alanı bütün durum geçişlerini (kim, ne zaman) tutar.
* **PostgreSQL:** `UPDATE … WHERE status = ANY(…) RETURNING`; satır kilidi sayesinde süreçler arası da tek kazanan garanti edilir.
* **Dosya deposu:** öneri ve olay yazmaları `O_EXCL` ile oluşturulan bir kilit dosyasıyla korunur. Bu, **aynı makinedeki** süreçler arasında karşılıklı dışlama sağlar. 30 saniyeden eski kilitler (çökmüş süreç) kırılır. `O_EXCL`'i desteklemeyen ağ dosya sistemlerinde garanti yoktur; çok kullanıcılı kurulumlarda PostgreSQL kullanılmalıdır.

### Proje kimliği kuralı
Tek bir kural vardır (`parseProjectId`, `packages/core/src/ids.ts`): 1-64 karakter; harf (her alfabe), rakam, `_`, `-`, `.`; harf ya da rakamla başlar; `..` içeremez; nokta ile bitemez; Windows'a ayrılmış cihaz adları (`con`, `nul`, `com1` vb.) kullanılamaz. Boşluk, yol ayırıcı ve kontrol karakterleri reddedilir. Çekirdek bu kuralı her girişte (Platform, bütün depolar, dışa aktarma deposu) uygular; HTTP de aynı fonksiyonu kullanır. Hata tipi `INVALID_PROJECT_ID`'dir. Önceki sürümde kabul edilen `.`, `-` ya da `_` ile başlayan kimlikler artık geçersizdir.

### Dışa aktarma deposu
* IFC ve Frag dışa aktarmaları yalnızca sunucunun kontrolündeki `<INSA_DATA>/<proje>/exports/` dizinine yazılır. Araçlar **dosya yolu almaz**: eski `path` parametresi açık bir `INVALID_EXPORT_PATH` hatasıyla reddedilir (sessizce yok sayılmaz).
* İsteğe bağlı `name` yalnızca düz bir dosya adıdır: harf, rakam, boşluk, `_ - . ()`; dizin, `..`, mutlak yol ve kontrol karakteri içeren adlar reddedilir. Ad verilmezse proje adından güvenli bir ad türetilir.
* Yazma atomiktir (geçici dosya + yeniden adlandırma). Yol, sembolik bağlantılar çözümlendikten sonra yeniden kontrol edilir; dışarıyı gösteren bir bağlantı reddedilir.
* Araçlar sunucu yolu değil, **artefakt bilgisi** döndürür: `{ id, project, kind, bytes, sha256, createdAt }`. İndirme web üzerinden yapılır: `GET /api/projects/:p/exports` ve `GET /api/projects/:p/exports/:id` (`bim.export` yetkisi).

### Hatalar
Çekirdek tipli hatalar üretir (`code`: domain / permission / concurrency; `reason`: `INVALID_PROJECT_ID`, `UNAUTHORIZED`, `PROPOSAL_NOT_PENDING`, `INVALID_EXPORT_PATH`, …). HTTP, MCP ve asistan bunları aynı `publicError()` fonksiyonuyla iletir. Beklenmeyen hatalar (dosya sistemi, veritabanı) istemciye yalnızca genel bir mesajla döner; ayrıntıları sunucu günlüğüne yazılır.
* Denetim kaydında her işlem için kim, ne zaman, ne yaptı ve sonucu ne oldu bilgisi tutulur. Reddedilen yetkisiz denemeler de kaydedilir.
* Web arayüzü geldiğinde onaylar oradan yapılacak; CLI geçici çözüm.

## Web API
| Uç nokta | İşlev |
|---|---|
| `POST /api/auth/login` | Geliştirme girişi (kullanıcı seç → token) |
| `GET /api/tools` · `POST /api/projects/:p/tools/:tool` | MCP ile aynı araçlar (`{input, dry_run}`) |
| `GET /api/projects/:p/summary` · `/tree` · `/elements/:id` · `/quantities` | Model verisi |
| `GET /api/projects/:p/model.frag` · `/model.ifc` · `/plan/:kat.png` | Viewer ve çıktılar (`.frag` model sürümü başına önbelleğe alınır) |
| `GET /api/projects/:p/proposals` · `POST …/proposals/:id/approve` · `…/reject` | Onay akışı |
| `GET /api/projects/:p/history` · `POST /api/projects/:p/undo` · `GET …/audit` | Geçmiş, geri alma (yönetilen komut), denetim |
| `GET /api/projects/:p/exports` · `GET /api/projects/:p/exports/:id` | Dışa aktarma artefaktlarının listesi ve indirilmesi |
| `GET /api/projects/:p/stream` | Canlı değişiklik akışı (SSE) |
| `GET /api/assistant/status` · `POST /api/projects/:p/assistant` | Asistan durumu; bir sohbet turu (`{message, history}` → SSE: metin, araç çağrıları ve sonuçları, `done`) |

Hata kodları: yetki 403, alan kuralı 400, eşzamanlı yazma çakışması 409, oturum 401.

> **Güvenlik:** Giriş şu an yalnızca geliştirme amaçlı (kullanıcı seçimi). Gerçek kullanımdan önce şirket kimlik sistemi (OIDC / Entra ID) bağlanmalıdır. Sunucu varsayılan olarak yalnızca `127.0.0.1`'i dinler.

## Eşzamanlılık
Her yazma işlemi "son gördüğüm olay numarası" ile kaydedilir (iyimser eşzamanlılık). Arada başka bir kullanıcı ya da süreç yazmışsa karar, güncel model üzerinde yeniden verilir; çakışan yazıcılar rastgele beklemelerle ayrışır. PostgreSQL'de `(proje, seq)` birincil anahtarı, iki yazmanın araya girmesini veritabanı seviyesinde engeller. Testlerde iki ayrı bağlantı havuzundan yapılan eşzamanlı 12 yazmanın hiçbiri kaybolmadı.

## Araçlar
**Platform:** `platform_whoami`, `platform_list_proposals`, `platform_approve`, `platform_reject`, `platform_history`, `platform_undo`, `platform_audit_log`

**BIM, yazma:** `bim_set_project`, `bim_create_storeys`, `bim_create_grids`, `bim_create_types` (katmanlı duvar ve döşeme, kolon ve kiriş profili, kapı ve pencere), `bim_create_walls` (polyline, gönye köşe, dış yüz/iç yüz/eksen referansı, dış katman otomatik dışta), `bim_create_profile_members` (kiriş, kolon ve her profil üyesi kategorisi), `bim_create_boundaries` (döşeme ve her sınır kategorisi), uyumluluk sarmalayıcıları `bim_create_slabs` (boşluklu), `bim_create_columns`, `bim_create_beams`, `bim_place_openings` (kapı, pencere, açıklık), `bim_move_elements`, `bim_update_elements` (tipe özgü şemalar, tam yeniden doğrulama), `bim_set_properties`, `bim_delete_elements` (bağımlılarıyla birlikte)

**BIM, kaynaklar (kat, aks, malzeme, tip):** `bim_query_storeys`, `bim_update_storeys` (kısıtlı elemanlara yayılım), `bim_delete_storeys`, `bim_reassign_storey` (elemanı başka kata taşıma), `bim_query_grids`, `bim_update_grids`, `bim_delete_grids`, `bim_query_materials`, `bim_create_materials`, `bim_update_materials`, `bim_delete_materials`, `bim_query_types`, `bim_update_types`, `bim_delete_types`, `bim_resource_usage` (kat, aks ve tip oluşturma yukarıdaki oluşturma araçlarıyla yapılır)

**BIM, duvar topolojisi ve ilişkiler:** `bim_detect_wall_connections`, `bim_join_walls`, `bim_unjoin_walls`, `bim_query_wall_topology`, `bim_get_element_usage`, `bim_rehost_opening`

**BIM, yazma ilkelleri (10. aşama):** `bim_split_wall`, `bim_merge_walls`, `bim_trim_wall`, `bim_extend_wall` (ve güçlendirilmiş `bim_rehost_opening`)

**BIM, taksonomi, aileler ve bileşenler:** `bim_list_disciplines`, `bim_list_categories`, `bim_get_category`, `bim_category_usage`, `bim_create_families`, `bim_query_families`, `bim_update_families`, `bim_delete_families`, `bim_create_components` (bileşen tipleri `bim_create_types` / `bim_update_types` ile `kind: "component"`; taşıma, güncelleme, kat değiştirme ve silme genel araçlarla)

**BIM, odalar ve mahaller (mekânsal elemanlar):** `bim_create_spatial_elements`, `bim_detect_spatial_regions`, `bim_query_spatial_adjacency` (güncelleme, taşıma, kat değiştirme ve silme genel araçlarla)

**BIM, okuma ve çıktı:** `bim_model_summary`, `bim_get_types`, `bim_query_elements`, `bim_get_element`, `bim_validate`, `bim_render_plan` (PNG), `bim_export_ifc`, `bim_export_frag` (dışa aktarma deposuna yazar; yol almaz)

Her yazma aracında `dry_run: true` ile önizleme alınabilir.

## BIM kaynakları: kat, aks, malzeme, tip
Kat, aks, malzeme ve tip tam yaşam döngüsüne sahip kaynaklardır: oluşturma, sorgulama, güncelleme ve silme. Bütün değişiklikler olay olarak kaydedilir, geri alınabilir ve snapshot'larla uyumludur.

### Kimlik
* Her kaynağın **değişmez bir id'si** vardır (`L-0001` kat, `G-0001` aks, `M-0001` malzeme, `WT-0001` / `ST-…` / `CT-…` / `BT-…` / kapı ve pencere tipleri). **Ad, değiştirilebilir bir etikettir.**
* Elemanlar katı ve tipi id ile referanslar; katmanlı tipler (duvar, döşeme) ve profil tipleri (kolon, kiriş) malzemeyi id ile referanslar. Bu yüzden ad değiştirmek hiçbir referansı koparmaz; IFC çıktısı yeni adı kullanır.
* Araçlar girdide id ya da ad kabul eder (ad aramasında büyük/küçük harf duyarsız). Bir ad birden fazla kaynağa uyuyorsa `AMBIGUOUS_RESOURCE_REFERENCE` döner ve id kullanılmalıdır.

### Ad kuralları
* 1–100 karakter; boş ya da yalnızca boşluk olamaz; kontrol karakteri içeremez. Araçlar adların başındaki ve sonundaki boşluğu kırpar. Kural ihlali `INVALID_RESOURCE_NAME` döner.
* **Benzersizlik** (büyük/küçük harf duyarsız): katlar, akslar ve malzemeler kendi türleri içinde; tipler kendi **tip türü** içinde benzersizdir (bir duvar tipiyle bir döşeme tipi aynı adı taşıyabilir). İhlal `DUPLICATE_RESOURCE` döner.
* Benzersizlik yalnızca oluşturulan ya da değiştirilen kaynağa uygulanır. Akslarda daha önce hiç benzersizlik kontrolü yoktu; böyle bir eski projedeki yinelenen aks adları projeyi yüklemeyi engellemez, ama o aks değiştirilirken adı da benzersiz yapılmalıdır.

### Düzenlenebilir alanlar
| Kaynak | Alanlar | Not |
|---|---|---|
| Kat | `name`, `elevation` | Kot değişince **sabit** (fixed) elemanlar aynen kalır; **kata kısıtlı** elemanlar yeni kotları izler (bkz. "Düşey kısıtlar"). |
| Aks | `name`, `start`, `end` | Uzunluk > ε, koordinatlar sonlu. |
| Malzeme | `name`, `color` (`#rrggbb`), `category` (1–60 karakter) | Doğrudan oluşturma: `bim_create_materials`. Tip katmanlarında adı verilen ama olmayan bir malzeme, mevcut davranışla uyumlu olarak otomatik oluşturulur. |
| Tip | Duvar/döşeme: `name`, `layers`; kolon/kiriş: `name`, `profile`, `material`; kapı/pencere: `name`, `width`, `height` | `{ type, kind, set }`: `kind` tipin türüyle eşleşmezse `RESOURCE_KIND_MISMATCH`. Türe ait olmayan ya da bilinmeyen bir alan `INVALID_RESOURCE_UPDATE` (alan adıyla) döner. |

`id` ve tip türü (`kind`) hiçbir kaynakta değiştirilemez.

### Tip değişikliği ve bağımlı elemanlar
Bir tip değişince onu kullanan bütün elemanlar aday durumda yeniden doğrulanır: duvar tipi kalınlığı (gönyeli ayak izi), kiriş ve kolon profili, döşeme katmanları. Kapı ve pencere ölçüsü, doldurdukları açıklıklara da uygulanır, çünkü açıklık ölçüsü tipten türetilir. Açıklık duvarına artık sığmıyorsa ya da başka bir açıklıkla örtüşüyorsa komut `DEPENDENT_ELEMENT_INVALID` ile reddedilir (ayrıntılarda `dependentId` ve `cause`).

### Bağımlılık koruması: sessiz basamaklama yok
* Silme hiçbir zaman bağımlı veriyi silmez. Kullanımdaki bir kat (elemanlar), tip (elemanlar) ya da malzeme (tip katmanları, profiller) silinmek istenirse komut **`RESOURCE_IN_USE`** ile reddedilir. Ayrıntılar: `resourceKind`, `resourceId`, `usageCount`, `usageSummary` (örn. `2 wall; 2 opening; 1 column`) ve en fazla 10 örnek id (`sampleIds`). Akslara modelde hiçbir şey bağlı değildir, bu yüzden doğrudan silinebilirler.
* Koruma tek bir yerdedir: BIM doğrulayıcısı, komutun aday durumunda silinmiş her kaynak için kullanım taramasını (`resourceUsage`) çalıştırır. Silme araçları bağımlılık aramaz; hiçbir giriş yolu bu kontrolü atlayamaz. Aynı komutta bir tip ile yalnızca o tipin kullandığı malzeme birlikte silinebilir.
* Kullanım sorgusu: `bim_resource_usage { kind, ref }` → eleman türüne göre sayılar ve örnek id'ler ya da malzemeyi kullanan tipler (ve katman sıraları). Sorgu araçları da her kaynak için `usageCount` döndürür.
* Kullanım taraması modelin doğrusal taramasıdır: O(eleman + tip). Bu, bugünkü model boyutları için yeterli; tek bir fonksiyonun arkasında olduğu için ileride indekslenebilir.

### Toplu işlemler ve sıralama
* Her araç bir dizi kabul eder ve atomiktir: tek bir geçersiz öğe ya da kullanımdaki tek bir kaynak bütün komutu reddeder; hiçbir olay yazılmaz.
* **Sıralama:** katlar kota göre, sonra id; akslar oluşturulma sırasına (id) göre; malzemeler ada göre, sonra id; tipler türe, sonra ada, sonra id'ye göre. Ad karşılaştırması büyük/küçük harf duyarsız ve yerel ayardan bağımsızdır.

### Olaylar, geri alma ve snapshot'lar
4. aşamanın olayları (hepsi sürüm 1, `BIM_EVENT_VERSIONS` içinde kayıtlı): `StoreyUpdated`, `StoreyDeleted`, `GridUpdated`, `GridDeleted`, `MaterialUpdated`, `MaterialDeleted`, `TypeUpdated`, `TypeDeleted`; ayrıca mevcut `MaterialCreated` kullanılır. Bütün yaşam döngüsü komutları geri alınabilir. 4. aşamada durum biçimi değişmediği için `BIM_STATE_VERSION` 1 olarak kalmıştı; 5. aşamada 2'ye yükseldi (bkz. "Düşey kısıtlar").

## Düşey kısıtlar (sabit ve kata kısıtlı geometri)
Duvar, kolon ve kirişin düşey değeri yanında bu değerin **niyeti** de saklanır:

```jsonc
{ "id": "W-0001", "storey": "L-0001", "height": 3.2, "baseOffset": 0,
  "vertical": { "mode": "storey", "storey": "L-0002" } }   // tepe L-0002'yi izler
{ "id": "W-0002", "storey": "L-0001", "height": 2.7, "baseOffset": 0,
  "vertical": { "mode": "fixed" } }                        // 2,7 m bağlayıcı
```

* **Sabit (`fixed`):** saklanan yükseklik ya da `z` bağlayıcıdır. Kat kotları değişse bile yeniden yorumlanmaz.
* **Kata kısıtlı (`storey`):** değer, kat **id'siyle** referanslanan hedef kattan türetilir:
  * duvar / kolon: `height = hedefKat.kot − tabanKat.kot − baseOffset`
  * kiriş (üst kotu): `z = hedefKat.kot − tabanKat.kot`

  Türetilmiş değer de saklanır (IFC, metraj ve görselleştirme onu okur). Doğrulayıcı, saklanan değerin formüle **tam olarak** eşit olduğunu denetler (ikisi de aynı 10⁻⁶ m yuvarlamasından geçer). Duvar ve kolonda hedef kat, taban kat + ofsetin üzerinde olmalıdır; değilse `INVALID_VERTICAL_CONSTRAINT`.
* Kısıtlar asla adla saklanmaz ya da çözülmez; kat adını değiştirmek kısıtları etkilemez.

### Oluşturma
| Girdi | Sonuç |
|---|---|
| `height` (kirişte `z`) verildi | sabit |
| `top_storey` (kirişte `target_storey`) verildi | o kata kısıtlı |
| ikisi de yok, bir üst kat var | **bir üst kata kısıtlı** (kat id'siyle) |
| ikisi de yok, üst kat yok | 3,0 m **sabit**. Sonradan eklenen bir kata sessizce bağlanmaz. |
| ikisi birden | `INVALID_VERTICAL_CONSTRAINT`. Daha önce kat sessizce yok sayılıyordu. |

### Güncelleme
`bim_update_elements` içinde `height` / `z` elemanı **sabit** yapar; `top_storey` / `target_storey` elemanı **kısıtlı** yapar ve değeri hemen türetir. İkisi aynı öğede verilirse `INVALID_ELEMENT_UPDATE` döner. Kısıtlı bir duvarın `base_offset`'i değişirse yüksekliği yeniden türetilir. `vertical` alanı doğrudan yazılamaz.

### Kat kotu değişince
`bim_update_storeys` önce komuttaki **bütün** kot değişikliklerini aday duruma uygular, sonra tabanı ya da hedefi değişen kata bağlı her kısıtlı elemanın değerini **son kotlardan** yeniden türetir. Sonuç öğelerin sırasına bağlı değildir. Ardından bütün bağımlı grafik (açıklık, kapı, pencere) yeniden doğrulanır. Örneğin bir duvar kısalınca penceresi artık sığmıyorsa komutun tamamı `DEPENDENT_ELEMENT_INVALID` ile reddedilir; ayrıntılarda `dependentId` ve `cause` bulunur ve hiçbir şey değişmez. Sabit elemanlar değişmez. Yanıtta `propagated` alanı etkilenen elemanları listeler.

### Kat değiştirme (`bim_reassign_storey`)
* Duvar, döşeme, kolon ve kiriş başka bir kata taşınabilir. Göreli değerler korunur (`baseOffset`, döşeme `offset`, sabit `height` / `z`), yani eleman yeni katla birlikte düşey olarak hareket eder. XY konumu değişmez.
* **Host grafikleri bölünmez:** bir duvar taşınınca açıklıkları ve onları dolduran kapı ve pencereler de aynı komutta taşınır. Açıklık, kapı ya da pencere tek başına taşınamaz (`INVALID_HOST_RELATION`). Hostlu elemanın host duvarıyla aynı katta olması merkezi bir değişmezdir.
* Kısıtlı eleman hedef katını korur ve değeri yeni tabana göre yeniden türetilir. İlişki imkânsızsa (örneğin hedef kat yeni tabanın altında kalıyorsa) komutun tamamı reddedilir; eleman, komut başarılı olsun diye sessizce sabite çevrilmez.
* **Kaynak yaşam döngüsü:** bir katı kaldırmak için önce `bim_resource_usage { kind: "storey" }` ile kullanıma bakılır, elemanlar `bim_reassign_storey` ile taşınır, kullanım sıfırlanınca `bim_delete_storeys` uygulanır. Bir katın başka elemanların **kısıt hedefi** olması da kullanım sayılır (`usageSummary`: "… constrained to it").
* **Tip değiştirme** ayrı bir araç değildir: `bim_update_elements` içinde `type` alanıyla zaten yapılır (tek ve toplu). Kat değiştirme ise ayrı bir yaşam döngüsü işlemidir.

### Sorgular
`bim_query_elements` artık şu filtreleri de alır:
* `vertical_mode` (`fixed` / `storey`);
* `constrained_to` (hangi elemanlar bu kata kısıtlı);
* `affected_by_storey` (bu katın kotu değişirse değeri değişecek elemanlar: tabanı ya da hedefi bu kat olan kısıtlı elemanlar).

Satırlar ve `bim_get_element` (`vertical_info`), modu, hedef katın id'sini ve adını ve saklanan değeri birlikte döndürür.

### Tarihsel uyumluluk ve sürümler
* 5. aşamadan önceki olaylarda niyet bilgisi yoktur ve **tahmin edilmez**. `ElementCreated` v1 → v2 upcaster'ı eski duvar, kolon ve kirişlere `{ mode: "fixed" }` ekler. Sayısal tesadüfler (örneğin 3,00 m'lik bir duvarın tam bir kat yüksekliğinde olması) asla kısıta dönüştürülmez.
* `ElementUpdated` v2: değişiklik alanları artık `vertical` ve `storey` içerebilir. v1 yükleri geçerli v2 yükleridir.
* `BIM_STATE_VERSION` 2 oldu (elemanlar `vertical` taşıyor). Durum sürümü 1 olan snapshot'lar güvenle yok sayılır ve durum, olay günlüğünden upcaster'larla yeniden kurulur; eski snapshot dosyaları değiştirilmez. Bu davranış, gerçek 4. aşama kodunun ürettiği bir proje ile test edilir (`packages/bim/test/fixtures/phase4-project`).
* Bütün işlemler olay olarak kaydedilir ve geri alınabilir. Geri alma hem görünen geometriyi hem niyeti geri getirir (kotla birlikte türetilmiş değerler ve kat atamaları da).

## Duvar topolojisi ve eleman ilişkileri
### Açık topoloji: değmek, birleşmek değildir
İki duvarın uçlarının çakışması ya da bir duvarın diğerine değmesi **kalıcı bir ilişki oluşturmaz**. Kalıcı ilişki yalnızca `bim_join_walls` ile, bilinçli olarak kurulur. `bim_detect_wall_connections` yalnızca **aday önerir**; hiçbir şeyi değiştirmez.

İlişkiler `BimState.joins` içinde, kendi kimlikleriyle (`J-0001` …) saklanır. Uç noktalar her zaman `{ wall, endpoint: "start" | "end" }` biçiminde, duvarın değişmez id'siyle tanımlanır; koordinatla asla.

| Tür | Anlamı | Saklanan |
|---|---|---|
| `endpoint_endpoint` (düğüm) | 2 veya daha fazla duvar ucu tek bir noktayı paylaşır | `members` (uç noktalar) |
| `endpoint_segment` (T-birleşim) | bir uç, host duvarın üzerinde parametrik bir konumdadır | `endpoint`, `host`, `t` (0 < t < 1) |

* Her uç nokta **en fazla bir** ilişkiye katılır.
* Duvarlar aynı katta olmalıdır.
* Kesişen duvarlar (X) birleşim değildir: tespit edilip raporlanır, ama otomatik olarak bölünmez ya da birleştirilmez.

### Birleştirme kuralları
* **Tolerans:** `JOIN_TOLERANCE` = 10 × `GEOMETRY_EPSILON` = **1 mm**. Daha uzak uçlar `INVALID_WALL_JOIN` ile reddedilir; duvarlar birleştirmek uğruna uzağa kaydırılmaz.
* **Düğüm noktası deterministiktir:** kanonik sırada (duvar id, uç) ilk üyenin koordinatı alınır; mevcut bir düğüme ekleme yapılırken o düğümün noktası korunur. Ortalama alınmaz. Birleşimden sonra bütün üyeler bit düzeyinde aynı koordinattadır.
* Mevcut bir düğüme yeni bir uç eklemek düğümü genişletir ve kimliği aynı kalır. İki düğüm birleşirse küçük id korunur.
* **Reddedilenler:**
  * aynı ucun kendisiyle birleştirilmesi ya da bir duvarın kendi iki ucunun birleştirilmesi (`INVALID_WALL_JOIN`);
  * zaten birleşik uçların tekrar birleştirilmesi, hangi sırayla verilirse verilsin (`DUPLICATE_WALL_JOIN`);
  * başka bir ilişkideki uç (`WALL_ENDPOINT_ALREADY_CONSTRAINED`);
  * farklı katlar (`WALL_JOIN_CONFLICT`);
  * aynı tarafa katlanan, üst üste binen eş doğrusal duvarlar (`INVALID_WALL_JOIN`).
* **T-birleşimi:** `t` verilmezse izdüşümle hesaplanır. Uç, host'un uçlarına 1 mm'den yakınsa reddedilir; o durumda `endpoint_endpoint` kullanılmalıdır. Host boyunca uzanan bir duvar ya da T-birleşimi döngüsü de reddedilir.

### Yayılım
Komut içinde sıra şöyledir:

1. istenen değişikliğin **tamamı** aday duruma uygulanır (bir duvarın iki ucu birlikte değişebilir);
2. **düğümler:** komuttan önceki duruma göre yer değiştiren üyeler "sürücü"dür; diğer bütün üyeler aynı noktaya gelir. Aynı düğümde farklı noktalara taşınan iki üye `WALL_JOIN_CONFLICT` verir;
3. **T-birleşimleri:** uç, host'un yeni geometrisinde `t` noktasına gelir (`t` niyettir, değişmez). Host zincirleri boyunca geçişli olarak uygulanır;
4. **kısıtlı uç:** bir T-ucu tek başına taşınamaz (`CONSTRAINED_ENDPOINT`). Host'la birlikte taşınması ya da duvarın diğer ucunun taşınması serbesttir;
5. etkilenen bütün duvarların gönyeleri yeniden hesaplanır;
6. aday durum bütünüyle doğrulanır; tek bir hata bütün komutu geri çevirir.

Yayılım sınırlı bir kuyrukla ve ziyaret kümeleriyle yapılır; sonuç öğe sırasından bağımsızdır. Düşey kısıtlar (5. aşama) plan topolojisinden etkilenmez.

### Gönye ve duvar ayak izi
Topoloji, ilişkiye katılan uçların `prevDir` / `nextDir` değerlerinin **tek kaynağıdır**; bu değerler her senkronizasyonda yeniden türetilir ve doğrulayıcı güncel olduklarını kesin eşitlikle denetler.
* **Tam iki duvarlı bir düğüm, aradaki açı ≥ 10° ise:** gönyelenir. Sonuç, aynı köşenin çoklu çizgiyle çizilmiş haliyle bire bir aynıdır (testlerle doğrulanır).
* **Düz devam, < 10° sapma, T-birleşimleri ve çok duvarlı düğümler:** kare uç. Böylece sonsuz ya da patlayan gönye oluşamaz. Çok duvarlı düğümlerin fiziksel kesişim geometrisi bu aşamanın kapsamı dışındadır.
* **Birleşimden ayrılan uçlar** kare uca döner. Hiçbir ilişkide olmayan uçlardaki eski çoklu çizgi ipuçlarına dokunulmaz.
* T-birleşimindeki duvar, 6. aşamada host'un eksenine kadar uzanıyordu (IFC'de yarım kalınlık kadar bindirme). **10. aşamadan beri** dal, host'un yakın yüzünde biter (bkz. "Yazma ilkelleri: fiziksel T-birleşimi").

### Yaşam döngüsü: sessiz basamaklama yok
* Birleşime katılan bir duvar, barındırdığı açıklıkları olan bir duvar ya da içinde kapı/pencere bulunan bir açıklık silinemez. Sonuç `ELEMENT_IN_USE`; ayrıntılarda `elementId`, `usageCount`, `usageSummary` ve `dependentIds` bulunur.
* **`cascade_hosted: true`:** barındırılan açıklıkları ve kapı/pencereleri de açıkça siler. Bu, 6. aşamadan önceki varsayılan davranıştı. Birleşimler **hiçbir koşulda** basamaklanmaz; önce ayrılmaları gerekir.
* Kapı ya da pencere tek başına silinirse açıklığı boş kalır (`filledBy: null`).
* Kontrol tek yerdedir (`elementReferences`, `resources.ts`): doğrulayıcı, silinen her eleman için aday durumda hâlâ ona referans veren bir şey olup olmadığına bakar.
* `bim_get_element_usage`: bir duvarın açıklıkları, birleşimleri ve doğrudan birleşik duvarları; bir açıklığın host'u ve dolgusu; kapı/pencerenin açıklığı.
* `bim_rehost_opening`: açıklığı (kapı/penceresiyle birlikte) aynı kattaki başka bir duvara taşır. Yeni duvara sığmalıdır; yakınlıktan asla çıkarım yapılmaz.

### Kat değiştirme
Birleşime katılan bir duvar tek başına başka kata taşınamaz (`WALL_JOIN_CONFLICT`, ayrıntıda `joinId`). Birleşik duvarların hepsi aynı komutta aynı kata taşınabilir ya da önce ayrılabilir. Bağlı yapı asla sessizce bütünüyle taşınmaz. Açıklıklar ve kapı/pencereler 5. aşamada olduğu gibi duvarlarını izler.

### Sorgular
* `bim_query_wall_topology { wall?, storey?, kind?, component_of? }`: ilişkiler kat, tür ve id sırasına göre (düğümün noktası ve duvarları dahil); `wall` ile `connectedWalls`; `component_of` ile açık ilişkiler üzerinden bağlı bileşen (BFS; yakın kaçışlar bağlı sayılmaz).
* `bim_detect_wall_connections { storey?, walls?, max_results?, near_miss_distance?, include_existing? }`: `candidates` (uç–uç, uç–segment), `crossings`, `nearMisses` (varsayılan 5 cm'ye kadar boşluk veya taşma), `total`, `truncated`. Sıralama deterministiktir. Algoritma kat başına O(n²) olduğu için kat ya da duvar listesiyle sınırlanmalıdır.

### MCP örnekleri
```jsonc
bim_detect_wall_connections { "storey": "L0" }
// → { "candidates": [{ "type": "endpoint_endpoint", "wallA": "W-0001", "endpointA": "end", "wallB": "W-0002", "endpointB": "start", "distance": 0 }], "crossings": [], "nearMisses": [], ... }
bim_join_walls { "kind": "endpoint_endpoint", "endpoints": [{ "wall": "W-0001", "endpoint": "end" }, { "wall": "W-0002", "endpoint": "start" }] }
// → { "joinId": "J-0001", "kind": "endpoint_endpoint", "affectedWalls": ["W-0001", "W-0002"], "propagated": [...] }
bim_join_walls { "kind": "endpoint_segment", "endpoint": { "wall": "W-0003", "endpoint": "start" }, "host": "W-0001" }
bim_query_wall_topology { "component_of": "W-0003" }
bim_unjoin_walls { "join": "J-0001" }          // ya da { "endpoint": { "wall": "W-0002", "endpoint": "start" } }
```

### Eski projeler, olaylar ve snapshot'lar
* 6. aşamadan önceki projeler **hiçbir birleşim kazanmaz**: çakışan uçlar, çoklu çizgi gönye ipuçları ve kesişimler tahmin için kullanılmaz. Duvarlar bağımsız kalır; tespit aracı adayları raporlar, kalıcılaştırma açık bir komut gerektirir. Bu davranış, gerçek 5. aşama kodunun ürettiği bir projeyle test edilir (`packages/bim/test/fixtures/phase5-project`).
* **Yeni olaylar** (sürüm 1): `WallJoinCreated`, `WallJoinUpdated`, `WallJoinDeleted`. `ElementCreated` ve `ElementUpdated` v2'de kalır, çünkü yük biçimleri değişmedi (`filledBy: null` mevcut alanın bir değeridir).
* **`BIM_STATE_VERSION` 3:** durum sürümü 2 olan snapshot'lar yok sayılır ve durum olay günlüğünden yeniden kurulur.
* Bütün topoloji işlemleri geri alınabilir. Geri alma, yayılan geometriyi ve gönyeleri de geri getirir.

## BIM taksonomisi: disiplin, kategori, aile, tip, örnek
```
Disiplin (architecture, structure, mechanical, electrical, plumbing, fire, site, spatial, generic)
  └─ Kategori (architecture.furniture, mechanical.equipment, …)      ← uygulama verisi, olay kaydı değil
       ├─ native motor:    WallType / SlabType / …  →  Wall / Slab / …          (mevcut özel modeller)
       └─ component motor: Family  →  ComponentType  →  Component          (TEK genel model)
```
* **Disiplinler ve kategoriler** uygulama verisidir (`packages/bim/src/taxonomy.ts`); projeye ait değildir ve olay olarak kaydedilmez.
* **Kategori kimlikleri kalıcıdır** (`disiplin.ad`): bir kimlik hiçbir zaman başka bir anlam için yeniden kullanılmaz; aynı kimliği ikinci kez kaydetmek reddedilir. Bir ailenin referans verdiği bir kategori kaldırılamaz; ileride `deprecated: true` ile işaretlenir. Kayıtlı durumda bilinmeyen bir kategori bir bütünlük hatasıdır (`INVALID_CATEGORY`).
* **Yetenekler** (`hasType`, `levelBased`, `pointPlaced`, `rotatable`, `movable`, `roomBounding`, `joinable`, `hostsOpenings`, `hosted`, `curveBased`, `profileBased`, `systemConnectable`, `hasMaterial`) tek bir yetkili listeden gelir. Bunlar **bildirimseldir**: kategoriyi tanımlar ve sorgulanır, ama alan doğrulamasının yerini almaz. Bazılarının arkasında henüz bir davranış yoktur; örneğin `systemConnectable` için MEP bağlantıları sonraki bir aşamanın konusudur.

### Yerleşik (native) ve bileşen (component) motorları
> **9. aşama notu:** "native" ve "component" geniş sınıflarının yerini somut davranış motorları aldı (bkz. "Evrensel BIM Motor Mimarisi"). Duvar `wall`, döşeme `boundary`, kolon ve kiriş `profile_member`, kapı ve pencere `hosted_component`, bileşenler `point_component` motorunu kullanır. Bu bölüm 7. aşamanın tasarım gerekçesini korur.
* **Duvar, döşeme, kolon, kiriş, açıklık, kapı ve pencere yerleşik kalır.** Bunların gerçek alan davranışları vardır: topoloji, gönye, düşey kısıtlar, açıklık barındırma. Hepsini genel bir modele dönüştürmek bu kuralları kaybettirirdi.
* Bu elemanların kategorisi türlerinden **türetilir** (`categoryIdOfElement`: `wall` → `architecture.wall`, `slab` → `architecture.floor`, `column` → `structure.column`, `beam` → `structure.framing`, …). Hiçbir eski olaya kategori alanı yazılmaz ve yerleşik tipler için **sahte aileler oluşturulmaz**. Yerleşik tipler, INSA'nın sistem aileleri gibi davranır.
* **Mobilya, dolap, genel model, mekanik ekipman, sıhhi tesisat armatürü, aydınlatma armatürü, elektrik ekipmanı ve saha bileşeni** aynı tek modeli kullanır: `Family` → `ComponentType` (`kind: "component"`) → `Component` (`kind: "component"`). Kategoriye özgü arayüz, tip ya da araç yoktur (`bim_create_furniture` gibi araçlar bilinçli olarak yok).
* Bir bileşenin kategorisi **yalnızca** Tip → Aile zincirinden gelir. Oluşturma girdisinde kategori alanı yoktur; dolayısıyla bir istemci kategori hakkında yanlış bilgi veremez.

### Aileler ve parametreler
* **Aile:** `{ id: "F-0001", name, category (değişmez), description?, placement: "level_point" (değişmez), parameters, representation }`. Kategoriyi değiştirmek yeni bir aile oluşturmak demektir. Ad, kategori içinde benzersizdir; bileşen tipi adı ise aile içinde benzersizdir.
* **Parametre tanımı:** `{ key, name, scope: "type" | "instance", dataType: "number" | "length" | "angle" | "string" | "boolean", required, default?, min?, max?, unit? }`.
  * `key` değişmez bir makine kimliğidir (küçük harf, rakam, `_`); `name` değiştirilebilir bir etikettir.
  * Birimler: uzunluk **metre** (negatif olamaz), açı **derece**.
  * Formüller henüz yok.
* **Tip kapsamı:** değer `ComponentType.parameters` içindedir ve **geometrinin tek kaynağıdır**. Tip değişince bütün örnekler yeni değeri kullanır; boyutlar örneklere kopyalanmaz.
* **Örnek kapsamı:** değer her bileşenin `parameters` alanındadır. Tip kapsamındaki bir anahtar örnek düzeyinde **asla** ezilemez (`UNKNOWN_PARAMETER`).
* **Doğrulama** tek bir yerdedir (`family.ts`): gerekli değerler, bilinmeyen anahtarlar, sonlu sayılar, `min` / `max`, veri tipi ve tekrarlanan anahtarlar. Hata sebepleri: `MISSING_REQUIRED_PARAMETER`, `UNKNOWN_PARAMETER`, `INVALID_PARAMETER_VALUE`, `INVALID_PARAMETER_SCHEMA`.
* **Aile şeması değişiklikleri** aday durumda doğrulanır: bütün tipleri ve bütün örnekleri geçerli kalmak zorundadır, aksi halde komutun tamamı `INVALID_FAMILY_UPDATE` (`familyId`, `typeId`, `parameterKey`) ile reddedilir. Hiçbir değer "sığsın diye" değiştirilmez. Bir anahtarı kaldırmak, onu kullanan bir tip ya da örnek varken mümkün değildir.
* Genel BIM özellikleri (`bim_set_properties`) parametrelerle **karıştırılmaz**: parametreler anlam ve geometriyi belirler, özellikler ise yalnızca üst veridir. IFC'de de ayrı özellik setlerine yazılırlar.

### Yerleşim ve geometri
* **Kat göreli nokta yerleşimi:** `placement: { kind: "level_point", x, y, offset, rotation }`. Kat, elemanın `storey` alanıdır (tek kaynak). Dünya Z = kat kotu + `offset`. `rotation` derece cinsindendir, saat yönünün tersinedir ve araçlar onu [0, 360) aralığına normalize eder (örneğin -90 → 270).
* **KUTU (BOX) gösterimi:** origin alt orta noktadır; genişlik yerel X, derinlik yerel Y, yükseklik Z yönündedir. Her eksen, ailenin bir **tip kapsamlı uzunluk** parametresine referans verir ve değeri ε'dan büyük olmalıdır. Geometri her zaman türetilir; ağ (mesh) ya da boyut olaylara yazılmaz.
* Bileşenler plan görünümünde ayak izi olarak, IFC'de ve dolayısıyla 3B görselleştiricide (`.frag` IFC'den türetilir) kutu olarak görünür.
* **Genel araçlar bileşenlerle de çalışır:**
  * `bim_move_elements`: yalnızca yerleşim değişir;
  * `bim_reassign_storey`: yalnızca kat değişir; kategori `levelBased` olmalıdır;
  * `bim_update_elements` (`kind: "component"`): ad, x, y, offset, rotation, örnek parametreleri ve tip. Tip yalnızca **aynı kategorideki** bir tiple değişebilir; mobilya asla ekipmana dönüşmez (`INCOMPATIBLE_COMPONENT_TYPE`);
  * `bim_delete_elements`.
* **Yaşam döngüsü:** tipleri olan bir aile silinemez (`RESOURCE_IN_USE`: tip sayıları, örnekler ve dolaylı örnek sayısı). Örnekleri olan bir tip silinemez. Bileşen tipinin kullandığı malzeme silinemez. Hiçbir şey basamaklanmaz.

### Sorgular ve IFC
* `bim_query_elements` ve `bim_query_types` şu filtreleri alır: `category`, `discipline`, `capability`, `engine`, `family`. Eski `kind` filtresi aynen çalışır.
* Sonuç satırları taksonomiyi açıkça içerir (`category`, `discipline`, `engine`; bileşenlerde `family` ve `type`), dolayısıyla bir elemanın ne olduğunu anlamak için ek bir sorguya gerek yoktur.
* `bim_category_usage` kategori başına aile, tip ve örnek sayılarını hesaplar; bu sayılar saklanmaz.
* **IFC eşlemesi:** kategori yalnızca **emin olunan** bir IFC sınıf ipucu taşır. Mobilya `IfcFurniture` olarak yazılır. Diğer bütün bileşen kategorileri `IfcBuildingElementProxy` olarak yazılır; varsa ipucu (örneğin `IfcLightFixture`, `IfcSanitaryTerminal`) `INSA_Component.IfcClassHint` özelliğinde saklanır. Mekanik ve elektrik ekipmanı ile dolap/tezgâh gibi kategorilerin tek ve evrensel bir IFC karşılığı olmadığı için ipucu verilmemiştir.
* Her bileşen kendi katına bağlanır ve `INSA_Component` (Category, Discipline, Family, Type) ile `INSA_Parameters` (çözümlenmiş tip ve örnek değerleri) özellik setlerini taşır.

### Yeni bir bileşen kategorisi eklemek (geliştirici rehberi)
1. `packages/bim/src/taxonomy.ts` içinde `BUILT_IN` listesine bir tanım ekleyin, örneğin `{ id: "fire.sprinkler_head", name: "Sprinkler Heads", discipline: "fire", engine: "component", placements: ["level_point"], capabilities: [...COMPONENT_CAPS, "systemConnectable"] }`. IFC karşılığından emin değilseniz `ifcClass` vermeyin.
2. Hepsi bu kadar. Yeni bir `ElementKind`, tip varyantı, olay, araç, doğrulama ya da IFC kodu **gerekmez**. Aile, tip, bileşen, sorgu, taşıma, kat değiştirme, silme, IFC ve plan görünümü otomatik olarak çalışır. Bu, `packages/bim/test/components-extensibility.test.ts` içinde test edilir.
3. Kimliği yayınladıktan sonra bir daha değiştirmeyin ve silmeyin. Kullanımdan kaldırmak için `deprecated: true` kullanın.

### Olaylar, snapshot'lar ve eski projeler
* **Yeni olaylar** (sürüm 1): `FamilyCreated`, `FamilyUpdated`, `FamilyDeleted`.
* Bileşen tipleri ve örnekleri mevcut `TypeCreated` / `TypeUpdated` / `TypeDeleted` ve `ElementCreated` / `ElementUpdated` (v2) olaylarını **değiştirmeden** kullanır; mevcut yüklerin hiçbiri yeniden yorumlanmaz.
* **`BIM_STATE_VERSION` 4:** durum sürümü 3 olan snapshot'lar yok sayılır ve durum olay günlüğünden yeniden kurulur. Eski projeler **hiçbir aile ya da bileşen kazanmaz**; yerleşik tipler için aile tahmin edilmez.
* Bu davranış, gerçek 6. aşama kodunun ürettiği bir projeyle test edilir (`packages/bim/test/fixtures/phase6-project`): 7. aşamanın tam replay ile kurduğu durum, 6. aşamanın kendi snapshot'ında sakladığı durumla birebir aynıdır.

## Phase 14 (DEVAM EDİYOR): kapsamlı BIM yazımı ve IFC kategori kapsamı
Bu bölüm **ilerleme durumunu** dürüstçe kaydeder; Phase 14 kapatılmamıştır.

### Tamamlanan: Phase 13 kapanış düzeltmeleri
* **Bağlayıcı kapsamlı ağ sorgusu:** `bim_query_mep_network` artık üç AYRI kip bilir: `system`, `element`, `connector` (tam `ConnectorRef`). Önceki kusur: `connector` verildiğinde yalnızca eleman iletiliyor, anahtar kayboluyordu. Seçiciler doğrulanır: `element` + `connector` aynı elemanı adlandırmalı (`INVALID_INPUT`), olmayan bağlayıcı `MEP_CONNECTOR_NOT_FOUND`, `system` + başka sistemin rota elemanı `INVALID_INPUT`.
* **Sistem yalıtımı:** ağ **bağlayıcı grafı** üzerinde yürünür. Düğüm = bağlayıcı; kenarlar = bir birleşimin üyeleri ve bir ROTA elemanının `start`↔`end` uçları. **Bileşenin bağlayıcıları birbirine bağlanmaz**: ekipman uç cihazdır, köprü değildir; dolayısıyla çok sistemli bir ekipman (örn. su + güç + gider) bir sistemin sorgusuna diğer sistemin birleşimlerini, rotalarını ya da bileşenlerini sızdırmaz. `junction_count`, `connected_component_count`, `adjacency`, açık bağlayıcılar ve sistem özetleri bu ayrıma uyar. Ekipman, sistem üyeliğini kalıcı olarak taşımaz.
* **Kayıt defteri temizliği:** `EngineId` birleşimindeki yinelenen `mep_network` kaldırıldı; "mep_network ayrılmış" yorumları düzeltildi.
* **Phase 13 fikstürü:** `fixtures/phase13-project` (düzeltilmiş koddan, Phase 14 şema değişikliğinden önce; ekipman üç farklı sisteme bağlı; oracle'da düzeltmeler görünür).

### Tamamlanan: resmî şema envanteri ve kapsama matrisi
* `npm run bim:inventory` (`scripts/ifc-inventory.py`): **IFC4X3_ADD2** (dondurulmuş resmî IFC4.3) ve **IFC4 (ADD2 TC1)** şemalarını, IfcOpenShell'in paketlediği makine okunur EXPRESS türevinden okuyup `packages/bim/data/ifc-inventory.json` üretir. Elle yazılmış varlık sayısı yoktur. (buildingSMART sitesine derleme ortamından erişilemediği için kaynak bu pakettir.) Atıf: IFC şemaları © buildingSMART International Limited; dosya yalnızca türetilmiş üst veri içerir.
* `npm run bim:coverage` (`scripts/bim-coverage.mts`): envanteri CANLI kategori/motor kaydıyla birleştirir ve `docs/coverage/ifc-coverage-matrix.json` + `ifc-coverage-report.md` üretir. Her varlık için: şema, soyut/somut, aile, INSA eşlemesi, motor, yerleşim, tür ailesi, geometri/yaşam döngüsü yeteneği, IFC dışa aktarma, desteklenmeyen anlambilim, seviye, doğrulanmışlık, testler. **Elle bakım yapılan başarı yüzdesi yoktur.**
* Seviyeler: 0 yok, 1 yeniden kullanılabilir motorla anlamsal yazım, 2 özel parametrik, 3 gelişmiş düzenleme. Seviye yalnızca üretilmiş **kategori sözleşmesi testi** (`category-contracts.test.ts`: oluştur → sorgula → doğrula → IFC sınıfı → taşı → geri al → replay → snapshot → sil) geçtiğinde "doğrulanmış" sayılır. Kaydedilen kayıt defteri IFC sınıfını yazıcı gerçekten üretmiyorsa kategori **boşluk** olarak raporlanır (örn. `plumbing.fixture` → `IfcSanitaryTerminal` hâlâ genel proxy olarak yazılır) ve destek sayılmaz.

### Mevcut durum (üretilmiş rapordan; sayılar `npm run bim:coverage` ile yeniden hesaplanır)
150 somut fiziksel ürün sınıfı: **131 eşlenmiş, 130 yazılabilir ve katı sözleşmeyle doğrulanmış (99 Level 1, 29 Level 2, 2 Level 3), 19 eşlenmemiş.** Seviye **kategori başına** kanıttan türetilir (oluşturma + yaşam döngüsü + geometri/metraj + IFC'de GlobalId ile bulunan gerçek ürün); bir kategori motorundan yüksek seviye alamaz, `authoringLevel` ile daha düşük sınır konabilir. 142/146 kategori doğrulandı, 142 kategori IFC katı doğrulamadan geçti. İlişki dışa aktarımı **ölçülmedi** (Milestone F).

### Rampa, merdiven kolu, sahanlık ve çok kollu düzenekler (Milestone B, 1. bölüm)
* **`ramp_flight` motoru** (`architecture.ramp_flight`, `IfcRampFlight`): yürüme çizgisi, genişlik, **rise**, taban kotu; `RampType` (`kind: ramp`: `max_slope` = rise/run, `thickness`) eğim sınırıdır (`RAMP_TYPE_LIMIT_EXCEEDED`). Yürüme yüzeyi üst yüzdür; kalınlık eğime dik ölçülür. Run, uzunluk, eğim, hacim türetilir. IFC: eğik eksende süpürme, üst yüzün yüksekliği taban + rise (bağımsız oracle).
* **`architecture.stair_flight`** (`IfcStairFlight`, mevcut `stair` motoru): `NumberOfRisers`, `NumberOfTreads`, `RiserHeight`, `TreadLength` şema şablonundan; yalnızca kollar tarafından kullanılan merdiven türü `IfcStairFlightType` yazılır. Düz merdiven (`architecture.stair`) aynen çalışır.
* **`architecture.landing`** (`IfcSlab` `LANDING`, mevcut `boundary` motoru).
* **Çok kollu merdiven / rampa:** `architecture.stair_assembly` (`IfcStair`) ve `architecture.ramp_assembly` (`IfcRamp`) **düzenek kuralıyla** (`assemblyRule`: `stair_run` / `ramp_run`; kural verisi `engines/assembly.ts`, kategori dalı yok): üyeler yalnızca kolların ve sahanlıkların olabilir; ardışık kollar **aynı kotta** uç-başa buluşmalı, doğrudan ya da o kotta kolların uç noktalarını içeren bir **sahanlıkla**; aksi `INVALID_ASSEMBLY_RELATION`. Metraj: `flight_count`, `landing_count`, `total_rise`, `total_run`, `total_riser_count` (rampada `max_slope_percent`). Düzenek üyelerini birlikte taşır; üye kotu kuralı bozarsa atomik ret. IFC: ana `IfcStair`/`IfcRamp` kolları ve sahanlığı `IfcRelAggregates` ile toplar, yalnızca ana ürün kata bağlıdır.
* **Plan:** motorlar artık `plan: draw` yeteneğiyle kendi çizimini yapar (rampa: taban alanı, yukarı ok, eğim %).
### Altyapı mekânsal yapısı ve koordinat semantiği (Milestone C, 1. bölüm)
* **Mekânsal birimler** (`SpatialUnit`, kaynak; olaylar `SpatialUnit{Created,Updated,Deleted}` v1; **durum sürümü 7**): tesisler (`IfcRoad`, `IfcRailway`, `IfcBridge`, `IfcMarineFacility`, `IfcFacility`) doğrudan sahanın altında ya da başka bir tesisin içinde; tesis parçaları (`IfcRoadPart`, `IfcRailwayPart`, `IfcBridgePart`, `IfcMarinePart`, `IfcFacilityPartCommon`) bir tesisin ya da parçanın içinde. Kurallar: ebeveyn var, döngü yok, parça doğrudan sahanın altında olamaz, tesis parçanın içinde olamaz, **yazılı parça kendi tesis sınıfında kalır** (yol parçası köprüde değil; nötr `IfcFacilityPartCommon` her yerde; bu bir modelleme kalitesi kuralıdır, IFC şeması zorlamaz), kardeşler arasında benzersiz ad, `PredefinedType`/`UsageType`/`CompositionType` şema numaralandırmalarından (`IfcFacility`'nin `PredefinedType`ı yoktur, uydurulmaz). Araçlar: `bim_create_spatial_units`, `bim_query_spatial_units` (türetilmiş yol, derinlik, çocuklar, içerilen elemanlar), `bim_update_spatial_units` (yeniden ebeveynleme dahil), `bim_delete_spatial_units` (çocuğu ya da elemanı olan birim silinemez: `RESOURCE_IN_USE`, kademe yok). IFC4.3'e özgüdür: birim içeren dışa aktarma `IFC4X3_ADD2` olur, açık `IFC4` reddedilir.
* **Kapsayıcı yeteneği** (`container` handler yeteneği): altyapı ürünü bir **bina katına değil**, bir tesis/parçaya bağlanır (`IfcRelContainedInSpatialStructure`); eleman doğrulaması kat yerine birimi arar, birim silme koruması bu elemanları sayar. Üretimde altyapı motoru henüz yoktur (hizalama sırada); yetenek test-only bir motorla doğrulandı.
* **Koordinat semantiği:** birimler metre ve radyan. `bim_set_georeference` yerel koordinatları projeksiyon CRS'ine bağlar (`IfcMapConversion` + `IfcProjectedCRS`): `map = ölçek · R(döndürme) · yerel + (Doğu, Kuzey, Yükseklik)`; döndürme yerel X ekseninin haritadaki Doğu'dan saat yönünün tersine açısıdır (`XAxisAbscissa/Ordinate` = cos/sin türetilir). CRS yalnızca bir **addır** (veritabanı, datum dönüşümü yoktur); elemanlar yerel koordinatlarını korur. `bim_get_coordinate_system`, `bim_convert_coordinates` (türetilir, saklanmaz), `bim_clear_georeference`.
* **Bulunan ve düzeltilen iki kusur:** (1) `mep_system` kullanım sayımı fittingleri saymıyordu (yalnızca fittinglerin kullandığı sistem silinebiliyordu); (2) bu bölümün kendi döngü denetimi başta hiç döngü bulmuyordu (test yakaladı). **Yapılmadı:** hizalama (yatay/düşey), arazi yüzeyi, hizalama tabanlı yerleşim, alt yapı ürünleri (Milestone C'nin kalanı ve D).

### Perde cephe (`curtain_wall` motoru, `IfcCurtainWall`)
Düz eksen üzerinde: taban kotu, yükseklik, isteğe bağlı açık ızgara (`u_divisions`, `v_divisions`); `CurtainWallType` (`kind: curtain_wall`) en büyük hücre boyutunu, mullion/transom kesitlerini ve panel kalınlığını taşır (`bim_update_types` ile düzenlenir). **Izgara, mullion, transom ve paneller TÜRETİLİR** (kalıcı alt kayıt yok): sütun = `ceil(L / maxPanelWidth)`, satır = `ceil(H / maxPanelHeight)`; uç mullionlar duvar boyuna kırpılır (yarım genişlik). **Kararlı alt kimlik:** `<id>.M<i>`, `<id>.T<i>.<j>`, `<id>.P<i>.<j>`; yükseklik/tür/bölme değişince aynı indisler yeniden türetilir. Reddedilenler: hücreden geniş çerçeve, 2500 hücre sınırı, geçersiz bölme (`INVALID_CURTAIN_GRID`), sıfır eksen. IFC: `IfcCurtainWall` (`IfcCurtainWallType`) `IfcRelAggregates` ile `IfcPlate CURTAIN_PANEL`, `IfcMember MULLION` ve `IfcMember USERDEFINED / ObjectType TRANSOM` toplar (IFC'de TRANSOM değeri yoktur); yalnızca perde cephe kata bağlıdır. **Yoktur:** panel bazlı değişiklikler (kapı, panjur, spandrel), eğri eksen, köşe mullionları, ankrajlar, cam katman yapısı.

### Gelişmiş çatı (`pitched_roof` motoru, `IfcRoof`): beşik ve kırma
**Dikdörtgen** planda `form` (`gable` | `hip`), `pitch` (0, 80], mahya kenarı (`long` | `short`; kırma çatı `long` ister, `ell == span` pavyon çatıdır), `overhang`, saçak kotu (`offset`); katmanlı `roof` türü kalınlığı verir (düz/tek eğimli `architecture.roof` ile aynı türü paylaşır, o davranış aynen çalışır). Düzlemler (`<id>.R<k>`), mahya, kırma kenarları ve saçaklar türetilir; metraj: düzlem alanları (eşit eğimde = plan alanı / cos eğim), mahya/kırma/saçak boyu, mahya yüksekliği, `volume_gross` (komşu düzlem kalınlıkları mahya ve kırmalarda çakışır, düşülmez). IFC: `IfcRoof` (`GABLE_ROOF` | `HIP_ROOF`) her düzlem için `IfcSlab ROOF` toplar; üst yüz çatı yüzeyidir. **Yoktur ve talep edilmez:** vadi, L/T/genel planlar, çatı açıklıkları (çatı penceresi, baca), kuytu çatı, mansard/gambrel, saçak detayı, düzlem katman yapısı.


### Kayıt-güdümlü dağıtım (Milestone A)
Bir motor `engines/handlers.ts` içinde **tipli yetenekler** kaydeder (`defineHandlers`): yerleşim, temsil, imza, doğrulama, metraj, etiket, bağımlılıklar, kat bağımlılığı, referanslar, taşıma, plan sınırı, IFC yazıcısı (`writer` | `central` | `none`) ve plan yeteneği. `dispatch`, `invariants`, `resources`, `model`, `tools` (taşıma), `plan` ve `ifc` `element.kind` üzerinde `switch` yapmaz; kayıtlı yeteneği sorar. Yeni motor = bir modül + `registerEngine` + `defineHandlers` (+ kategori); `packages/bim/test/engine-registration.test.ts` bunu test-only bir motorla kanıtlar ve kayıtsız motorun sessizce değil gürültüyle başarısız olduğunu gösterir. Motor kimlikleri/yerleşimler modül genişletmesiyle (`ExtensionEngines`) tipli kalır. Olay yönetişimi (komutlar, olaylar, indirgeyiciler, replay, snapshot, geri alma) merkezî kalır. **Zorunlu IFC sözleşmesi:** motoru IFC ürünü bildiren elemanın ürünü yoksa dışa aktarma `IFC_ELEMENT_NOT_EXPORTED` verir. Eski motorların IFC/plan yazıcıları hâlâ `ifc.ts`/`plan.ts` içindedir (`central` olarak bildirilir).

### Donatı ve tendon (P14-E kısmen): motor `reinforcement`
Kategoriler: `structure.rebar_set` (`IfcReinforcingBar`), `structure.rebar_mesh` (`IfcReinforcingMesh`, tam iki kesişen katman), `structure.tendon` (`IfcTendon`), `structure.tendon_conduit` (`IfcTendonConduit`, boşluklu süpürme). `IfcTendonAnchor` tipli nokta bileşenidir.
* **Açık konak:** kolon, kiriş, perde duvar, yapısal döşeme, ayak veya radye (`INVALID_HOST_RELATION` aksi hâlde); donatı konağın katındadır; konak otomatik çıkarılmaz.
* **Niyet:** konak + `RebarType` (`bim_create_types`, `kind: rebar`: çap, çelik sınıfı, boru için et kalınlığı) + katmanlar (ilk çubuğun yolu storey-yerel `[x, y, z]`, `count`, `spacing`, `direction`), isteğe bağlı `bend_radius` (her iç köşe 6 kirişli yayla yuvarlanır), `cover`. **Her çubuk, boyu ve hacmi türetilir**; çubuk başına kalıcı kayıt yoktur. Metraj: `bar_count`, `bar_length`, `total_length`, `cross_section_area`, `volume`. Kütle türetilmez (yoğunluk yok).
* **Yaşam döngüsü:** donatı konağıyla birlikte taşınır, tek başına taşınamaz (`INVALID_HOST_RELATION`); donatılı konak silinemez (`ELEMENT_IN_USE`); konağın katı değişirse atomik ret.
* **IFC:** her çubuk bir `IfcReinforcingBar` (`IfcSweptDiskSolid`, poliline yönergesi, `AdvancedSweptSolid`), hasır tek ürün; öznitelikler şemadan (`NominalDiameter`, `BarLength`, `SteelGrade` ...); konak `IfcRelAggregates` ile çubukları toplar (çubuklar ayrıca kata bağlanmaz). `IfcTendonConduit` yalnızca IFC4.3'tedir: şema `auto` iken IFC4X3_ADD2 seçilir.
* Yoktur: yönetmelik/örtü kontrolü, donatı tasarımı, kuvvet/gerilme.

### Düzenekler (P14-D/E kısmen): motor `assembly`
`generic.element_assembly` (`IfcElementAssembly`): açık **toplama** (aggregation). Çocuklar kendi kimliklerini, kategorilerini, türlerini ve yaşam döngülerini korur; düzenek yalnızca ilişkiyi ve kendi katını ekler. Kurallar: ≥ 1 üye, hepsi düzeneğin katında, her üyenin **tek** ebeveyni, **döngüsüz**, açıklık/barındırılan bileşen/mekân üye olamaz (`INVALID_ASSEMBLY_RELATION`); `predefined_type` IFC numaralandırmasına karşı doğrulanır. Düzenek üyelerini birlikte taşır; üye düzenekteyken silinemez, düzenek silinince üyeler serbest kalır (kademe yok). IFC: `IfcRelAggregates` (iç içe düzenekler önce çocuklar), yalnızca üst düzey düzenek kata bağlanır. Fabrikasyon/ağırlık yoktur.

### Şema seçimi ve öznitelik yerleşimi
Şema seçimi **tüm elemanların** kategorilerine bakar (bileşen, donatı, derin temel, ...): IFC4.3'e özgü bir sınıf varsa `IFC4X3_ADD2`, yoksa `IFC4`; açık `IFC4` isteği reddedilir (`UNSUPPORTED_IFC_SCHEMA`). `PredefinedType` özniteliği olmayan sınıflar (`IfcDeepFoundation`) şemanın gerçek öznitelik listesiyle yazılır.

### MEP fittingleri ve dağıtım segmentleri (P14-F kısmen)
* **Motor `mep_fitting`** (yeni davranış modeli): dirsek, te, çapraz, redüksiyon, geçiş, rakor; kategoriler `plumbing.pipe_fitting` (`IfcPipeFitting`), `mechanical.duct_fitting` (`IfcDuctFitting`), `electrical.cable_carrier_fitting` (`IfcCableCarrierFitting`), `electrical.cable_fitting` (`IfcCableFitting`). **Fitting bir üründür, birleşim ilişkidir:** `MepJunction` açık bağlantı olarak kalır (`segment → fitting → segment`, `segment → ekipman → segment`); yakınlıktan bağlantı çıkarılmaz.
* `FittingType` (`bim_create_types`, `kind: mep_fitting`): `fitting`, `domain`, `run` kesiti (yuvarlak ya da dikdörtgen), `outlet` (redüksiyon/geçiş çıkışı ya da te/çapraz dalı), `angle` (dirsek dönüşü ya da dal açısı), `radius`, `length`, `branch_length`. **Bağlayıcılar ve geometri tür parametrelerinden TÜRETİLİR**, saklanmaz: `inlet`, `outlet`, `branch` / `branch_a` / `branch_b`. Yerel çerçeve: koşu +X boyunca, giriş orijinde −X'e bakar.
* Yerleşim: `bim_create_mep_fittings` (`storey`, `at`, `offset`, `rotation` = yaw, `pitch`, `roll`). Ağ grafında fitting **tüm bağlayıcıları arasında** ortamı geçirir.
* **IFC:** düz prizmalar, **dirsek = `IfcRevolvedAreaSolid`** (yuvarlak ve dikdörtgen için tam), yuvarlak redüksiyon = `IfcExtrudedAreaSolidTapered`, **dikdörtgen redüksiyon = tam çokyüzlü `IfcFacetedBrep`** (bağımsız hacim oracle'ı, dikdörtgenler arası konik ekstrüzyonun yaygın çekirdeklerde yanlış kurulduğunu yakaladı), geçiş (yuvarlak → dikdörtgen) iki prizma (yuvarlaktan dikdörtgene geçişin loft'u IFC ilkeli değildir: bu ayrıntı kaybedilir). `PredefinedType` fitting türünden (BEND, JUNCTION, TEE, CROSS, REDUCER, TRANSITION, CONNECTOR); sınıfın ifade edemediği tür reddedilir (örn. kablo bağlantı parçası dirsek olamaz: `INVALID_PREDEFINED_TYPE`). Bağlayıcılar `IfcDistributionPort`, sistem ataması dahil.
* Fabrikasyon ayrıntısı (flanş, kaynak, et kalınlığı) ve mühendislik (kayıp katsayısı) yoktur.
* **Esnek ve kablo segmentleri** (aynı `mep_network` motoru): `electrical.cable_segment` (`IfcCableSegment`, yeni `cable` türü), `mechanical.flexible_duct`, `plumbing.flexible_pipe` (`FLEXIBLESEGMENT`). Esnek segment şimdilik kategori anlambilimidir (poliline rota); minimum bükülme yarıçapı modellenmez.

### Kategori keşfi (J4)
`bim_list_categories`: `discipline`, `engine`, `capability`, `ifc_class`, `min_level` filtreleri; her satırda `authoring_level` ve `creation_tool`. `bim_get_category_capabilities`: motor (durum, seviye, işlemler, temsiller), yerleşimler, tür türleri, IFC sınıfı + geçerli `PredefinedType` değerleri + hangi şemalarda var olduğu, oluşturma aracı, çağıranın sağlaması gerekenler ve **sınırlar** (Level 1: "jenerik aile kutusu geometrisi").

### Şemadan türetilmiş kategoriler (P14-H, kısmen)
`scripts/ifc-schema-data.py`, resmî şemalardan `packages/bim/src/ifc-schema-data.ts` üretir: her somut fiziksel sınıf için **öznitelik şablonu (IFC4 ve IFC4.3 ayrı)**, geçerli `PredefinedType` değerleri, genel yazıcıyla yazılabilirlik. Aynı betik dağıtım ekipmanı, terminal, kontrol elemanı, mobilya, ulaşım, coğrafi/sivil/sanal ve eleman bileşeni sınıfları için **90 kategoriyi** (nokta-bileşen motoru) türetir; yeni motor ve yeni eleman türü yoktur. Her kategori: gerçek IFC sınıfı, tür (ComponentType) + `predefined_type` (şema numaralandırmasına karşı doğrulanır; geçersiz değer `INVALID_PREDEFINED_TYPE`), bağlayıcılar, malzeme/parametreler, genel yaşam döngüsü. Geometri bir **aile kutusudur** (Level 1: "jenerik kutu Level 2 değildir"). `IfcPlate` sınır motoruna, `IfcWallStandardCase` duvar motoruna, `IfcCaissonFoundation` aşağı yönlü profil üyesine eşlendi.
**IFC şema seçimi:** `bim_export_ifc` `schema` alır (`auto` | `IFC4` | `IFC4X3_ADD2`); `auto`, yalnızca IFC4.3'te var olan bir sınıf varsa IFC4.3 yazar; böyle bir modelin açık IFC4 dışa aktarımı `UNSUPPORTED_IFC_SCHEMA` ile reddedilir (4.3'e özgü sınıf IFC4 başlığı altında **asla** yazılmaz). Tüm süpürme modeli IfcOpenShell ile IFC4.3'te, IFC4 alt kümesi IFC4'te doğrulanır (0 şema hatası).

### Henüz yapılmayanlar (Phase 14 kapsamı)
P14-C motor/kayıt genelleştirmesi (kayıt-güdümlü gönderim), P14-D…G yeni davranış aileleri (perde cephe, gelişmiş çatı/merdiven, rampa, donatı, çelik birleşimleri, düzenekler, MEP fittingleri ve esnek dağıtım segmentleri, arazi/hizalama/doğrusal altyapı, jeoteknik), P14-I tür/malzeme/özellik/sınıflama modeli, P14-J IFC4.3 dışa aktarma ve doğrulama, `bim_create_elements` / kategori yetenek keşfi araçları.

## MEP çekirdeği: bağlayıcılar, sistemler, boru, kanal, kablo tavası, konduit (13. aşama)
**Phase 13 mühendislik analizi yapmaz:** debi, basınç kaybı, hız, pompa/fan boyutlandırma, akım, gerilim düşümü, devre yükü, kablo boyutlandırma, tava doluluğu yoktur. Bu bir BIM yazım ve bağlantı anlambilimidir.

### Kategori → motor
`mep_network` motoru etkinleşti (`proxy` hâlâ ayrılmış). Dört kategori **aynı** motoru ve **tek** yaşam döngüsünü kullanır; `pipe` / `duct` / `cable_tray` / `conduit` için ayrı motor, ayrı eleman türü ya da ayrı doğrulama yoktur.

| Kategori | MEP alanı (`mepDomain`) | Tür türü | IFC |
|---|---|---|---|
| `plumbing.pipe` | `piping` | `pipe` | `IfcPipeSegment` (`RIGIDSEGMENT`) |
| `mechanical.duct` | `hvac` | `duct` (yuvarlak / dikdörtgen) | `IfcDuctSegment` (`RIGIDSEGMENT`) |
| `electrical.cable_tray` | `electrical` | `cable_tray` | `IfcCableCarrierSegment` (`CABLETRAYSEGMENT`) |
| `electrical.conduit` | `electrical` | `conduit` | `IfcCableCarrierSegment` (`CONDUITSEGMENT`) |

Alan kategori verisinde açıkça yazılıdır; tür adından çıkarılmaz.

### Sistem: kaynak, eleman değil
`MepSystem { id, name, domain, classification, description?, properties? }` (`MS-0001`). `domain` sıkı ve **değişmezdir**; `classification` kararlı bir anlamsal dizedir (`domestic_cold_water`, `sanitary`, `supply_air`, `power`…). Her rota elemanı mevcut bir sisteme bağlı olmak **zorundadır** (sessiz varsayılan sistem yoktur) ve sistem alanı kategorinin alanıyla uyuşmalıdır (kanal → piping sistemi `MEP_SYSTEM_DOMAIN_MISMATCH`). Araçlar: `bim_create/query/get/update/delete_mep_systems`. Kullanımdaki sistem silinemez (`RESOURCE_IN_USE`; kullanım "3 plumbing.pipe" gibi anlamsal etiketlerle). Sorgu, türetilmiş özet verir: eleman sayısı, toplam rota uzunluğu, birleşim sayısı, açık bağlayıcı sayısı, bağlı bileşen sayısı.

### Rota (tek kanonik eleman: `mep_segment`)
`MepSegment { kind: "mep_segment", category, type, system, route: MepRoutePoint[] }`, `MepRoutePoint { storey, at: [x, y], offset }`. Dünya z'si `kat kotu + offset` olarak **türetilir** (saklanmaz; Phase 12 çaprazıyla aynı ilke). En az 2 nokta; ardışık yinelenen nokta **reddedilir** (`INVALID_ROUTE`). Yatay, eğimli, dikey yükselti, çok parçalı ve **çok katlı** rotalar geçerlidir. Elemanın `storey`'si ilk noktanın katıdır. **Tek** `polylineLength` (3B) metraj, temsil, doğrulama ve IFC'nin ortak kaynağıdır.
* **Kat kotu değişirse** rota, uzunluk, bağlayıcı konumları ve IFC türer; rota niyeti **yeniden yazılmaz** ve MEP olayı gerekmez. Bir kat değişimi bağlı bir birleşimin üyelerini tolerans dışına ayıracaksa **bütün komut** atomik reddedilir.
* `bim_reassign_storey` çok katlı rotada **reddedilir** (belirsiz; `INVALID_ENGINE_PLACEMENT`): rota `bim_update_elements` (`kind: mep_segment`) ile açıkça güncellenir. Rotanın başvurduğu **her** kat silme korumasına dahildir.

### Tür modeli
`PipeType { diameter, wallThickness?, insulationThickness?, material? }`, `DuctType { shape: round | rectangular, diameter | width + height, insulationThickness?, material? }`, `CableTrayType { width, height, material? }`, `ConduitType { diameter, material? }`. Merkezi zincir kategori ↔ tür uyumunu durum düzeyinde de denetler (boru kategorisine kanal türü verilemez).

### Bağlayıcı (connector): kararlı kimlik, türetilmiş geometri
Bir bağlayıcının kimliği **`ConnectorRef { element, connector }`**'tir; dünya koordinatı kalıcı değildir.
* **Rota uçları:** `start`, `end`. Konum: ilk / son rota noktası. Yön (tek kural): `start` → **ilk segmentin tersi** (dışa doğru), `end` → son segment boyunca. Alan, şekil ve boyut kategori + türden; akış `bidirectional`; sistem elemanın sistemi.
* **Bileşen bağlayıcıları (isteğe bağlı):** `ComponentType.connectors: ConnectorDef[]` `{ key, domain, position (yerel, bileşen kaynağına göre), direction, flow: in | out | bidirectional, shape, diameter | width + height, classification? }`. Dünya konumu / yönü **mevcut nokta-bileşen yerleşiminden** (kat kotu + ofset, x/y, Z etrafında dönüş) türetilir; bileşen örneğinde bağlayıcı geometrisi saklanmaz. Mevcut bileşen türleri bağlayıcısızdır (göç yok). Tanım hatası: `INVALID_CONNECTOR_DEFINITION`.
* Bileşen, tek bir `system` alanı taşımaz; sistem üyeliği bağlı ağdan **türetilir**.

### Bağlantı: açık, dokunmak bağlamaz
**DOKUNMAK ≠ BAĞLI.** İki ucun aynı koordinatta olması hiçbir bağlantı yaratmaz (duvar topolojisiyle aynı ilke). Bağlantı yalnızca **`MepJunction { id, members: ConnectorRef[] }`** kaynağıyla (`MJ-0001`) kalıcıdır: 2 üye = kaplin / dirsek benzeri, 3 = tee, 4 = çapraz. **BİRLEŞİM ≠ FİTİNG ÜRÜNÜ:** birleşim anlamsal bağlantıdır; kalıcı dirsek/tee/redüksiyon/vana elemanı yoktur.
Kurallar (`bim_connect_mep`, tek yer: `junctionProblem`): ≥ 2 üye; üyeler var olmalı (`MEP_CONNECTOR_NOT_FOUND`); aynı alan (`MEP_DOMAIN_MISMATCH`, adaptör yok); aynı sistem (`MEP_SYSTEM_MISMATCH`, sistemler birleştirilmez); aynı şekil ve boyut (`MEP_CONNECTOR_INCOMPATIBLE`, **otomatik redüksiyon yok**); iki `out` ya da iki `in` yok (`MEP_FLOW_CONFLICT`); hepsi mevcut `JOIN_TOLERANCE` içinde aynı noktada (`MEP_CONNECTION_DISTANCE`; hata bağlayıcı referanslarını, konumları, mesafeyi ve toleransı verir; **hiçbir şey kaydırılmaz**). Bir bağlayıcı **en çok bir** birleşimdedir; var olan birleşime ekleme onu genişletir, iki mevcut birleşimi birleştirme **reddedilir** (`MEP_JUNCTION_MERGE_UNSUPPORTED`). `bim_disconnect_mep` (`junction` ve/veya `connectors`): üye çıkarır, 2'nin altında kalan birleşim silinir.
**Bağlı düzenleme koruması:** her komuttan sonra tek bir değişmez bütün birleşimleri yeniden doğrular. Rota ucunu, bileşeni, katı ya da türü bir birleşimi bozacak biçimde değiştiren komut **bütünüyle** reddedilir (`MEP_CONNECTED_ELEMENT_MOVE_CONFLICT`; durum ve olay sayısı değişmez). İş akışı: `bim_disconnect_mep` → düzenle → `bim_connect_mep`. Bağlı bir eleman silinemez (`ELEMENT_IN_USE`). Ağ boyunca otomatik yeniden yönlendirme / taşıma yoktur.

### Ağ sorgusu
`bim_query_mep_connectors` (konum, yön, alan, akış, şekil/boyut, sistem, birleşim, `connected_to`; `open_only`). `bim_query_mep_network` (`system`, `element` ya da `connector`): elemanlar, birleşimler (coupling / tee / cross), **bağlı bileşenler** (bir sistem yazım sırasında birden çok bileşene sahip olabilir), **açık bağlayıcılar** (hata değildir), bağlayıcı düzeyinde komşuluk ve eleman başlangıçlı **belirleyici genişlik-öncelikli gezinti** (dal ve **döngü** güvenli; kimlikler sıralı; her düğüm bir kez).

### Üretilen çıktılar
* **Metraj:** `length` (3B), boru/konduit/yuvarlak kanal `diameter`, dikdörtgen kanal/tava `width` + `height`, `cross_section_area`. Debi, basınç, doluluk **türetilmez**.
* **Plan:** kategori başına stil (boru mavi, kanal yeşil, kablo tavası kesikli sarı, konduit noktalı kırmızı); çizgi kalınlığı kesitten; dikey segment bir **yükselti işareti** olarak çizilir.
* **Yineleme imzası:** kategori + sistem + tür + rota. Aynı doğrultudaki boru ve konduit, ya da iki farklı sistemin aynı rotası yineleme değildir.
* **IFC:** sınıf ve PredefinedType kategori verisinden (`IfcPipeSegment`, `IfcDuctSegment`, `IfcCableCarrierSegment`; proxy yok); her rota segmenti başına bir süpürme katısı, tek ürün temsili. Her bağlayıcı `IfcDistributionPort` (`IfcRelNests` ile sahibine; akış `SOURCE` / `SINK` / `SOURCEANDSINK`; tür `PIPE` / `DUCT` / `CABLECARRIER`; sistem enum'u), bileşenler de (sınıfları değişmez). Her sistem `IfcDistributionSystem` + `IfcRelAssignsToGroup` (sınıflandırma `IfcDistributionSystemEnum`'a denk düşüyorsa o, yoksa `USERDEFINED` + `ObjectType` = sınıflandırma dizesi). Birleşim → `IfcRelConnectsPorts`. **Sınırlama:** IFC4'te bir port her yönde yalnızca bir bağlantı alabildiğinden 3+ üyeli birleşim, ardışık üyeler arasında **bir port bağlantısı zinciri** olarak yazılır (tee = 2 bağlantı); n-ary bağlantı IFC4'te ifade edilemez ve INSA durumunda eksiksiz kalır.
* **Araçlar:** `bim_create_mep_segments` (kanonik), ince sarmalayıcılar `bim_create_pipes` / `_ducts` / `_cable_trays` / `_conduits`, `bim_query_mep_connectors`, `bim_connect_mep`, `bim_disconnect_mep`, `bim_query_mep_network`, sistem araçları.

### Durum ve olay sürümü
`BIM_STATE_VERSION` **5 → 6** (üst düzey `mepSystems` / `mepJunctions`); eski snapshot'lar yok sayılır ve geçmiş yeniden oynatılır (eski projelerde hiçbir sistem, birleşim ya da MEP elemanı **türemez**). Yeni olaylar: `MepSystemCreated/Updated/Deleted`, `MepJunctionCreated/Updated/Deleted` (v1). `ElementCreated` **3** ve `ElementUpdated` **2** değişmedi: rota elemanı mevcut birleşimin **eklemeli bir varyantıdır** (yeni `kind`; eski olaylar aynen geçerli ve aynı anlamdadır; yama anlamı yine "üst düzey alan ata"), ve bileşen türündeki `connectors` isteğe bağlıdır. Phase 8, 11 ve Phase 12 gerçek projeleri yeni kodla yeniden oynatılır; Phase 12 IFC'si ürün ürün aynıdır.

### Ertelenenler
Kalıcı dirsek/tee/çapraz/redüksiyon/geçiş/vana/damper/rakor elemanları, sprinkler ağ cihazları, mühendislik davranışlı pompa/fan, otomatik yönlendirme, engel kaçınma, otomatik fitting/redüksiyon, eğim çözücü, askı/destek üretimi, geçiş/manşon üretimi, çakışma tespiti, debi/basınç/hız/akım/gerilim düşümü/kablo boyutlandırma/tava doluluğu, ağ boyunca taşıma, birleşim birleştirme, IFC içe aktarma, BCF/IDS/bSDD, birlikte çalışma ve gelişmiş MEP arayüzü.

## Yapısal genişleme (12. aşama)
Yeni **kategoriler**, yeni motor ya da yeni eleman türü getirmeden mevcut motorları kullanır:

| Kategori | Motor | Yerleşim | Tür (type kind) | IFC |
|---|---|---|---|---|
| `structure.column` / `structure.framing` | `profile_member` | `member_vertical` / `member_axis` | `column` / `beam` (değişmedi) | `IfcColumn` / `IfcBeam` |
| `structure.brace` | `profile_member` | **`member_spatial_axis`** | `beam` (kiriş türü: eksenli üye profili) | `IfcMember` (`BRACE`) |
| `structure.pile` | `profile_member` | `member_vertical`, **aşağı yönlü** | `column` (kolon türü: dikey üye profili) | `IfcPile` |
| `structure.shear_wall` | `wall` | `wall_axis` | `wall` | `IfcWall` (`SHEAR`) |
| `structure.slab` | `boundary` | `boundary` | `slab` | `IfcSlab` |
| `structure.foundation_slab` | `boundary` | `boundary` (kalınlık aşağı) | `foundation_slab` | `IfcSlab` (`BASESLAB`) |
| `structure.footing` | `boundary` | `boundary` (kalınlık aşağı) | `footing` (`footing_kind`: pad / strip) | `IfcFooting` (`PAD_FOOTING` / `STRIP_FOOTING`) |

**Phase 12 yapısal mühendislik analizi yapmaz:** yük, yük durumu, mesnet, salıverme, iç kuvvet, gerilme, sehim, FEA, yönetmelik kontrolü, donatı, bağlantı tasarımı yoktur. Doğrulama **model tutarlılığını** denetler, taşıma yeterliliğini değil; "perde duvar" bir BIM kategorisidir, deprem tasarımının kanıtı değildir.

### Çapraz (brace): gerçek 3B üye
`member_spatial_axis`: iki **kata bağlı** uç: `start` / `end` = `{ storey, at: [x, y], offset }`; dünya yüksekliği `kat kotu + offset` olarak **türetilir** (saklanmaz). `storey` her zaman başlangıç katıdır; `rotation` kesitin eksen etrafındaki dönüşüdür (derece).
* **Kat kotu değişirse** çaprazın dünya uçları, uzunluğu, yönelimi, IFC geometrisi ve metrajı **hiçbir çapraz olayı yazılmadan** yeniden türer (yalnızca `StoreyUpdated`). Düzenleme ekseni sıfır uzunluğa indirecekse komut atomik reddedilir.
* Her sıfır olmayan 3B açı geçerlidir (aynı kat içinde yatay/dikey ya da komşu katlar arası); uzunluk 3B mesafedir.
* **Kat yeniden atama belirsiz olduğu için reddedilir** (`INVALID_ENGINE_PLACEMENT`): uçların katları `bim_update_elements` (`kind: "brace"`: `start`, `end`, `start_storey`, `start_offset`, `end_storey`, `end_offset`, `rotation`, `type`) ile açıkça güncellenir. Taşıma iki ucu birlikte kaydırır. Çaprazın başvurduğu kat silinemez (`RESOURCE_IN_USE`).
* Araç: `bim_create_braces` (ince sarmalayıcı) ya da `bim_create_profile_members` (`structure.brace`). Eksen çerçevesi belirleyicidir: eksen, yatay yanal vektör ve dönüş; dikeye yakın eksenlerde dünya X'i (`memberFrame`), tekillik ve tekrar arası dönüş yoktur.

### Kazık (pile): aşağı yönlü dikey üye
Kolonla aynı `member_vertical`; fark **kategori semantiğidir** (`memberDirection: "down"`). Saklanan: `at`, `baseOffset` (üst ucun kat üstündeki kotu), `height` (= kazık uzunluğu), `rotation`, `direction: "down"`. Üst uç `kat kotu + baseOffset`, alt uç uzunluk kadar aşağıdadır. Kat kotu değişirse üst uç izler, **uzunluk değişmez**. Kazık sabit uzunlukludur (kat kısıtı yoktur). Kolon kazığa, kazık kolona dönüşemez (`CATEGORY_ENGINE_MISMATCH`).
**Uyumluluk:** `direction` yokluğu = yukarı (eski kolon olayları ve snapshot'lar değişmez; kolonlara alan yazılmaz). Araç: `bim_create_piles` (`length` zorunlu).

### Kesit modeli (tek kaynak)
`section.ts`: `rect {b, h}`, `circle {d}`, **`rhs {b, h, t}`**, **`chs {d, t}`**, **`i_section {h, b, tw, tf}`**. Geçerlilik (boş çekirdek bırakmayan duvar/flanş kalınlığı, sonlu pozitif ölçüler), alan, dış sınır ve plan hattı yalnızca orada. Alanlar: RHS = dış − iç dikdörtgen; CHS = dış − iç daire; I = 2 flanş + gövde (flanş çakışması hariç). `cross_section_area` bu fonksiyondan gelir. IFC'de **gerçek** profiller yazılır (`IfcRectangleHollowProfileDef`, `IfcCircleHollowProfileDef`, `IfcIShapeProfileDef`); boş kesit katıya yaklaştırılmaz.
**Tür uyumluluğu (strateji A):** eski tür türleri yerleşim rolünü bildirir: `beam` türü eksenli/uzamsal eksenli üyelere, `column` türü dikey üyelere uygundur; kategori hangi tür türünü kabul ettiğini kendisi bildirir (`structure.brace` → `beam`, `structure.pile` → `column`). Her kesit her ikisinde kullanılabilir.

### Perde duvar
`bim_create_walls` artık `category` alır (`architecture.wall` varsayılan, `structure.shear_wall`); ayrı duvar modeli yoktur. `Wall.category` isteğe bağlıdır ve `architecture.wall` için **hiç yazılmaz** (eski duvarlar aynen). Tür, katmanlı yapı, dikey kısıt, `roomBounding`, topoloji, açıklıklar ve **Phase 10'un bölme / birleştirme / kırpma / uzatma** işlemleri aynen çalışır; kategori korunur. Farklı kategorideki iki duvar birleştirilemez (`MERGE_INCOMPATIBLE`, `field: category`).

### Yapısal döşeme, temel plağı, ayak
Hepsi `boundary` motorudur; kategori ve **tür türü** ayırır. `structure.slab` → `slab` türü (kalınlık aşağı, yatay); `structure.foundation_slab` → `foundation_slab` türü; `structure.footing` → `footing` türü. **Pad / strip yalnızca türden** gelir (`footing_kind`), çokgenin şeklinden çıkarılmaz. Çatı/duvar türü ayağa, ayak türü temel plağına verilemez. `bim_create_footings` (ince sarmalayıcı): pad için `center + length + width + rotation` dikdörtgen bir ayak izine normalize edilir; **şerit ayak açık poligonla verilir** (yoldan türetme ertelendi). Aynı ayak izindeki mimari döşeme ve yapısal döşeme yineleme sayılmaz (kategori imzaya girer).

### Metraj
Çapraz: `length` (3B), `section_area`, `cross_section_area`, `volume`. Kazık: aynı anahtarlar (`length` = kazık boyu). Kolon/kiriş: değişmedi. Perde duvar: duvar metrajı. Yapısal döşeme/temel plağı/ayak: `area`, `thickness`, `volume`. Yoğunluk/kütle tanımlı olmadığı için ağırlık **türetilmez**.

### Olay ve durum sürümü
`BIM_STATE_VERSION` **5**, `ElementCreated` **3**, `ElementUpdated` **2**; upcaster eklenmedi. Gerekçe: değişiklikler yalnızca eklemelidir (yeni isteğe bağlı `direction`, yeni yerleşim ve kategoriler, isteğe bağlı `Wall.category`); eski olaylar anlamını korur. Gerçek Phase 8 ve Phase 11 projeleri (`packages/bim/test/fixtures`) yeni kodla yeniden oynatılır: aynı kimlikler, hiçbir yapısal eleman türemez, ölçümler aynıdır.

### Tür keşfi: ev kategorisi ve uyumlu kategoriler
Bir sistem türünün **ev (home) kategorisi** vardır (kiriş türü → `structure.framing`). Ama aynı tür, merkezi Kategori → Motor → Tür zinciri uyarınca başka kategorilerce de kullanılabilir (kiriş türü `structure.brace`'te, kolon türü `structure.pile`'da, duvar türü `structure.shear_wall`'da). `bim_query_types`: `category` = ev kategorisi filtresi; **`compatible_category`** = o kategorinin gerçekten kullanabileceği türler. Her tür sonucu türetilmiş `compatible_categories` içerir. Kural tek yerdedir (`typeFitProblem`): hem eleman doğrulaması hem keşif onu okur; uyumluluk listeleri türlerin içinde **saklanmaz**.

### Türetilmiş yapısal bağlantı sorgusu
`bim_query_structural_connectivity`: mevcut geometriden **o anda** hesaplanan temaslar: üye ucu başka bir üyenin ucuna (`endpoint_contact`) ya da eksenine (`endpoint_on_member`, T), bir yapısal duvarın içine (`endpoint_in_wall`), bir yapısal döşeme/ayak/radye katısının içine (`endpoint_in_boundary`) değiyor. Yükseklikler katlardan gelir; tolerans mevcut `JOIN_TOLERANCE`'dır.
Bu **türetilmiş bir görünümdür**: kalıcı bir birleşim ya da bir mühendislik bağlantı tasarımı **değildir**; durumu hiçbir zaman değiştirmez, olay yazmaz ve yakınlıktan kalıcı bağ çıkarmaz. Bir eleman taşındığında yanıt, kendi bir olayı olmadan değişir (`derived: true`). Eğimli çatı düzlemleri bu görünüme dahil değildir.

### Ertelenenler
Yoldan şerit ayak türetme, donatı, tendon, çelik bağlantı/cıvata/kaynak/taban plakası, kazık başlığı donatısı, yükler ve analiz modeli, otomatik çerçeve/çapraz/ayak boyutlandırma, geoteknik kapasite, giydirme cephe (Curtain Wall), MEP, IFC içe aktarma ve etkileşimli yapısal düzenleme.

## Mimari genişleme: tavan, çatı, merdiven, korkuluk (11. aşama)
Yeni **kategoriler** (`architecture.ceiling`, `.roof`, `.stair`, `.railing`) yeni eleman türü getirmez; mevcut ya da etkinleştirilen motorları kullanır:

| Kategori | Motor | Tür (type kind) | IFC sınıfı |
|---|---|---|---|
| `architecture.floor` | `boundary` | `slab` (değişmedi) | `IfcSlab` |
| `architecture.ceiling` | `boundary` | `ceiling` | `IfcCovering` (`CEILING`) |
| `architecture.roof` | `boundary` | `roof` | `IfcRoof` (`FLAT_ROOF` / `SHED_ROOF`) |
| `architecture.stair` | `stair` | `stair` | `IfcStair` (`STRAIGHT_RUN_STAIR`) |
| `architecture.railing` | `path` | `railing` | `IfcRailing` (`GUARDRAIL`) |

Olaylar, durum ve kalıcılık aynıdır: `ElementCreated` v3 / `ElementUpdated` v2, `BIM_STATE_VERSION` **5**, upcaster eklenmedi. Yeni `kind` değerleri yalnızca yeni olaylarda görünür; eski olaylar, eski snapshot'lar ve eski projeler (gerçek 8. aşama projesi dahil) hiçbir tavan, çatı, merdiven ya da korkuluk **türetmez**. Yeni olay türü (`RoofCreated` vb.) yoktur.

### Sınır motoru: döşeme, tavan, düz ve tek düzlemli çatı
Tek `Boundary` modeli ve tek doğrulayıcı; kategori yalnızca tür türünü ve **kalınlık yönünü** (registry verisi) seçer.
* **Döşeme:** değişmedi (kalınlık referans seviyesinin **altında**).
* **Tavan:** referans düzlemi `offset`; kalınlık **yukarı** doğru uzanır (`top = offset + kalınlık`). Alan, kalınlık ve hacim döşemeyle aynı anahtarlarla türetilir; döşeme ve tavan aynı ayak izinde **yineleme sayılmaz** (kategori imzaya girer).
* **Çatı:** düz ya da **tek düzlemli** (mono-pitch). Otomatik kırma/beşik, vadi/mahya çözücü, çatı penceresi ve karmaşık çok düzlemli birleşimler kapsam dışıdır; her çatı düzlemi bir `Boundary`'dir.
* **Düzlem niyeti (kanonik, çözülmüş ağ saklanmaz):** `slope: { azimuth, pitch }`. `azimuth` düzlemin **yükseldiği** yön (derece, [0, 360), +X'ten saat yönünün tersine), `pitch` eğim (derece, 0 < pitch ≤ 80). Eğim çizgisi (saçak) dış hattın yükselme yönündeki en küçük izdüşümüdür ve `offset` saçaktaki üst yüzey kotudur. Tek yükseklik formülü: `planeHeight(b, p) = offset + tan(pitch) · (p·u − s₀)` (plan, IFC, doğrulama ve metraj aynısını okur).
* **Eğimli çatı metrajı:** `projected_area`, `surface_area = projected / cos(pitch)`, `thickness` (düzleme **dik**), `volume = surface_area × thickness`, `pitch`. Düz çatıda `surface_area == projected_area`. Hacim hiçbir zaman plan alanından hesaplanmaz.
* Düz bir sınır sonradan eğimli yapılamaz ve eğimden düze dönülemez (olaylar alan silemez): yeni çatı oluşturulur. Döşeme ve tavan eğimli olamaz (`INVALID_ENGINE_PLACEMENT`).
* **IFC:** çatı düzlemi eğimli bir profilin düzlem normali boyunca ekstrüzyonudur; `IfcRoof` doğrudan geometriyle yazılır (tek ürün; ayrı `IfcSlab` alt öğesi yoktur). Çatının katman kullanımı (`IfcMaterialLayerSetUsage`) eğimli düzlemde yazılmaz.

### Merdiven (`stair` motoru): tek doğrusal koşu
Saklanan niyet: yürüme çizgisi `start` → `end` (ilk ve son riser), `width`, `riserCount` (N riser = N − 1 basamak), `baseOffset` ve **dikey niyet** (kolon gibi). Varsayılan üst kat bir üst kattır; toplam rise = üst kat − taban kat − `baseOffset`.
* Türetilir: `riser_height = rise / N`, `tread_depth = run / (N − 1)`, eğim açısı, basamaklar, adım profili ve metraj (`total_rise`, `run`, `width`, `riser_count`, `riser_height`, `tread_depth`, `slope_angle`, `footprint_area`). Basamaklar eleman **değildir**.
* **Kat yüksekliği değişirse** riser yüksekliği aynı komutta güncellenir; **riser sayısı kendiliğinden değişmez**. Değişiklik tür sınırını aşıyorsa komutun tamamı atomik olarak reddedilir (`STAIR_TYPE_LIMIT_EXCEEDED`); niyet doğrulamayı geçirmek için otomatik değiştirilmez.
* **StairType:** yalnızca sınırlar ve varsayılanlar: `max_riser`, `min_tread`, `default_width`, `material`. Evrensel bir yönetmelik varsayılmaz; sınırlar türün kendisidir.
* Hatalar: `INVALID_STAIR_GEOMETRY`, `STAIR_VERTICAL_CONSTRAINT_INVALID` (üst kat tabanın üstünde değil; ör. kendi üst katına yeniden atama), `STAIR_TYPE_LIMIT_EXCEEDED`.
* Katı, son basamakta biter (N. riser üst kat döşemesine ulaşır). IFC'de tek `IfcStair` ürünü; ayrı `IfcStairFlight` yazılmaz.
* Çok kollu, L/U biçimli, kıvrık ya da spiral merdiven, sahanlık, otomatik açıklık ve korkuluk bağlama **ertelendi**.

### Yol motoru (`path`) ve korkuluk
`path` bir kaçış kapısı değil, semantik bir poliline üzerinde geometrisi olan elemanlar içindir. Saklanan: `path` (≥ 2 nokta; kapalıysa ≥ 3), `closed`, `offset` (taban kotu) ve `height`. **Direkler ve korkuluk türetilir**, saklanmaz.
* **Direk kuralı (tek):** her köşede bir direk; her segment `ceil(uzunluk / max_post_spacing)` eşit aralığa bölünür (pozisyonlar çarpımla hesaplanır, kayma birikmez). Kapalı yolda ilk/son direk yinelenmez.
* **Politika:** ardışık yinelenen köşeler (sıfır uzunluklu segment) **reddedilir**, sessizce düzeltilmez (`INVALID_PATH_ELEMENT`).
* **RailingType:** `height`, `top_rail {width, depth}`, `post {size}`, `max_post_spacing`, `material`.
* Metraj: `path_length`, `height`, `post_count`. IFC: üst korkuluk segment segment + direkler, tek `IfcRailing`.
* Eğri/spline yol ve panel/baluster aileleri ertelendi.

### Araçlar
`bim_create_boundaries` (kategori: `architecture.floor` / `.ceiling` / `.roof`; çatı için isteğe bağlı `slope`), `bim_create_stairs`, `bim_create_path_elements` (genel), `bim_create_railings` (ince sarmalayıcı). Türler `bim_create_types` ile (`ceiling`, `roof`, `stair`, `railing`). Taşıma, güncelleme (`kind`: `boundary` / `stair` / `path`), storey yeniden atama, silme ve sorgular genel araçlardır. Sonuçlar daima kategoriyi (`architecture.roof`) ve motoru (`boundary`) **ayrı** gösterir; web ağacı anlamsal kategoriye göre gruplar (Döşemeler, Tavanlar, Çatılar, Merdivenler, Korkuluklar, Odalar, Mahaller, …), asla motora göre değil.

### Yeni bir kategori eklemek
* **Boundary kategorisi:** `taxonomy.ts` içinde `engine: "boundary"`, `placements`, `typeKinds` (mevcut katmanlı tür ya da yeni bir katmanlı tür türü), `thickness: "above" | "below"`, isteğe bağlı `ifcClass`. Eleman türü, doğrulayıcı, taşıma, silme, sorgu ya da IFC geometrisi kodu **gerekmez** (`architecture-extensibility.test.ts`: test amaçlı `architecture.test_canopy`).
* **Path kategorisi:** `engine: "path"`, `placements: ["path"]`, `typeKinds: ["railing"]` (ya da yeni bir tür). Test amaçlı `architecture.test_path_feature` yeni eleman türü olmadan oluşturma, sorgu, güncelleme, taşıma, storey yeniden atama, silme ve IFC (proxy) yapar.

### Ertelenenler
Giydirme cephe (Curtain Wall: panel/kayıt sistemi), çok düzlemli çatı üreticisi, vadi/mahya çözücü, çatı penceresi, otomatik duvar–çatı bağlama, odalardan otomatik tavan, çatı/tavanla kırpılan oda hacmi, çok kollu/L/U/spiral merdiven, sahanlık, otomatik merdiven açıklığı, merdivene bağlı korkuluk, eğri korkuluk, MEP, IFC içe aktarma, birlikte çalışma ve gelişmiş etkileşimli tutamaçlar.

## Yazma ilkelleri ve topoloji güvenli düzenleme (10. aşama)
Duvar bölme, birleştirme, kırpma ve uzatma **niyet komutlarıdır**; `WallSplit` gibi olay türleri yoktur. Her biri adayı düzenler ve platform **sonucu tarif eden kanonik olayları** yazar (`ElementCreated/Updated/Deleted`, `WallJoinCreated/Updated/Deleted`, `CountersSet`).

```
komut → adayı düzenle → diffToEvents(önce, aday) → verifyPlan → reducer → doğrulama → kayıt
```
* Olaylar, öncesi ve adayı karşılaştıran bir farktan **hesaplanır**; bu yüzden adaydan ayrışamaz. `verifyPlan` olayları öncesine uygular ve sonuç adayla **birebir** eşleşmiyorsa komut başarısız olur (`AUTHORING_PLAN_MISMATCH`).
* Plan yalnızca karar altyapısıdır: ikinci bir kalıcılık modeli yoktur. Türetilmiş veri (gönye, kırpılmış uç, bölgeler) asla saklanmaz.
* **Atomik:** bileşik bir düzenlemenin son doğrulaması (topoloji, mekân doluluğu, açıklık uyumu, …) başarısız olursa **hiçbir** olay yazılmaz, durum ve snapshot'lar değişmez, "applied" denetim kaydı oluşmaz.
* **Kuru çalıştırma** (`dry_run: true`) aynı karar yolunu ve tam doğrulamayı çalıştırır, hiçbir şey kaydetmez ve yapılandırılmış sonucu (`preview.summary`) ve yazılacak olay türlerini döndürür. Uygulamanın sonucu bununla aynıdır.
* **Geri alma ve tekrar:** her komut mevcut olay tabanlı geri almayla (`platform_undo`) geri alınır; elle yazılmış ters komut yoktur. Canlı durum = olaylardan yeniden kurulan durum = snapshot + kuyruk. `BIM_STATE_VERSION` (5) ve olay sürümleri değişmedi.
* Araçlar yıkıcı (governed) olarak işaretlidir; onay kipinde bir yapay zekâ çağıranı için öneri üretirler.

### Bölme (`bim_split_wall`)
`{ wall, t }` (0 < t < 1) ya da `{ wall, point }` (eksen üzerinde bir nokta; hemen `t`'ye normalize edilir).
* **Kimlik:** özgün kimlik **başlangıç** parçasında kalır, bitiş parçası sıradaki duvar kimliğini alır. Rastgelelik yoktur.
* Tip, kat, düşey niyet, yükseklik, taban ofseti, `roomBounding`, ad, özellikler ve dış yüz kaydı iki parçada da korunur. Metrajlar yeniden türetilir.
* **Topoloji aktarımı:** başlangıç uç birleşimleri yerinde kalır; bitiş uç birleşimi (ya da T-ucu) yeni duvara geçer; host üzerindeki T-birleşimleri, içinde bulundukları yarıya, **fiziksel konumlarından** yeniden hesaplanan `t` ile aktarılır. Bölme noktasında (`JOIN_TOLERANCE` içinde) bir T varsa bölme tam oraya kenetlenir ve T, yeni **üç duvarlı açık kavşağın** üyesi olur. İki yarı her zaman açıkça birleştirilir (değmek birleşmek değildir).
* **Barındırılan öğeler:** açıklıklar, kapılar ve pencereler kimliklerini ve fiziksel konumlarını korur; içinde bulundukları yarıya geçer ve `along` değeri yeniden hesaplanır. Bölme bir açıklığı **kesiyorsa** komutun tamamı `SPLIT_INTERSECTS_HOSTED_OPENING` ile reddedilir (`wallId`, `openingId`, `splitDistance`, `intervalStart`, `intervalEnd`).
* `t = 0`, `t = 1` ve yarısı `JOIN_TOLERANCE`'dan kısa kalan bölmeler `INVALID_SPLIT` ile reddedilir.

### Birleştirme (`bim_merge_walls`)
`{ walls: [a, b], primary? }`. İki duvar, tam iki üyeli bir **açık uç–uç kavşağı** ile bağlı olmalı; toplayıcı çizgi, yakınlık ya da T yetmez (`MERGE_NOT_CONNECTED`; kavşakta başka duvar varsa `MERGE_AMBIGUOUS_JUNCTION`).
* Uyumluluk (`MERGE_INCOMPATIBLE`, `field` ayrıntısıyla): aynı tip, kat, taban ofseti, `roomBounding`, yükseklik ve düşey niyet (aynı mod, kısıtlıysa aynı hedef kat); doğrusal ve devam eden geometri.
* Ad, özellik kümeleri ve dış yüz tarafı çakışıyorsa seçmek yerine `MERGE_PROPERTY_CONFLICT` verilir; çakışmayanlar birleştirilir.
* **Hayatta kalan:** `primary`, yoksa küçük kimlik. Yönünü korur (ters yönlü ikinci duvar geri eşlenir). Diğer duvar silinir.
* Dış birleşimler, T-birleşimleri (konumları korunarak yeniden parametrelenir) ve barındırılan öğeler (kimlikleri sabit) hayatta kalana aktarılır. İç kavşak kalkar.
* Bölmenin tersidir: bölüp birleştirmek modeli (kimlikler, birleşimler, barındırılan öğeler, bölge imzaları) geri getirir. Bölme noktasında T varsa üç duvarlı kavşak bilinçli olarak geri birleştirilmez.

### Kırpma ve uzatma (`bim_trim_wall`, `bim_extend_wall`)
`{ wall, endpoint, target, join = true }`. Uç, duvarın **kendi ekseni** boyunca hedef duvarın eksenindeki deterministik kesişime taşınır (`geo.lineParams`; tek kesişim formülü).
* **Kırpma:** duvar hedefi aşmalı; hedefin ötesindeki parça kalkar. **Uzatma:** hedef, ucun ötesinde olmalı.
* `join` açıkken yeni uç, aynı atomik komutta hedefe açıkça bağlanır: T-birleşimi (ya da hedefin ucuna denk geliyorsa uç–uç kavşağı). `join: false` yalnızca ucu taşır (değme; topoloji yok).
* Barındırılan açıklıklar ve T-birleşimleri fiziksel konumlarını korur (başlangıç ucu değişince `along` kaydırılır). Düzenleme bunlardan birini ortadan kaldıracaksa `WALL_EDIT_HOSTED_CONFLICT`.
* Reddedilenler (`INVALID_TRIM_TARGET` / `INVALID_EXTEND_TARGET`): paralel ya da paralelden `MITER_MIN_ANGLE_DEG` (10°) içinde hedef, ulaşmayan hedef, yanlış yön, uzatma için içeride kalan hedef, kırpma için kesişmeyen duvar, `JOIN_TOLERANCE`'dan kısa sonuç, başka kat. **Zaten birleşik bir uç** düzenlenemez (`WALL_EDIT_ENDPOINT_JOINED`): kavşak kaymasın diye önce ayırın. Bu yüzden kapalı bir oda kırpma ya da uzatmayla sessizce açılamaz; kapatma yönü desteklenir.

### Yeniden barındırma (`bim_rehost_opening`)
Açıklık ve dolgusu **tek** düzenlemede taşınır: açıklığın hostu ile dolgunun hostu hiçbir zaman ayrışmaz. `along` verilmezse eski konum değeri korunur; `keep_position: true` açıklığın dünya konumunu korur (yeni duvarın ekseni üzerinde olmalı). Sığma ve çakışma reddedilirse hiçbir şey değişmez; host duvarın silinmesi `ELEMENT_IN_USE` ile korunmaya devam eder.

### Fiziksel T-birleşimi (türetilmiş)
Kalıcı niyet temiz kalır (eksen, topoloji). Duvarın her ucu **türetilmiş bir uç koşuluyla** çözülür (`wallEnds`):

| Uç | Anlamı |
|---|---|
| `free` | birleşim yok (eski çoklu çizgi gönye ipucu varsa uygulanır) |
| `endpoint_join` | iki duvarlı kavşak (gönyeli ya da düz devam için kare) |
| `tee_branch` | T dalı: host'un **yakın yüzüne** kadar kırpılır (dal hangi taraftaysa o yüz; açılı T'de yüz doğrusu boyunca) |
| `junction_fallback` | muhafazakâr kare uç: ikiden fazla duvarlı kavşak, 10°'den sığ T ya da dalı yok edecek kadar kısa bir dal |

Host sürekli kalır. Plan, IFC ve metraj aynı ayak izini kullanır; mekân bölgeleri duvar **eksenlerinden** türediği için kırpmadan etkilenmez. `bim_get_element` temsilinde `ends` görünür.

### Sınırlar
Çok duvarlı kavşakların fiziksel kesişimi (kare uç), kavşak kaydırma, otomatik X-bölme, toplu birleştirme ve fare tutamaçları kapsam dışıdır. Yerel düzenlemeler düzenlenen duvarlara, doğrudan bağlı topolojiye ve barındırılan öğelere bakar; tam model doğrulaması önceki aşamalardaki gibi doğrusaldır (ölçekleme için uzamsal indeks ertelendi).

## Odalar ve mahaller: mekânsal elemanlar
> **GEOMETRİK ÇAKIŞMA, AÇIK DUVAR TOPOLOJİSİ OLMADAN BİR ODAYI KAPATMAZ.**
> **MEKÂN SINIRLARI TÜRETİLİR; SAKLANAN YETKİLİ ÇOKGENLER DEĞİLDİR.**

### Tek mekânsal motor, birden çok kategori
* `architecture.room` (Oda) ve `mechanical.space` (Mahal) aynı `engine: "spatial"` motorunu ve aynı eleman türünü (`kind: "spatial"`, `SP-0001` …) kullanır. Ayrı `RoomElement` / `SpaceElement` türü, olayı ya da aracı yoktur.
* Bütün mekânsal davranış `packages/bim/src/spatial.ts` içindedir. Kod `isSpatialElement`, `resolveSpatialElement` ve motor kontrolleriyle çalışır; kategoriye özgü `if` dalları yoktur. Bu, 9. aşamada mekânsal motorun genel motor mimarisine taşınmasını kolaylaştırır.
* Mekânsal elemanların tipi ya da ailesi yoktur. Kategori elemanın üzerinde saklanır ve **değiştirilemez**; bir Oda'nın Mahal'e dönüştürülmesi `INVALID_ELEMENT_UPDATE` ile reddedilir.

### Saklanan niyet, türetilen geometri
* **Saklanan:** `{ category, storey, point: [x, y] (kat yerel), number?, name?, height, vertical }`. Sınır, alan, çevre ve hacim **asla** saklanmaz.
* **Konum noktası** elemanın bölgesini belirler: geçerli sınır grafiğinde bu noktayı **içeren** sınırlı yüz, elemanın bölgesidir.
* **Durum:**
  * `bounded`: bir sınırlı bölgenin içinde;
  * `unbounded`: hiçbirinin içinde değil. Bu, olağan düzenleme sırasında oluşabilen **geçerli** bir durumdur; replay'i bozmaz. Alan, çevre ve hacim `null` döner, sahte geometri üretilmez.
* **Oluşturma:** nokta sınırlı bir bölgede değilse `SPATIAL_REGION_NOT_FOUND`; `allow_unbounded: true` ile sınırsız oluşturulabilir. Nokta tam bir sınırın üzerindeyse (ε içinde) belirsizdir ve her komutta `SPATIAL_POINT_ON_BOUNDARY` ile reddedilir.
* **Numara** isteğe bağlıdır; verilirse **kategori içinde** benzersizdir (`DUPLICATE_SPATIAL_NUMBER`). Oda 101 ile Mahal 101 birlikte olabilir. Adların benzersiz olması gerekmez.
* **Yükseklik** 5. aşamanın düşey modelini kullanır: açık `height` → sabit; `top_storey` ya da bir üst kat → kısıtlı (`height` = hedef kat kotu − taban kat kotu); üst kat yoksa 3,0 m sabit. Kat kotu değişince kısıtlı yükseklik yeniden hesaplanır. Kat değiştirmede nokta, numara, ad ve kategori korunur; imkânsız bir kısıt bütün komutu reddeder.

### Sınır grafiği
Her kat için, yalnızca o kattaki **room-bounding** duvarlardan bir planar grafik kurulur:
* **Düğümler yalnızca açık topolojiden gelir.** Bir düğüm (endpoint junction) tek bir düğümdür; bir T-ucu ile host'taki `t` noktası tek bir düğümdür. Diğer her uç kendi düğümüdür. Çakışan ama **birleştirilmemiş** uçlar ayrı kalır; topolojisi olmayan X kesişimleri düğüm oluşturmaz ve bölgeleri bölmez.
* **Kenarlar:** host duvar, T parametrelerinde **sanal olarak** bölünür (`[0, t₁, t₂, …, 1]`). Duvar elemanı hiçbir zaman bölünmez; her kenar `{ wallId, fromT, toT }` anlamsal referansını taşır.
* **Yüzler:** yarı kenar dolaşımı; her düğümde giden kenarlar **kesin** açıyla sıralanır (yarım düzlem ve `orient2d`). Yüz her zaman yarı kenarın solundadır. **Yönelim kuralı:** dış döngü saat yönünün tersine (CCW), delikler saat yönünde (CW). Her bileşenin dış yüzü (CW) sınırlı değildir ve dışarıda kalır.
* **Sarkan kollar ve köprüler:** aynı yüzde iki yönde de dolaşılan kenarlar çıkarılır. Sarkan bir duvar oda oluşturmaz; bir köprüyle bağlı iç döngü bir delik olarak ortaya çıkar.
* **Bağlantısız iç içe döngüler** (örneğin bir şaft): içindeki bölgeyi en küçük sınırlı yüzün **deliği** yapar. Halka bölge alanı = dış alan − delik alanı; şaftın içi ayrı bir bölgedir.
* Çok üyeli düğümler (derece > 2), birden çok bağlantısız blok ve L şekilli bölgeler desteklenir.
* **Bölge imzası** (`R-…`): sınır referanslarından üretilir. Aynı duvarın ardışık parçaları birleştirilir, döngüler kanonik olarak döndürülür, delikler sıralanır ve SHA-256 alınır. Duvarlar hareket ettiğinde ama topoloji aynı kaldığında imza da aynı kalır; sarkan bir T eklemek imzayı değiştirmez; topolojik bir değişiklik değiştirir. İmza bir kimlik değildir.

### Alan, çevre ve hacim
* `boundaryLocation: "wall_centerline"`: sınırlar duvar **eksenlerinden** geçer, çünkü yetkili topoloji eksenler üzerindedir. Bu bitmiş yüzey alanı **değildir**; bitmiş yüzey ya da çekirdek seçenekleri ileriye bırakılmıştır.
* **Alan** = dış döngü alanı − delik alanları.
* **Çevre** = dış döngü + delikler (`perimeter`); yalnızca dış döngü için `outerPerimeter`.
* **Hacim** = alan × yükseklik (mobilya, kiriş ya da katı çıkarma hesaba katılmaz).

### Duvar düzenlemeleri ve mekânlar
* **Duvar hareketi:** oda için hiçbir olay yazılmaz. Nokta hâlâ kapalı bir bölgedeyse oda yeni geometriyi otomatik olarak izler; geri alma eski geometriyi geri getirir.
* **Bölme eklemek:** oda, noktasının bulunduğu taraftaki küçük bölgeye geçer; diğer bölge boş bir aday olarak `bim_detect_spatial_regions` içinde görünür. Odalar asla çoğaltılmaz.
* **Bir köşeyi ayırmak ya da bir duvarı silmek:** oda `unbounded` olur. Bu bir hata değildir; aynı eleman, köşe yeniden birleştirilince yeniden `bounded` olur.
* **Tekil doluluk:** aynı kat, aynı kategori ve aynı bölgede en fazla **bir** sınırlı eleman olabilir. İki odayı tek bir bölgede birleştirecek bir komut (duvar silme, `room_bounding: false`, oda taşıma) bütünüyle `SPATIAL_REGION_OCCUPIED` ile reddedilir. Farklı kategoriler (Oda ve Mahal) aynı bölgede bulunabilir.
* **`room_bounding`** (duvar alanı): yoksa `true` anlamına gelir; eski bütün duvarlar sınırlayıcıdır. `false` olan duvarlar grafiğe girmez. Değiştirilmesi bölgeleri aday durumda yeniden türetir. Kapı ya da açıklık içeren bir duvar da mekânları ayırmaya devam eder.
* Mekânlar duvarlara saklanan bir referans tutmaz. Bu yüzden bir duvarın üzerinde oda olması silmeyi **engellemez** (`ELEMENT_IN_USE` değildir); oda yalnızca sınırsız hale gelir.

### Komşuluk
`bim_query_spatial_adjacency` tamamen türetilir:
* aynı kategoriden iki mekânın paylaştığı duvar segmentleri (`wallId` ve parametre aralıkları);
* her **kapı** için duvarın iki tarafındaki bölgeler ve mekânlar (yalnızca bir taraf sınırlıysa `exteriorSide: true`);
* **pencereler** yalnızca sınır bilgisi olarak listelenir, gezinme komşuluğu oluşturmaz.

Kapılara oda kimliği yazılmaz; sınır değişince komşuluk kendiliğinden güncellenir.

### Sorgular, plan ve IFC
* `bim_query_elements` mekânları `engine: "spatial"`, `category`, `discipline` ve `kind: "spatial"` ile filtreler. Satırlar `status`, `area`, `perimeter`, `height`, `volume`, `regionSignature` ve `boundaryWalls` içerir. `bim_get_element` ayrıca tam `spatial` bölümünü (dış döngü, delikler, sınır segmentleri, temsilî nokta) döndürür.
* `bim_detect_spatial_regions` hiçbir şeyi değiştirmez: bölgeleri, onları kimin doldurduğunu ve `include_occupied: false` ile boş adayları listeler. **Tespit, kalıcılık değildir.**
* **Plan:** sınırlı mekânlar duvarların altında dolgu olarak çizilir ve numara/ad ile etiketlenir.
* **IFC:** her mekân bir `IfcSpace` olur ve katına **`IfcRelAggregates`** ile bağlanır. Gövde, türetilmiş bölgenin (deliklerle birlikte, `IfcArbitraryProfileDefWithVoids`) yükseklik kadar ekstrüzyonudur. Değerler `INSA_Spatial` özellik setindedir: Category, Status, BoundaryLocation, Number, Area, Perimeter, Height, Volume, RegionSignature. Standart `Qto_SpaceBaseQuantities` **bilinçli olarak yazılmaz**: oradaki "net" alanlar bitmiş yüzeye göredir, eksen alanıyla karıştırılmamalıdır.
* Sınırsız bir mekân geometrisiz, yalnızca anlamsal bir `IfcSpace` olarak yazılır; proje dışa aktarımı başarısız olmaz.
* 3B görselleştirici (`.frag`), mekânları gövdesiz alır; böylece prizmalar binayı örtmez.

### Olaylar, snapshot'lar ve eski projeler
* Mekânsal elemanlar `ElementCreated` / `ElementUpdated` / `ElementDeleted` olaylarını (v2) **değiştirmeden** kullanır. Mevcut yüklerin hiçbiri yeniden yorumlanmadığı için olay sürümü artırılmadı.
* (8. aşamada; 9. aşamada 5'e yükseldi.) `BIM_STATE_VERSION` **4 olarak kaldı**: her v4 durumu, 8. aşamada anlamı birebir aynı olan geçerli bir durumdur (mekânsal eleman yok; `roomBounding` yok, yani `true`). Gerçek 7. aşama fikstürünün snapshot'ı doğrudan yüklenir ve tam replay ile birebir aynıdır (`packages/bim/test/fixtures/phase7-project`).
* Eski projelerdeki kapalı duvar döngüleri **hiçbir zaman** kendiliğinden oda olmaz. Bölgeler tespit edilebilir, ancak oda yalnızca açık bir `bim_create_spatial_elements` komutuyla oluşur.
* **Performans:** her komut, etkilenen katlar için grafiği **bir kez** kurar (O(E log E)) ve o kattaki bütün mekânları bu grafikle çözümler. Önbellek komut ya da sorgu kapsamındadır ve hiçbir zaman saklanmaz.

## Evrensel BIM Motor Mimarisi
**KATEGORİ = nesne NEDİR. MOTOR = nesne NASIL DAVRANIR.** Yeni bir BIM kategorisi yeni bir eleman türü, yeni bir doğrulayıcı, yeni bir taşıma kodu, yeni bir IFC dalı ya da yeni bir MCP aracı **gerektirmez**: mevcut bir motorun kategorisi olarak kaydedilir.

| Eksen | Sorduğu soru | Nerede |
|---|---|---|
| Kategori | Bu nesne nedir? (kalıcı kimlik, ör. `structure.column`) | `taxonomy.ts` |
| Motor | Nasıl davranır? (doğrulama, yerleşim, temsil, işlemler) | `engines/registry.ts`, `engines/*.ts` |
| Yerleşim | Nerede ve nasıl konumlanır? | motor değişkeni ve `placementOf` |
| Temsil | Geometrisi ne? (türetilir, asla saklanmaz) | `resolveElementRepresentation` |
| Parametreler | Hangi değerler ayarlanabilir? | tipler, aileler |
| İlişkiler | Neye bağlı? | `relationshipsOf` (barındırma, dolgu, birleşim, sınır) |
| IFC eşlemesi | Dışarıda ne olarak görünür? | kategorinin `ifcClass` değeri |

### Motorlar
| Motor | Durum | Değişken (`kind`) | Yerleşim | Tip ailesi | Kategoriler |
|---|---|---|---|---|---|
| `wall` | uygulanmış | `wall` | `wall_axis` | katmanlı | duvar |
| `point_component` | uygulanmış | `component` | `level_point` | bileşen | mobilya, dolap, genel model, mekanik/elektrik ekipmanı, armatürler, saha |
| `hosted_component` | uygulanmış | `hosted_component` | `host` | açıklık | kapı, pencere |
| `profile_member` | uygulanmış | `profile_member` | `member_axis` / `member_vertical` / `member_spatial_axis` | profil | kiriş, kolon, çapraz (`structure.brace`), kazık (`structure.pile`) |
| `boundary` | uygulanmış | `boundary` | `boundary` | katmanlı | döşeme (`architecture.floor`) |
| `spatial` | uygulanmış | `spatial` | `spatial_point` | — | oda, mahal |
| `void` | iç ilkel | `opening` | `host` | — | açıklık (`architecture.opening`) |
| `stair` | uygulanmış (11. aşama) | `stair` | `stair_run` | merdiven | merdiven |
| `path` | uygulanmış (11. aşama) | `path` | `path` | korkuluk | korkuluk |
| `mep_network`, `proxy` | ayrılmış | — | — | — | yok (hiçbir kategori kullanamaz) |

* Motor kaydı derin dondurulmuştur; sırası sabittir. Her motor yerleşimlerini, temsillerini, kabul ettiği tip ailelerini ve desteklediği işlemleri yayınlar (`bim_list_engines`, `bim_get_engine`). Bu **keşif verisidir**; kararı her zaman alan doğrulayıcıları verir.
* **Kayıt kuralları:** bilinmeyen ya da **ayrılmış** bir motoru, motorun desteklemediği bir yerleşimi ya da motorun tip ailesine uymayan bir tip türünü kullanan kategori kaydedilemez.
* **Motor dağıtımı tek yoldan yapılır:** eleman → `categoryIdOfElement` → kategori → motor (`engineOfElement`). Motor alanı olaylara **yazılmaz**; kategoriden çözülür.
* **Merkezi zincir kontrolü:** her eleman için Kategori → Motor → Tip → Yerleşim:
  * kategori kayıtlı;
  * kategorinin motoru, elemanın değişkeninin sahibi;
  * yerleşim kategoriye uygun;
  * tip, motorun ailesinden (aksi halde `ENGINE_TYPE_MISMATCH`) ve kategorinin kabul ettiği türden.

  Örneğin `structure.framing` kategorisinde bir döşeme tipi ya da mobilya kategorisinde bir profil üyesi oluşturulamaz.
* **Doğrulayıcı motor ailesine göre dağıtır;** her motorun doğrulayıcısı kendi modülündedir (`engines/profile-member.ts`, `boundary.ts`, `hosted.ts`; duvar `invariants.ts` ve `topology.ts`; bileşen `family.ts`; mekân `spatial.ts`). Motorlar arası değişmezler merkezde kalır: duvar ↔ açıklık, topoloji, mekân doluluğu, kat ilişkileri, kaynak bağımlılıkları.
* **Aday durum sırası (deterministik):**
  1. istenen değişiklikler;
  2. düşey kısıt senkronizasyonu;
  3. duvar topolojisi yayılımı;
  4. gönye;
  5. barındırılan elemanlar;
  6. kaynaklar;
  7. elemanlar ve bağımlıları;
  8. topoloji;
  9. mekân çözümlemesi ve doluluk;
  10. kayıt.

### Kanonik eleman modeli
`Element = Wall | ProfileMember | Boundary | Opening | HostedComponent | Component | SpatialElement`: kategori başına değil, **motor başına bir değişken**.
* **`ProfileMember`:** `{ kind: "profile_member", category, placement: "member_axis" | "member_vertical", … }`. Eksen üyeleri `start` / `end` / `z` (üst kot), düşey üyeler `at` / `height` / `baseOffset` / `rotation` taşır. Alan adları 8. aşamanın kiriş ve kolonuyla **birebir aynıdır**; yerleşim farkı güvensiz bir aritmetikle silinmemiş, küçük bir birleşim olarak korunmuştur.
* **`Boundary`:** döşemenin `outline` / `holes` / `offset` alanları ve `category`.
* **`HostedComponent`:** kapı ve pencere aynı değişkendir; fark yalnızca `category`. Duvar → Açıklık → dolgu ilişkisi, sığma, aynı kat, taşıma ve silme kuralları aynen korunmuştur.
* **Tip aileleri** bilinçli olarak genelleştirilmedi (katmanlı / profil / açıklık / bileşen); anlamları gerçekten farklıdır. Kategoriler kabul ettikleri tip türlerini **veri** olarak bildirir (`typeKinds`). Kolon ve kiriş tipleri 8. aşamadaki kurallarını korur: yalnızca kolonlarda dairesel profil vardır.
* Yerleşik tipler için **aile oluşturulmaz**; aile bir kaynak stratejisidir, evrensel bir zorunluluk değildir.

### Kategori örnekleri
Mobilya → `point_component` · Mekanik ekipman → `point_component` · Kapı → `hosted_component` · Pencere → `hosted_component` · Kiriş → `profile_member` · Kolon → `profile_member` · Döşeme → `boundary` · Oda → `spatial` · Mahal → `spatial` · Duvar → `wall`.

Kategori sayısının artması eleman türü sayısının artması demek **değildir**: ileride çapraz eleman, aşık ya da mertek gibi kategoriler `profile_member` motorunu kullanır.

### İç ilkeller
**Açıklık (`opening`, `void` motoru)** bir duvar boşluğudur: barındırılan bir bileşenin doldurabileceği bir kesim. Kullanıcıya dönük bir BIM motoru değildir; kategorisi (`architecture.opening`) yalnızca kimlik ve IFC (`IfcOpeningElement`) içindir. Her uygulama ilkelinin kullanıcıya görünen bir kategori olması gerekmez.

### Temsil ve IFC
* **Temsil:** `resolveElementRepresentation` her eleman için türetilmiş, kat yerel bir geometri tanımı verir: `wall_extrusion`, `profile_sweep`, `boundary_extrusion`, `hosted_insert`, `host_cut`, `box`, `spatial_prism`.
  * Kiriş ve kolon **aynı** `profile_sweep` tanımından çizilir: eksen süpürmesinde profil üst kenardan sarkar, düşey süpürmede döndürülmüş ayak izi kullanılır.
  * Plan ve IFC bu tanımları okur.
* **IFC'de iki sorumluluk ayrıdır:** IFC sınıfı yalnızca **kategoriden** gelir (`IfcBeam`, `IfcColumn`, `IfcSlab`, …); geometri yalnızca **motorun temsilinden** gelir. Sınıfı olmayan bir kategori aynı geometriyle `IfcBuildingElementProxy` olarak yazılır. Kapı ve pencerenin IFC öznitelik listeleri farklı olduğu için bu ayrımı IFC yazıcısı yapar, motor değil.
* 3B görselleştirici IFC'den türetildiği için ek kod gerekmez.

### Araçlar ve uyumluluk
* **Tercih edilen genel araçlar:** `bim_create_profile_members` (kategori, yerleşimi belirler), `bim_create_boundaries`, `bim_list_engines`, `bim_get_engine`.
* **Uyumluluk sarmalayıcıları:** `bim_create_beams`, `bim_create_columns` ve `bim_create_slabs` yalnızca girdiyi eşleyip **aynı** kanonik fonksiyonu çağırır; kendi doğrulama, olay ya da geometri kodları yoktur. Ürettikleri olayların genel araçlarınkiyle birebir aynı olduğu testle doğrulanır. Kapı ve pencere `bim_place_openings` ile oluşturulur ve barındırılan bileşen motorunun kurucusundan geçer.
* **`bim_update_elements`:** kanonik türleri (`profile_member`, `boundary`, `hosted_component`) ve eski türleri (`column`, `beam`, `slab`, `door`, `window`) kabul eder. Düzenlenebilir alanlar elemanın gerçek yerleşimine göre seçilir: bir kolona `z` yazılamaz, `beam` türüyle bir kolon adreslenemez.
* **Sorgular:** `bim_query_elements` ve `bim_query_types` şu filtreleri alır: `engine` (somut kimlikler ve belgelenmiş takma adlar: `component` = `point_component`; `native` = 9. aşama öncesi yerleşik grup, **kullanımdan kaldırılmış**), `category`, `discipline`, `capability`; eski `kind` değerleri kategori anlamına gelir. Her satırda `category`, `discipline` ve `engine` bulunur; sonuçlar kimliğe göre sıralıdır.
* **`bim_get_element`:** motor, normalize yerleşim (`placement_info`), ilişkiler ve türetilmiş temsil.
* Kullanım raporları ve web arayüzünün model ağacı elemanları yine tanıdık adlarıyla (`column`, `beam`, `slab`, `door`, `window`) gruplar.

### Göç politikası
* Eski olaylar disk ve veritabanında **değişmeden** kalır; hiçbir satır ya da dosya yeniden yazılmaz.
* **`ElementCreated` v2 → v3** saf bir upcaster ile çalışır: `beam` / `column` → `profile_member` (+ kategori, yerleşim), `slab` → `boundary`, `door` / `window` → `hosted_component`. Bütün alanlar aynı ad ve değerle kalır.
* **`ElementUpdated` v2'de kalır:** tarihsel yamalar aynı alan adlarını hedefler ve tür hiçbir zaman yamalanmaz. Bu yüzden eski güncelleme ve geri alma geçmişleri kanonik modele doğrudan uygulanır.
* **`BIM_STATE_VERSION` 5:** v4 snapshot'ları yok sayılır ve durum olaylardan yeniden kurulur. Snapshot'lar sıra başına **bir kez** yazılır; eski snapshot'ın yuvası doluysa `createSnapshot` bunu `written: false` ile bildirir ve yeni v5 snapshot'ı bir sonraki komutun yuvasına yazılır.
* **Kimlik önekleri** (`C-`, `B-`, `S-`, `D-`, `N-`) korunur. Kendi öneki olmayan yeni kategoriler motor varsayılanını kullanır: `PM-`, `BD-`, `HC-`. Önekler hiçbir zaman başka bir kaynakla paylaşılmaz.
* **Kanıt:** gerçek 8. aşama projesi (`packages/bim/test/fixtures/phase8-project`) ve 8. aşamanın kendi hesapladığı ölçümler ile IFC (`phase8-oracle/`). Metraj, mekân çözümlemeleri, kullanım ilişkileri ve IFC (ürün ürün) birebir aynıdır.

### Yeni bir kategori ya da motor eklemek
* **Mevcut bir motora kategori eklemek:** `taxonomy.ts` içinde bir tanım ekleyin (`engine`, `placements`, `typeKinds`, isteğe bağlı `ifcClass` ve `idKey`). Eleman türü, doğrulayıcı, taşıma, silme, sorgu ya da IFC geometrisi kodu **gerekmez** (`engines-extensibility.test.ts`).
* **Yeni bir motor eklemek:**
  1. kayda bir tanım;
  2. kendi modülünde bir değişken ve doğrulayıcı;
  3. `placementOf` / `resolveElementRepresentation` / `checkElement` dağıtımlarında birer satır;
  4. kanonik bir oluşturma fonksiyonu;
  5. kategorileri.

  Depo genelinde kategoriye özgü dallar gerekmez.

## BIM alan kuralları (değişmezler)
Eleman geçerliliğinin tek yetkili kaynağı BIM alan katmanıdır (`packages/bim/src/invariants.ts`). MCP/HTTP şemaları yalnızca girdinin biçimini denetler; anlam ve geometri kuralları çekirdekte, işlem kaydedilmeden önce uygulanır. Bu nedenle hiçbir giriş yolu (oluşturma, güncelleme, taşıma, silme, toplu işlem, asistan) bu kuralları atlayamaz.

### Birimler ve tolerans
* Birim **metre**; plan koordinatları x (doğu), y (kuzey); eleman z değerleri katına göredir.
* Tek geometri toleransı: **`GEOMETRY_EPSILON = 0,1 mm`** (`packages/bim/src/geometry.ts`). Bundan yakın iki nokta aynı nokta sayılır; bu değere eşit ya da küçük uzunluk ve ölçüler dejenere kabul edilir. Bütün geometrik karşılaştırmalar bu sabiti kullanır.
* Bütün sayılar sonlu olmalıdır: `NaN`, `Infinity` ve `-Infinity`, girdi JSON'dan gelmese bile alan katmanında reddedilir.
* **Kesin yönelim testleri:** "hangi tarafta", "doğrusal mı", "kesişiyor mu" gibi topoloji kararları [`robust-predicates`](https://github.com/mourner/robust-predicates) kütüphanesinin `orient2d` fonksiyonuyla (Shewchuk'un uyarlanabilir hassasiyetli yönelim testi) verilir; böylece kayan nokta yuvarlaması bir kararı tersine çeviremez. Kütüphane yalnızca bu düşük seviye ilke için kullanılır; tolerans politikası, çokgen ve boşluk kuralları INSA'nındır. Tolerans ayrıca mesafelere uygulanır. Bilinen bir neredeyse doğrusal test ızgarasında basit çapraz çarpım vakaların yaklaşık %18'inde yanlış işaret verirken `orient2d` hiç hata vermez (`packages/bim/test/geometry.test.ts`).
* **Segment ilişkisi:** iki segment kesin olarak `cross` (iç noktada kesişme), `overlap` (doğrusal örtüşme), `touch` (yalnızca bir uç noktada temas, T birleşimi dahil) veya `disjoint` olarak sınıflandırılır. Çokgende komşu kenarların ortak köşeyi paylaşması kesişme sayılmaz; yalnızca geri katlanma (örtüşme) reddedilir. Komşu olmayan kenarlar ise ne kesişebilir ne değebilir ne de birbirine ε'dan fazla yaklaşabilir.
* **Nokta–çokgen:** dolanım sayısı yöntemi (kesin yönelim testleriyle); herhangi bir kenara ε mesafesindeki nokta `boundary` sayılır. Bir boşluğun geçerliliği tek başına nokta–çokgen testine dayanmaz: hem sınırının dış sınırdan ε'dan uzak kalması hem de içeride olması gerekir.

### Eleman kuralları
| Eleman | Kurallar |
|---|---|
| Duvar | Uç noktalar sonlu; uzunluk > ε; yükseklik > ε; düşey niyet geçerli (kısıtlıysa hedef kat mevcut ve değer formüle eşit); taban ofseti sonlu; tip bir duvar tipi ve toplam kalınlığı > ε; gönye yönleri boş ya da birim vektör; gönyeli taban ayak izi basit bir çokgen. |
| Döşeme | Tip bir döşeme tipi ve kalınlığı > ε; ofset sonlu; dış sınır ve her boşluk basit bir çokgen; boşluk kuralları aşağıda. |
| Kolon | Konum sonlu; yükseklik > ε; taban ofseti ve dönüş sonlu; tip bir kolon tipi; profil ölçüleri > ε. |
| Kiriş | Uç noktalar sonlu; uzunluk > ε; z sonlu; tip bir kiriş tipi; profil ölçüleri > ε. |
| Açıklık | Host mevcut bir duvar ve aynı katta; genişlik ve yükseklik > ε; parapet ≥ 0; duvarın uzunluğu ve yüksekliği içinde (ε toleransla); aynı duvardaki açıklıklarla örtüşmez (kenarların değmesine izin verilir). |
| Kapı / pencere | Kendi açıklığına bağlı (açıklık mevcut, aynı duvarda, `filledBy` bu eleman); açıklık ölçüleri tipin ölçüleriyle aynı. |
| Tipler, katlar, akslar, malzemeler | Katman kalınlıkları sonlu ve ≥ 0, toplamı > ε; profil, kapı ve pencere ölçüleri > ε; kat kotu sonlu; aks uzunluğu > ε; katman ve profil malzemeleri mevcut; ad kuralları ve benzersizlik (bkz. "BIM kaynakları"). |

### Çokgen kuralları (döşeme dış sınırı ve boşlukları)
* Halkalar **açık** saklanır (kapanış noktası tekrarlanmaz). Girdide ilk noktanın tekrarı varsa yalnızca o nokta çıkarılır; başka hiçbir nokta değiştirilmez.
* En az 3 nokta; ardışık noktalar çakışmaz; noktaların hepsi aynı doğru üzerinde olamaz; komşu olmayan kenarlar birbirini kesmez ve değmez; komşu kenarlar geri katlanamaz; alan > ε × yarı çevre (tolerans altında incelmiş çokgen reddedilir). Sebep kodları: `DEGENERATE_GEOMETRY`, `SELF_INTERSECTING_POLYGON`, `INVALID_GEOMETRY`.
* **Boşluklar** (`INVALID_SLAB_HOLE`): her boşluk kendi başına geçerli bir çokgendir; dış sınırın tamamen içindedir; sınırı dış sınırı kesmez. Boşluklar birbirini kesmez, örtüşmez ve birbirini içermez. **Değmek de reddedilir:** dış sınırla ya da başka bir boşlukla kenar veya nokta paylaşan boşluk belirsiz topoloji sayılır.

### Güncelleme anlamı (`bim_update_elements`)
* Her öğe elemanın tipini belirtir: `{ id, kind, set }`. `kind` elemanın gerçek tipiyle eşleşmezse istek reddedilir. Her tipin **düzenlenebilir alanları** açıkça tanımlıdır:
  * duvar: `height` (sabit) **ya da** `top_storey` (kata kısıtlı), `base_offset, type, name, start, end`
  * döşeme: `offset, type, name, outline, holes`
  * kolon: `height` **ya da** `top_storey`, `base_offset, rotation, type, name, at`
  * kiriş: `z` (sabit) **ya da** `target_storey` (kata kısıtlı), `type, name, start, end`
  * açıklık: `along, width, height, sill`
  * kapı / pencere: `type, name, along, sill` (konum değişikliği açıklığa uygulanır; tip değişince açıklık ölçüleri tiple eşitlenir)
* Değiştirilemeyenler: `id`, `kind`, kat (bunun için `bim_reassign_storey`), `vertical` (yalnızca yukarıdaki alanlarla değişir), host ve açıklık bağlantıları, `filledBy`, türetilmiş gönye verisi (`prevDir`, `nextDir`, `exterior`) ve özellik setleri (bunlar için `bim_set_properties`). Bu alanları değiştirme denemesi `INVALID_ELEMENT_UPDATE` ile, hangi alan olduğu belirtilerek reddedilir.
* Bir duvarın uç noktası değiştirilirse o uçtaki gönye birleşimi kaldırılır (kare uç). Komşu duvarın gönyesi kendiliğinden güncellenmez.
* **Kırıcı değişiklik:** eski `{ id, set }` biçimi (tipsiz) artık kabul edilmez.
* Akış: mevcut eleman + doğrulanmış yama → aday eleman → aday proje durumunun tamamı doğrulanır → hepsi geçerliyse kaydedilir. Birden fazla öğeli bir komutta tek bir geçersiz öğe **bütün komutu** reddeder; hiçbir olay yazılmaz.

### Host ilişkileri (Duvar → Açıklık → Kapı/Pencere)
* Bir komut bir duvarı değiştirdiğinde (boy, uç nokta, yükseklik, tip, taşıma), o duvardaki açıklıklar ve onları dolduran kapı ve pencereler aday durumda yeniden doğrulanır. Biri geçersiz hale gelecekse komut `DEPENDENT_ELEMENT_INVALID` ile reddedilir; ayrıntılarda etkilenen eleman (`dependentId`) ve asıl neden (`cause`) bulunur. Duvar da bağımlıları da değişmeden kalır.
* Bir açıklık değiştiğinde aynı duvardaki diğer açıklıklarla örtüşme yeniden kontrol edilir. Silmeler bağımlılarla birlikte yapılır.

### Tarihsel olaylar
Doğrulama yalnızca **komut anında** yapılır; olay günlüğünden yeniden kurma (replay) doğrulama çalıştırmaz (olay biçimi değişiklikleri için bkz. "Olay günlüğü"). Komut anındaki kontrol yalnızca komutun değiştirdiği elemanları ve onlara bağlı olanları kapsar. Bu sayede eski kurallarla kabul edilmiş tarihsel bir eleman projenin yüklenmesini ya da ilgisiz yeni işleri engellemez. Ancak o elemana dokunan bir komut, elemanın geçerli hale getirilmesini gerektirir. `bim_validate` aracı bütün modeli tarar ve bu tür tarihsel sorunları da raporlar.

## Olay günlüğü: sürümleme, upcaster'lar ve snapshot'lar
Olay günlüğü (event log) tek doğruluk kaynağıdır. Saklanmış geçmiş hiçbir zaman yeniden yazılmaz.

### Olay sürümleme
* Her yeni olay bir **`schemaVersion`** taşır. Bu alan, olay tiplerinin ilk kez sürümlendiği aşamadan önce yazılmış olaylarda yoktur; böyle olaylar **sürüm 1** sayılır. PostgreSQL'de `schema_version` sütunu eski satırlarda boştur (NULL); dosyalar ve satırlar yeniden yazılmaz.
* Bir olay tipinin güncel sürümü **tek bir yerde**, olayı yazan modülde bildirilir: `ModuleDef.eventVersions` (BIM için `BIM_EVENT_VERSIONS`, `packages/bim/src/model.ts`; platform olayları için platform modülü). `EventRegistry` bu bildirimleri okuyan tek yerdir. Bildirilmemiş bir olay tipi yazılamaz.
* Okuma yolu: **saklanan olay → upcaster zinciri (v1 → v2 → … → güncel) → reducer**. Reducer'lar yalnızca güncel biçimi bilir; geçmişle uyumluluk upcaster katmanındadır.
* Upcaster'lar **saftır**: yalnızca olayın yüküne bakar; G/Ç, saat, rastgelelik ve proje durumu kullanmaz. Girdileri derinlemesine dondurulmuş bir kopyadır; girdiyi değiştirmeye çalışan upcaster hata verir. Reducer'lar da her zaman olayın kendi kopyasını alır, bu yüzden saklanan olay durum üzerinden değiştirilemez. Olay tipi upcaster'da değişmez; adı değişen bir olay yeni bir olay tipidir.
* Desteklenenden **yeni** bir sürüm açıkça reddedilir (`UNSUPPORTED_EVENT_VERSION`; ayrıntılarda modül, tip, saklanan ve desteklenen sürüm, sıra numarası). Tahmine dayalı okuma yapılmaz. Bildirilen bir sürüm için zincirde eksik adım varsa platform başlarken hata verir. Upcaster başarısız olursa `EVENT_UPCAST_FAILED` döner. Bu hatalar `IntegrityError` sınıfındadır (HTTP 500, güvenli mesaj).
* Olaylar katı sırayla uygulanır: her olayın sıra numarası bir öncekinin bir fazlası olmalıdır. Atlanan ya da tekrarlanan olay `EVENT_SEQUENCE_ERROR` verir.

### Gelecekte bir olay biçimini değiştirmek
Örnek: `ElementCreated` yükünde duvarlar için `h` alanı `height` olarak yeniden adlandırılacak.
```ts
// packages/bim/src/model.ts
export const BIM_EVENT_VERSIONS = { /* ... */ ElementCreated: 2 /* was 1 */ };
export const BIM_UPCASTERS: Upcaster[] = [
  { type: "ElementCreated", fromVersion: 1,
    upcast: (p) => {
      if (p.kind !== "wall" || !("h" in p)) return p;
      const { h, ...rest } = p;            // never mutate p (it is frozen)
      return { ...rest, height: h };
    } },
];
```
Reducer yalnızca yeni biçimi (`height`) bilir. Yeni yazılan olaylar `schemaVersion: 2` taşır; eski olaylar okunurken dönüştürülür. Sonraki değişiklik bir `fromVersion: 2` adımı ekler (v1 → v2 → v3). Reducer'ın ürettiği durum biçimi de değiştiyse modülün `stateVersion` değeri artırılır; böylece eski snapshot'lar yok sayılır. Gerçek bir örnek: `packages/bim/test/replay.test.ts`.

### Snapshot'lar
* **Zarf:** `snapshotVersion`, `project`, `lastSeq` (bir komutun son olayı), `lastCommandId`, `createdAt`, modüllerin durum sürümleri, modül durumları, **replay meta verisi** (platformun komut indeksi: her komutun kimliği ve `CommandApplied` sıra numarası, geri alınmış komutlar) ve kanonik JSON üzerinden SHA-256 sağlama toplamı. Fonksiyon, bağlantı, önbellek ya da görüntüleyici durumu saklanmaz. Anahtarlar sıralı yazıldığı için aynı durum her zaman aynı metni üretir.
* **Politika:** tek merkezde, `DEFAULT_SNAPSHOT_POLICY = { everyEvents: 1000, keep: 3 }` (`packages/core/src/snapshots.ts`). Son snapshot'tan bu yana en az 1000 olay işlenince yeni snapshot alınır ve proje başına en yeni 3 snapshot tutulur. `PlatformOptions.snapshotPolicy` ile değiştirilebilir ya da kapatılabilir (`false`). İstenirse `platform.createSnapshot(project)` ile elle de alınabilir.
* **Güvenli sınır:** snapshot yalnızca bir komut tamamen yazıldıktan sonra alınır (her komut depoya tek seferde, atomik olarak eklenir) ve sınır yazmadan önce olay günlüğüne karşı yeniden kontrol edilir. Yüklenirken de snapshot'tan sonraki ilk olay snapshot'ın son komutuna aitse, yani snapshot bir komutun ortasında kesilmişse, kullanılmaz.
* **Yükleme:** en yeni uyumlu snapshot + `seq > lastSeq` olan olaylar (upcast edilip uygulanır). Snapshot yoksa olay 1'den tam replay.
* **Depolar:**
  * **Bellek:** proses içi liste.
  * **Dosya:** `<INSA_DATA>/<proje>/snapshots/<lastSeq>.json`. Yazma geçici dosya → `fsync` → atomik yeniden adlandırma → dizin `fsync` sırasıyla yapılır. Dosya adları yalnızca sıra numarasından oluşur; geçici dosyalar asla snapshot olarak okunmaz.
  * **PostgreSQL:** `insa_snapshots` tablosu (`project`, `last_seq`, `snapshot_version`, `created_at`, `body`). Olay tablosuna hiç yazılmaz.
* **Kurtarma:** okunamayan, sağlama toplamı tutmayan ya da biçimi bozuk snapshot (`SNAPSHOT_CORRUPTED`) ve uyumsuz snapshot (`UNSUPPORTED_SNAPSHOT_VERSION`: farklı biçim sürümü ya da farklı modül durum sürümleri) **yok sayılır**. Sistem önce daha eski bir snapshot'a, sonra tam replay'e geçer (B seçeneği: snapshot'lar dönüştürülmez, olaylardan yeniden üretilir). Olay geçmişi hiçbir zaman silinmez.
* **Hata yalıtımı:** snapshot yazılamazsa komut yine kaydedilmiş sayılır; bu yalnızca bir hızlandırma kaybıdır ve tanılanır.
* **Tanılama:** `snapshot.loaded`, `snapshot.ignored_incompatible`, `snapshot.fallback_corrupted`, `snapshot.ignored_mid_command`, `snapshot.predates_undo_target`, `snapshot.save_failed`, `replay.failed`. Uyarılar stderr'e yazılır (MCP stdio aktarımı için güvenli); bilgi kayıtları `INSA_LOG_SNAPSHOTS=1` ile açılır ya da `PlatformOptions.logger` ile yönlendirilir.

### Geri alma ve snapshot'lar
Geri alma yığın mantığıyla çalışır: her zaman en son canlı komut geri alınır ve art arda geri alma geçmişte istenildiği kadar geriye gider. Bu davranış değişmedi. Bir snapshot, içerdiği komutların etkisini "pişmiş" halde taşır. Bu yüzden yükleme sırasında snapshot'tan sonraki olaylar içinde, **snapshot'tan önceki** (ya da snapshot'ın içindeki) bir komutu hedefleyen bir geri alma varsa o snapshot kullanılmaz. Sistem hedef komuttan önce alınmış daha eski bir snapshot arar; bulamazsa tam replay yapar. Hedef komutun sıra numarası snapshot'ın replay meta verisinden (komut indeksi) okunur. Hedef snapshot'tan sonra ise snapshot olduğu gibi kullanılır ve yalnızca kuyruk uygulanır. Sonuç olarak snapshot'lar geri alma penceresini daraltmaz; yalnızca saklanan snapshot sayısının ötesine giden derin geri almalar tam replay maliyetine döner (`keep` ile ayarlanır).

## Doğrulama
`examples/` klasöründe örnek binanın çıktıları bulunur:
* **IFC:** IfcOpenShell 0.9 şema doğrulamasından sıfır hatayla geçti. IfcOpenShell geometri motorunun hesapladığı hacimler, çekirdeğin hesabıyla 10⁻¹⁴ hassasiyetinde aynı: duvar net hacmi açıklıklar düşülmüş halde, döşeme hacmi merdiven boşluğu düşülmüş halde. Duvarların `IfcMaterialLayerSetUsage` değerine göre dış katman dış taraftadır. Kontrol betiği: `examples/validate_ifc.py`.
* **Frag:** ThatOpen'ın okuyucusuyla açıldı; geometrili 17 eleman, tipler, malzeme katmanları ve özellik setleri dosyada.
* **Plan görüntüleri:** duvarlar katman katman çizilir; dış sıva ve yalıtım dışarıda görünür.

Eleman GlobalId'leri proje ve eleman id'sinden deterministik olarak türetilir. Aynı model her dışa aktarımda aynı GUID'leri verir; bu, sürüm karşılaştırması ve BCF için gereklidir.

## Test kapsamı
Güncel test paketini çalıştırmak için `npm test` kullanılır.

### Özellik tabanlı testler (fast-check)
`packages/bim/test/properties.test.ts` geometri ve durum değişmezlerini rastgele üretilmiş girdilerle sınar: kabul edilen her duvar ve kirişin uzunluğu ε'dan büyüktür; dejenere segmentler her zaman reddedilir; dikdörtgenler geçerli ve alanları doğrudur; geçerli bir çokgenin ters çevrilmesi geçerliliği ve mutlak alanı korur; reddedilen komutlar ve toplu işlemler hiçbir şeyi değiştirmez; host'u kısaltmak açıklığı dışarıda bırakacaksa reddedilir; doğrulama ve olaylardan yeniden kurma deterministiktir. Bu testler normal `npm test` paketinin parçasıdır, sabit tohum ve sınırlı çalıştırma sayısıyla birkaç saniye sürer.
* Tohum: `FC_SEED` (varsayılan `20261007`); her testin tanı çıktısına yazılır.
* Genişletilmiş tarama: `FC_SEED=<n> FC_RUNS_FACTOR=20 node --test --import tsx packages/bim/test/properties.test.ts` (çalıştırma sayılarını 20 katına çıkarır).
* Başarısızlıkta fast-check tohumu, yolu (`path`) ve küçültülmüş karşı örneği raporlar; aynı tohum ve yol ile vaka birebir yeniden üretilebilir.
* Olay günlüğü için özellik testleri (`packages/core/test/replay-properties.test.ts`, `packages/bim/test/replay-properties.test.ts`) üretilmiş komut dizileri, rastgele snapshot politikaları ve bozulmuş snapshot'larla **tam replay = snapshot + kuyruk = canlı durum** eşitliğini sınar. Aynı `FC_SEED` / `FC_RUNS_FACTOR` değişkenleri geçerlidir.
* **Çekirdek:** yetkiler, dry-run, değişmezlik kontrolleri, öneri ve dört göz kuralı, geri alma, eşzamanlılık; gerçek PostgreSQL üzerinde iki havuz arası eşzamanlı yazma, süreçler arası onay ve `NOTIFY`.
* **BIM:** örnek bina, gönye köşeler, net hacimler, kural ihlalleri, IFC, Frag ve plan çıktıları (IFC ayrıca IfcOpenShell ile doğrulandı).
* **MCP:** gerçek stdio süreci; modelleme, plan görüntüsü, dışa aktarma, öneri, CLI onayı, roller.
* **Web API:** yetkiler, çıktılar ve önbellek; yapay zekâ önerir → insan web'den onaylar → canlı olay → geri alma.
* **Asistan:** araç şemalarının hepsi bağımsız bir JSON Schema doğrulayıcısından (Ajv) geçer. Senaryolu bir modelle şunlar doğrulandı: asistan bina kurar, plan görüntüsünü bir sonraki adımda görür, mesaj geçmişi API yapısına uygun kalır, onay modunda öneri üretir, izleyicinin asistanı yazamaz, onay araçları reddedilir. Uç nokta testinde asistanın önerisi web'den onaylanıp uygulandı.
* **Canlı deneme:** ayrı süreçlerde web sunucusu + MCP sunucusu + PostgreSQL; MCP'nin yazdıkları web'e `NOTIFY` ile anında ulaştı.
* **Gerçek Claude API ile denenmedi:** bu ortamda API anahtarı yok. Ajan döngüsü resmi SDK'nın (`@anthropic-ai/sdk` 0.131) tip tanımlarına göre yazıldı ve senaryolu modelle test edildi. İlk gerçek kullanımda modelin araç seçimi ve prompt ayarı gerekebilir.
* Web arayüzü gerçek ThatOpen tip tanımlarına karşı derleniyor ve üretim derlemesi alınıyor. **Ancak bu ortamda tarayıcı olmadığı için arayüz gerçek bir tarayıcıda çalıştırılarak denenmedi;** ilk denemede görsel/etkileşim sorunları çıkabilir.

## Sonraki aşamalar
4. Gerçek kimlik doğrulama (OIDC / Entra ID) ve proje bazlı yetkiler; sohbetlerin sunucuda saklanması
5. BIM modülünün genişletilmesi (çatı, merdiven, mahal, curtain wall, MEP), IFC içe aktarma
6. Veri yönetimi: tablolar, Excel, sınıflandırma, IDS
7. Koordinasyon: federasyon, çakışma, BCF
8. ERP modülleri: metraj/hakediş, iş programı, satınalma, doküman
