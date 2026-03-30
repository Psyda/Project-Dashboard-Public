import { useState, useEffect, useCallback, useRef } from "react";

/*
 * ICraft Work Dashboard — GitHub-backed
 *
 * Access at: yourdomain.com/#/admin
 *
 * Config is stored in localStorage. On first load, go to Settings tab
 * and enter your GitHub repo details + PAT.
 */

const DEFAULT_CONFIG = {
  owner: "",
  repo: "",
  branch: "main",
  dataPath: "data/dashboard.json",
  token: "",
  pollInterval: 300,
  workerUrl: "https://icraft-api.psyda.workers.dev",
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const currency = (n) => `$${Number(n || 0).toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const STATUS_MAP = {
  request:   { label: "Request",     bg: "#1c1917", fg: "#d6d3d1", dot: "#a8a29e", border: "#292524" },
  wip:       { label: "In Progress", bg: "#0c1222", fg: "#7dd3fc", dot: "#38bdf8", border: "#172554" },
  review:    { label: "Review",      bg: "#1a0f24", fg: "#d8b4fe", dot: "#a855f7", border: "#2e1065" },
  completed: { label: "Completed",   bg: "#071a0b", fg: "#86efac", dot: "#22c55e", border: "#14532d" },
  shelved:   { label: "Shelved",     bg: "#1a1508", fg: "#fde047", dot: "#eab308", border: "#422006" },
};

const EMPTY_DATA = {
  jobs: [],
  payments: [],
  maintenance: [],
  retainer: { monthlyHours: 40, monthlyRate: 3000, overflowRate: 85 },
};

// ── GitHub API ──
async function ghFetch(config) {
  const url = `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.branch}/${config.dataPath}?t=${Date.now()}`;
  const headers = config.token ? { Authorization: `token ${config.token}` } : {};
  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return res.json();
}

async function ghPush(config, data) {
  const metaUrl = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${config.dataPath}?ref=${config.branch}`;
  const headers = {
    Authorization: `token ${config.token}`,
    "Content-Type": "application/json",
    Accept: "application/vnd.github.v3+json",
  };
  const metaRes = await fetch(metaUrl, { headers });
  let sha = null;
  if (metaRes.ok) {
    const meta = await metaRes.json();
    sha = meta.sha;
  }
  const body = {
    message: `Dashboard update ${new Date().toISOString()}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2)))),
    branch: config.branch,
  };
  if (sha) body.sha = sha;
  const pushRes = await fetch(metaUrl, { method: "PUT", headers, body: JSON.stringify(body) });
  if (!pushRes.ok) throw new Error(`Push failed: ${pushRes.status}`);
  return true;
}

// ── Shared components ──
const mono = "'IBM Plex Mono', monospace";
const sans = "'Outfit', sans-serif";

const C = {
  bg: "#0c0a09", surface: "#1c1917", border: "#292524", hover: "#292524",
  text: "#e7e5e4", muted: "#78716c", accent: "#22c55e", warn: "#f59e0b",
  error: "#dc2626", blue: "#38bdf8", purple: "#a855f7",
};

const inputStyle = {
  width: "100%", padding: "9px 11px", borderRadius: 4,
  border: `1px solid ${C.border}`, background: C.bg, color: C.text,
  fontSize: 13, fontFamily: mono, boxSizing: "border-box", outline: "none",
};

const Field = ({ label, children, span }) => (
  <div style={{ marginBottom: 14, gridColumn: span ? `span ${span}` : undefined }}>
    <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>{label}</label>
    {children}
  </div>
);

const Btn = ({ children, onClick, color = C.text, bg = C.surface, border = C.border, style: extra, disabled }) => (
  <button onClick={onClick} disabled={disabled} style={{
    padding: "8px 16px", borderRadius: 4, border: `1px solid ${border}`,
    background: bg, color, fontSize: 12, fontFamily: mono, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, ...extra,
  }}>{children}</button>
);

const Tag = ({ status }) => {
  const s = STATUS_MAP[status] || STATUS_MAP.request;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 3, background: s.bg, color: s.fg, fontSize: 11, fontFamily: mono, fontWeight: 600, border: `1px solid ${s.border}` }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />
      {s.label}
    </span>
  );
};

const ProgressBar = ({ pct }) => (
  <div style={{ width: "100%", height: 6, borderRadius: 3, background: C.surface, overflow: "hidden", border: `1px solid ${C.border}` }}>
    <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", borderRadius: 3, background: pct > 90 ? C.error : pct > 70 ? C.warn : C.accent, transition: "width 0.4s" }} />
  </div>
);

// ── Main Dashboard ──
export default function Dashboard() {
  const [config, setConfig] = useState(() => {
    try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem("icraft-config") || "{}") }; } catch { return DEFAULT_CONFIG; }
  });
  const [data, setData] = useState(() => {
    try { return JSON.parse(localStorage.getItem("icraft-data") || "null") || EMPTY_DATA; } catch { return EMPTY_DATA; }
  });
  const [view, setView] = useState("overview");
  const [modal, setModal] = useState(null);
  const [status, setStatus] = useState({ text: "Local mode", color: C.muted });
  const [saving, setSaving] = useState(false);
  const [lastPull, setLastPull] = useState(null);
  const pollRef = useRef(null);

  const isConfigured = config.owner && config.repo && config.token;

  const saveConfig = useCallback((c) => {
    setConfig(c);
    localStorage.setItem("icraft-config", JSON.stringify(c));
  }, []);

  // Always persist locally
  const saveLocal = useCallback((d) => {
    setData(d);
    localStorage.setItem("icraft-data", JSON.stringify(d));
  }, []);

  const pull = useCallback(async () => {
    if (!isConfigured) return;
    try {
      setStatus({ text: "Pulling…", color: C.blue });
      const remote = await ghFetch(config);
      saveLocal(remote);
      setLastPull(new Date());
      setStatus({ text: "Synced", color: C.accent });
    } catch (e) {
      setStatus({ text: `Pull failed`, color: C.error });
      console.error(e);
    }
  }, [config, isConfigured, saveLocal]);

  const push = useCallback(async (newData) => {
    saveLocal(newData);
    if (!isConfigured) return;
    setSaving(true);
    try {
      setStatus({ text: "Pushing…", color: C.blue });
      await ghPush(config, newData);
      setStatus({ text: "Saved", color: C.accent });
    } catch (e) {
      setStatus({ text: `Push failed`, color: C.error });
      console.error(e);
    }
    setSaving(false);
  }, [config, isConfigured, saveLocal]);

  // Poll
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (isConfigured && config.pollInterval > 0) {
      pull();
      pollRef.current = setInterval(pull, config.pollInterval * 1000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [config.owner, config.repo, config.branch, config.token, config.pollInterval]);

  // Derived
  const jobs = data.jobs || [];
  const payments = data.payments || [];
  const maintenance = data.maintenance || [];
  const retainer = data.retainer || EMPTY_DATA.retainer;

  const currentMonth = new Date().toISOString().slice(0, 7);
  const monthHours = jobs.filter(j => j.created?.startsWith(currentMonth)).reduce((s, j) => s + (j.hours || 0), 0);
  const totalInvoiced = jobs.reduce((s, j) => s + (j.quoted || (j.hours || 0) * (j.rate || 0)), 0);
  const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
  const totalOwed = totalInvoiced - totalPaid;
  const monthlyRecurring = maintenance.reduce((s, m) => s + (m.monthly || 0), 0);
  const retainerPct = retainer.monthlyHours ? Math.round((monthHours / retainer.monthlyHours) * 100) : 0;
  const overflowHours = Math.max(0, monthHours - (retainer.monthlyHours || 0));

  // CRUD
  const saveJob = (j) => {
    const nj = [...jobs]; const idx = nj.findIndex(x => x.id === j.id);
    idx >= 0 ? nj[idx] = j : nj.push(j); push({ ...data, jobs: nj }); setModal(null);
  };
  const deleteJob = (id) => { push({ ...data, jobs: jobs.filter(j => j.id !== id) }); setModal(null); };
  const savePayment = (p) => {
    const np = [...payments]; const idx = np.findIndex(x => x.id === p.id);
    idx >= 0 ? np[idx] = p : np.push(p); push({ ...data, payments: np }); setModal(null);
  };
  const deletePayment = (id) => { push({ ...data, payments: payments.filter(p => p.id !== id) }); setModal(null); };
  const saveMaint = (m) => {
    const nm = [...maintenance]; const idx = nm.findIndex(x => x.id === m.id);
    idx >= 0 ? nm[idx] = m : nm.push(m); push({ ...data, maintenance: nm }); setModal(null);
  };
  const deleteMaint = (id) => { push({ ...data, maintenance: maintenance.filter(m => m.id !== id) }); setModal(null); };

  // Forms
  const JobForm = ({ job, isNew }) => {
    const [j, setJ] = useState({ ...job });
    return (
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
          <Field label="Job Title" span={2}><input style={inputStyle} value={j.title} onChange={e => setJ({ ...j, title: e.target.value })} placeholder="Menu Display System" /></Field>
          <Field label="Client"><input style={inputStyle} value={j.client} onChange={e => setJ({ ...j, client: e.target.value })} /></Field>
          <Field label="Store"><input style={inputStyle} value={j.store} onChange={e => setJ({ ...j, store: e.target.value })} /></Field>
          <Field label="Status" span={2}>
            <select style={{ ...inputStyle, appearance: "auto" }} value={j.status} onChange={e => setJ({ ...j, status: e.target.value })}>
              {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </Field>
          <Field label="Hours"><input style={inputStyle} type="number" step="0.5" value={j.hours} onChange={e => setJ({ ...j, hours: parseFloat(e.target.value) || 0 })} /></Field>
          <Field label="Rate ($/hr)"><input style={inputStyle} type="number" value={j.rate} onChange={e => setJ({ ...j, rate: parseFloat(e.target.value) || 0 })} /></Field>
          <Field label="Quoted Total"><input style={inputStyle} type="number" value={j.quoted} onChange={e => setJ({ ...j, quoted: parseFloat(e.target.value) || 0 })} /></Field>
          <Field label="Paid"><input style={inputStyle} type="number" value={j.paid} onChange={e => setJ({ ...j, paid: parseFloat(e.target.value) || 0 })} /></Field>
          <Field label="Created"><input style={inputStyle} type="date" value={j.created} onChange={e => setJ({ ...j, created: e.target.value })} /></Field>
          <Field label="Due"><input style={inputStyle} type="date" value={j.due} onChange={e => setJ({ ...j, due: e.target.value })} /></Field>
          <Field label="Notes" span={2}><textarea style={{ ...inputStyle, minHeight: 56, resize: "vertical", fontFamily: sans }} value={j.notes} onChange={e => setJ({ ...j, notes: e.target.value })} /></Field>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <Btn onClick={() => saveJob(j)}>Save</Btn>
          {!isNew && <Btn onClick={() => { if (confirm("Delete?")) deleteJob(j.id); }} color="#fca5a5" border="#7f1d1d">Delete</Btn>}
        </div>
      </div>
    );
  };

  const PaymentForm = ({ payment, isNew }) => {
    const [p, setP] = useState({ ...payment });
    return (
      <div>
        <Field label="Date"><input style={inputStyle} type="date" value={p.date} onChange={e => setP({ ...p, date: e.target.value })} /></Field>
        <Field label="Amount ($)"><input style={inputStyle} type="number" value={p.amount} onChange={e => setP({ ...p, amount: parseFloat(e.target.value) || 0 })} /></Field>
        <Field label="Note"><input style={inputStyle} value={p.note} onChange={e => setP({ ...p, note: e.target.value })} /></Field>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <Btn onClick={() => savePayment(p)}>Save</Btn>
          {!isNew && <Btn onClick={() => { if (confirm("Delete?")) deletePayment(p.id); }} color="#fca5a5" border="#7f1d1d">Delete</Btn>}
        </div>
      </div>
    );
  };

  const MaintForm = ({ item, isNew }) => {
    const [m, setM] = useState({ ...item });
    return (
      <div>
        <Field label="Store Name"><input style={inputStyle} value={m.store} onChange={e => setM({ ...m, store: e.target.value })} /></Field>
        <Field label="Service"><input style={inputStyle} value={m.service} onChange={e => setM({ ...m, service: e.target.value })} /></Field>
        <Field label="Monthly Fee ($)"><input style={inputStyle} type="number" value={m.monthly} onChange={e => setM({ ...m, monthly: parseFloat(e.target.value) || 0 })} /></Field>
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <Btn onClick={() => saveMaint(m)}>Save</Btn>
          {!isNew && <Btn onClick={() => { if (confirm("Delete?")) deleteMaint(m.id); }} color="#fca5a5" border="#7f1d1d">Delete</Btn>}
        </div>
      </div>
    );
  };

  const SettingsView = () => {
    const [c, setC] = useState({ ...config });
    const [r, setR] = useState({ ...retainer });
    const [testResult, setTestResult] = useState(null);
    return (
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#d6d3d1", marginBottom: 14 }}>GitHub Connection</div>
        <div style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
            <Field label="Username"><input style={inputStyle} value={c.owner} onChange={e => setC({ ...c, owner: e.target.value })} placeholder="github-username" /></Field>
            <Field label="Repo"><input style={inputStyle} value={c.repo} onChange={e => setC({ ...c, repo: e.target.value })} placeholder="icraft-data" /></Field>
            <Field label="Branch"><input style={inputStyle} value={c.branch} onChange={e => setC({ ...c, branch: e.target.value })} /></Field>
            <Field label="Data Path"><input style={inputStyle} value={c.dataPath} onChange={e => setC({ ...c, dataPath: e.target.value })} /></Field>
            <Field label="Token" span={2}><input style={inputStyle} type="password" value={c.token} onChange={e => setC({ ...c, token: e.target.value })} placeholder="ghp_xxxx" /></Field>
            <Field label="Poll Interval (sec)"><input style={inputStyle} type="number" value={c.pollInterval} onChange={e => setC({ ...c, pollInterval: parseInt(e.target.value) || 60 })} /></Field>
            <Field label="Worker URL"><input style={inputStyle} value={c.workerUrl} onChange={e => setC({ ...c, workerUrl: e.target.value })} /></Field>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Btn onClick={() => saveConfig(c)}>Save Config</Btn>
            <Btn onClick={async () => { try { setTestResult({ text: "Testing…", color: C.blue }); await ghFetch(c); setTestResult({ text: "Connected", color: C.accent }); } catch (e) { setTestResult({ text: "Failed", color: C.error }); } }} bg="#0c1222" border="#172554" color="#7dd3fc">Test</Btn>
            {testResult && <span style={{ fontSize: 11, fontFamily: mono, color: testResult.color }}>{testResult.text}</span>}
          </div>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#d6d3d1", marginBottom: 14 }}>Retainer Terms</div>
        <div style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 12px" }}>
            <Field label="Monthly Hours"><input style={inputStyle} type="number" value={r.monthlyHours} onChange={e => setR({ ...r, monthlyHours: parseInt(e.target.value) || 0 })} /></Field>
            <Field label="Monthly Rate ($)"><input style={inputStyle} type="number" value={r.monthlyRate} onChange={e => setR({ ...r, monthlyRate: parseInt(e.target.value) || 0 })} /></Field>
            <Field label="Overflow ($/hr)"><input style={inputStyle} type="number" value={r.overflowRate} onChange={e => setR({ ...r, overflowRate: parseInt(e.target.value) || 0 })} /></Field>
          </div>
          <Btn onClick={() => push({ ...data, retainer: r })} style={{ marginTop: 6 }}>Save Retainer</Btn>
        </div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#d6d3d1", marginBottom: 14 }}>Data</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn onClick={() => { const b = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "icraft-export.json"; a.click(); }}>Export</Btn>
          <Btn onClick={() => { const i = document.createElement("input"); i.type = "file"; i.accept = ".json"; i.onchange = async (e) => { try { push(JSON.parse(await e.target.files[0].text())); } catch { alert("Invalid JSON"); } }; i.click(); }}>Import</Btn>
          <Btn onClick={() => { if (confirm("Reset?")) push(EMPTY_DATA); }} color="#fca5a5" border="#7f1d1d">Reset</Btn>
        </div>
      </div>
    );
  };

  const newJob = () => setModal({ type: "job", payload: { id: uid(), title: "", client: "", store: "", status: "request", hours: 0, rate: 75, quoted: 0, paid: 0, notes: "", created: new Date().toISOString().slice(0, 10), due: "" }, isNew: true });

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh", fontFamily: sans, padding: "0 20px 40px" }}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet" />

      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: `1px solid ${C.surface}`, marginBottom: 24, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 11, fontFamily: mono, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>ICraft</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: "#d6d3d1" }}>Dashboard</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: status.color, display: "inline-block" }} />
          <span style={{ fontSize: 11, fontFamily: mono, color: C.muted }}>{status.text}</span>
          {isConfigured && <Btn onClick={pull} style={{ padding: "4px 10px", fontSize: 11 }} bg="transparent">↻ Pull</Btn>}
          {lastPull && <span style={{ fontSize: 10, fontFamily: mono, color: C.muted }}>{lastPull.toLocaleTimeString()}</span>}
        </div>
      </div>

      {/* Nav */}
      <div style={{ display: "flex", gap: 2, background: C.surface, borderRadius: 5, padding: 2, marginBottom: 24, flexWrap: "wrap" }}>
        {[["overview", "Overview"], ["jobs", "Jobs"], ["payments", "Ledger"], ["maintenance", "Recurring"], ["settings", "Settings"]].map(([k, l]) => (
          <button key={k} style={{ padding: "7px 14px", borderRadius: 4, border: "none", background: view === k ? C.hover : "transparent", color: view === k ? C.text : C.muted, fontSize: 12, fontFamily: mono, cursor: "pointer", fontWeight: view === k ? 600 : 400 }} onClick={() => setView(k)}>{l}</button>
        ))}
      </div>

      <div style={{ maxWidth: 860 }}>
        {/* Overview */}
        {view === "overview" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10, marginBottom: 24 }}>
              {[
                ["Outstanding", currency(totalOwed), totalOwed > 0 ? "#fca5a5" : C.accent],
                ["Total Paid", currency(totalPaid), C.accent],
                ["Recurring", `${currency(monthlyRecurring)}/mo`, C.purple],
                [`Hours (${new Date().toLocaleString("en", { month: "short" })})`, `${monthHours}h`, C.text],
              ].map(([label, val, color]) => (
                <div key={label} style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: "14px 16px" }}>
                  <div style={{ fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, fontFamily: mono, color, lineHeight: 1 }}>{val}</div>
                </div>
              ))}
            </div>

            {retainer.monthlyHours > 0 && (
              <div style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: "14px 16px", marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontFamily: mono, color: C.muted }}>Retainer</span>
                  <span style={{ fontSize: 12, fontFamily: mono, color: "#d6d3d1" }}>{monthHours}/{retainer.monthlyHours}h ({retainerPct}%)</span>
                </div>
                <ProgressBar pct={retainerPct} />
                {overflowHours > 0 && <div style={{ fontSize: 11, fontFamily: mono, color: "#fca5a5", marginTop: 6 }}>{overflowHours}h overflow at {currency(retainer.overflowRate)}/hr = {currency(overflowHours * retainer.overflowRate)} extra</div>}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#d6d3d1" }}>Recent</span>
              <Btn onClick={newJob}>+ Job</Btn>
            </div>
            {jobs.slice().reverse().slice(0, 6).map(j => {
              const total = j.quoted || (j.hours || 0) * (j.rate || 0);
              const owed = total - (j.paid || 0);
              return (
                <div key={j.id} style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: "14px 16px", marginBottom: 8, cursor: "pointer" }} onClick={() => setModal({ type: "job", payload: j })}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{j.title || "Untitled"}</div>
                      <div style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>{j.client}{j.store ? ` · ${j.store}` : ""}{j.hours ? ` · ${j.hours}h` : ""}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <Tag status={j.status} />
                      {owed > 0 && <div style={{ fontSize: 11, fontFamily: mono, color: "#fca5a5", marginTop: 4 }}>{currency(owed)} owed</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </>
        )}

        {/* Jobs */}
        {view === "jobs" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#d6d3d1" }}>All Jobs</span>
              <Btn onClick={newJob}>+ New Job</Btn>
            </div>
            {Object.keys(STATUS_MAP).map(st => {
              const f = jobs.filter(j => j.status === st);
              if (!f.length) return null;
              return (
                <div key={st} style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 11, fontFamily: mono, color: STATUS_MAP[st].fg, marginBottom: 8 }}>{STATUS_MAP[st].label} ({f.length})</div>
                  {f.map(j => (
                    <div key={j.id} style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: "14px 16px", marginBottom: 6, cursor: "pointer" }} onClick={() => setModal({ type: "job", payload: j })}>
                      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{j.title || "Untitled"}</div>
                          <div style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>{j.client}{j.store ? ` · ${j.store}` : ""} · {j.hours}h</div>
                        </div>
                        <span style={{ fontFamily: mono, fontSize: 13, color: "#d6d3d1" }}>{currency(j.quoted || (j.hours || 0) * (j.rate || 0))}</span>
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </>
        )}

        {/* Payments */}
        {view === "payments" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#d6d3d1" }}>Payment Ledger</span>
              <Btn onClick={() => setModal({ type: "payment", payload: { id: uid(), date: new Date().toISOString().slice(0, 10), amount: 0, note: "" }, isNew: true })}>+ Log Payment</Btn>
            </div>
            <div style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: "14px 16px", marginBottom: 16 }}>
              {[["Total Invoiced", currency(totalInvoiced), "#d6d3d1"], ["Total Received", currency(totalPaid), C.accent], ["Balance Owing", currency(totalOwed), totalOwed > 0 ? "#fca5a5" : C.accent]].map(([l, v, c], i) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: i === 2 ? `1px solid ${C.border}` : "none", marginTop: i === 2 ? 4 : 0 }}>
                  <span style={{ fontSize: 12, color: C.muted, fontWeight: i === 2 ? 700 : 400 }}>{l}</span>
                  <span style={{ fontSize: 13, fontFamily: mono, color: c, fontWeight: i === 2 ? 700 : 400 }}>{v}</span>
                </div>
              ))}
            </div>
            {payments.slice().reverse().map(p => (
              <div key={p.id} style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: "14px 16px", marginBottom: 6, cursor: "pointer" }} onClick={() => setModal({ type: "payment", payload: p })}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 13 }}>{p.note || "Payment"}</div>
                    <div style={{ fontSize: 11, fontFamily: mono, color: C.muted }}>{p.date}</div>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, fontFamily: mono, color: C.accent }}>+{currency(p.amount)}</span>
                </div>
              </div>
            ))}
          </>
        )}

        {/* Maintenance */}
        {view === "maintenance" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#d6d3d1" }}>Recurring Revenue</span>
              <Btn onClick={() => setModal({ type: "maint", payload: { id: uid(), store: "", service: "Menu Hosting + Support", monthly: 100 }, isNew: true })}>+ Add Store</Btn>
            </div>
            <div style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: "14px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Monthly Recurring</div>
              <div style={{ fontSize: 22, fontWeight: 700, fontFamily: mono, color: C.purple }}>{currency(monthlyRecurring)}<span style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}>/mo</span></div>
              <div style={{ fontSize: 11, fontFamily: mono, color: C.muted, marginTop: 4 }}>{currency(monthlyRecurring * 12)}/yr · {maintenance.length} store{maintenance.length !== 1 ? "s" : ""}</div>
            </div>
            {maintenance.map(m => (
              <div key={m.id} style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: "14px 16px", marginBottom: 6, cursor: "pointer" }} onClick={() => setModal({ type: "maint", payload: m })}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{m.store}</div>
                    <div style={{ fontSize: 11, color: C.muted }}>{m.service}</div>
                  </div>
                  <span style={{ fontSize: 14, fontWeight: 700, fontFamily: mono, color: C.purple }}>{currency(m.monthly)}<span style={{ fontSize: 11, color: C.muted, fontWeight: 400 }}>/mo</span></span>
                </div>
              </div>
            ))}
            {!maintenance.length && <div style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: 24, textAlign: "center", color: C.muted, fontSize: 13 }}>No stores yet.</div>}
          </>
        )}

        {/* Settings */}
        {view === "settings" && <SettingsView />}
      </div>

      {/* Modal */}
      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16 }} onClick={() => setModal(null)}>
          <div style={{ background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, padding: 24, width: "100%", maxWidth: 480, maxHeight: "88vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <span style={{ fontSize: 15, fontWeight: 700 }}>
                {modal.type === "job" ? (modal.isNew ? "New Job" : "Edit Job") : modal.type === "payment" ? (modal.isNew ? "Log Payment" : "Edit Payment") : (modal.isNew ? "Add Store" : "Edit Store")}
              </span>
              <Btn onClick={() => setModal(null)} bg="transparent" style={{ padding: "2px 8px" }}>✕</Btn>
            </div>
            {modal.type === "job" && <JobForm job={modal.payload} isNew={modal.isNew} />}
            {modal.type === "payment" && <PaymentForm payment={modal.payload} isNew={modal.isNew} />}
            {modal.type === "maint" && <MaintForm item={modal.payload} isNew={modal.isNew} />}
          </div>
        </div>
      )}
    </div>
  );
}
