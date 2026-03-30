import { useState, useEffect, useCallback, useRef } from "react";

/*
 * ICraft Client Portal
 *
 * How it works:
 * 1. Client enters the API key you gave them
 * 2. Key is validated against the Worker, client info returned
 * 3. Key cached in localStorage so they don't re-enter it
 * 4. They can submit requests and view their project status
 *
 * Set WORKER_URL below to your Cloudflare Worker URL.
 */

const WORKER_URL = "https://icraft-api.psyda.workers.dev";

// ── Styles ──
const fonts = "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700&display=swap";

const C = {
  bg: "#0c0a09", surface: "#1c1917", border: "#292524", hover: "#292524",
  text: "#e7e5e4", muted: "#78716c", accent: "#22c55e", warn: "#f59e0b",
  error: "#dc2626", blue: "#38bdf8", purple: "#a855f7",
};

const mono = "'IBM Plex Mono', monospace";
const sans = "'Outfit', sans-serif";

const inputBase = {
  width: "100%", padding: "10px 12px", borderRadius: 4, border: `1px solid ${C.border}`,
  background: C.bg, color: C.text, fontSize: 13, fontFamily: mono, boxSizing: "border-box",
  outline: "none", transition: "border-color 0.15s",
};

const STATUS_STYLE = {
  pending:     { label: "Pending",     color: "#a8a29e", bg: "#1c1917" },
  accepted:    { label: "Accepted",    color: "#38bdf8", bg: "#0c1222" },
  in_progress: { label: "In Progress", color: "#a855f7", bg: "#1a0f24" },
  review:      { label: "Review",      color: "#fbbf24", bg: "#1a1508" },
  completed:   { label: "Completed",   color: "#22c55e", bg: "#071a0b" },
  shelved:     { label: "Shelved",     color: "#78716c", bg: "#1c1917" },
};

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
    const g = [...goals];
    const [moved] = g.splice(dragIdx, 1);
    g.splice(i, 0, moved);
    onChange(g);
    setDragIdx(null);
    setOverIdx(null);
  };

  return (
    <div>
      {goals.map((goal, i) => (
        <div
          key={i}
          draggable
          onDragStart={() => onDragStart(i)}
          onDragOver={(e) => onDragOver(e, i)}
          onDrop={() => onDrop(i)}
          onDragEnd={() => { setDragIdx(null); setOverIdx(null); }}
          style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 6,
            padding: "6px 8px", borderRadius: 4,
            background: overIdx === i ? C.hover : "transparent",
            border: `1px solid ${overIdx === i ? C.muted : "transparent"}`,
            transition: "all 0.15s", cursor: "grab",
          }}
        >
          <span style={{ color: C.muted, fontSize: 11, fontFamily: mono, minWidth: 20, userSelect: "none" }}>
            {i + 1}.
          </span>
          <span style={{ color: C.muted, cursor: "grab", userSelect: "none", fontSize: 14 }}>⠿</span>
          <input
            style={{ ...inputBase, flex: 1 }}
            value={goal}
            onChange={(e) => updateGoal(i, e.target.value)}
            placeholder={`Goal ${i + 1}`}
          />
          <button
            onClick={() => removeGoal(i)}
            style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 16, padding: "0 4px", fontFamily: mono }}
          >×</button>
        </div>
      ))}
      <button
        onClick={addGoal}
        style={{
          background: "none", border: `1px dashed ${C.border}`, borderRadius: 4,
          color: C.muted, fontSize: 12, fontFamily: mono, padding: "8px 14px",
          cursor: "pointer", width: "100%", marginTop: 4, transition: "all 0.15s",
        }}
      >+ Add Goal</button>
    </div>
  );
}

