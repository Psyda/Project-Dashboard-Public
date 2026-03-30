import { useState, useEffect, useCallback, useRef } from "react";

/*
 * ICraft Client Portal (v5)
 *
 * What the client sees:
 * 1. Login with their key, greeted by name
 * 2. Submit new project requests
 * 3. View ONLY their projects (filtered server-side)
 * 4. See progress, scope, cost estimates, deadlines
 * 5. Mark payments as sent (admin confirms separately)
 * 6. View payment history and update timeline
 */

const WORKER_URL = "https://icraft-api.psyda.workers.dev";

const currency = (n) => `$${Number(n || 0).toLocaleString("en-CA", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const STATUS_STYLE = {
  pending:     { label: "Pending",     color: "#a8a29e", bg: "#1c1917", border: "#292524" },
  accepted:    { label: "Accepted",    color: "#38bdf8", bg: "#0c1222", border: "#172554" },
  in_progress: { label: "In Progress", color: "#a855f7", bg: "#0f0a1e", border: "#2e1065" },
  review:      { label: "Review",      color: "#fbbf24", bg: "#1a1508", border: "#422006" },
  completed:   { label: "Completed",   color: "#22c55e", bg: "#071a0b", border: "#14532d" },
  shelved:     { label: "Shelved",     color: "#78716c", bg: "#1c1917", border: "#292524" },
};

const PRIORITY_MAP = {
  low:    { label: "Low",    color: "#78716c" },
  normal: { label: "Normal", color: "#d6d3d1" },
  rush:   { label: "Rush",   color: "#f97316" },
};

const C = {
  bg: "#0c0a09", surface: "#1c1917", border: "#292524", hover: "#292524",
  text: "#e7e5e4", text2: "#d6d3d1", muted: "#78716c",
  accent: "#22c55e", warn: "#f59e0b", error: "#dc2626",
  blue: "#38bdf8", purple: "#a855f7",
};
const mono = "'IBM Plex Mono', monospace";
const sans = "'Outfit', sans-serif";
const fonts = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap";

const inputBase = {
  width: "100%", padding: "10px 12px", borderRadius: 4,
  border: `1px solid ${C.border}`, background: C.bg, color: C.text,
  fontSize: 13, fontFamily: mono, boxSizing: "border-box", outline: "none",
  transition: "border-color 0.15s",
};

// ── Micro Components ──

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
      <div style={{ width: "100%", height, borderRadius: 3, background: C.surface, overflow: "hidden", border: `1px solid ${C.border}` }}>
        <div style={{ width: `${v}%`, height: "100%", borderRadius: 3, background: color, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

function PaymentBar({ paid, total }) {
  if (!total || total <= 0) return null;
  const ratio = Math.min(100, Math.round((paid / total) * 100));
  const remaining = total - paid;
  const barColor = ratio >= 100 ? C.accent : ratio > 50 ? C.blue : C.warn;
  return (
    <div style={{ width: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontFamily: mono, color: C.muted }}>{currency(paid)} of {currency(total)}</span>
        <span style={{ fontSize: 10, fontFamily: mono, color: remaining > 0 ? "#fca5a5" : C.accent }}>
          {remaining > 0 ? `${currency(remaining)} remaining` : "Paid in full"}
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
  let label;
  if (days < 0) { color = C.error; label = `${Math.abs(days)}d overdue`; }
  else if (days <= 3) { color = C.error; label = `${days}d left`; }
  else if (days <= 7) { color = C.warn; label = `${days}d left`; }
  else { label = `Due ${due.toLocaleDateString()}`; }
  return <span style={{ fontSize: 10, fontFamily: mono, color, fontWeight: 600 }}>{label}</span>;
}

// ── Draggable Goal List ──
function GoalList({ goals, onChange }) {
  const [dragIdx, setDragIdx] = useState(null);
  const [overIdx, setOverIdx] = useState(null);
  const addGoal = () => onChange([...goals, ""]);
  const updateGoal = (i, val) => { const g = [...goals]; g[i] = val; onChange(g); };
  const removeGoal = (i) => onChange(goals.filter((_, idx) => idx !== i));
  const onDragStart = (i) => setDragIdx(i);
  const onDragOver = (e, i) => { e.preventDefault(); setOverIdx(i); };
  const onDrop = (i) => {
    if (dragIdx === null || dragIdx === i) { setDragIdx(null); setOverIdx(null); return; }
    const g = [...goals]; const [moved] = g.splice(dragIdx, 1); g.splice(i, 0, moved);
    onChange(g); setDragIdx(null); setOverIdx(null);
  };

  return (
    <div>
      {goals.map((goal, i) => (
        <div key={i} draggable onDragStart={() => onDragStart(i)} onDragOver={(e) => onDragOver(e, i)} onDrop={() => onDrop(i)} onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
          style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "6px 8px", borderRadius: 4, background: overIdx === i ? C.hover : "transparent", border: `1px solid ${overIdx === i ? C.muted : "transparent"}`, transition: "all 0.15s", cursor: "grab" }}>
          <span style={{ color: C.muted, fontSize: 11, fontFamily: mono, minWidth: 20, userSelect: "none" }}>{i + 1}.</span>
          <span style={{ color: C.muted, cursor: "grab", userSelect: "none", fontSize: 14 }}>⠿</span>
          <input style={{ ...inputBase, flex: 1 }} value={goal} onChange={(e) => updateGoal(i, e.target.value)} placeholder={`Goal ${i + 1}`} />
          <button onClick={() => removeGoal(i)} style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16, padding: "0 4px", fontFamily: mono }}>×</button>
        </div>
      ))}
      <button onClick={addGoal} style={{ background: "none", border: `1px dashed ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 12, fontFamily: mono, padding: "8px 14px", cursor: "pointer", width: "100%", marginTop: 4 }}>
        + Add Goal
      </button>
    </div>
  );
}

