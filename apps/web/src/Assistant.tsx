import { useEffect, useRef, useState } from "react";
import { api, AssistantEvent } from "./api";

type Item =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "tool"; id: string; name: string; state: "running" | "applied" | "proposed" | "ok" | "preview" | "error"; detail?: string; image?: string }
  | { kind: "error"; text: string };

const TOOL_TR: Record<string, string> = {
  bim_create_storeys: "Katlar", bim_create_grids: "Akslar", bim_create_types: "Tipler", bim_create_walls: "Duvarlar",
  bim_create_slabs: "Döşemeler", bim_create_columns: "Kolonlar", bim_create_beams: "Kirişler", bim_place_openings: "Kapı / pencere",
  bim_move_elements: "Taşıma", bim_update_elements: "Güncelleme", bim_set_properties: "Özellikler", bim_delete_elements: "Silme",
  bim_render_plan: "Plana bakıyor", bim_model_summary: "Modeli okuyor", bim_query_elements: "Sorgu", bim_get_element: "Eleman",
  bim_validate: "Doğrulama", bim_export_ifc: "IFC", bim_export_frag: "Frag", bim_set_project: "Proje bilgisi",
};
const STATE_TR: Record<string, string> = { running: "…", applied: "uygulandı", proposed: "onay bekliyor", ok: "tamam", preview: "önizleme", error: "hata" };
const EXAMPLES = [
  "Modelde neler var? Kısaca özetle.",
  "12x8 m dış ölçülü, 2 katlı (kat yüksekliği 3.2 m) bir yapı kur: dış duvarlar dıştan içe 2 cm sıva, 5 cm taşyünü, 19 cm tuğla, 2 cm sıva; 20 cm betonarme döşemeler; güney cephesine iki 150x150 pencere ve ortaya 100x210 kapı.",
  "Zemin kat planına bak, hatalı ya da eksik bir şey var mı?",
];

const KEY = (p: string) => `insa_chat_${p}`;

export function Assistant({ project, onProposals }: { project: string; onProposals: () => void }) {
  const [status, setStatus] = useState<{ enabled: boolean; model: string | null } | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<unknown[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { api.assistantStatus().then(setStatus).catch(() => setStatus({ enabled: false, model: null })); }, []);
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem(KEY(project)) ?? "null");
    setItems(saved?.items ?? []); setHistory(saved?.history ?? []);
  }, [project]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth" }); }, [items]);
  const save = (it: Item[], h: unknown[]) => {
    try { localStorage.setItem(KEY(project), JSON.stringify({ items: it.map((x) => (x.kind === "tool" ? { ...x, image: undefined } : x)).slice(-80), history: h })); }
    catch { /* storage full: keep in memory only */ }
  };

  const send = async (message: string) => {
    if (!message.trim() || busy) return;
    setText(""); setBusy(true);
    let list: Item[] = [...items, { kind: "user", text: message }];
    let h = history;
    setItems(list);
    const c = new AbortController(); ctrl.current = c;
    const upd = (f: (l: Item[]) => Item[]) => { list = f(list); setItems(list); };
    try {
      await api.assistant(project, message, history, (e: AssistantEvent) => {
        if (e.type === "text") upd((l) => {
          const last = l[l.length - 1];
          return last?.kind === "assistant" ? [...l.slice(0, -1), { ...last, text: last.text + e.delta }] : [...l, { kind: "assistant", text: e.delta }];
        });
        else if (e.type === "tool_call") upd((l) => [...l, { kind: "tool", id: e.id, name: e.name, state: "running" }]);
        else if (e.type === "tool_result") upd((l) => l.map((x) => (x.kind === "tool" && x.id === e.id
          ? { ...x, state: e.ok ? ((e.status as any) ?? "ok") : "error", detail: e.ok ? (e.summary ? JSON.stringify(e.summary) : undefined) : String(e.summary), image: e.image }
          : x)));
        else if (e.type === "done") h = e.messages;
        else if (e.type === "error") upd((l) => [...l, { kind: "error", text: e.message }]);
      }, c.signal);
    } catch (err) {
      if ((err as Error).name !== "AbortError") upd((l) => [...l, { kind: "error", text: (err as Error).message }]);
    }
    setHistory(h); save(list, h); setBusy(false);
  };

  if (status && !status.enabled)
    return <div className="empty-state assistant-empty"><strong>Proje asistanı henüz etkin değil</strong><p>Modeli incelemek, dosyaları yüklemek ve araçlarla çalışmak için diğer panelleri kullanabilirsiniz.</p><details><summary>Bağlantı bilgisi</summary><p>Asistan bağlantısının sunucu yöneticisi tarafından yapılandırılması gerekiyor.</p></details></div>;
  return (
    <div className="chat">
      <div className="msgs">
        {!items.length && (<div>
          <p className="muted">Modelle ilgili ne istersen yaz. Asistan senin yetkilerinle çalışır; onay modunda değişiklikleri Öneriler sekmesinde onaylarsın.</p>
          {EXAMPLES.map((x) => <button key={x} className="ghost example" onClick={() => void send(x)}>{x}</button>)}
        </div>)}
        {items.map((it, i) => {
          if (it.kind === "user") return <div key={i} className="msg user">{it.text}</div>;
          if (it.kind === "assistant") return <div key={i} className="msg bot">{it.text}</div>;
          if (it.kind === "error") return <div key={i} className="msg err">{it.text}</div>;
          return (
            <div key={i} className={`tool ${it.state}`} title={it.detail}>
              <span>{TOOL_TR[it.name] ?? it.name}</span> <span className="st">{STATE_TR[it.state] ?? it.state}</span>
              {it.state === "proposed" && <button className="link" onClick={onProposals}>Önerilere git</button>}
              {it.state === "error" && <div className="muted">{it.detail}</div>}
              {it.image && <img src={`data:image/png;base64,${it.image}`} onClick={(e) => window.open((e.target as HTMLImageElement).src)} />}
            </div>);
        })}
        <div ref={end} />
      </div>
      <div className="composer">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Örn: kuzey cephesine 3 pencere ekle"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(text); } }} />
        <div className="row">
          {busy ? <button className="ghost" onClick={() => ctrl.current?.abort()}>Durdur</button>
                : <button onClick={() => void send(text)} disabled={!text.trim()}>Gönder</button>}
          <button className="ghost" disabled={busy} onClick={() => { setItems([]); setHistory([]); localStorage.removeItem(KEY(project)); }}>Yeni sohbet</button>
          <span className="muted">{status?.model}</span>
        </div>
      </div>
    </div>
  );
}
