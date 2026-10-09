/* Sync between devices through a private GitHub Gist in the user's own GitHub account. */
(function () {
  "use strict";
  var PG = window.PG, $ = PG.$, esc = PG.esc;
  var Sync = PG.Sync = {};
  var FILE = "public-ground-sync.json", API = "https://api.github.com";
  var KEEP_TOMBSTONES_DAYS = 180;
  var cfg = null, busy = false, again = false;

  function load() { return PG.db.get("kv", "sync").then(function (c) { cfg = c || null; }); }
  function store() { return cfg ? PG.db.put("kv", cfg, "sync") : PG.db.del("kv", "sync"); }

  function gh(path, opts) {
    opts = opts || {};
    return fetch(API + path, {
      method: opts.method || "GET",
      headers: Object.assign({ "Accept": "application/vnd.github+json", "Authorization": "Bearer " + (opts.token || cfg.token) }, opts.body ? { "Content-Type": "application/json" } : {}),
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store"
    }).then(function (r) {
      if (r.status === 401) throw new Error("GitHub didn't accept that token. Make a new one with the gist box checked.");
      if (r.status === 403 || r.status === 429) throw new Error("GitHub is limiting requests right now. Sync will try again later.");
      if (r.status === 404) throw new Error("NOT_FOUND");
      if (!r.ok) throw new Error("GitHub error " + r.status);
      return r.json();
    });
  }

  function payload(list) { return JSON.stringify({ app: "public-ground", v: 1, updated: PG.now(), items: list }); }
  function prune(list) {
    var cutoff = Date.now() - KEEP_TOMBSTONES_DAYS * 864e5;
    return list.filter(function (i) { return !i.deleted || Date.parse(i.updated) > cutoff; });
  }
  function clean(i) { var c = Object.assign({}, i); delete c._d; return c; }

  function readGist() {
    return gh("/gists/" + cfg.gistId).then(function (g) {
      var f = g.files && g.files[FILE];
      if (!f) return [];
      var content = f.truncated ? fetch(f.raw_url, { cache: "no-store" }).then(function (r) { return r.text(); }) : Promise.resolve(f.content);
      return content.then(function (txt) { try { return (JSON.parse(txt).items || []); } catch (e) { return []; } });
    });
  }

  function merge(remote) {
    var local = PG.Items.all, toLocal = [], out = new Map(), pushNeeded = false;
    var rmap = new Map(); remote.forEach(function (r) { rmap.set(r.id, r); });
    var ids = new Set(Array.from(local.keys()).concat(Array.from(rmap.keys())));
    ids.forEach(function (id) {
      var l = local.get(id), r = rmap.get(id), pick;
      if (!r) { pick = l; pushNeeded = true; }
      else if (!l) { pick = r; toLocal.push(r); }
      else {
        pick = Date.parse(r.updated) > Date.parse(l.updated) ? r : l;
        if (!pick.deleted && !(l.deleted || r.deleted) && pick.kind === "spot") {
          pick = Object.assign({}, pick); PG.Items.mergeLogs(pick, pick === l ? r : l);
        }
        var pj = JSON.stringify(clean(pick));
        if (pj !== JSON.stringify(clean(l))) toLocal.push(pick);
        if (pj !== JSON.stringify(clean(r))) pushNeeded = true;
      }
      out.set(id, clean(pick));
    });
    return { all: prune(Array.from(out.values())), toLocal: toLocal, pushNeeded: pushNeeded };
  }

  Sync.run = function (manual) {
    if (!cfg || !cfg.gistId) return Promise.resolve();
    if (!PG.isOnline()) { if (manual) PG.toast("Sync needs a signal."); return Promise.resolve(); }
    if (busy) { again = true; return Promise.resolve(); }
    busy = true; render();
    return readGist().then(function (remote) {
      var m = merge(remote);
      var p = m.toLocal.length ? PG.Items.applyRemote(m.toLocal) : Promise.resolve();
      return p.then(function () {
        if (!m.pushNeeded) return;
        return gh("/gists/" + cfg.gistId, { method: "PATCH", body: { files: (function () { var f = {}; f[FILE] = { content: payload(m.all) }; return f; })() } });
      }).then(function () {
        cfg.last = PG.now(); cfg.error = null;
        if (manual) PG.toast(m.toLocal.length ? "Synced. " + m.toLocal.length + " change" + (m.toLocal.length === 1 ? "" : "s") + " came in." : "Synced");
      });
    }).catch(function (err) {
      if (err.message === "NOT_FOUND") { cfg.error = "The sync file on GitHub is gone. Disconnect and connect again to make a new one."; }
      else cfg.error = err.message || "Sync failed";
      if (manual) PG.toast(cfg.error);
    }).then(function () {
      busy = false; store(); render();
      if (again) { again = false; Sync.run(); }
    });
  };
  var soon = PG.debounce(function () { Sync.run(); }, 4000);
  PG.on("items-changed", function () { if (cfg && cfg.gistId) soon(); });

  Sync.connect = function (token) {
    token = (token || "").trim();
    if (!token) { PG.toast("Paste your token first."); return; }
    $("syncConnect").disabled = true; $("syncConnect").textContent = "Connecting...";
    // look for an existing sync file so a second device joins the same one
    gh("/gists?per_page=100", { token: token }).then(function (list) {
      var found = list.find(function (g) { return g.files && g.files[FILE]; });
      if (found) return found.id;
      return gh("/gists", { method: "POST", token: token, body: { description: "Public Ground sync (spots, drawings, tracks)", public: false, files: (function () { var f = {}; f[FILE] = { content: payload([]) }; return f; })() } })
        .then(function (g) { return g.id; });
    }).then(function (gistId) {
      cfg = { token: token, gistId: gistId, last: null, error: null };
      return store().then(function () { PG.toast("Connected. Syncing now..."); return Sync.run(true); });
    }).catch(function (err) {
      PG.toast(err.message === "NOT_FOUND" ? "GitHub didn't find that. Check the token." : err.message || "Couldn't connect to GitHub.");
    }).then(render);
  };
  Sync.disconnect = function () { cfg = null; store().then(render); PG.toast("Sync turned off on this device. Your spots stay here."); };

  function render() {
    var box = $("syncBox"); if (!box) return;
    if (!cfg) {
      box.innerHTML = '<p class="fine" style="margin-top:0">Keeps your spots, drawings, tracks and hunt logs the same on your phone and computer. It stores them in a private file in your own GitHub account. Photos stay on the device that took them.</p>' +
        '<ol class="steps"><li>Open <a href="https://github.com/settings/tokens/new?scopes=gist&description=Public%20Ground%20sync" target="_blank" rel="noopener">GitHub token settings</a> (it opens with the right box checked).</li>' +
        '<li>Set Expiration to <strong>No expiration</strong>, scroll down and tap <strong>Generate token</strong>.</li>' +
        '<li>Copy the token, paste it here and tap Connect. Do the same on your other devices.</li></ol>' +
        '<div class="field"><label for="syncToken">GitHub token</label><input id="syncToken" type="password" autocomplete="off" spellcheck="false" placeholder="ghp_..."></div>' +
        '<div class="tools"><button class="btn primary" id="syncConnect">Connect</button></div>';
      return;
    }
    var st = busy ? "Syncing..." : cfg.error ? cfg.error : cfg.last ? "Last synced " + PG.fmtDate(new Date(cfg.last)) + " at " + PG.fmtTime(new Date(cfg.last)) : "Not synced yet";
    box.innerHTML = '<div class="status ' + (cfg.error ? "err" : "ok") + '">' + esc(st) + '</div>' +
      '<p class="fine">Syncs on its own when you open the app and after every change. Turn it on with the same token on each device.</p>' +
      '<div class="tools"><button class="btn primary" id="syncNow"' + (busy ? " disabled" : "") + '>Sync now</button><button class="btn" id="syncOff">Turn off</button></div>';
  }
  Sync.render = render;
  $("syncBox").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.id === "syncConnect") Sync.connect($("syncToken").value);
    else if (b.id === "syncNow") Sync.run(true);
    else if (b.id === "syncOff") {
      if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Tap again to turn off"; return; }
      Sync.disconnect();
    }
  });

  Sync.init = function () {
    return load().then(function () {
      render();
      if (cfg) Sync.run();
      window.addEventListener("online", function () { Sync.run(); });
      setInterval(function () { if (!document.hidden) Sync.run(); }, 5 * 6e4);
      document.addEventListener("visibilitychange", function () { if (!document.hidden) Sync.run(); });
    });
  };
})();
