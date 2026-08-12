/* ithacus web dashboard — loopback view client (Sprint 5.27 §3.4).
 *
 * Talks ONLY to the same loopback origin it was loaded from, via relative
 * /api/* paths (no external URL, no wildcard CORS, zero outbound calls —
 * PREVENT-ITH-004). The server injects this session's per-run token into the
 * page; state-changing writes echo it back in the X-Ithacus-Token header.
 */
(function () {
  "use strict";

  // Per-session token injected by the server at serve time (anti-CSRF guard).
  var tok = "";
  (function readToken() {
    var m = document.querySelector('meta[name="ithacus-token"]');
    if (m && m.getAttribute) tok = m.getAttribute("content") || "";
  })();

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmt(d) {
    if (!d) return "—";
    return new Date(d).toLocaleTimeString();
  }

  // ---- tabs ----------------------------------------------------------------
  var tabsEl = $("tabs");
  var panels = {
    dashboard: $("panel-dashboard"),
    live: $("panel-live"),
    inbox: $("panel-inbox"),
    setup: $("panel-setup"),
    guardrails: $("panel-guardrails"),
  };
  function showTab(name) {
    Array.prototype.forEach.call(tabsEl.children, function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === name);
    });
    Object.keys(panels).forEach(function (k) {
      panels[k].classList.toggle("active", k === name);
    });
    if (name === "inbox") refreshInbox();
    if (name === "setup") refreshConfig();
  }
  Array.prototype.forEach.call(tabsEl.children, function (b) {
    b.addEventListener("click", function () { showTab(b.getAttribute("data-tab")); });
  });

  // ---- dashboard poll ------------------------------------------------------
  function renderState(data) {
    var fire = function (id, v) { var n = $(id); if (n) n.textContent = v; };
    fire("stat-pressure", data.pressure != null ? (data.pressure * 100).toFixed(0) + "%" : "—");
    fire("stat-agents", data.crew ? String(data.crew.activeAgents) : "—");
    fire("stat-turn", data.crew ? String(data.crew.currentTurn) : "—");
    fire("stat-running", data.crew && data.crew.running ? data.crew.running : "—");
    fire("stat-repo", data.repo || "—");
    var pct = data.context && data.context.percent != null ? data.context.percent : 0;
    var fill = $("ctx-fill");
    if (fill) fill.style.width = Math.max(0, Math.min(100, pct * 100)) + "%";
    fire("ctx-text", (data.context && data.context.percent != null ? (data.context.percent * 100).toFixed(0) : "0") + "% of " +
      (data.context && data.context.contextWindow ? String(data.context.contextWindow) : "?") + " tokens used");
  }
  function pollState() {
    fetch("/api/state")
      .then(function (r) { return r.json(); })
      .then(renderState)
      .catch(function () { /* transient — keep polling */ });
  }
  pollState();
  setInterval(pollState, 4000);

  // ---- live SSE -------------------------------------------------------------
  var sse = null;
  var log = $("live-log");
  var pill = $("sse-pill");
  function setPill(ok) {
    if (!pill) return;
    pill.textContent = ok ? "connected" : "disconnected";
    pill.classList.toggle("ok", !!ok);
    pill.classList.toggle("bad", !ok);
  }
  function connectLive() {
    setPill(false);
    try {
      sse = new EventSource("/api/events");
    } catch (e) {
      return;
    }
    sse.onopen = function () { setPill(true); };
    sse.onerror = function () { setPill(false); };
    sse.onmessage = function (ev) {
      var line;
      try { line = JSON.stringify(JSON.parse(ev.data)); } catch (e) { line = String(ev.data); }
      var d = el("div", "ev", fmt(Date.now()) + "  ");
      var b = el("b", null, line);
      d.appendChild(b);
      log.appendChild(d);
      while (log.childNodes.length > 400) log.removeChild(log.firstChild);
      log.scrollTop = log.scrollHeight;
    };
  }
  connectLive();

  // ---- inbox ---------------------------------------------------------------
  function refreshInbox() {
    fetch("/api/inbox")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var root = $("inbox-root");
        root.textContent = "";
        var threads = data.threads || [];
        if (!threads.length) {
          root.appendChild(el("p", "muted", "No agent threads yet."));
          return;
        }
        threads.forEach(function (t) {
          var box = el("div", "thread");
          var hdr = el("h3", null, t.agent + " ");
          if (t.unread) hdr.appendChild(el("span", "unread", "(" + t.unread + " unread)"));
          box.appendChild(hdr);
          (t.messages || []).forEach(function (m) {
            var row = el("div", "msg");
            var who = el("span", "who", "[" + (m.from || "?") + "] ");
            var txt = el("span", "txt", String(m.text || ""));
            var ts = el("span", "muted", " " + fmt(m.ts));
            row.appendChild(who);
            row.appendChild(txt);
            row.appendChild(ts);
            box.appendChild(row);
          });
          root.appendChild(box);
        });
      })
      .catch(function () { /* transient */ });
  }
  setInterval(refreshInbox, 6000);

  // ---- setup (ui flags) -----------------------------------------------------
  var flagMeta = [
    ["liveCard", "Live agent card", "Live card overlay in the TUI"],
    ["webUi", "Web dashboard", "Loopback /api + dashboard server"],
    ["widget", "Status widget", "Version/crew status widget"],
    ["menuOverlay", "Menu overlay", "Persistent status overlay"],
    ["notifications", "Notifications", "Notify surface for events"],
  ];
  var currentFlags = {};
  function refreshConfig() {
    fetch("/api/config")
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var ui = data.ui || {};
        currentFlags = {};
        var root = $("flags-root");
        root.textContent = "";
        flagMeta.forEach(function (f) {
          var id = f[0], label = f[1], desc = f[2];
          var on = ui[id] !== false;
          currentFlags[id] = on;
          var row = el("div", "flag");
          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = on;
          cb.setAttribute("data-flag", id);
          cb.addEventListener("change", function () { currentFlags[id] = cb.checked; });
          var lblWrap = el("label", null, label);
          var descEl = el("div", "desc", desc);
          lblWrap.appendChild(descEl);
          row.appendChild(cb);
          row.appendChild(lblWrap);
          root.appendChild(row);
        });
        var save = el("button", "save", "Save flags");
        save.addEventListener("click", saveFlags);
        root.appendChild(save);
      })
      .catch(function () { /* transient */ });
  }
  function saveFlags() {
    var status = $("save-status");
    var body;
    try { body = JSON.stringify({ token: tok, ui: currentFlags }); }
    catch (e) { if (status) status.textContent = "encode failed"; return; }
    fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Ithacus-Token": tok },
      body: body,
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (status) {
          status.textContent = data.ok ? "Saved — written to .ithacus/config.json" : ("Error: " + (data.error || "unknown"));
        }
        refreshConfig();
      })
      .catch(function () { if (status) status.textContent = "save failed (is the server running?)"; });
  }

  showTab("dashboard");
})();