// ── Modal ──
function Modal({ title, onClose, children, width = 500 }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999, padding: 16 }} onClick={onClose}>
      <div style={{ background: C.surface, borderRadius: 8, border: `1px solid ${C.border}`, padding: 24, width: "100%", maxWidth: width, maxHeight: "90vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span>
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 11, fontFamily: mono, padding: "4px 10px", cursor: "pointer" }}>✕</button>
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

// ══════════════════════════
// MAIN APP
// ══════════════════════════

export default function ClientPortal() {
  const [key, setKey] = useState(() => localStorage.getItem("icraft-client-key") || "");
  const [keyInput, setKeyInput] = useState("");
  const [client, setClient] = useState(null);
  const [authError, setAuthError] = useState("");

  const [view, setView] = useState("projects");
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);

  // Form
  const [title, setTitle] = useState("");
  const [goals, setGoals] = useState([""]);
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState("normal");
  const [deadline, setDeadline] = useState("");
  const [store, setStore] = useState("");
  const [submitStatus, setSubmitStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const toastTimer = useRef(null);
  const showToast = (message, type = "info") => {
    setToast({ message, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  // ── Auth ──
  const authenticate = useCallback(async (k) => {
    try {
      setAuthError("");
      const res = await fetch(`${WORKER_URL}/auth`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: k }),
      });
      const data = await res.json();
      if (data.success) {
        setClient({ name: data.name, store: data.store, admin: data.admin, role: data.role });
        setStore(data.store || "");
        setKey(k);
        localStorage.setItem("icraft-client-key", k);
        return true;
      } else {
        setAuthError("Invalid key. Check with your contact for a valid access key.");
        return false;
      }
    } catch (e) {
      setAuthError(`Connection failed: ${e.message}`);
      return false;
    }
  }, []);

  useEffect(() => { if (key) authenticate(key); }, []);

  // ── Fetch Projects ──
  const fetchProjects = useCallback(async () => {
    if (!key) return;
    setLoadingProjects(true);
    try {
      const res = await fetch(`${WORKER_URL}/projects?key=${encodeURIComponent(key)}`);
      const data = await res.json();
      setProjects(data.projects || []);
    } catch (e) {
      console.error("Failed to load projects:", e);
    }
    setLoadingProjects(false);
  }, [key]);

  useEffect(() => {
    if (client) fetchProjects();
  }, [client]);

  // ── Submit Request ──
  const submit = async () => {
    if (!title.trim()) { setSubmitStatus({ type: "error", text: "Project title is required." }); return; }
    setSubmitting(true); setSubmitStatus(null);
    try {
      const res = await fetch(`${WORKER_URL}/request`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key, title: title.trim(), store: store.trim(),
          goals: goals.filter(g => g.trim()), details: details.trim(),
          priority, deadline: priority === "rush" ? deadline : null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSubmitStatus({ type: "success", text: "Request submitted. You'll hear back shortly." });
        setTitle(""); setGoals([""]); setDetails(""); setPriority("normal"); setDeadline("");
        fetchProjects();
      } else {
        setSubmitStatus({ type: "error", text: data.error || "Failed to submit." });
      }
    } catch (e) {
      setSubmitStatus({ type: "error", text: e.message });
    }
    setSubmitting(false);
  };

  // ── Mark Payment ──
  const markPayment = async (projectId, amount, method, note) => {
    try {
      const res = await fetch(`${WORKER_URL}/payment/mark`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, projectId, amount, method, note }),
      });
      const data = await res.json();
      if (data.success) {
        showToast("Payment marked. Awaiting confirmation.", "success");
        fetchProjects();
        setModal(null);
      } else {
        showToast(data.error || "Failed to mark payment.", "error");
      }
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  const logout = () => {
    localStorage.removeItem("icraft-client-key");
    setKey(""); setClient(null); setKeyInput(""); setProjects([]);
  };

  // ── Payment Modal ──
  const PaymentModal = ({ project }) => {
    const [amount, setAmount] = useState("");
    const [method, setMethod] = useState("");
    const [note, setNote] = useState("");

    const cost = project.finalCost || project.estimatedCost || 0;
    const confirmed = (project.payments || []).filter(p => p.confirmed).reduce((s, p) => s + p.amount, 0);
    const remaining = cost - confirmed;

    return (
      <Modal title="Mark Payment" onClose={() => setModal(null)}>
        <div style={{ background: C.bg, borderRadius: 6, padding: 12, marginBottom: 16, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 12, color: C.muted }}>Project: <span style={{ color: C.text, fontWeight: 600 }}>{project.title}</span></div>
          {cost > 0 && (
            <div style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>
              Total: {currency(cost)} · Paid: {currency(confirmed)} · Remaining: <span style={{ color: remaining > 0 ? "#fca5a5" : C.accent }}>{currency(remaining > 0 ? remaining : 0)}</span>
            </div>
          )}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Amount ($)</label>
          <input style={inputBase} type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder={remaining > 0 ? String(remaining) : "0"} autoFocus />
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Payment Method</label>
          <select style={{ ...inputBase, appearance: "auto" }} value={method} onChange={e => setMethod(e.target.value)}>
            <option value="">Select method</option>
            <option value="e-transfer">E-Transfer</option>
            <option value="cash">Cash</option>
            <option value="cheque">Cheque</option>
            <option value="credit">Credit Card</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 5 }}>Note</label>
          <input style={inputBase} value={note} onChange={e => setNote(e.target.value)} placeholder="Optional reference or note" />
        </div>

        <button onClick={() => { if (parseFloat(amount) > 0) markPayment(project.id, parseFloat(amount), method, note); }}
          disabled={!amount || parseFloat(amount) <= 0}
          style={{
            width: "100%", padding: "12px", borderRadius: 4, border: `1px solid ${C.border}`,
            background: C.surface, color: C.text, fontSize: 13, fontFamily: mono,
            fontWeight: 600, cursor: !amount ? "not-allowed" : "pointer",
            opacity: !amount ? 0.5 : 1,
          }}>
          Mark as Paid
        </button>

        <div style={{ fontSize: 10, color: C.muted, fontFamily: mono, marginTop: 8, textAlign: "center" }}>
          Payment will be verified before it is confirmed.
        </div>
      </Modal>
    );
  };

  // ── Project Detail Modal ──
  const ProjectDetailModal = ({ project }) => {
    const st = STATUS_STYLE[project.status] || STATUS_STYLE.pending;
    const cost = project.finalCost || project.estimatedCost || 0;
    const confirmed = (project.payments || []).filter(p => p.confirmed).reduce((s, p) => s + p.amount, 0);
    const isFinal = !!project.finalCost;

    return (
      <Modal title={project.title} onClose={() => setModal(null)} width={560}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 3,
            background: st.bg, color: st.color, fontSize: 11, fontFamily: mono, fontWeight: 600, border: `1px solid ${st.border}`,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: st.color }} />
            {st.label}
          </span>
          <span style={{ fontSize: 10, fontFamily: mono, color: PRIORITY_MAP[project.priority]?.color || C.muted, fontWeight: 600, textTransform: "uppercase" }}>
            {PRIORITY_MAP[project.priority]?.label || project.priority}
          </span>
          <DeadlineIndicator deadline={project.estimatedDeadline || project.deadline} status={project.status} />
        </div>

        {/* Progress */}
        {(project.progress > 0 || project.status === "in_progress") && (
          <div style={{ marginBottom: 14 }}><ProgressBar value={project.progress || 0} showLabel /></div>
        )}

        {/* Cost & Payment */}
        {cost > 0 && (
          <div style={{ background: C.bg, borderRadius: 6, padding: 12, marginBottom: 14, border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontFamily: mono, color: C.muted }}>{isFinal ? "FINAL COST" : "ESTIMATED COST"}</span>
              <span style={{ fontSize: 16, fontWeight: 700, fontFamily: mono, color: C.text }}>{currency(cost)}</span>
            </div>
            <PaymentBar paid={confirmed} total={cost} />

            {project.status !== "pending" && (
              <button onClick={() => setModal({ type: "payment", payload: project })}
                style={{
                  marginTop: 10, width: "100%", padding: "8px", borderRadius: 4,
                  border: `1px solid ${C.border}`, background: C.surface,
                  color: C.text, fontSize: 12, fontFamily: mono, fontWeight: 600, cursor: "pointer",
                }}>
                Mark Payment
              </button>
            )}
          </div>
        )}

        {/* Scope */}
        {(project.scope || []).length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontFamily: mono, color: C.muted, marginBottom: 6 }}>SCOPE</div>
            {project.scope.map((s, i) => (
              <div key={i} style={{ fontSize: 12, color: C.text2, paddingLeft: 12, marginBottom: 3 }}>
                <span style={{ color: C.muted, fontFamily: mono, fontSize: 10, marginRight: 6 }}>{i + 1}.</span>{s}
              </div>
            ))}
          </div>
        )}

        {/* Client Goals */}
        {(project.goals || []).length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontFamily: mono, color: C.muted, marginBottom: 6 }}>YOUR GOALS</div>
            {project.goals.map((g, i) => (
              <div key={i} style={{ fontSize: 12, color: C.text2, paddingLeft: 12, marginBottom: 3 }}>
                <span style={{ color: C.muted, fontFamily: mono, fontSize: 10, marginRight: 6 }}>{i + 1}.</span>{g}
              </div>
            ))}
          </div>
        )}

        {project.details && (
          <div style={{ fontSize: 12, color: C.muted, marginBottom: 14, lineHeight: 1.6 }}>{project.details}</div>
        )}

        {/* Payment History */}
        {(project.payments || []).length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontFamily: mono, color: C.muted, marginBottom: 6 }}>PAYMENT HISTORY</div>
            {project.payments.map(p => (
              <div key={p.id} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 10px", marginBottom: 4, borderRadius: 4,
                border: `1px solid ${p.confirmed ? `${C.accent}30` : p.rejected ? `${C.error}30` : `${C.warn}30`}`,
                background: C.bg,
              }}>
                <div>
                  <span style={{ fontSize: 13, fontFamily: mono, fontWeight: 600 }}>{currency(p.amount)}</span>
                  <span style={{ fontSize: 10, color: C.muted, marginLeft: 6 }}>{p.method || ""}</span>
                  <div style={{ fontSize: 10, color: C.muted, fontFamily: mono }}>{new Date(p.markedAt).toLocaleDateString()}</div>
                </div>
                <span style={{
                  fontSize: 10, fontFamily: mono, fontWeight: 600,
                  color: p.confirmed ? C.accent : p.rejected ? C.error : C.warn,
                }}>
                  {p.confirmed ? "CONFIRMED" : p.rejected ? "REJECTED" : "PENDING"}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Updates Timeline */}
        {(project.updates || []).length > 0 && (
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
            <div style={{ fontSize: 10, fontFamily: mono, color: C.muted, marginBottom: 8 }}>UPDATES</div>
            {project.updates.slice().reverse().map((u, i) => (
              <div key={i} style={{ marginBottom: 8, paddingLeft: 12, borderLeft: `2px solid ${C.border}` }}>
                <div style={{ fontSize: 10, fontFamily: mono, color: C.muted }}>{new Date(u.timestamp).toLocaleString()}</div>
                <div style={{ fontSize: 12, color: C.text2 }}>{u.message}</div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    );
  };

  // ══════════════════════════
  // AUTH SCREEN
  // ══════════════════════════

  if (!client) {
    return (
      <div style={{ background: C.bg, color: C.text, fontFamily: sans, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <link href={fonts} rel="stylesheet" />
        <div style={{ width: "100%", maxWidth: 380 }}>
          <div style={{ fontSize: 11, fontFamily: mono, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 6 }}>ICraft Creative Solutions</div>
          <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 6 }}>Client Portal</h1>
          <p style={{ fontSize: 13, color: C.muted, marginBottom: 28 }}>Enter the access key provided to you.</p>

          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Access Key</label>
            <input style={inputBase} type="password" value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") authenticate(keyInput); }}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autoFocus />
          </div>

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
  // AUTHENTICATED PORTAL
  // ══════════════════════════

  const activeProjects = projects.filter(p => ["accepted", "in_progress", "review"].includes(p.status));
  const pendingProjects = projects.filter(p => p.status === "pending");
  const completedProjects = projects.filter(p => p.status === "completed" || p.status === "shelved");

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: sans, minHeight: "100vh", padding: "0 20px 40px" }}>
      <link href={fonts} rel="stylesheet" />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: `1px solid ${C.surface}`, marginBottom: 24, flexWrap: "wrap", gap: 10 }}>
        <div>
          <span style={{ fontSize: 11, fontFamily: mono, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>ICraft</span>
          <span style={{ fontSize: 15, fontWeight: 600, color: C.text2, marginLeft: 10 }}>{client.name}</span>
          {client.store && <span style={{ fontSize: 12, color: C.muted, marginLeft: 8 }}>· {client.store}</span>}
        </div>
        <button onClick={logout} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 11, fontFamily: mono, padding: "5px 10px", cursor: "pointer" }}>
          Sign Out
        </button>
      </div>

      {/* Nav */}
      <div style={{ display: "flex", gap: 2, background: C.surface, borderRadius: 5, padding: 2, marginBottom: 24, maxWidth: 300 }}>
        {[["projects", "My Projects"], ["submit", "New Request"]].map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} style={{
            padding: "7px 14px", borderRadius: 4, border: "none",
            background: view === k ? C.hover : "transparent",
            color: view === k ? C.text : C.muted,
            fontSize: 12, fontFamily: mono, cursor: "pointer", fontWeight: view === k ? 600 : 400,
          }}>{l}</button>
        ))}
      </div>

      <div style={{ maxWidth: 620 }}>

        {/* ═══ PROJECTS VIEW ═══ */}
        {view === "projects" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>My Projects</h2>
              <button onClick={fetchProjects} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 11, fontFamily: mono, padding: "5px 10px", cursor: "pointer" }}>
                {loadingProjects ? "Loading..." : "↻ Refresh"}
              </button>
            </div>

            {!projects.length && !loadingProjects && (
              <div style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: 24, textAlign: "center" }}>
                <div style={{ color: C.muted, fontSize: 13, marginBottom: 8 }}>No projects yet.</div>
                <button onClick={() => setView("submit")} style={{
                  padding: "8px 16px", borderRadius: 4, border: `1px solid ${C.border}`,
                  background: C.surface, color: C.text, fontSize: 12, fontFamily: mono, fontWeight: 600, cursor: "pointer",
                }}>Submit a Request</button>
              </div>
            )}

            {/* Active Projects */}
            {activeProjects.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontFamily: mono, color: C.purple, marginBottom: 8, fontWeight: 600 }}>
                  Active ({activeProjects.length})
                </div>
                {activeProjects.map(p => {
                  const st = STATUS_STYLE[p.status] || STATUS_STYLE.pending;
                  const cost = p.finalCost || p.estimatedCost || 0;
                  const confirmed = (p.payments || []).filter(pay => pay.confirmed).reduce((s, pay) => s + pay.amount, 0);
                  const pendingPay = (p.payments || []).filter(pay => !pay.confirmed && !pay.rejected).length;

                  return (
                    <div key={p.id} style={{
                      background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`,
                      padding: "14px 16px", marginBottom: 8, cursor: "pointer",
                    }} onClick={() => setModal({ type: "detail", payload: p })}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{p.title}</div>
                          <div style={{ fontSize: 11, fontFamily: mono, color: C.muted }}>
                            {p.store && `${p.store} · `}{new Date(p.submitted).toLocaleDateString()}
                            {cost > 0 && ` · ${currency(cost)}`}
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {pendingPay > 0 && (
                            <span style={{ fontSize: 10, fontFamily: mono, color: C.warn, background: `${C.warn}15`, padding: "2px 6px", borderRadius: 3 }}>
                              {pendingPay} pending
                            </span>
                          )}
                          <DeadlineIndicator deadline={p.estimatedDeadline || p.deadline} status={p.status} />
                          <span style={{
                            fontSize: 11, fontFamily: mono, fontWeight: 600, color: st.color,
                            background: st.bg, padding: "3px 10px", borderRadius: 3,
                            border: `1px solid ${st.border}`,
                          }}>
                            {st.label}
                          </span>
                        </div>
                      </div>
                      <ProgressBar value={p.progress || 0} />
                      {cost > 0 && <div style={{ marginTop: 6 }}><PaymentBar paid={confirmed} total={cost} /></div>}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pending */}
            {pendingProjects.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontFamily: mono, color: C.muted, marginBottom: 8, fontWeight: 600 }}>
                  Pending Review ({pendingProjects.length})
                </div>
                {pendingProjects.map(p => (
                  <div key={p.id} style={{
                    background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`,
                    padding: "14px 16px", marginBottom: 8, cursor: "pointer",
                  }} onClick={() => setModal({ type: "detail", payload: p })}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{p.title}</div>
                        <div style={{ fontSize: 11, fontFamily: mono, color: C.muted }}>
                          Submitted {new Date(p.submitted).toLocaleDateString()}
                        </div>
                      </div>
                      <span style={{ fontSize: 11, fontFamily: mono, color: "#a8a29e", background: "#1c1917", padding: "3px 10px", borderRadius: 3, border: `1px solid #292524` }}>
                        Pending
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Completed */}
            {completedProjects.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontFamily: mono, color: C.accent, marginBottom: 8, fontWeight: 600 }}>
                  Completed ({completedProjects.length})
                </div>
                {completedProjects.map(p => {
                  const st = STATUS_STYLE[p.status] || STATUS_STYLE.completed;
                  return (
                    <div key={p.id} style={{
                      background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`,
                      padding: "14px 16px", marginBottom: 8, cursor: "pointer", opacity: 0.8,
                    }} onClick={() => setModal({ type: "detail", payload: p })}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{p.title}</div>
                          <div style={{ fontSize: 11, fontFamily: mono, color: C.muted }}>
                            {new Date(p.submitted).toLocaleDateString()}
                          </div>
                        </div>
                        <span style={{ fontSize: 11, fontFamily: mono, fontWeight: 600, color: st.color, background: st.bg, padding: "3px 10px", borderRadius: 3, border: `1px solid ${st.border}` }}>
                          {st.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══ SUBMIT VIEW ═══ */}
        {view === "submit" && (
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 18 }}>New Request</h2>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Store Name</label>
              <input style={inputBase} value={store} onChange={(e) => setStore(e.target.value)} placeholder="Which store is this for?" />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Project Title</label>
              <input style={inputBase} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Brief title for the project" />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
                Goals <span style={{ color: C.muted, fontWeight: 400 }}>(drag to reorder by priority)</span>
              </label>
              <GoalList goals={goals} onChange={setGoals} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Extra Details</label>
              <textarea style={{ ...inputBase, minHeight: 80, resize: "vertical", fontFamily: sans }}
                value={details} onChange={(e) => setDetails(e.target.value)}
                placeholder="Colors, sizes, references, content, anything that helps..." />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: priority === "rush" ? "1fr 1fr" : "1fr", gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Priority</label>
                <select style={{ ...inputBase, appearance: "auto" }} value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="rush">Rush</option>
                </select>
              </div>
              {priority === "rush" && (
                <div>
                  <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Deadline</label>
                  <input style={inputBase} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
                  <div style={{ fontSize: 10, fontFamily: mono, color: C.warn, marginTop: 4 }}>Rush jobs may incur additional fees</div>
                </div>
              )}
            </div>

            <button onClick={submit} disabled={submitting} style={{
              width: "100%", padding: "12px", borderRadius: 4, border: `1px solid ${C.border}`,
              background: C.surface, color: C.text, fontSize: 13, fontFamily: mono,
              fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer",
              opacity: submitting ? 0.5 : 1,
            }}>
              {submitting ? "Submitting..." : "Submit Request"}
            </button>

            {submitStatus && (
              <div style={{ marginTop: 12, fontSize: 12, fontFamily: mono, color: submitStatus.type === "success" ? C.accent : C.error, textAlign: "center" }}>
                {submitStatus.text}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      {modal?.type === "detail" && <ProjectDetailModal project={modal.payload} />}
      {modal?.type === "payment" && <PaymentModal project={modal.payload} />}

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}