// ── Progress Bar ──
function ProgressBar({ value, height = 6 }) {
  const color = value >= 100 ? C.accent : value > 60 ? C.blue : value > 30 ? C.purple : C.muted;
  return (
    <div style={{ width: "100%", height, borderRadius: 3, background: C.surface, overflow: "hidden", border: `1px solid ${C.border}` }}>
      <div style={{ width: `${Math.min(100, value)}%`, height: "100%", borderRadius: 3, background: color, transition: "width 0.4s ease" }} />
    </div>
  );
}

// ── Main App ──
export default function ClientPortal() {
  const [key, setKey] = useState(() => localStorage.getItem("icraft-client-key") || "");
  const [keyInput, setKeyInput] = useState("");
  const [client, setClient] = useState(null); // { name, store, admin }
  const [authError, setAuthError] = useState("");
  const [view, setView] = useState("submit"); // submit | projects
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [goals, setGoals] = useState([""]);
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState("normal");
  const [deadline, setDeadline] = useState("");
  const [store, setStore] = useState("");
  const [submitStatus, setSubmitStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Admin progress update
  const [editingProject, setEditingProject] = useState(null);
  const [progressUpdate, setProgressUpdate] = useState({ status: "", progress: 0, update: "" });
  const [updating, setUpdating] = useState(false);

  // Auth
  const authenticate = useCallback(async (k) => {
    try {
      setAuthError("");
      const res = await fetch(`${WORKER_URL}/auth`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: k }),
      });
      const data = await res.json();
      if (data.success) {
        setClient({ name: data.client, store: data.store, admin: data.admin });
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

  // Auto-auth on load
  useEffect(() => {
    if (key) authenticate(key);
  }, []);

  // Fetch projects
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
    if (client && view === "projects") fetchProjects();
  }, [client, view]);

  // Submit request
  const submit = async () => {
    if (!title.trim()) { setSubmitStatus({ type: "error", text: "Project title is required." }); return; }
    setSubmitting(true);
    setSubmitStatus(null);
    try {
      const res = await fetch(`${WORKER_URL}/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          title: title.trim(),
          store: store.trim(),
          goals: goals.filter(g => g.trim()),
          details: details.trim(),
          priority,
          deadline: priority === "rush" ? deadline : null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSubmitStatus({ type: "success", text: "Request submitted. You'll hear back shortly." });
        setTitle(""); setGoals([""]); setDetails(""); setPriority("normal"); setDeadline("");
      } else {
        setSubmitStatus({ type: "error", text: data.error || "Failed to submit." });
      }
    } catch (e) {
      setSubmitStatus({ type: "error", text: e.message });
    }
    setSubmitting(false);
  };

  // Admin: update progress
  const updateProgress = async () => {
    if (!editingProject) return;
    setUpdating(true);
    try {
      const res = await fetch(`${WORKER_URL}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key,
          projectId: editingProject.id,
          status: progressUpdate.status || undefined,
          progress: progressUpdate.progress,
          update: progressUpdate.update || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setEditingProject(null);
        setProgressUpdate({ status: "", progress: 0, update: "" });
        fetchProjects();
      }
    } catch (e) {
      console.error("Update failed:", e);
    }
    setUpdating(false);
  };

  const logout = () => {
    localStorage.removeItem("icraft-client-key");
    setKey(""); setClient(null); setKeyInput(""); setProjects([]);
  };

  // ── Auth Screen ──
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
            <input
              style={inputBase}
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") authenticate(keyInput); }}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              autoFocus
            />
          </div>

          <button
            onClick={() => authenticate(keyInput)}
            style={{
              width: "100%", padding: "12px", borderRadius: 4, border: `1px solid ${C.border}`,
              background: C.surface, color: C.text, fontSize: 13, fontFamily: mono,
              fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
            }}
          >Authenticate</button>

          {authError && <div style={{ marginTop: 12, fontSize: 12, fontFamily: mono, color: C.error, textAlign: "center" }}>{authError}</div>}
        </div>
      </div>
    );
  }

  // ── Authenticated Portal ──
  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: sans, minHeight: "100vh", padding: "0 20px 40px" }}>
      <link href={fonts} rel="stylesheet" />

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: `1px solid ${C.surface}`, marginBottom: 24, flexWrap: "wrap", gap: 10 }}>
        <div>
          <span style={{ fontSize: 11, fontFamily: mono, color: C.muted, letterSpacing: "0.15em", textTransform: "uppercase" }}>ICraft</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#d6d3d1", marginLeft: 10 }}>{client.name}</span>
          {client.store && <span style={{ fontSize: 12, color: C.muted, marginLeft: 8 }}>· {client.store}</span>}
          {client.admin && <span style={{ fontSize: 10, fontFamily: mono, color: C.warn, marginLeft: 8, padding: "2px 6px", borderRadius: 3, border: `1px solid ${C.warn}30` }}>ADMIN</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={logout} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 11, fontFamily: mono, padding: "5px 10px", cursor: "pointer" }}>Sign Out</button>
        </div>
      </div>

      {/* Nav */}
      <div style={{ display: "flex", gap: 2, background: C.surface, borderRadius: 5, padding: 2, marginBottom: 24, maxWidth: 300 }}>
        {[["submit", "New Request"], ["projects", "Projects"]].map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} style={{
            padding: "7px 14px", borderRadius: 4, border: "none",
            background: view === k ? C.hover : "transparent",
            color: view === k ? C.text : C.muted,
            fontSize: 12, fontFamily: mono, cursor: "pointer", fontWeight: view === k ? 600 : 400,
          }}>{l}</button>
        ))}
      </div>

      <div style={{ maxWidth: 600 }}>
        {/* ── Submit Request ── */}
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
              <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Goals <span style={{ color: C.muted, fontWeight: 400 }}>(drag to reorder by priority)</span></label>
              <GoalList goals={goals} onChange={setGoals} />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Extra Details</label>
              <textarea style={{ ...inputBase, minHeight: 80, resize: "vertical", fontFamily: sans }} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Colors, sizes, references, content, anything that helps..." />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: priority === "rush" ? "1fr 1fr" : "1fr", gap: 12, marginBottom: 20 }}>
              <div>
                <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>Priority</label>
                <select style={{ ...inputBase, appearance: "auto" }} value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="low">Low — whenever you get to it</option>
                  <option value="normal">Normal</option>
                  <option value="rush">Rush — I need this ASAP</option>
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

            <button
              onClick={submit}
              disabled={submitting}
              style={{
                width: "100%", padding: "12px", borderRadius: 4, border: `1px solid ${C.border}`,
                background: C.surface, color: C.text, fontSize: 13, fontFamily: mono,
                fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.5 : 1, transition: "all 0.15s",
              }}
            >{submitting ? "Submitting…" : "Submit Request"}</button>

            {submitStatus && (
              <div style={{ marginTop: 12, fontSize: 12, fontFamily: mono, color: submitStatus.type === "success" ? C.accent : C.error, textAlign: "center" }}>
                {submitStatus.text}
              </div>
            )}
          </div>
        )}

        {/* ── Projects ── */}
        {view === "projects" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Projects</h2>
              <button onClick={fetchProjects} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 11, fontFamily: mono, padding: "5px 10px", cursor: "pointer" }}>
                {loadingProjects ? "Loading…" : "↻ Refresh"}
              </button>
            </div>

            {!projects.length && !loadingProjects && (
              <div style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: 24, textAlign: "center", color: C.muted, fontSize: 13 }}>
                No projects yet. Submit a request to get started.
              </div>
            )}

            {projects.map((p) => {
              const st = STATUS_STYLE[p.status] || STATUS_STYLE.pending;
              return (
                <div key={p.id} style={{ background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`, padding: "14px 16px", marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>{p.title}</div>
                      <div style={{ fontSize: 11, fontFamily: mono, color: C.muted }}>
                        {p.store && `${p.store} · `}{new Date(p.submitted).toLocaleDateString()}
                        {p.deadline && ` · Due: ${new Date(p.deadline).toLocaleDateString()}`}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontFamily: mono, fontWeight: 600, color: st.color, background: st.bg, padding: "3px 10px", borderRadius: 3, border: `1px solid ${st.color}20` }}>
                      {st.label}
                    </span>
                  </div>

                  {(p.progress > 0 || p.status === "in_progress") && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 10, fontFamily: mono, color: C.muted }}>Progress</span>
                        <span style={{ fontSize: 10, fontFamily: mono, color: C.text }}>{p.progress || 0}%</span>
                      </div>
                      <ProgressBar value={p.progress || 0} />
                    </div>
                  )}

                  {p.goals && p.goals.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 10, fontFamily: mono, color: C.muted, marginBottom: 4 }}>GOALS</div>
                      {p.goals.map((g, i) => (
                        <div key={i} style={{ fontSize: 12, color: "#d6d3d1", paddingLeft: 12, marginBottom: 2 }}>
                          <span style={{ color: C.muted, fontFamily: mono, fontSize: 10, marginRight: 6 }}>{i + 1}.</span>{g}
                        </div>
                      ))}
                    </div>
                  )}

                  {p.details && <div style={{ fontSize: 12, color: "#a8a29e", marginBottom: 8 }}>{p.details}</div>}

                  {p.updates && p.updates.length > 0 && (
                    <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, marginTop: 8 }}>
                      <div style={{ fontSize: 10, fontFamily: mono, color: C.muted, marginBottom: 6 }}>UPDATES</div>
                      {p.updates.map((u, i) => (
                        <div key={i} style={{ marginBottom: 6, paddingLeft: 10, borderLeft: `2px solid ${C.border}` }}>
                          <div style={{ fontSize: 10, fontFamily: mono, color: C.muted }}>{new Date(u.timestamp).toLocaleString()}</div>
                          <div style={{ fontSize: 12, color: "#d6d3d1" }}>{u.message}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Admin: update progress */}
                  {client.admin && (
                    <div style={{ marginTop: 8 }}>
                      {editingProject?.id === p.id ? (
                        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                            <div>
                              <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Status</label>
                              <select style={{ ...inputBase, appearance: "auto" }} value={progressUpdate.status} onChange={(e) => setProgressUpdate({ ...progressUpdate, status: e.target.value })}>
                                <option value="">No change</option>
                                {Object.entries(STATUS_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                              </select>
                            </div>
                            <div>
                              <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Progress %</label>
                              <input style={inputBase} type="number" min="0" max="100" value={progressUpdate.progress} onChange={(e) => setProgressUpdate({ ...progressUpdate, progress: parseInt(e.target.value) || 0 })} />
                            </div>
                          </div>
                          <div style={{ marginBottom: 10 }}>
                            <label style={{ display: "block", fontSize: 10, fontFamily: mono, color: C.muted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Update Note</label>
                            <input style={inputBase} value={progressUpdate.update} onChange={(e) => setProgressUpdate({ ...progressUpdate, update: e.target.value })} placeholder="e.g. First draft ready for review" />
                          </div>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button onClick={updateProgress} disabled={updating} style={{ padding: "6px 12px", borderRadius: 4, border: `1px solid ${C.border}`, background: C.hover, color: C.text, fontSize: 11, fontFamily: mono, fontWeight: 600, cursor: "pointer" }}>
                              {updating ? "Saving…" : "Save Update"}
                            </button>
                            <button onClick={() => setEditingProject(null)} style={{ padding: "6px 12px", borderRadius: 4, border: `1px solid ${C.border}`, background: "transparent", color: C.muted, fontSize: 11, fontFamily: mono, cursor: "pointer" }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => { setEditingProject(p); setProgressUpdate({ status: p.status, progress: p.progress || 0, update: "" }); }} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 4, color: C.muted, fontSize: 10, fontFamily: mono, padding: "4px 10px", cursor: "pointer" }}>
                          Update Progress
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
