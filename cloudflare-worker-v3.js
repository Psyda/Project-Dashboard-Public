/*
 * ICraft API — Cloudflare Worker (v3)
 *
 * ALL GitHub communication goes through this Worker.
 * The frontend never talks to GitHub directly (avoids CORS issues).
 *
 * ENV VARIABLES (set in Cloudflare dashboard):
 *   GITHUB_TOKEN    - Fine-grained PAT with Contents read/write (ENCRYPT THIS)
 *   GITHUB_OWNER    - Your GitHub username
 *   GITHUB_REPO     - Repo name (e.g. "icraft-data")
 *   GITHUB_BRANCH   - "main"
 *   ALLOWED_ORIGIN  - "*" for dev, your domain for prod
 *   CLIENTS         - JSON string mapping keys to client info:
 *
 *   Example CLIENTS value:
 *   {
 *     "pick-any-secret-string-for-admin": {
 *       "name": "Travis",
 *       "role": "admin"
 *     },
 *     "pick-another-string-for-client": {
 *       "name": "Client Name",
 *       "store": "Store Name",
 *       "role": "client"
 *     }
 *   }
 *
 *   Keys are just strings you make up. Give each client their key.
 *   The first entry with role "admin" is the admin account.
 *
 * ENDPOINTS:
 *   GET  /health                  — Health check (no auth)
 *   POST /auth                    — Validate key, return client info
 *   GET  /data?key=&path=         — Read any file from repo (admin only)
 *   POST /data/write              — Write any file to repo (admin only)
 *   POST /request                 — Submit project request (any valid key)
 *   GET  /projects?key=           — List projects (admin=all, client=own)
 *   POST /progress                — Update project (admin only)
 */

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });

    // ── Parse clients config ──
    let clients = {};
    try {
      clients = JSON.parse(env.CLIENTS || "{}");
    } catch {}

    const getClient = (key) => clients[key] || null;
    const isAdmin = (key) => {
      const c = clients[key];
      return c && c.role === "admin";
    };

    // ── GitHub helpers ──
    const ghHeaders = () => ({
      Authorization: `token ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "ICraft-Worker",
      "Content-Type": "application/json",
    });

    const ghReadFile = async (path) => {
      const res = await fetch(
        `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH || "main"}`,
        { headers: ghHeaders() }
      );
      if (!res.ok) return null;
      const meta = await res.json();
      const content = decodeURIComponent(
        escape(atob(meta.content.replace(/\n/g, "")))
      );
      return { content, sha: meta.sha };
    };

    const ghWriteFile = async (path, content, sha = null, message = "update") => {
      const body = {
        message,
        content: btoa(unescape(encodeURIComponent(content))),
        branch: env.GITHUB_BRANCH || "main",
      };
      if (sha) body.sha = sha;

      const res = await fetch(
        `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}`,
        { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) }
      );
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`GitHub write failed: ${res.status} ${err}`);
      }
      return true;
    };

    const ghListDir = async (path) => {
      const res = await fetch(
        `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/contents/${path}?ref=${env.GITHUB_BRANCH || "main"}`,
        { headers: ghHeaders() }
      );
      if (!res.ok) return [];
      return res.json();
    };

    // ══════════════════════════
    // ENDPOINTS
    // ══════════════════════════

    // ── Health ──
    if (url.pathname === "/health") {
      return json({ status: "ok", time: new Date().toISOString() });
    }

    // ── Auth ──
    if (url.pathname === "/auth" && request.method === "POST") {
      try {
        const body = await request.json();
        const client = getClient(body.key);
        if (!client) return json({ error: "Invalid key" }, 401);
        return json({
          success: true,
          name: client.name,
          store: client.store || "",
          role: client.role || "client",
          admin: client.role === "admin",
        });
      } catch (e) {
        return json({ error: e.message }, 400);
      }
    }

    // ── Read data (admin only) ──
    // Used by dashboard to read dashboard.json through the Worker
    if (url.pathname === "/data" && request.method === "GET") {
      const key = url.searchParams.get("key") || "";
      if (!isAdmin(key)) return json({ error: "Admin access required" }, 403);

      const path = url.searchParams.get("path") || "data/dashboard.json";
      try {
        const file = await ghReadFile(path);
        if (!file) return json({ error: "File not found" }, 404);
        // Return the raw content as JSON
        try {
          return json({ data: JSON.parse(file.content), sha: file.sha });
        } catch {
          // Not JSON, return as string
          return json({ data: file.content, sha: file.sha });
        }
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // ── Write data (admin only) ──
    // Used by dashboard to save dashboard.json through the Worker
    if (url.pathname === "/data/write" && request.method === "POST") {
      try {
        const body = await request.json();
        if (!isAdmin(body.key)) return json({ error: "Admin access required" }, 403);

        const path = body.path || "data/dashboard.json";
        const content =
          typeof body.data === "string"
            ? body.data
            : JSON.stringify(body.data, null, 2);

        // Get current SHA
        const existing = await ghReadFile(path);
        const sha = existing ? existing.sha : null;

        await ghWriteFile(
          path,
          content,
          sha,
          body.message || `Dashboard update ${new Date().toISOString()}`
        );
        return json({ success: true });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // ── Submit request (any authenticated user) ──
    if (url.pathname === "/request" && request.method === "POST") {
      try {
        const body = await request.json();
        const client = getClient(body.key);
        if (!client) return json({ error: "Invalid key" }, 401);
        if (!body.title) return json({ error: "Project title required" }, 400);

        const requestData = {
          id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          submitted: new Date().toISOString(),
          client: client.name,
          store: body.store || client.store || "",
          title: body.title,
          goals: body.goals || [],
          details: body.details || "",
          priority: body.priority || "normal",
          deadline: body.deadline || null,
          status: "pending",
          progress: 0,
          updates: [],
        };

        await ghWriteFile(
          `data/requests/${requestData.id}.json`,
          JSON.stringify(requestData, null, 2),
          null,
          `Request: ${requestData.title}`
        );

        return json({ success: true, id: requestData.id });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // ── List projects ──
    if (url.pathname === "/projects" && request.method === "GET") {
      const key = url.searchParams.get("key") || "";
      const client = getClient(key);
      if (!client) return json({ error: "Invalid key" }, 401);

      try {
        const files = await ghListDir("data/requests");
        const projects = [];

        for (const file of files) {
          if (!file.name.endsWith(".json") || file.name === ".gitkeep") continue;
          const data = await ghReadFile(`data/requests/${file.name}`);
          if (data) {
            try {
              const project = JSON.parse(data.content);
              if (isAdmin(key) || project.client === client.name) {
                projects.push(project);
              }
            } catch {}
          }
        }

        projects.sort((a, b) => new Date(b.submitted) - new Date(a.submitted));
        return json({ projects });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    // ── Update project progress (admin only) ──
    if (url.pathname === "/progress" && request.method === "POST") {
      try {
        const body = await request.json();
        if (!isAdmin(body.key))
          return json({ error: "Admin access required" }, 403);
        if (!body.projectId)
          return json({ error: "projectId required" }, 400);

        const filePath = `data/requests/${body.projectId}.json`;
        const file = await ghReadFile(filePath);
        if (!file) return json({ error: "Project not found" }, 404);

        const project = JSON.parse(file.content);
        if (body.status) project.status = body.status;
        if (body.progress !== undefined) project.progress = body.progress;
        if (body.update) {
          project.updates = project.updates || [];
          project.updates.push({
            timestamp: new Date().toISOString(),
            message: body.update,
          });
        }

        await ghWriteFile(
          filePath,
          JSON.stringify(project, null, 2),
          file.sha,
          `Update: ${project.title}`
        );

        return json({ success: true, project });
      } catch (e) {
        return json({ error: e.message }, 500);
      }
    }

    return json({ error: "Not found" }, 404);
  },
};
