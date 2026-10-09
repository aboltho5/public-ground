/* Your stuff: spots, drawn lines and areas, tracks. Storage, map rendering, list, editor, photos, hunt log, sharing, import/export. */
(function () {
  "use strict";
  var PG = window.PG, $ = PG.$, esc = PG.esc, map = PG.map;

  var TYPES = [
    { id: "stand", label: "Stand", glyph: "S", color: "#e8601c" },
    { id: "blind", label: "Blind", glyph: "B", color: "#7a5230" },
    { id: "camera", label: "Trail cam", glyph: "C", color: "#2b6cb0" },
    { id: "sign", label: "Rub/scrape", glyph: "R", color: "#b33a2f" },
    { id: "bedding", label: "Bedding", glyph: "Bd", color: "#5d7a2c" },
    { id: "water", label: "Water", glyph: "W", color: "#1f8a95" },
    { id: "parking", label: "Parking", glyph: "P", color: "#4a5560" },
    { id: "other", label: "Other", glyph: "•", color: "#6b4fa0" }
  ];
  var TYPE = {}; TYPES.forEach(function (t) { TYPE[t.id] = t; });
  var COLORS = ["#e8601c", "#f2c230", "#2f8a3c", "#1d6fa5", "#a23fb5", "#c62f2f", "#ffffff", "#111111"];
  var KIND_LABEL = { spot: "Spot", line: "Line", area: "Area", track: "Track" };
  var ICON_LINE = '<svg viewBox="0 0 24 24"><path d="M4 18 10 8l5 6 5-9"/></svg>';
  var ICON_AREA = '<svg viewBox="0 0 24 24"><path d="M5 6 18 4l2 12-9 4-6-6z"/></svg>';
  var ICON_TRACK = '<svg viewBox="0 0 24 24"><path d="M5 20c2-6 6-2 8-8s5-5 6-8"/><circle cx="5" cy="20" r="1.5"/></svg>';

  var items = new Map();
  var Items = PG.Items = { TYPES: TYPES, TYPE: TYPE, COLORS: COLORS, all: items };

  Items.list = function () { return Array.from(items.values()).filter(function (i) { return !i.deleted; }); };
  Items.get = function (id) { var i = items.get(id); return i && !i.deleted ? i : null; };

  // ---------- load + migrate ----------
  Items.load = function () {
    return PG.db.all("items").then(function (rows) {
      rows.forEach(function (r) { items.set(r.id, r); });
      var legacy = PG.local.get("publicground.spots.v1", null);
      if (legacy && legacy.length) {
        var add = legacy.filter(function (s) { return !items.has(s.id); }).map(function (s) {
          return { id: s.id, kind: "spot", name: s.name, type: s.type || "other", notes: s.notes || "", group: "", goodWinds: [], log: [], logDeleted: [],
            lat: s.lat, lng: s.lng, created: s.created || PG.now(), updated: s.updated || PG.now() };
        });
        add.forEach(function (i) { items.set(i.id, i); });
        return PG.db.putMany("items", add).then(function () { PG.local.set("publicground.spots.v1.migrated", legacy); PG.local.del("publicground.spots.v1"); });
      }
    }).then(function () { Items.render(); });
  };

  function normalize(i) {
    i.group = i.group || ""; i.notes = i.notes || ""; i.log = i.log || []; i.logDeleted = i.logDeleted || []; i.goodWinds = i.goodWinds || [];
    return i;
  }
  Items.save = function (item, opts) {
    normalize(item);
    item.updated = PG.now(); if (!item.created) item.created = item.updated;
    items.set(item.id, item);
    return PG.db.put("items", item).then(function () {
      Items.render();
      if (!(opts && opts.quiet)) PG.emit("items-changed");
      PG.persist();
    }, function () { PG.toast("Couldn't save. Your browser may be blocking storage."); });
  };
  Items.remove = function (id) {
    var tomb = { id: id, deleted: true, updated: PG.now() };
    items.set(id, tomb);
    return PG.db.put("items", tomb).then(function () {
      return Photos.forItem(id).then(function (ps) { return Promise.all(ps.map(function (p) { return PG.db.del("photos", p.id); })); });
    }).then(function () { Items.render(); PG.emit("items-changed"); });
  };
  // used by sync: replace many items at once without bumping their timestamps
  Items.applyRemote = function (list) {
    list.forEach(function (i) { items.set(i.id, i); });
    return PG.db.putMany("items", list).then(function () { Items.render(); });
  };

  // ---------- geometry helpers ----------
  Items.anchor = function (i) {
    if (i.kind === "spot") return [i.lat, i.lng];
    if (i.kind === "area") {
      var la = 0, ln = 0; i.pts.forEach(function (p) { la += p[0]; ln += p[1]; }); return [la / i.pts.length, ln / i.pts.length];
    }
    return i.pts[0];
  };
  Items.measure = function (i) {
    if (i.kind === "area") return PG.fmtAcres(PG.polyArea(i.pts));
    if (i.kind === "line" || i.kind === "track") return PG.fmtDist(PG.lineLength(i.pts));
    return "";
  };

  // ---------- wind match ----------
  Items.windState = function (i) {
    var w = PG.Field && PG.Field.windNow && PG.Field.windNow();
    if (!w || !i.goodWinds || !i.goodWinds.length) return null;
    if (w.speed < 2) return null;
    return i.goodWinds.indexOf(PG.dirName(w.dir)) >= 0 ? "good" : "bad";
  };

  // ---------- map rendering ----------
  var spotLayer = L.layerGroup().addTo(map);
  var shapeLayer = L.layerGroup().addTo(map);
  var markers = {}, shapes = {};

  function glyph(i, size) {
    if (i.kind === "spot") {
      var t = TYPE[i.type] || TYPE.other;
      return '<div class="glyph" style="background:' + t.color + (size ? ';width:' + size + 'px;height:' + size + 'px' : '') + '">' + esc(t.glyph) + '</div>';
    }
    var icon = i.kind === "area" ? ICON_AREA : i.kind === "track" ? ICON_TRACK : ICON_LINE;
    var c = i.color || "#e8601c";
    return '<div class="glyph shape" style="background:' + (c === "#ffffff" ? "#8a8a8a" : c) + '">' + icon + '</div>';
  }
  Items.glyph = glyph;

  function iconFor(i) {
    var t = TYPE[i.type] || TYPE.other, ws = Items.windState(i);
    return L.divIcon({ className: "spot-icon", html: '<div class="glyph' + (ws ? " " + ws + "wind" : "") + '" style="background:' + t.color + '">' + esc(t.glyph) + '</div>', iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] });
  }

  function lastSit(i) {
    var l = (i.log || []).slice().sort(function (a, b) { return a.t < b.t ? 1 : -1; })[0];
    if (!l) return "";
    return "Last sat " + PG.fmtDate(new Date(l.t)) + (l.wind ? ", " + l.wind + " wind" : "") + (l.seen != null && l.seen !== "" ? ", saw " + l.seen : "");
  }

  function popupHtml(i) {
    var tag, color;
    if (i.kind === "spot") { var t = TYPE[i.type] || TYPE.other; tag = t.label; color = t.color; }
    else { tag = KIND_LABEL[i.kind]; color = i.color === "#ffffff" ? "#8a8a8a" : (i.color || "#e8601c"); }
    var ws = Items.windState(i), sub = [];
    if (i.kind !== "spot") sub.push(Items.measure(i));
    if (i.kind === "track" && i.times && i.times.length > 1) sub.push(PG.fmtDuration(i.times[i.times.length - 1] - i.times[0]) + " on " + PG.fmtDate(new Date(i.times[0])));
    if (i.group) sub.push(i.group);
    var notes = i.notes ? (i.notes.length > 220 ? i.notes.slice(0, 220) + "..." : i.notes) : "";
    var a = Items.anchor(i);
    return '<div class="pop">' +
      '<span class="tag" style="background:' + color + '">' + esc(tag) + '</span>' +
      (ws === "good" ? '<span class="badge">Good wind now</span>' : '') +
      '<h3>' + esc(i.name) + '</h3>' +
      (sub.length ? '<div class="tip">' + esc(sub.join(" · ")) + '</div>' : '') +
      (notes ? '<div style="white-space:pre-wrap;margin-top:4px">' + esc(notes) + '</div>' : '') +
      (lastSit(i) ? '<div class="tip">' + esc(lastSit(i)) + '</div>' : '') +
      '<div class="popthumb" data-thumb="' + i.id + '"></div>' +
      (i.kind === "spot" ? '<div class="mono" style="color:var(--muted);margin-top:6px">' + PG.fmtLL(i.lat, i.lng) + '</div>' : '') +
      '<div class="acts">' +
        '<button class="go" data-nav="' + i.id + '">' + (i.kind === "track" ? "Back to start" : "Go to") + '</button>' +
        '<button data-edit="' + i.id + '">Edit</button>' +
        '<button data-share="' + i.id + '">Share</button>' +
        '<a href="https://www.google.com/maps/dir/?api=1&destination=' + a[0].toFixed(6) + ',' + a[1].toFixed(6) + '" target="_blank" rel="noopener">Drive</a>' +
      '</div></div>';
  }

  function hidden(i) { return (PG.prefs.hiddenGroups || []).indexOf(i.group || "") >= 0; }

  Items.render = function () {
    spotLayer.clearLayers(); shapeLayer.clearLayers(); markers = {}; shapes = {};
    Items.list().forEach(function (i) {
      if (hidden(i)) return;
      var lyr;
      if (i.kind === "spot") {
        lyr = L.marker([i.lat, i.lng], { icon: iconFor(i), riseOnHover: true }).addTo(spotLayer);
        markers[i.id] = lyr;
      } else {
        var c = i.color || (i.kind === "track" ? "#ff3b30" : "#e8601c");
        var opts = { pane: "shapes", color: c, weight: i.kind === "track" ? 4 : 3.5, opacity: .95, bubblingMouseEvents: false };
        if (i.kind === "track") opts.dashArray = "1 7", opts.lineCap = "round", opts.weight = 5;
        if (i.kind === "area") lyr = L.polygon(i.pts, Object.assign(opts, { fillColor: c, fillOpacity: .18 }));
        else lyr = L.polyline(i.pts, opts);
        lyr.addTo(shapeLayer); shapes[i.id] = lyr;
      }
      lyr.bindPopup(function () { return popupHtml(i); }, { maxWidth: 300 });
      lyr.on("popupopen", function () { fillThumb(i.id); });
    });
    if (!$("sheetSpots").hidden) Items.renderList();
  };
  Items.refreshIcons = function () {
    Items.list().forEach(function (i) { if (markers[i.id]) markers[i.id].setIcon(iconFor(i)); });
    if (!$("sheetSpots").hidden) Items.renderList();
  };
  Items.focus = function (id) {
    var i = Items.get(id); if (!i) return;
    if (hidden(i)) { PG.prefs.hiddenGroups = PG.prefs.hiddenGroups.filter(function (g) { return g !== (i.group || ""); }); PG.savePrefs(); Items.render(); }
    if (i.kind === "spot") map.setView([i.lat, i.lng], Math.max(map.getZoom(), 16));
    else map.fitBounds(L.latLngBounds(i.pts), { maxZoom: 17, padding: [40, 40] });
    setTimeout(function () { var l = markers[id] || shapes[id]; if (l) l.openPopup(Items.anchor(i)); }, 350);
  };

  function fillThumb(id) {
    Photos.forItem(id).then(function (ps) {
      var el = document.querySelector('[data-thumb="' + id + '"]'); if (!el || !ps.length) return;
      var url = URL.createObjectURL(ps[0].thumb || ps[0].blob);
      el.innerHTML = '<img class="thumb" alt="" src="' + url + '">';
    });
  }

  // ---------- list ----------
  Items.renderList = function () {
    var el = $("spotList"), q = ($("spotFilter").value || "").trim().toLowerCase();
    var all = Items.list();
    if (!all.length) {
      el.innerHTML = '<p class="empty">Nothing saved yet. Tap the orange pin to mark a stand, cam or sign, or press and hold anywhere on the map. Lines, areas and tracks you save show up here too.</p>';
      return;
    }
    var from = PG.gps && PG.gps.last ? [PG.gps.last.lat, PG.gps.last.lng] : [map.getCenter().lat, map.getCenter().lng];
    var fromLabel = PG.gps && PG.gps.last ? "from you" : "from map center";
    var list = all.filter(function (i) { return !q || (i.name + " " + i.group + " " + i.notes).toLowerCase().indexOf(q) >= 0; });
    var groups = {};
    list.forEach(function (i) { (groups[i.group || ""] = groups[i.group || ""] || []).push(i); });
    var names = Object.keys(groups).sort(function (a, b) { return a === "" ? 1 : b === "" ? -1 : a.localeCompare(b); });
    var hiddenG = PG.prefs.hiddenGroups || [];
    el.innerHTML = names.map(function (g) {
      var dist = new Map();
      groups[g].forEach(function (i) { dist.set(i.id, PG.distance(from, Items.anchor(i))); });
      var rows = groups[g].slice().sort(function (a, b) { return dist.get(a.id) - dist.get(b.id); });
      var off = hiddenG.indexOf(g) >= 0;
      var head = (names.length > 1 || g) ? '<div class="grouphead' + (off ? " off" : "") + '"><strong>' + esc(g || "No group") + '</strong><small>' + rows.length + '</small>' +
        '<button class="eye" data-eye="' + esc(g) + '" aria-label="' + (off ? "Show" : "Hide") + ' this group on the map" title="' + (off ? "Show on map" : "Hide on map") + '">' +
        (off ? '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.6M6.3 7.6C3.9 9.3 2.5 12 2.5 12s3.5 6 9.5 6c1.6 0 3-.4 4.2-1"/></svg>'
             : '<svg viewBox="0 0 24 24"><path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z"/><circle cx="12" cy="12" r="2.8"/></svg>') +
        '</button></div>' : '';
      return head + rows.map(function (i) {
        var t = i.kind === "spot" ? (TYPE[i.type] || TYPE.other).label : KIND_LABEL[i.kind] + " · " + Items.measure(i);
        var good = Items.windState(i) === "good" ? '<span class="badge">Good wind</span>' : '';
        return '<button class="row" data-go="' + i.id + '">' + glyph(i) +
          '<span class="meta"><span class="name">' + esc(i.name) + good + '</span><span class="sub">' + esc(t) + ' · ' + PG.fmtDist(dist.get(i.id)) + ' ' + fromLabel + '</span></span></button>';
      }).join("");
    }).join("") || '<p class="empty">Nothing matches that filter.</p>';
  };
  $("spotFilter").addEventListener("input", Items.renderList);
  $("spotList").addEventListener("click", function (e) {
    var eye = e.target.closest("[data-eye]");
    if (eye) {
      var g = eye.dataset.eye, h = PG.prefs.hiddenGroups || [];
      PG.prefs.hiddenGroups = h.indexOf(g) >= 0 ? h.filter(function (x) { return x !== g; }) : h.concat([g]);
      PG.savePrefs(); Items.render(); Items.renderList(); return;
    }
    var b = e.target.closest("[data-go]"); if (!b) return;
    if (window.innerWidth < 900) PG.UI.closeSheets();
    Items.focus(b.dataset.go);
  });

  // ---------- photos ----------
  var Photos = Items.Photos = {
    forItem: function (itemId) { return PG.db.byIndex("photos", "itemId", itemId).then(function (ps) { return ps.sort(function (a, b) { return a.created < b.created ? -1 : 1; }); }); },
    add: function (itemId, file) {
      return resize(file, 1600, 0.82).then(function (blob) {
        return resize(blob, 320, 0.7).then(function (thumb) {
          var p = { id: PG.uid(), itemId: itemId, blob: blob, thumb: thumb, created: PG.now() };
          return PG.db.put("photos", p).then(function () { return p; });
        });
      });
    }
  };
  function resize(fileOrBlob, max, q) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(fileOrBlob);
      img.onload = function () {
        var s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? res(b) : rej(new Error("encode failed")); }, "image/jpeg", q);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("That file isn't an image this browser can read.")); };
      img.src = url;
    });
  }

  // ---------- editor ----------
  var ed = null; // { item (draft copy), isNew }
  var thumbUrls = [];

  function buildTypeButtons() {
    $("fTypes").innerHTML = TYPES.map(function (t) {
      return '<button type="button" data-type="' + t.id + '" aria-pressed="false">' + glyph({ kind: "spot", type: t.id }) + '<span>' + esc(t.label) + '</span></button>';
    }).join("");
    $("fColors").innerHTML = COLORS.map(function (c) { return '<button type="button" data-color="' + c + '" style="background:' + c + '" aria-label="Color ' + c + '" aria-pressed="false"></button>'; }).join("");
    var winds = PG.DIRS.map(function (d) { return '<button type="button" data-wind="' + d + '" aria-pressed="false">' + d + '</button>'; }).join("");
    $("fWinds").innerHTML = winds;
    $("lWinds").innerHTML = winds + '<button type="button" data-wind="Calm" aria-pressed="false">Calm</button>';
  }
  buildTypeButtons();

  function pressed(container, attr, values) {
    container.querySelectorAll("[" + attr + "]").forEach(function (b) { b.setAttribute("aria-pressed", String(values.indexOf(b.getAttribute(attr)) >= 0)); });
  }
  $("fTypes").addEventListener("click", function (e) { var b = e.target.closest("[data-type]"); if (!b || !ed) return; ed.item.type = b.dataset.type; pressed($("fTypes"), "data-type", [ed.item.type]); });
  $("fColors").addEventListener("click", function (e) { var b = e.target.closest("[data-color]"); if (!b || !ed) return; ed.item.color = b.dataset.color; pressed($("fColors"), "data-color", [ed.item.color]); });
  $("fWinds").addEventListener("click", function (e) {
    var b = e.target.closest("[data-wind]"); if (!b || !ed) return;
    var w = b.dataset.wind, g = ed.item.goodWinds;
    ed.item.goodWinds = g.indexOf(w) >= 0 ? g.filter(function (x) { return x !== w; }) : g.concat([w]);
    pressed($("fWinds"), "data-wind", ed.item.goodWinds);
  });

  function groupOptions() {
    var gs = {}; Items.list().forEach(function (i) { if (i.group) gs[i.group] = 1; });
    $("groupList").innerHTML = Object.keys(gs).sort().map(function (g) { return '<option value="' + esc(g) + '">'; }).join("");
  }

  Items.openEditor = function (id, draft) {
    var src = id ? Items.get(id) : draft;
    if (!src) return;
    ed = { item: normalize(JSON.parse(JSON.stringify(src))), isNew: !id };
    if (!ed.item.id) ed.item.id = PG.uid();
    var i = ed.item, isSpot = i.kind === "spot";
    $("editTitle").textContent = (ed.isNew ? "New " : "Edit ") + KIND_LABEL[i.kind].toLowerCase();
    $("fName").value = i.name || "";
    $("fName").placeholder = isSpot ? "e.g. Oak ridge ladder stand" : i.kind === "area" ? "e.g. Cedar swamp bedding" : i.kind === "track" ? "e.g. Walk in, north gate" : "e.g. Trail to the creek crossing";
    $("fGroup").value = i.group || "";
    $("fNotes").value = i.notes || "";
    $("fTypeField").hidden = !isSpot; $("fWindField").hidden = !isSpot; $("fLogField").hidden = !isSpot;
    $("fColorField").hidden = isSpot;
    $("fMove").hidden = !(isSpot && !ed.isNew);
    $("fDelete").hidden = ed.isNew;
    if (isSpot) { i.type = i.type || PG.local.get("publicground.lastType", "stand"); pressed($("fTypes"), "data-type", [i.type]); pressed($("fWinds"), "data-wind", i.goodWinds); }
    else { i.color = i.color || (i.kind === "track" ? "#c62f2f" : "#e8601c"); pressed($("fColors"), "data-color", [i.color]); }
    $("fCoord").textContent = isSpot ? PG.fmtLL(i.lat, i.lng) : Items.measure(i) + " · " + i.pts.length + " points";
    groupOptions(); renderPhotos(); renderLog(); disarm();
    PG.UI.openSheet("sheetEdit");
    if (ed.isNew && window.innerWidth >= 900) setTimeout(function () { $("fName").focus(); }, 60);
  };
  Items.newSpot = function (latlng) {
    Items.openEditor(null, { kind: "spot", lat: latlng.lat, lng: latlng.lng, name: "", group: PG.local.get("publicground.lastGroup", "") });
  };
  Items.newShape = function (kind, pts, extra) {
    Items.openEditor(null, Object.assign({ kind: kind, pts: pts, name: "", group: PG.local.get("publicground.lastGroup", "") }, extra || {}));
  };
  Items.editing = function () { return ed; };
  Items.closeEditor = function () {
    if (ed && ed.isNew) { // drop photos taken for a spot that was never saved
      var id = ed.item.id;
      Photos.forItem(id).then(function (ps) { ps.forEach(function (p) { PG.db.del("photos", p.id); }); });
    }
    ed = null; revokeThumbs();
  };

  $("editForm").addEventListener("submit", function (e) {
    e.preventDefault(); if (!ed) return;
    var i = ed.item;
    i.name = $("fName").value.trim() || defaultName(i);
    i.group = $("fGroup").value.trim();
    i.notes = $("fNotes").value.trim();
    if (i.kind === "spot") PG.local.set("publicground.lastType", i.type);
    PG.local.set("publicground.lastGroup", i.group);
    // keep any sits logged while the editor was open
    var stored = items.get(i.id);
    if (stored && !stored.deleted) mergeLogs(i, stored);
    var wasNew = ed.isNew; ed.isNew = false; ed = null; revokeThumbs();
    PG.UI.closeSheets();
    Items.save(i).then(function () { PG.toast(wasNew ? "Saved" : "Changes saved"); });
  });
  function defaultName(i) {
    if (i.kind === "spot") return (TYPE[i.type] || TYPE.other).label + " " + (Items.list().filter(function (x) { return x.kind === "spot"; }).length + 1);
    if (i.kind === "track") return "Track " + PG.fmtDate(new Date(i.times ? i.times[0] : Date.now()));
    return KIND_LABEL[i.kind] + " " + Items.measure(i);
  }
  function mergeLogs(into, other) {
    var del = {}; (into.logDeleted || []).concat(other.logDeleted || []).forEach(function (id) { del[id] = 1; });
    var byId = {}; (into.log || []).concat(other.log || []).forEach(function (l) { if (!del[l.id]) byId[l.id] = l; });
    into.log = Object.keys(byId).map(function (k) { return byId[k]; });
    into.logDeleted = Object.keys(del);
  }
  Items.mergeLogs = mergeLogs;

  $("fMove").addEventListener("click", function () {
    if (!ed) return; var i = ed.item; var id = i.id;
    PG.UI.closeSheets(); ed = null;
    map.setView([i.lat, i.lng], Math.max(map.getZoom(), 16));
    PG.UI.startPlacing(function (ll) {
      var s = Items.get(id); if (!s) return;
      s.lat = ll.lat; s.lng = ll.lng; Items.save(s).then(function () { PG.toast("Spot moved"); Items.openEditor(id); });
    }, "Move here", function () { Items.openEditor(id); });
  });

  var armTimer;
  function disarm() { var b = $("fDelete"); b.classList.remove("armed"); b.textContent = "Delete"; clearTimeout(armTimer); }
  $("fDelete").addEventListener("click", function () {
    var b = this; if (!ed) return;
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Tap again to delete"; armTimer = setTimeout(disarm, 3500); return; }
    var id = ed.item.id; ed = null; revokeThumbs(); PG.UI.closeSheets();
    Items.remove(id).then(function () { PG.toast("Deleted"); });
  });

  // photos in editor
  function revokeThumbs() { thumbUrls.forEach(URL.revokeObjectURL); thumbUrls = []; }
  function renderPhotos() {
    if (!ed) return; revokeThumbs();
    Photos.forItem(ed.item.id).then(function (ps) {
      $("fPhotos").innerHTML = ps.map(function (p) {
        var u = URL.createObjectURL(p.thumb || p.blob); thumbUrls.push(u);
        return '<button type="button" data-photo="' + p.id + '"><img alt="Photo" src="' + u + '"></button>';
      }).join("");
    });
  }
  $("fAddPhoto").addEventListener("click", function () { $("fPhotoInput").click(); });
  $("fPhotoInput").addEventListener("change", function () {
    var files = Array.from(this.files || []); this.value = ""; if (!ed || !files.length) return;
    var id = ed.item.id;
    PG.toast("Adding " + files.length + " photo" + (files.length > 1 ? "s" : "") + "...");
    files.reduce(function (p, f) { return p.then(function () { return Photos.add(id, f); }); }, Promise.resolve())
      .then(function () { renderPhotos(); PG.persist(); }, function (err) { PG.toast(err.message || "Couldn't add that photo."); });
  });
  $("fPhotos").addEventListener("click", function (e) { var b = e.target.closest("[data-photo]"); if (b) openViewer(b.dataset.photo); });

  var viewing = null, viewerUrl = null;
  function openViewer(photoId) {
    PG.db.get("photos", photoId).then(function (p) {
      if (!p) return;
      viewing = p; if (viewerUrl) URL.revokeObjectURL(viewerUrl);
      viewerUrl = URL.createObjectURL(p.blob); $("viewerImg").src = viewerUrl; $("viewer").hidden = false;
      $("viewerDelete").classList.remove("armed"); $("viewerDelete").textContent = "Delete photo";
    });
  }
  function closeViewer() { $("viewer").hidden = true; $("viewerImg").removeAttribute("src"); if (viewerUrl) URL.revokeObjectURL(viewerUrl); viewerUrl = null; viewing = null; }
  $("viewerClose").addEventListener("click", closeViewer);
  $("viewerDelete").addEventListener("click", function () {
    var b = this; if (!viewing) return;
    if (!b.classList.contains("armed")) { b.classList.add("armed"); b.textContent = "Tap again to delete"; return; }
    PG.db.del("photos", viewing.id).then(function () { closeViewer(); renderPhotos(); PG.toast("Photo deleted"); });
  });

  // ---------- hunt log ----------
  function renderLog() {
    if (!ed) return;
    var log = (ed.item.log || []).slice().sort(function (a, b) { return a.t < b.t ? 1 : -1; });
    $("fLog").innerHTML = log.length ? log.map(function (l) {
      var d = new Date(l.t);
      var head = PG.fmtDate(d) + " " + PG.fmtTime(d) + (l.wind ? " · " + l.wind + (l.wind === "Calm" ? "" : " wind") : "") + (l.seen != null && l.seen !== "" ? " · saw " + l.seen : "");
      return '<div class="logentry"><div class="meta"><strong>' + esc(head) + '</strong>' + (l.notes ? '<p>' + esc(l.notes) + '</p>' : '') + '</div>' +
        '<button type="button" class="logdel" data-dellog="' + l.id + '" aria-label="Delete this sit">&times;</button></div>';
    }).join("") + '<small class="fine">' + log.length + ' sit' + (log.length === 1 ? '' : 's') + ' logged</small>' : '<p class="empty">No sits logged yet.</p>';
  }
  $("fLog").addEventListener("click", function (e) {
    var b = e.target.closest("[data-dellog]"); if (!b || !ed) return;
    var lid = b.dataset.dellog;
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Delete?"; b.style.fontSize = "12px"; return; }
    ed.item.log = ed.item.log.filter(function (l) { return l.id !== lid; });
    ed.item.logDeleted = (ed.item.logDeleted || []).concat([lid]);
    commitLog(); renderLog();
  });
  function commitLog() {
    if (!ed || ed.isNew) return;
    var stored = Items.get(ed.item.id); if (!stored) return;
    stored.log = ed.item.log.slice(); stored.logDeleted = ed.item.logDeleted.slice();
    Items.save(stored, { quiet: false });
  }
  var logWind = "";
  $("fAddLog").addEventListener("click", function () {
    var now = new Date(); now.setSeconds(0, 0);
    $("lWhen").value = new Date(now.getTime() - now.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
    var w = PG.Field && PG.Field.windNow && PG.Field.windNow();
    logWind = w ? (w.speed < 2 ? "Calm" : PG.dirName(w.dir)) : "";
    pressed($("lWinds"), "data-wind", [logWind]);
    $("lSeen").value = ""; $("lNotes").value = "";
    PG.UI.openSheet("sheetLog", { keepEditor: true });
  });
  $("lWinds").addEventListener("click", function (e) { var b = e.target.closest("[data-wind]"); if (!b) return; logWind = logWind === b.dataset.wind ? "" : b.dataset.wind; pressed($("lWinds"), "data-wind", [logWind]); });
  function backToEditor() { PG.UI.openSheet("sheetEdit", { keepEditor: true }); }
  $("logCancel").addEventListener("click", backToEditor);
  $("logCancelX").addEventListener("click", backToEditor);
  $("logForm").addEventListener("submit", function (e) {
    e.preventDefault(); if (!ed) { backToEditor(); return; }
    var when = $("lWhen").value ? new Date($("lWhen").value) : new Date();
    var seen = $("lSeen").value === "" ? null : Math.max(0, parseInt($("lSeen").value, 10) || 0);
    ed.item.log.push({ id: PG.uid(), t: when.toISOString(), wind: logWind, seen: seen, notes: $("lNotes").value.trim() });
    commitLog(); renderLog(); backToEditor(); PG.toast("Sit logged");
  });

  // ---------- sharing ----------
  function b64urlEncode(str) { var bytes = new TextEncoder().encode(str), bin = ""; bytes.forEach(function (b) { bin += String.fromCharCode(b); }); return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
  function b64urlDecode(s) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; var bin = atob(s), bytes = new Uint8Array(bin.length); for (var k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k); return new TextDecoder().decode(bytes); }
  function thin(pts, max) { if (pts.length <= max) return pts; var step = pts.length / max, out = []; for (var k = 0; k < max; k++) out.push(pts[Math.floor(k * step)]); out.push(pts[pts.length - 1]); return out; }
  function r6(p) { return [+p[0].toFixed(6), +p[1].toFixed(6)]; }

  Items.shareLink = function (i) {
    var o = { k: i.kind, n: i.name };
    if (i.notes) o.no = i.notes.slice(0, 500);
    if (i.kind === "spot") { o.t = i.type; o.p = r6([i.lat, i.lng]); }
    else { o.c = i.color; o.ps = thin(i.pts, 300).map(r6); }
    return location.origin + location.pathname + "#s=" + b64urlEncode(JSON.stringify(o));
  };
  Items.share = function (id) {
    var i = Items.get(id); if (!i) return;
    var url = Items.shareLink(i), text = i.name + " (" + (i.kind === "spot" ? (TYPE[i.type] || TYPE.other).label : KIND_LABEL[i.kind]) + ")";
    if (navigator.share) {
      navigator.share({ title: i.name, text: text, url: url }).catch(function (err) { if (err && err.name !== "AbortError") copy(url); });
    } else copy(url);
  };
  function copy(url) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { PG.toast("Link copied. Send it to your buddy."); }, function () { window.prompt("Copy this link:", url); });
    } else window.prompt("Copy this link:", url);
  }
  Items.parseShare = function (hash) {
    var m = /^#s=([A-Za-z0-9_-]+)$/.exec(hash || ""); if (!m) return null;
    try {
      var o = JSON.parse(b64urlDecode(m[1]));
      var base = { name: String(o.n || "Shared spot").slice(0, 80), notes: String(o.no || "").slice(0, 4000), group: "Shared with me" };
      if (o.k === "spot" && o.p) return Object.assign(base, { kind: "spot", type: TYPE[o.t] ? o.t : "other", lat: +o.p[0], lng: +o.p[1] });
      if ((o.k === "line" || o.k === "area" || o.k === "track") && o.ps && o.ps.length > 1)
        return Object.assign(base, { kind: o.k, color: COLORS.indexOf(o.c) >= 0 ? o.c : "#e8601c", pts: o.ps.map(function (p) { return [+p[0], +p[1]]; }) });
    } catch (e) {}
    return null;
  };

  // popup buttons
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-edit],[data-share],[data-nav]"); if (!b) return;
    if (b.dataset.edit) { map.closePopup(); Items.openEditor(b.dataset.edit); }
    else if (b.dataset.share) Items.share(b.dataset.share);
    else if (b.dataset.nav) { map.closePopup(); var i = Items.get(b.dataset.nav); if (i) PG.Field.navigateTo(Items.anchor(i), i.name); }
  });

  // ---------- export / import ----------
  function stamp() { return new Date().toISOString().slice(0, 10); }
  function xmlEsc(s) { return String(s || "").replace(/[<>&'"]/g, function (c) { return { "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]; }); }
  Items.toGeoJSON = function () {
    return { type: "FeatureCollection", features: Items.list().map(function (i) {
      var props = Object.assign({}, i); delete props.lat; delete props.lng; delete props.pts; delete props._d;
      var g;
      if (i.kind === "spot") g = { type: "Point", coordinates: [i.lng, i.lat] };
      else if (i.kind === "area") g = { type: "Polygon", coordinates: [i.pts.concat([i.pts[0]]).map(function (p) { return [p[1], p[0]]; })] };
      else g = { type: "LineString", coordinates: i.pts.map(function (p) { return [p[1], p[0]]; }) };
      return { type: "Feature", geometry: g, properties: props };
    }) };
  };
  Items.exportGeoJSON = function () {
    if (!Items.list().length) { PG.toast("Nothing to export yet"); return; }
    PG.download("public-ground-" + stamp() + ".geojson", JSON.stringify(Items.toGeoJSON(), null, 1), "application/geo+json");
  };
  Items.exportGpx = function (onlyId) {
    var list = onlyId ? [Items.get(onlyId)] : Items.list();
    if (!list.length || !list[0]) { PG.toast("Nothing to export yet"); return; }
    var out = ['<?xml version="1.0" encoding="UTF-8"?>', '<gpx version="1.1" creator="Public Ground" xmlns="http://www.topografix.com/GPX/1/1">'];
    list.filter(function (i) { return i.kind === "spot"; }).forEach(function (s) {
      out.push('  <wpt lat="' + s.lat.toFixed(7) + '" lon="' + s.lng.toFixed(7) + '"><name>' + xmlEsc(s.name) + '</name>' +
        (s.notes ? '<desc>' + xmlEsc(s.notes) + '</desc>' : '') + '<type>' + xmlEsc(s.type) + '</type>' + (s.created ? '<time>' + s.created + '</time>' : '') + '</wpt>');
    });
    list.filter(function (i) { return i.kind !== "spot"; }).forEach(function (t) {
      var pts = t.kind === "area" ? t.pts.concat([t.pts[0]]) : t.pts;
      out.push('  <trk><name>' + xmlEsc(t.name) + '</name>' + (t.notes ? '<desc>' + xmlEsc(t.notes) + '</desc>' : '') + '<type>' + t.kind + '</type><trkseg>' +
        pts.map(function (p, k) { return '<trkpt lat="' + p[0].toFixed(7) + '" lon="' + p[1].toFixed(7) + '">' + (t.times && t.times[k] ? '<time>' + new Date(t.times[k]).toISOString() + '</time>' : '') + '</trkpt>'; }).join("") +
        '</trkseg></trk>');
    });
    out.push("</gpx>");
    var name = onlyId ? list[0].name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "track" : "public-ground-" + stamp();
    PG.download(name + ".gpx", out.join("\n"), "application/gpx+xml");
  };
  Items.importText = function (text) {
    var incoming = [], now = PG.now();
    if (/^\s*</.test(text)) {
      var doc = new DOMParser().parseFromString(text, "application/xml");
      var g = function (el, tag) { var n = el.getElementsByTagName(tag)[0]; return n ? n.textContent : ""; };
      Array.from(doc.getElementsByTagName("wpt")).forEach(function (w) {
        var type = g(w, "type"); if (!TYPE[type]) type = "other";
        incoming.push({ kind: "spot", name: g(w, "name") || "Imported spot", notes: g(w, "desc") || g(w, "cmt"), type: type, lat: +w.getAttribute("lat"), lng: +w.getAttribute("lon"), created: g(w, "time") || now });
      });
      Array.from(doc.getElementsByTagName("trk")).concat(Array.from(doc.getElementsByTagName("rte"))).forEach(function (t) {
        var pts = [], times = [];
        Array.from(t.getElementsByTagName("trkpt")).concat(Array.from(t.getElementsByTagName("rtept"))).forEach(function (p) {
          pts.push([+p.getAttribute("lat"), +p.getAttribute("lon")]); var tm = g(p, "time"); if (tm) times.push(Date.parse(tm));
        });
        if (pts.length < 2) return;
        var kind = g(t, "type"); kind = kind === "area" || kind === "line" ? kind : (t.tagName === "rte" ? "line" : "track");
        if (kind === "area" && pts.length > 3) pts.pop();
        var it = { kind: kind, name: g(t, "name") || "Imported " + kind, notes: g(t, "desc"), pts: pts, color: kind === "track" ? "#c62f2f" : "#e8601c" };
        if (times.length === pts.length) it.times = times;
        incoming.push(it);
      });
    } else {
      var gj = JSON.parse(text);
      (gj.features || []).forEach(function (f) {
        if (!f.geometry) return;
        var p = f.properties || {}, c = f.geometry.coordinates, it = Object.assign({}, p);
        if (f.geometry.type === "Point") { it.kind = "spot"; it.lat = +c[1]; it.lng = +c[0]; if (!TYPE[it.type]) it.type = "other"; }
        else if (f.geometry.type === "LineString") { it.kind = p.kind === "track" ? "track" : "line"; it.pts = c.map(function (q) { return [+q[1], +q[0]]; }); }
        else if (f.geometry.type === "Polygon") { it.kind = "area"; it.pts = c[0].slice(0, -1).map(function (q) { return [+q[1], +q[0]]; }); }
        else return;
        it.name = it.name || "Imported " + it.kind;
        incoming.push(it);
      });
    }
    var have = {};
    Items.list().forEach(function (i) { have[i.id] = 1; have[sig(i)] = 1; });
    var add = [];
    incoming.forEach(function (i) {
      if (i.kind === "spot" && (!isFinite(i.lat) || !isFinite(i.lng))) return;
      if ((i.id && have[i.id]) || have[sig(i)]) return;
      i.id = i.id && !items.has(i.id) ? i.id : PG.uid();
      normalize(i); i.created = i.created || now; i.updated = now; delete i.deleted;
      add.push(i);
    });
    add.forEach(function (i) { items.set(i.id, i); });
    return PG.db.putMany("items", add).then(function () { Items.render(); PG.emit("items-changed"); return add.length; });
  };
  function sig(i) {
    if (i.kind === "spot") return "s" + (+i.lat).toFixed(6) + "," + (+i.lng).toFixed(6) + "," + i.name;
    return i.kind + (i.pts && i.pts[0] ? i.pts[0][0].toFixed(6) + "," + i.pts[0][1].toFixed(6) + "," + i.pts.length : "") + i.name;
  }
})();
