import { useState, useEffect, useCallback, useRef } from "react";

const WORKER_URL = "https://icraft-api.psyda.workers.dev";

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const currency = (n) => `$${Number(n || 0).toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const pct = (v, max) => max > 0 ? Math.min(100, Math.round((v / max) * 100)) : 0;

const STATUS_MAP = {
  pending:    { label: "Pending",     bg: "#1c1917", fg: "#d6d3d1", dot: "#a8a29e", border: "#292524",  order: 0 },
  accepted:   { label: "Accepted",    bg: "#0c1222", fg: "#7dd3fc", dot: "#38bdf8", border: "#172554",  order: 1 },
  in_progress:{ label: "In Progress", bg: "#0f0a1e", fg: "#d8b4fe", dot: "#a855f7", border: "#2e1065",  order: 2 },
  review:     { label: "Review",      bg: "#1a1508", fg: "#fde047", dot: "#eab308", border: "#422006",  order: 3 },
  completed:  { label: "Completed",   bg: "#071a0b", fg: "#86efac", dot: "#22c55e", border: "#14532d",  order: 4 },
  shelved:    { label: "Shelved",     bg: "#1a1508", fg: "#fde047", dot: "#78716c", border: "#292524",  order: 5 },
};

const PRIORITY_MAP = {
  low:    { label: "Low",    color: "#78716c" },
  normal: { label: "Normal", color: "#d6d3d1" },
  rush:   { label: "Rush",   color: "#f97316" },
};

const C = {
  bg: "#0c0a09", surface: "#1c1917", surface2: "#171412", border: "#292524",
  hover: "#292524", text: "#e7e5e4", text2: "#d6d3d1", muted: "#78716c",
  accent: "#22c55e", warn: "#f59e0b", error: "#dc2626", blue: "#38bdf8",
  purple: "#a855f7", orange: "#f97316",
};
const mono = "'IBM Plex Mono', monospace";
const sans = "'Outfit', sans-serif";
const fonts = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap";

const inputStyle = {
  width: "100%", padding: "9px 11px", borderRadius: 4,
  border: `1px solid ${C.border}`, background: C.bg, color: C.text,
  fontSize: 13, fontFamily: mono, boxSizing: "border-box", outline: "none",
};

// ── Micro Components ──

const Field = ({ label, children, span, hint }) => (
  <div style={{ marginBottom: 14, gridColumn: span ? `span ${span}` : undefined }}>
    <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>
      {label}
      {hint && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: 6, color: C.muted, opacity: 0.7 }}>{hint}</span>}
    </label>
    {children}
  </div>
);

const Btn = ({ children, onClick, color = C.text, bg = C.surface, border = C.border, small, disabled, style: extra }) => (
  <button onClick={onClick} disabled={disabled} style={{
    padding: small ? "5px 10px" : "8px 16px", borderRadius: 4,
    border: `1px solid ${border}`, background: bg, color,
    fontSize: small ? 11 : 12, fontFamily: mono, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1, transition: "all 0.15s", ...extra,
  }}>{children}</button>
);

const Tag = ({ status }) => {
  const s = STATUS_MAP[status] || STATUS_MAP.pending;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "3px 10px", borderRadius: 3, background: s.bg,
      color: s.fg, fontSize: 11, fontFamily: mono, fontWeight: 600,
      border: `1px solid ${s.border}`,
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot }} />
      {s.label}
    </span>
  );
};

const PriorityTag = ({ priority }) => {
  const p = PRIORITY_MAP[priority] || PRIORITY_MAP.normal;
  return (
    <span style={{ fontSize: 10, fontFamily: mono, color: p.color, fontWeight: 600, textTransform: "uppercase" }}>
      {p.label}
    </span>
  );
};

function ProgressBar({ value, height = 6, showLabel }) {
  const v = Math.min(100, Math.max(0, value || 0));
  const color = v >= 100 ? C.accent : v > 60 ? C.blue : v > 30 ? C.purple : C.muted;
  return (
    <div style={{ width: "100%" }}>
      {showLabel && (
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 10, fontFamily: mono, color: C.muted }}>Progress</span>
          <span style={{ fontSize: 10, fontFamily: mono, color: C.text }}>{v}%</span>
        </div>
      )}
      <div style={{ width: "100%", height, borderRadius: 3, background: C.bg, overflow: "hidden", border: `1px solid ${C.border}` }}>
        <div style={{ width: `${v}%`, height: "100%", borderRadius: 3, background: color, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

function PaymentBar({ paid, total }) {
  if (!total || total <= 0) return null;
  const ratio = pct(paid, total);
  const remaining = total - paid;
  const barColor = ratio >= 100 ? C.accent : ratio > 50 ? C.blue : C.warn;

  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontFamily: mono, color: C.muted }}>
          {currency(paid)} of {currency(total)} paid
        </span>
        <span style={{ fontSize: 10, fontFamily: mono, color: remaining > 0 ? "#fca5a5" : C.accent }}>
          {remaining > 0 ? `${currency(remaining)} owing` : "Paid in full"}
        </span>
      </div>
      <div style={{ width: "100%", height: 6, borderRadius: 3, background: C.bg, overflow: "hidden", border: `1px solid ${C.border}` }}>
        <div style={{ width: `${ratio}%`, height: "100%", borderRadius: 3, background: barColor, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

function DeadlineIndicator({ deadline, status }) {
  if (!deadline || status === "completed" || status === "shelved") return null;
  const now = new Date();
  const due = new Date(deadline);
  const days = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
  let color = C.muted;
  let label = `${Math.abs(days)}d`;
  if (days < 0) { color = C.error; label = `${Math.abs(days)}d overdue`; }
  else if (days <= 3) { color = C.error; label = `${days}d left`; }
  else if (days <= 7) { color = C.warn; label = `${days}d left`; }
  else { label = `${days}d left`; }

  return (
    <span style={{ fontSize: 10, fontFamily: mono, color, fontWeight: 600 }}>
      {label}
    </span>
  );
}

// ── Modal Wrapper ──
// Never closes on background click/drag. Only the X button closes.
function Modal({ title, onClose, children, width = 520 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16 }}>
      <div style={{ background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, padding: 24, width: "100%", maxWidth: width, maxHeight: "90vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
          <Btn onClick={onClose} bg="transparent" small>✕</Btn>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Toast ──
function Toast({ message, type = "info" }) {
  if (!message) return null;
  const colors = { success: C.accent, error: C.error, info: C.blue, warning: C.warn };
  return (
    <div style={{
      position: "fixed", bottom: 20, right: 20, zIndex: 1000,
      background: C.surface, border: `1px solid ${colors[type] || C.border}`,
      borderRadius: 6, padding: "10px 16px", fontFamily: mono, fontSize: 12,
      color: colors[type] || C.text, boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
    }}>
      {message}
    </div>
  );
}

// ── API helpers ──
async function api(endpoint, options = {}) {
  const { method = "GET", body, key } = options;
  const url = method === "GET" && key
    ? `${WORKER_URL}${endpoint}${endpoint.includes("?") ? "&" : "?"}key=${encodeURIComponent(key)}`
    : `${WORKER_URL}${endpoint}`;

  const config = { method, headers: { "Content-Type": "application/json" } };
  if (body) {
    const payload = { ...body };
    if (key) payload.key = key;
    config.body = JSON.stringify(payload);
  }

  const res = await fetch(url, config);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// ══════════════════════════
// MAIN DASHBOARD
// ══════════════════════════

export default function Dashboard() {
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem("icraft-admin-key") || "");
  const [keyInput, setKeyInput] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState("");
  const [userName, setUserName] = useState("");

  const [view, setView] = useState("overview");
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [modal, setModal] = useState(null);
  const [status, setStatus] = useState({ text: "Offline", color: C.muted });

  const toastTimer = useRef(null);
  const showToast = (message, type = "info") => {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  // ── Auth ──
  const authenticate = useCallback(async (key) => {
    try {
      setAuthError("");
      const data = await api("/auth", { method: "POST", body: { key } });
      if (data.success && data.admin) {
        setAdminKey(key);
        setAuthed(true);
        setUserName(data.name);
        localStorage.setItem("icraft-admin-key", key);
        return true;
      }
      // Use the key directly since api helper adds it to body
      if (data.success && !data.admin) {
        setAuthError("This key does not have admin access.");
        return false;
      }
      setAuthError("Invalid key.");
      return false;
    } catch (e) {
      setAuthError(`Connection failed: ${e.message}`);
      return false;
    }
  }, []);

  useEffect(() => { if (adminKey) authenticate(adminKey); }, []);

  const logout = () => {
    localStorage.removeItem("icraft-admin-key");
    setAdminKey(""); setAuthed(false); setKeyInput(""); setProjects([]); setClients([]);
  };

  // ── Data fetching ──
  const fetchProjects = useCallback(async () => {
    try {
      setStatus({ text: "Syncing...", color: C.blue });
      const data = await api("/projects", { key: adminKey });
      setProjects(data.projects || []);
      setStatus({ text: "Synced", color: C.accent });
    } catch (e) {
      setStatus({ text: "Sync failed", color: C.error });
      console.error(e);
    }
  }, [adminKey]);

  const fetchClients = useCallback(async () => {
    try {
      const data = await api("/clients", { key: adminKey });
      setClients(data.clients || []);
    } catch (e) {
      console.error(e);
    }
  }, [adminKey]);

  useEffect(() => {
    if (!authed) return;
    fetchProjects();
    fetchClients();
    const interval = setInterval(fetchProjects, 120000);
    return () => clearInterval(interval);
  }, [authed]);

  // ── Project actions ──
  const acceptProject = async (projectId, scope, estimatedCost, estimatedDeadline, note) => {
    try {
      await api("/project/accept", {
        method: "POST",
        body: { projectId, scope, estimatedCost, estimatedDeadline, note },
        key: adminKey,
      });
      showToast("Project accepted", "success");
      fetchProjects();
      setModal(null);
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  const updateProgress = async (projectId, updates) => {
    try {
      await api("/progress", {
        method: "POST",
        body: { projectId, ...updates },
        key: adminKey,
      });
      showToast("Updated", "success");
      fetchProjects();
      setModal(null);
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  const updateScope = async (projectId, updates) => {
    try {
      await api("/project/update-scope", {
        method: "POST",
        body: { projectId, ...updates },
        key: adminKey,
      });
      showToast("Scope updated", "success");
      fetchProjects();
      setModal(null);
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  const confirmPayment = async (projectId, paymentId, confirmed, note) => {
    try {
      await api("/payment/confirm", {
        method: "POST",
        body: { projectId, paymentId, confirmed, note },
        key: adminKey,
      });
      showToast(confirmed ? "Payment confirmed" : "Payment rejected", confirmed ? "success" : "warning");
      fetchProjects();
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  // ── Client management ──
  const addClient = async (clientName, store, role) => {
    try {
      const data = await api("/clients/add", {
        method: "POST",
        body: { clientName, store, role },
        key: adminKey,
      });
      showToast(`Client added. Key: ${data.generatedKey}`, "success");
      fetchClients();
      setModal(null);
      return data.generatedKey;
    } catch (e) {
      showToast(e.message, "error");
      return null;
    }
  };

  const editClient = async (clientKey, clientName, store, role) => {
    try {
      await api("/clients/edit", {
        method: "POST",
        body: { clientKey, clientName, store, role },
        key: adminKey,
      });
      showToast("Client updated", "success");
      fetchClients();
      setModal(null);
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  const removeClient = async (clientKey) => {
    try {
      await api("/clients/remove", {
        method: "POST",
        body: { clientKey },
        key: adminKey,
      });
      showToast("Client removed", "success");
      fetchClients();
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  // ── Computed stats ──
  const pendingCount = projects.filter(p => p.status === "pending").length;
  const activeCount = projects.filter(p => ["accepted", "in_progress", "review"].includes(p.status)).length;
  const completedCount = projects.filter(p => p.status === "completed").length;

  const totalEstimated = projects.reduce((s, p) => s + (p.estimatedCost || p.finalCost || 0), 0);
  const totalConfirmedPaid = projects.reduce((s, p) => {
    return s + (p.payments || []).filter(pay => pay.confirmed).reduce((ps, pay) => ps + pay.amount, 0);
  }, 0);
  const totalPending = projects.reduce((s, p) => {
    return s + (p.payments || []).filter(pay => !pay.confirmed && !pay.rejected).reduce((ps, pay) => ps + pay.amount, 0);
  }, 0);
  const totalOwed = totalEstimated - totalConfirmedPaid;

  const overdueProjects = projects.filter(p => {
    if (!p.estimatedDeadline || p.status === "completed" || p.status === "shelved") return false;
    return new Date(p.estimatedDeadline) < new Date();
  });

  // ══════════════════════════
  // MODALS
  // ══════════════════════════

  // Accept Project Modal
  const AcceptModal = ({ project }) => {
    const cacheKey = `icraft-accept-${project.id}`;
    const cached = (() => { try { return JSON.parse(localStorage.getItem(cacheKey) || "null"); } catch { return null; } })();

    const [scope, setScope] = useState(cached?.scope ?? ((project.scope || []).join("\n") || (project.goals || []).join("\n")));
    const [cost, setCost] = useState(cached?.cost ?? (project.estimatedCost || ""));
    const [deadline, setDeadline] = useState(cached?.deadline ?? (project.estimatedDeadline || ""));
    const [note, setNote] = useState(cached?.note ?? "");

    // Cache on every change
    useEffect(() => {
      localStorage.setItem(cacheKey, JSON.stringify({ scope, cost, deadline, note }));
    }, [scope, cost, deadline, note]);

    const clearCache = () => localStorage.removeItem(cacheKey);

    return (
      <Modal title={`Accept: ${project.title}`} onClose={() => setModal(null)} width={560}>
        <div style={{ background: C.bg, borderRadius: 6, padding: 12, marginBottom: 16, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, fontFamily: mono, color: C.muted, marginBottom: 4 }}>SUBMITTED BY</div>
          <div style={{ fontSize: 13, color: C.text }}>{project.client}{project.store ? ` · ${project.store}` : ""}</div>
          {project.details && <div style={{ fontSize: 12, color: C.muted, marginTop: 6 }}>{project.details}</div>}
          {project.goals && project.goals.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, fontFamily: mono, color: C.muted, marginBottom: 2 }}>CLIENT GOALS</div>
              {project.goals.map((g, i) => (
                <div key={i} style={{ fontSize: 12, color: C.text2, paddingLeft: 10 }}>
                  <span style={{ color: C.muted, fontFamily: mono, fontSize: 10, marginRight: 6 }}>{i + 1}.</span>{g}
                </div>
              ))}
            </div>
          )}
        </div>

        <Field label="Scope Items" hint="one per line">
          <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical", fontFamily: sans }}
            value={scope} onChange={e => setScope(e.target.value)}
            placeholder="Define the deliverables, one per line" />
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
          <Field label="Estimated Cost ($)">
            <input style={inputStyle} type="number" value={cost} onChange={e => setCost(parseFloat(e.target.value) || 0)} placeholder="0" />
          </Field>
          <Field label="Estimated Deadline">
            <input style={inputStyle} type="date" value={deadline} onChange={e => setDeadline(e.target.value)} />
          </Field>
        </div>

        <Field label="Note to Client">
          <input style={inputStyle} value={note} onChange={e => setNote(e.target.value)} placeholder="Optional message" />
        </Field>

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Btn onClick={() => { clearCache(); acceptProject(project.id, scope.split("\n").filter(Boolean), parseFloat(cost) || 0, deadline, note); }} color="#000" bg={C.accent} border={C.accent}>
            Accept Project
          </Btn>
          <Btn onClick={() => setModal(null)}>Cancel</Btn>
        </div>
      </Modal>
    );
  };

  // Project Detail / Edit Modal
  const ProjectModal = ({ project }) => {
    const [tab, setTab] = useState("overview");
    const [editStatus, setEditStatus] = useState(project.status);
    const [editProgress, setEditProgress] = useState(project.progress || 0);
    const [editNote, setEditNote] = useState("");
    const [editCost, setEditCost] = useState(project.estimatedCost || 0);
    const [editFinal, setEditFinal] = useState(project.finalCost || 0);
    const [editDeadline, setEditDeadline] = useState(project.estimatedDeadline || "");
    const [editScope, setEditScope] = useState((project.scope || []).join("\n"));

    const projectCost = project.finalCost || project.estimatedCost || 0;
    const confirmedPaid = (project.payments || []).filter(p => p.confirmed).reduce((s, p) => s + p.amount, 0);
    const pendingPayments = (project.payments || []).filter(p => !p.confirmed && !p.rejected);

    return (
      <Modal title={project.title} onClose={() => setModal(null)} width={620}>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <Tag status={project.status} />
          <PriorityTag priority={project.priority} />
          <DeadlineIndicator deadline={project.estimatedDeadline || project.deadline} status={project.status} />
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 2, background: C.bg, borderRadius: 4, padding: 2, marginBottom: 16 }}>
          {[["overview", "Overview"], ["progress", "Update"], ["scope", "Scope/Cost"], ["payments", "Payments"], ["history", "History"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              padding: "5px 12px", borderRadius: 3, border: "none",
              background: tab === k ? C.hover : "transparent",
              color: tab === k ? C.text : C.muted,
              fontSize: 11, fontFamily: mono, cursor: "pointer", fontWeight: tab === k ? 600 : 400,
            }}>{l}</button>
          ))}
        </div>

        {tab === "overview" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
              <div style={{ background: C.bg, borderRadius: 6, padding: 12, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, fontFamily: mono, color: C.muted, marginBottom: 4 }}>CLIENT</div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{project.client}</div>
                {project.store && <div style={{ fontSize: 11, color: C.muted }}>{project.store}</div>}
              </div>
              <div style={{ background: C.bg, borderRadius: 6, padding: 12, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 10, fontFamily: mono, color: C.muted, marginBottom: 4 }}>COST</div>
                <div style={{ fontSize: 13, fontWeight: 600, fontFamily: mono }}>
                  {project.finalCost ? currency(project.finalCost) : project.estimatedCost ? `~${currency(project.estimatedCost)}` : "TBD"}
                </div>
                <div style={{ fontSize: 10, color: C.muted, fontFamily: mono }}>{currency(confirmedPaid)} paid</div>
              </div>
            </div>

            <ProgressBar value={project.progress || 0} showLabel />
            {projectCost > 0 && <div style={{ marginTop: 10 }}><PaymentBar paid={confirmedPaid} total={projectCost} /></div>}

            {project.details && (
              <div style={{ marginTop: 14, fontSize: 12, color: C.muted, lineHeight: 1.6 }}>{project.details}</div>
            )}

            {(project.scope || []).length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 10, fontFamily: mono, color: C.muted, marginBottom: 6 }}>SCOPE</div>
                {project.scope.map((s, i) => (
                  <div key={i} style={{ fontSize: 12, color: C.text2, paddingLeft: 10, marginBottom: 3 }}>
                    <span style={{ color: C.muted, fontFamily: mono, fontSize: 10, marginRight: 6 }}>{i + 1}.</span>{s}
                  </div>
                ))}
              </div>
            )}

            {pendingPayments.length > 0 && (
              <div style={{ marginTop: 14, background: "#1a1508", borderRadius: 6, padding: 12, border: `1px solid ${C.warn}30` }}>
                <div style={{ fontSize: 10, fontFamily: mono, color: C.warn, marginBottom: 8, fontWeight: 600 }}>
                  PENDING PAYMENTS ({pendingPayments.length})
                </div>
                {pendingPayments.map(p => (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
                    <div>
                      <div style={{ fontSize: 12, fontFamily: mono, fontWeight: 600, color: C.warn }}>{currency(p.amount)}</div>
                      <div style={{ fontSize: 10, color: C.muted }}>{p.markedBy} · {new Date(p.markedAt).toLocaleDateString()}{p.method ? ` · ${p.method}` : ""}</div>
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>
                      <Btn small onClick={() => confirmPayment(project.id, p.id, true)} color="#000" bg={C.accent} border={C.accent}>Confirm</Btn>
                      <Btn small onClick={() => confirmPayment(project.id, p.id, false)} color="#fca5a5" border="#7f1d1d">Reject</Btn>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "progress" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
              <Field label="Status">
                <select style={{ ...inputStyle, appearance: "auto" }} value={editStatus} onChange={e => setEditStatus(e.target.value)}>
                  {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </Field>
              <Field label="Progress %">
                <input style={inputStyle} type="number" min="0" max="100" value={editProgress} onChange={e => setEditProgress(parseInt(e.target.value) || 0)} />
              </Field>
            </div>

            <div style={{ marginBottom: 14 }}>
              <ProgressBar value={editProgress} height={8} />
            </div>

            <Field label="Update Note">
              <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical", fontFamily: sans }}
                value={editNote} onChange={e => setEditNote(e.target.value)}
                placeholder="What changed? This note is visible to the client." />
            </Field>

            <Btn onClick={() => updateProgress(project.id, { status: editStatus, progress: editProgress, update: editNote || undefined })}>
              Save Update
            </Btn>
          </div>
        )}

        {tab === "scope" && (
          <div>
            <Field label="Scope Items" hint="one per line">
              <textarea style={{ ...inputStyle, minHeight: 80, resize: "vertical", fontFamily: sans }}
                value={editScope} onChange={e => setEditScope(e.target.value)} />
            </Field>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0 12px" }}>
              <Field label="Estimated ($)">
                <input style={inputStyle} type="number" value={editCost} onChange={e => setEditCost(parseFloat(e.target.value) || 0)} />
              </Field>
              <Field label="Final ($)">
                <input style={inputStyle} type="number" value={editFinal} onChange={e => setEditFinal(parseFloat(e.target.value) || 0)} />
              </Field>
              <Field label="Deadline">
                <input style={inputStyle} type="date" value={editDeadline} onChange={e => setEditDeadline(e.target.value)} />
              </Field>
            </div>

            <Btn onClick={() => updateScope(project.id, {
              scope: editScope.split("\n").filter(Boolean),
              estimatedCost: editCost,
              finalCost: editFinal || undefined,
              estimatedDeadline: editDeadline || undefined,
            })}>
              Save Scope
            </Btn>
          </div>
        )}

        {tab === "payments" && (
          <div>
            <PaymentBar paid={confirmedPaid} total={projectCost} />

            <div style={{ marginTop: 14 }}>
              {(project.payments || []).length === 0 && (
                <div style={{ fontSize: 12, color: C.muted, textAlign: "center", padding: 20 }}>No payments recorded yet.</div>
              )}
              {(project.payments || []).map(p => (
                <div key={p.id} style={{
                  background: C.bg, borderRadius: 6, padding: 12, marginBottom: 8,
                  border: `1px solid ${p.confirmed ? `${C.accent}30` : p.rejected ? `${C.error}30` : `${C.warn}30`}`,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <span style={{ fontSize: 14, fontFamily: mono, fontWeight: 700, color: C.text }}>{currency(p.amount)}</span>
                      <span style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>{p.method || ""}</span>
                    </div>
                    <span style={{
                      fontSize: 10, fontFamily: mono, fontWeight: 600,
                      color: p.confirmed ? C.accent : p.rejected ? C.error : C.warn,
                      padding: "2px 8px", borderRadius: 3,
                      background: p.confirmed ? `${C.accent}15` : p.rejected ? `${C.error}15` : `${C.warn}15`,
                    }}>
                      {p.confirmed ? "CONFIRMED" : p.rejected ? "REJECTED" : "PENDING"}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: C.muted, fontFamily: mono, marginTop: 4 }}>
                    Marked by {p.markedBy} on {new Date(p.markedAt).toLocaleDateString()}
                    {p.confirmedAt && ` · ${p.confirmed ? "Confirmed" : "Rejected"} ${new Date(p.confirmedAt).toLocaleDateString()}`}
                  </div>
                  {p.note && <div style={{ fontSize: 11, color: C.text2, marginTop: 4 }}>{p.note}</div>}
                  {!p.confirmed && !p.rejected && (
                    <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
                      <Btn small onClick={() => confirmPayment(project.id, p.id, true)} color="#000" bg={C.accent} border={C.accent}>Confirm</Btn>
                      <Btn small onClick={() => confirmPayment(project.id, p.id, false)} color="#fca5a5" border="#7f1d1d">Reject</Btn>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === "history" && (
          <div>
            <div style={{ fontSize: 11, color: C.muted, fontFamily: mono, marginBottom: 6 }}>
              Submitted {new Date(project.submitted).toLocaleDateString()}
              {project.acceptedAt && ` · Accepted ${new Date(project.acceptedAt).toLocaleDateString()}`}
            </div>

            {(project.updates || []).slice().reverse().map((u, i) => (
              <div key={i} style={{ marginBottom: 8, paddingLeft: 12, borderLeft: `2px solid ${C.border}` }}>
                <div style={{ fontSize: 10, fontFamily: mono, color: C.muted }}>{new Date(u.timestamp).toLocaleString()}</div>
                <div style={{ fontSize: 12, color: C.text2 }}>{u.message}</div>
              </div>
            ))}

            {(!project.updates || project.updates.length === 0) && (
              <div style={{ fontSize: 12, color: C.muted, textAlign: "center", padding: 20 }}>No updates yet.</div>
            )}
          </div>
        )}
      </Modal>
    );
  };

  // Add Client Modal
  const AddClientModal = () => {
    const cacheKey = "icraft-add-client";
    const cached = (() => { try { return JSON.parse(localStorage.getItem(cacheKey) || "null"); } catch { return null; } })();

    const [name, setName] = useState(cached?.name ?? "");
    const [store, setStore] = useState(cached?.store ?? "");
    const [role, setRole] = useState(cached?.role ?? "client");
    const [generatedKey, setGeneratedKey] = useState(null);

    useEffect(() => {
      if (!generatedKey) localStorage.setItem(cacheKey, JSON.stringify({ name, store, role }));
    }, [name, store, role]);

    const clearCache = () => localStorage.removeItem(cacheKey);

    return (
      <Modal title="Add Client" onClose={() => setModal(null)}>
        {generatedKey ? (
          <div>
            <div style={{ fontSize: 13, color: C.accent, marginBottom: 12 }}>Client created successfully.</div>
            <Field label="Client Key">
              <div style={{
                ...inputStyle, background: C.bg, cursor: "pointer", wordBreak: "break-all",
                border: `1px solid ${C.accent}40`,
              }} onClick={() => { navigator.clipboard.writeText(generatedKey); showToast("Key copied", "success"); }}>
                {generatedKey}
              </div>
            </Field>
            <div style={{ fontSize: 11, color: C.warn, fontFamily: mono }}>
              Copy this key now. It will not be shown again in full.
            </div>
            <Btn onClick={() => { clearCache(); setModal(null); }} style={{ marginTop: 12 }}>Done</Btn>
          </div>
        ) : (
          <div>
            <Field label="Client Name">
              <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Business or person name" autoFocus />
            </Field>
            <Field label="Store / Location">
              <input style={inputStyle} value={store} onChange={e => setStore(e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Role">
              <select style={{ ...inputStyle, appearance: "auto" }} value={role} onChange={e => setRole(e.target.value)}>
                <option value="client">Client</option>
                <option value="admin">Admin</option>
              </select>
            </Field>
            <Btn onClick={async () => { const k = await addClient(name, store, role); if (k) { clearCache(); setGeneratedKey(k); } }} disabled={!name.trim()}>
              Create Client
            </Btn>
          </div>
        )}
      </Modal>
    );
  };

  // Edit Client Modal
  const EditClientModal = ({ client }) => {
    const [name, setName] = useState(client.name);
    const [store, setStore] = useState(client.store);
    const [role, setRole] = useState(client.role);
    const [showKey, setShowKey] = useState(false);

    return (
      <Modal title={`Edit: ${client.name}`} onClose={() => setModal(null)}>
        <Field label="Client Name">
          <input style={inputStyle} value={name} onChange={e => setName(e.target.value)} />
        </Field>
        <Field label="Store / Location">
          <input style={inputStyle} value={store} onChange={e => setStore(e.target.value)} />
        </Field>
        <Field label="Role">
          <select style={{ ...inputStyle, appearance: "auto" }} value={role} onChange={e => setRole(e.target.value)}>
            <option value="client">Client</option>
            <option value="admin">Admin</option>
          </select>
        </Field>
        <Field label="Access Key">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ ...inputStyle, flex: 1, fontSize: 11, cursor: "pointer", wordBreak: "break-all" }}
              onClick={() => { navigator.clipboard.writeText(client.fullKey); showToast("Key copied", "success"); }}>
              {showKey ? client.fullKey : client.key}
            </div>
            <Btn small onClick={() => setShowKey(!showKey)}>{showKey ? "Hide" : "Show"}</Btn>
          </div>
        </Field>

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Btn onClick={() => editClient(client.fullKey, name, store, role)} disabled={!name.trim()}>Save</Btn>
          <Btn onClick={() => { if (confirm(`Remove ${client.name}? This cannot be undone.`)) { removeClient(client.fullKey); setModal(null); } }} color="#fca5a5" border="#7f1d1d">
            Remove Client
          </Btn>
        </div>
      </Modal>
    );
  };

  // ══════════════════════════
  // AUTH SCREEN
  // ══════════════════════════

  if (!authed) {
    return (
      <div style={{ background: C.bg, color: C.text, fontFamily: sans, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <link href={fonts} rel="stylesheet" />
        <div style={{ width: "100%", maxWidth: 380 }}>
          <div style={{ fontSize: 11, fontFamily: mono, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6 }}>ICraft Creative Solutions</div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 6 }}>Admin Dashboard</h1>
          <p style={{ fontSize: 13, color: C.muted, marginBottom: 28 }}>Enter your admin key to continue.</p>
          <Field label="Admin Key">
            <input style={inputStyle} type="password" value={keyInput}
              onChange={e => setKeyInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") authenticate(keyInput); }}
              placeholder="your-admin-key" autoFocus />
          </Field>
          <button onClick={() => authenticate(keyInput)} style={{
            width: "100%", padding: "12px", borderRadius: 4, border: `1px solid ${C.border}`,
            background: C.surface, color: C.text, fontSize: 13, fontFamily: mono, fontWeight: 600, cursor: "pointer",
          }}>Authenticate</button>
          {authError && <div style={{ marginTop: 12, fontSize: 12, fontFamily: mono, color: C.error, textAlign: "center" }}>{authError}</div>}
        </div>
      </div>
    );
  }

  // ══════════════════════════
  // MAIN LAYOUT
  // ══════════════════════════

  const navItems = [
    ["overview", "Overview"],
    ["projects", "Projects"],
    ["clients", "Clients"],
    ["payments", "Payments"],
  ];

  // Group projects by status for the board view
  const projectsByStatus = {};
  for (const st of Object.keys(STATUS_MAP)) {
    projectsByStatus[st] = projects.filter(p => p.status === st);
  }

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: "100vh", fontFamily: sans, padding: "0 20px 40px" }}>
      <link href={fonts} rel="stylesheet" />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: `1px solid ${C.surface}`, marginBottom: 24, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 11, fontFamily: mono, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>ICraft</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: C.text2 }}>Dashboard</span>
          <span style={{ fontSize: 11, fontFamily: mono, color: C.muted }}>({userName})</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: status.color, display: "inline-block" }} />
          <span style={{ fontSize: 11, fontFamily: mono, color: C.muted }}>{status.text}</span>
          <Btn onClick={fetchProjects} small bg="transparent">↻ Sync</Btn>
          <Btn onClick={logout} small bg="transparent" color={C.muted}>Sign Out</Btn>
        </div>
      </div>

      {/* Nav */}
      <div style={{ display: "flex", gap: 2, background: C.surface, borderRadius: 5, padding: 2, marginBottom: 24, maxWidth: 500 }}>
        {navItems.map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} style={{
            padding: "7px 14px", borderRadius: 4, border: "none",
            background: view === k ? C.hover : "transparent",
            color: view === k ? C.text : C.muted,
            fontSize: 12, fontFamily: mono, cursor: "pointer", fontWeight: view === k ? 600 : 400,
            position: "relative",
          }}>
            {l}
            {k === "projects" && pendingCount > 0 && (
              <span style={{ position: "absolute", top: 2, right: 4, width: 6, height: 6, borderRadius: "50%", background: C.warn }} />
            )}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 960 }}>

        {/* ══════ OVERVIEW ══════ */}
        {view === "overview" && (
          <div>
            {/* Stat Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 24 }}>
              {[
                ["Pending", pendingCount, C.warn, pendingCount > 0],
                ["Active", activeCount, C.purple, false],
                ["Completed", completedCount, C.accent, false],
                ["Outstanding", currency(totalOwed > 0 ? totalOwed : 0), totalOwed > 0 ? "#fca5a5" : C.accent, totalOwed > 0],
                ["Confirmed Paid", currency(totalConfirmedPaid), C.accent, false],
                ["Unconfirmed", currency(totalPending), totalPending > 0 ? C.warn : C.muted, totalPending > 0],
              ].map(([label, val, color, alert]) => (
                <div key={label} style={{
                  background: C.surface, borderRadius: 6,
                  border: `1px solid ${alert ? `${color}30` : C.border}`,
                  padding: "14px 16px",
                }}>
                  <div style={{ fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, fontFamily: mono, color, lineHeight: 1 }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Overdue Alert */}
            {overdueProjects.length > 0 && (
              <div style={{ background: "#1a0a0a", borderRadius: 6, border: `1px solid ${C.error}30`, padding: "12px 16px", marginBottom: 16 }}>
                <div style={{ fontSize: 10, fontFamily: mono, color: C.error, fontWeight: 600, marginBottom: 6 }}>
                  OVERDUE ({overdueProjects.length})
                </div>
                {overdueProjects.map(p => (
                  <div key={p.id} style={{ fontSize: 12, color: C.text2, marginBottom: 4, cursor: "pointer" }}
                    onClick={() => setModal({ type: "project", payload: p })}>
                    {p.title} · <DeadlineIndicator deadline={p.estimatedDeadline} status={p.status} />
                  </div>
                ))}
              </div>
            )}

            {/* Pending Requests */}
            {projectsByStatus.pending.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text2, marginBottom: 12 }}>New Requests</div>
                {projectsByStatus.pending.map(p => (
                  <div key={p.id} style={{
                    background: C.surface, borderRadius: 6, border: `1px solid ${C.warn}25`,
                    padding: "14px 16px", marginBottom: 8,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{p.title}</div>
                        <div style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>
                          {p.client}{p.store ? ` · ${p.store}` : ""} · {new Date(p.submitted).toLocaleDateString()}
                        </div>
                        {p.details && <div style={{ fontSize: 12, color: C.muted, marginTop: 4, maxHeight: 40, overflow: "hidden" }}>{p.details}</div>}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <PriorityTag priority={p.priority} />
                        <Btn small onClick={() => setModal({ type: "accept", payload: p })} color="#000" bg={C.accent} border={C.accent}>
                          Accept
                        </Btn>
                        <Btn small onClick={() => setModal({ type: "project", payload: p })}>View</Btn>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Active Projects */}
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text2, marginBottom: 12 }}>Active Projects</div>
            {projects.filter(p => ["accepted", "in_progress", "review"].includes(p.status)).map(p => {
              const cost = p.finalCost || p.estimatedCost || 0;
              const paid = (p.payments || []).filter(pay => pay.confirmed).reduce((s, pay) => s + pay.amount, 0);
              return (
                <div key={p.id} style={{
                  background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`,
                  padding: "14px 16px", marginBottom: 8, cursor: "pointer",
                }} onClick={() => setModal({ type: "project", payload: p })}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{p.title}</div>
                      <div style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>
                        {p.client}{p.store ? ` · ${p.store}` : ""}
                        {cost > 0 ? ` · ${currency(cost)}` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <DeadlineIndicator deadline={p.estimatedDeadline || p.deadline} status={p.status} />
                      <Tag status={p.status} />
                    </div>
                  </div>
                  <ProgressBar value={p.progress || 0} />
                  {cost > 0 && <div style={{ marginTop: 6 }}><PaymentBar paid={paid} total={cost} /></div>}
                </div>
              );
            })}

            {projects.filter(p => ["accepted", "in_progress", "review"].includes(p.status)).length === 0 && (
              <div style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: 24, textAlign: "center", color: C.muted, fontSize: 13 }}>
                No active projects.
              </div>
            )}
          </div>
        )}

        {/* ══════ PROJECTS (ALL) ══════ */}
        {view === "projects" && (
          <div>
            {Object.entries(STATUS_MAP).map(([st, info]) => {
              const group = projectsByStatus[st];
              if (!group || group.length === 0) return null;
              return (
                <div key={st} style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 12, fontFamily: mono, color: info.fg, marginBottom: 10, fontWeight: 600 }}>
                    {info.label} ({group.length})
                  </div>
                  {group.map(p => {
                    const cost = p.finalCost || p.estimatedCost || 0;
                    const paid = (p.payments || []).filter(pay => pay.confirmed).reduce((s, pay) => s + pay.amount, 0);
                    const pendingPay = (p.payments || []).filter(pay => !pay.confirmed && !pay.rejected).length;
                    return (
                      <div key={p.id} style={{
                        background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`,
                        padding: "14px 16px", marginBottom: 8, cursor: "pointer",
                      }} onClick={() => setModal({ type: st === "pending" ? "accept" : "project", payload: p })}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{p.title}</div>
                            <div style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>
                              {p.client}{p.store ? ` · ${p.store}` : ""}
                              {cost > 0 ? ` · ${currency(cost)}` : ""}
                              {p.hours ? ` · ${p.hours}h` : ""}
                            </div>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                            {pendingPay > 0 && (
                              <span style={{ fontSize: 10, fontFamily: mono, color: C.warn, background: `${C.warn}15`, padding: "2px 6px", borderRadius: 3 }}>
                                {pendingPay} payment{pendingPay > 1 ? "s" : ""}
                              </span>
                            )}
                            <DeadlineIndicator deadline={p.estimatedDeadline || p.deadline} status={p.status} />
                            <PriorityTag priority={p.priority} />
                          </div>
                        </div>
                        {(p.progress > 0 || st === "in_progress") && (
                          <div style={{ marginTop: 8 }}><ProgressBar value={p.progress || 0} /></div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* ══════ CLIENTS ══════ */}
        {view === "clients" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.text2 }}>Clients ({clients.length})</span>
              <Btn onClick={() => setModal({ type: "addClient" })}>+ Add Client</Btn>
            </div>

            {clients.map(c => {
              const clientProjects = projects.filter(p => p.client === c.name);
              const active = clientProjects.filter(p => ["accepted", "in_progress", "review"].includes(p.status)).length;
              return (
                <div key={c.fullKey} style={{
                  background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`,
                  padding: "14px 16px", marginBottom: 8, cursor: "pointer",
                }} onClick={() => setModal({ type: "editClient", payload: c })}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 2 }}>
                        {c.name}
                        {c.role === "admin" && (
                          <span style={{ fontSize: 10, fontFamily: mono, color: C.warn, marginLeft: 8, padding: "2px 6px", borderRadius: 3, border: `1px solid ${C.warn}30` }}>ADMIN</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>
                        {c.store || "No store"} · {c.key}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 12, fontFamily: mono, color: C.text2 }}>{clientProjects.length} project{clientProjects.length !== 1 ? "s" : ""}</div>
                      {active > 0 && <div style={{ fontSize: 10, fontFamily: mono, color: C.purple }}>{active} active</div>}
                    </div>
                  </div>
                </div>
              );
            })}

            {clients.length === 0 && (
              <div style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: 24, textAlign: "center", color: C.muted, fontSize: 13 }}>
                No clients yet.
              </div>
            )}
          </div>
        )}

        {/* ══════ PAYMENTS ══════ */}
        {view === "payments" && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.text2, marginBottom: 16 }}>All Payments</div>

            {/* Summary */}
            <div style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: "14px 16px", marginBottom: 16 }}>
              {[
                ["Total Estimated", currency(totalEstimated), C.text2],
                ["Confirmed Received", currency(totalConfirmedPaid), C.accent],
                ["Pending Confirmation", currency(totalPending), totalPending > 0 ? C.warn : C.muted],
                ["Outstanding", currency(totalOwed > 0 ? totalOwed : 0), totalOwed > 0 ? "#fca5a5" : C.accent],
              ].map(([l, v, c], i) => (
                <div key={l} style={{
                  display: "flex", justifyContent: "space-between", padding: "6px 0",
                  borderTop: i === 3 ? `1px solid ${C.border}` : "none",
                  marginTop: i === 3 ? 4 : 0,
                }}>
                  <span style={{ fontSize: 12, color: C.muted, fontWeight: i === 3 ? 700 : 400 }}>{l}</span>
                  <span style={{ fontSize: 13, fontFamily: mono, color: c, fontWeight: i === 3 ? 700 : 400 }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Per-project payments */}
            {projects.filter(p => (p.payments || []).length > 0 || (p.finalCost || p.estimatedCost)).map(p => {
              const cost = p.finalCost || p.estimatedCost || 0;
              const paid = (p.payments || []).filter(pay => pay.confirmed).reduce((s, pay) => s + pay.amount, 0);
              const pending = (p.payments || []).filter(pay => !pay.confirmed && !pay.rejected);
              return (
                <div key={p.id} style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: "14px 16px", marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{p.title}</div>
                      <div style={{ fontSize: 11, color: C.muted, fontFamily: mono }}>{p.client}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 13, fontFamily: mono, fontWeight: 600, color: C.text }}>{currency(cost)}</div>
                      <Tag status={p.status} />
                    </div>
                  </div>
                  {cost > 0 && <PaymentBar paid={paid} total={cost} />}

                  {pending.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      {pending.map(pay => (
                        <div key={pay.id} style={{
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          padding: "6px 10px", marginTop: 4, borderRadius: 4,
                          background: `${C.warn}10`, border: `1px solid ${C.warn}20`,
                        }}>
                          <div>
                            <span style={{ fontSize: 12, fontFamily: mono, fontWeight: 600, color: C.warn }}>{currency(pay.amount)}</span>
                            <span style={{ fontSize: 10, color: C.muted, marginLeft: 6 }}>{pay.markedBy} · {new Date(pay.markedAt).toLocaleDateString()}</span>
                          </div>
                          <div style={{ display: "flex", gap: 4 }}>
                            <Btn small onClick={() => confirmPayment(p.id, pay.id, true)} color="#000" bg={C.accent} border={C.accent}>Confirm</Btn>
                            <Btn small onClick={() => confirmPayment(p.id, pay.id, false)} color="#fca5a5" border="#7f1d1d">Reject</Btn>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* Modals */}
      {modal?.type === "accept" && <AcceptModal project={modal.payload} />}
      {modal?.type === "project" && <ProjectModal project={modal.payload} />}
      {modal?.type === "addClient" && <AddClientModal />}
      {modal?.type === "editClient" && <EditClientModal client={modal.payload} />}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}