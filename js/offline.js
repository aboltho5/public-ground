/* Offline maps: service worker, area downloads (USGS photo, topo, terrain, land data), offline status. */
(function () {
  "use strict";
  var PG = window.PG, $ = PG.$, esc = PG.esc, map = PG.map;
  var Off = PG.Offline = {};
  var TILE_CACHE = "pg-tiles-v1";
  var MAX_TILES = 15000, MAX_Z = 16;
  var EST = { usgs: 28, topo: 14, terrain: 18 }; // rough KB per tile

  // ---------- service worker ----------
  Off.registerSW = function () {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    navigator.serviceWorker.register("sw.js").then(function (reg) {
      reg.addEventListener("updatefound", function () {
        var w = reg.installing; if (!w) return;
        w.addEventListener("statechange", function () {
          if (w.state === "installed" && navigator.serviceWorker.controller) PG.toast("App updated. Reopen it to get the new version.", 5000);
        });
      });
    }).catch(function () {});
  };

  // ---------- online / offline ----------
  var autoSwitched = null;
  function onlineState() {
    var off = !PG.isOnline();
    $("chipOffline").hidden = !off;
    if (off && PG.offlineBases.indexOf(PG.prefs.base) < 0) {
      autoSwitched = PG.prefs.base; PG.setBase("usgs");
      PG.toast("No signal. Switched to the USGS photo map, which works in areas you downloaded.", 4500);
    } else if (!off && autoSwitched) { PG.setBase(autoSwitched); autoSwitched = null; PG.refreshLand(); }
    else if (!off) PG.refreshLand();
  }
  window.addEventListener("online", onlineState);
  window.addEventListener("offline", onlineState);
  Off.initState = onlineState;

  // ---------- tile math for downloads ----------
  function layerUrl(id, z, x, y) {
    if (id === "terrain") return PG.terrainUrl(x, y, z);
    return PG.tileUrls[id].replace("{z}", z).replace("{y}", y).replace("{x}", x);
  }
  function plan(bounds, layers, zMin) {
    var tiles = [], perLayer = {};
    layers.forEach(function (id) {
      perLayer[id] = 0;
      for (var z = zMin; z <= MAX_Z; z++) {
        var r = PG.tile.range(bounds, z);
        for (var x = r.x0; x <= r.x1; x++) for (var y = r.y0; y <= r.y1; y++) { tiles.push(layerUrl(id, z, x, y)); perLayer[id]++; }
      }
    });
    var kb = layers.reduce(function (s, id) { return s + perLayer[id] * EST[id]; }, 0);
    return { tiles: tiles, perLayer: perLayer, mb: kb / 1024 };
  }
  function landPlan(bounds) {
    var cells = [];
    PG.landLayers.forEach(function (cfg) {
      if (cfg.region) {
        var rb = cfg.region;
        if (bounds.getEast() < rb[0] || bounds.getWest() > rb[2] || bounds.getNorth() < rb[1] || bounds.getSouth() > rb[3]) return;
      }
      var r = PG.tile.range(bounds, cfg.cellZ);
      for (var x = r.x0; x <= r.x1; x++) for (var y = r.y0; y <= r.y1; y++) cells.push({ cfg: cfg, z: cfg.cellZ, x: x, y: y });
    });
    return cells;
  }

  // ---------- UI ----------
  var job = null, areas = [], areaRects = L.layerGroup();
  var opts = PG.local.get("publicground.offlineOpts", { usgs: true, topo: true, terrain: false, land: true });

  function loadAreas() { return PG.db.all("areas").then(function (a) { areas = a.sort(function (x, y) { return x.created < y.created ? 1 : -1; }); }); }

  Off.render = function () {
    var box = $("offlineBox");
    if (job) {
      var pct = job.total ? Math.round(job.done / job.total * 100) : 0;
      box.innerHTML = '<div class="status">Downloading <strong>' + esc(job.name) + '</strong>: ' + job.done.toLocaleString() + ' of ' + job.total.toLocaleString() + (job.failed ? ' (' + job.failed + ' skipped)' : '') + '</div>' +
        '<div class="progress"><i style="width:' + pct + '%"></i></div>' +
        '<p class="fine">Keep this page open until it finishes.</p><div class="tools"><button class="btn" id="offCancel">Cancel</button></div>';
      return;
    }
    var z = Math.floor(map.getZoom()), b = map.getBounds();
    var zMin = Math.max(9, Math.min(z, 13) - 1);
    var layers = ["usgs", "topo", "terrain"].filter(function (id) { return opts[id]; });
    var p = plan(b, layers, zMin), tooBig = p.tiles.length > MAX_TILES, tooWide = z < 11;
    var n = areas.length + 1;
    box.innerHTML =
      '<p class="fine" style="margin-top:0">Downloads everything you can see on the map right now, so it works with no signal. Zoom in on your hunting area first.</p>' +
      '<div class="toggle"><input type="checkbox" id="off_usgs"' + (opts.usgs ? " checked" : "") + '><label for="off_usgs">USGS photo map<small>Aerial photos with roads and names</small></label></div>' +
      '<div class="toggle"><input type="checkbox" id="off_topo"' + (opts.topo ? " checked" : "") + '><label for="off_topo">Topo map<small>Contours, trails, creeks</small></label></div>' +
      '<div class="toggle"><input type="checkbox" id="off_terrain"' + (opts.terrain ? " checked" : "") + '><label for="off_terrain">Terrain shading</label></div>' +
      '<div class="toggle"><input type="checkbox" id="off_land"' + (opts.land ? " checked" : "") + '><label for="off_land">Public land and Michigan DNR layers</label></div>' +
      '<div class="field" style="margin-top:10px"><label for="offName">Name this area</label><input id="offName" maxlength="60" value="' + esc(PG.local.get("publicground.offName", "") || "Hunting area " + n) + '"></div>' +
      '<div class="status' + (tooBig || tooWide ? " err" : "") + '">' +
        (tooWide ? "Zoom in closer first. This view is too big to download." :
         tooBig ? "That's " + p.tiles.length.toLocaleString() + " map tiles, more than the " + MAX_TILES.toLocaleString() + " limit. Zoom in a little or turn off a map type." :
         "About " + (p.mb < 1 ? "<1" : Math.round(p.mb)) + " MB, " + p.tiles.length.toLocaleString() + " map tiles, detail down to zoom " + MAX_Z + ".") + '</div>' +
      '<div class="tools"><button class="btn primary" id="offStart"' + (tooBig || tooWide || (!layers.length && !opts.land) ? " disabled" : "") + '>Download this view</button></div>' +
      (areas.length ? '<div class="eyebrow">Downloaded areas</div><div class="list arealist">' + areas.map(function (a) {
        return '<div class="row"><div class="meta"><span class="name">' + esc(a.name) + '</span><span class="sub">' + PG.fmtDate(new Date(a.created)) + ' · ' + a.count.toLocaleString() + ' tiles · about ' + Math.max(1, Math.round(a.mb)) + ' MB</span></div>' +
          '<button class="btn small" data-areago="' + a.id + '">Show</button><button class="btn small danger" data-areadel="' + a.id + '">Delete</button></div>';
      }).join("") + '</div>' : '');
    ["usgs", "topo", "terrain", "land"].forEach(function (id) {
      $("off_" + id).addEventListener("change", function () { opts[id] = this.checked; PG.local.set("publicground.offlineOpts", opts); Off.render(); });
    });
    $("offName").addEventListener("input", function () { PG.local.set("publicground.offName", this.value); });
    showAreaRects();
  };
  $("offlineBox").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.id === "offStart") Off.download();
    else if (b.id === "offCancel" && job) { job.cancelled = true; }
    else if (b.dataset.areago) { var a = areas.find(function (x) { return x.id === b.dataset.areago; }); if (a) { if (window.innerWidth < 900) PG.UI.closeSheets(); map.fitBounds(a.bounds); } }
    else if (b.dataset.areadel) {
      if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Sure?"; b.classList.add("armed"); return; }
      Off.deleteArea(b.dataset.areadel);
    }
  });
  map.on("moveend", PG.debounce(function () { if (!$("sheetMenu").hidden && !job) Off.render(); }, 300));

  function showAreaRects() {
    areaRects.clearLayers();
    areas.forEach(function (a) { L.rectangle(a.bounds, { color: "#e8601c", weight: 2, dashArray: "6 6", fill: false, interactive: false }).addTo(areaRects); });
    if (!map.hasLayer(areaRects)) areaRects.addTo(map);
  }
  Off.hideAreaRects = function () { if (map.hasLayer(areaRects)) map.removeLayer(areaRects); };

  // ---------- download ----------
  Off.download = function () {
    if (job) return;
    if (!("caches" in window)) { PG.toast("This browser can't store offline maps. Try Safari or Chrome."); return; }
    if (!PG.isOnline()) { PG.toast("You need a signal to download maps."); return; }
    var b = map.getBounds(), z = Math.floor(map.getZoom()), zMin = Math.max(9, Math.min(z, 13) - 1);
    var layers = ["usgs", "topo", "terrain"].filter(function (id) { return opts[id]; });
    var p = plan(b, layers, zMin), cells = opts.land ? landPlan(b) : [];
    var name = ($("offName").value || "").trim() || "Hunting area";
    job = { name: name, total: p.tiles.length + cells.length, done: 0, failed: 0, cancelled: false };
    PG.persist(); Off.render();
    var renderSoon = PG.debounce(function () { if (!$("sheetMenu").hidden) Off.render(); }, 250);

    caches.open(TILE_CACHE).then(function (cache) {
      var i = 0, saved = [];
      function next() {
        if (job.cancelled || i >= p.tiles.length) return Promise.resolve();
        var url = p.tiles[i++];
        return cache.match(url).then(function (hit) {
          if (hit) return true;
          return fetch(url, { mode: "cors" }).catch(function () { return fetch(url, { mode: "no-cors" }); }).then(function (r) {
            if (!r || (!r.ok && r.type !== "opaque")) throw new Error("bad");
            return cache.put(url, r);
          });
        }).then(function () { saved.push(url); }, function () { job.failed++; })
          .then(function () { job.done++; renderSoon(); return next(); });
      }
      var workers = []; for (var w = 0; w < 6; w++) workers.push(next());
      return Promise.all(workers).then(function () {
        if (job.cancelled) return saved;
        return cells.reduce(function (pr, c) {
          return pr.then(function () {
            if (job.cancelled) return;
            return PG.getLandCell(c.cfg, c.z, c.x, c.y, { forceNet: true }).catch(function () { job.failed++; }).then(function () { job.done++; renderSoon(); });
          });
        }, Promise.resolve()).then(function () { return saved; });
      });
    }).then(function (saved) {
      var cancelled = job.cancelled, failed = job.failed;
      var area = { id: PG.uid(), name: name, bounds: [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]], urls: saved, count: saved.length,
        mb: layers.reduce(function (s, id) { return s + p.perLayer[id] * EST[id]; }, 0) / 1024 * (saved.length / Math.max(1, p.tiles.length)), created: PG.now() };
      job = null;
      PG.local.del("publicground.offName");
      return (saved.length ? PG.db.put("areas", area) : Promise.resolve()).then(loadAreas).then(function () {
        Off.render(); Off.storageInfo();
        PG.toast(cancelled ? "Download stopped. What finished is saved." : failed > 20 ? "Downloaded, but " + failed + " pieces failed. Try again on better Wi-Fi to fill gaps." : "“" + name + "” is ready for offline use");
      });
    }).catch(function () { job = null; Off.render(); PG.toast("Download failed. Check your connection and try again."); });
  };

  Off.deleteArea = function (id) {
    var a = areas.find(function (x) { return x.id === id; }); if (!a) return;
    var keep = new Set(); areas.forEach(function (o) { if (o.id !== id) (o.urls || []).forEach(function (u) { keep.add(u); }); });
    caches.open(TILE_CACHE).then(function (cache) {
      return Promise.all((a.urls || []).filter(function (u) { return !keep.has(u); }).map(function (u) { return cache.delete(u); }));
    }).then(function () { return PG.db.del("areas", id); }).then(loadAreas).then(function () { Off.render(); Off.storageInfo(); PG.toast("Offline area deleted"); });
  };

  Off.storageInfo = function () {
    if (!navigator.storage || !navigator.storage.estimate) return;
    navigator.storage.estimate().then(function (e) {
      $("storageInfo").textContent = "Using about " + Math.max(1, Math.round((e.usage || 0) / 1048576)) + " MB on this device for maps, photos and spots.";
    }).catch(function () {});
  };

  Off.init = function () {
    Off.registerSW();
    onlineState();
    return loadAreas();
  };
})();
