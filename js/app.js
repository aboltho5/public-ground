/* App shell: sheets, rail buttons, map taps, spot placement, search, import/export, shared links, startup. */
(function () {
  "use strict";
  var PG = window.PG, $ = PG.$, esc = PG.esc, map = PG.map;
  var UI = PG.UI = {};

  // ---------- sheets ----------
  var SHEETS = ["sheetLayers", "sheetSpots", "sheetField", "sheetTools", "sheetMenu", "sheetEdit", "sheetLog", "sheetShared"];
  var RAIL = { sheetLayers: "btnLayers", sheetSpots: "btnSpots", sheetField: "btnField", sheetTools: "btnTools", sheetMenu: "btnMenu" };
  var current = null;
  UI.openSheet = function (id, opts) {
    var keepEditor = opts && opts.keepEditor;
    if (current === "sheetEdit" || current === "sheetLog") { if (!keepEditor && id !== "sheetEdit" && id !== "sheetLog") PG.Items.closeEditor(); }
    if (current === "sheetMenu" && id !== "sheetMenu") PG.Offline.hideAreaRects();
    SHEETS.forEach(function (s) { $(s).hidden = s !== id; });
    Object.keys(RAIL).forEach(function (s) { $(RAIL[s]).classList.toggle("on", s === id); });
    current = id;
    if (id === "sheetSpots") PG.Items.renderList();
    if (id === "sheetField") PG.Field.renderSheet();
    if (id === "sheetMenu") { PG.Offline.render(); PG.Sync.render(); PG.Offline.storageInfo(); }
  };
  UI.closeSheets = function () { UI.openSheet(null); };
  UI.current = function () { return current; };
  document.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", UI.closeSheets); });
  Object.keys(RAIL).forEach(function (s) {
    $(RAIL[s]).addEventListener("click", function () { current === s ? UI.closeSheets() : UI.openSheet(s); });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (!$("viewer").hidden) { $("viewerClose").click(); return; }
    if (PG.Draw.active) { PG.Draw.cancel(); return; }
    if (placing) { $("placeCancel").click(); return; }
    if (current === "sheetLog") { $("logCancel").click(); return; }
    if (current) UI.closeSheets();
  });
  $("btnLocate").addEventListener("click", PG.Field.toggleLocate);

  // ---------- placing a spot with the crosshair ----------
  var placing = null;
  UI.startPlacing = function (onPlace, label, onCancel) {
    if (PG.Draw.active) PG.Draw.cancel();
    placing = { onPlace: onPlace, onCancel: onCancel };
    UI.closeSheets(); map.closePopup();
    $("crosshair").hidden = false; $("placebar").hidden = false;
    $("placeHere").textContent = label || "Place here";
    $("placeCoord").textContent = PG.fmtLL(map.getCenter().lat, map.getCenter().lng);
    $("btnAdd").classList.add("on");
  };
  function stopPlacing() { placing = null; $("crosshair").hidden = true; $("placebar").hidden = true; $("btnAdd").classList.remove("on"); }
  map.on("move", function () { if (placing) $("placeCoord").textContent = PG.fmtLL(map.getCenter().lat, map.getCenter().lng); });
  $("btnAdd").addEventListener("click", function () {
    if (placing) { $("placeCancel").click(); return; }
    UI.startPlacing(function (ll) { PG.Items.newSpot(ll); });
  });
  $("placeCancel").addEventListener("click", function () { var p = placing; stopPlacing(); if (p && p.onCancel) p.onCancel(); });
  $("placeHere").addEventListener("click", function () { var p = placing, ll = map.getCenter(); stopPlacing(); if (p) p.onPlace(ll); });
  $("placeGps").addEventListener("click", function () {
    PG.gps.once(function (p) { map.setView([p.lat, p.lng], Math.max(map.getZoom(), 17)); if (p.acc > 25) PG.toast("GPS accuracy is about " + Math.round(p.acc * 3.28) + " ft. Nudge the crosshair if you need to."); });
  });

  // ---------- map taps ----------
  map.on("click", function (e) {
    $("results").hidden = true;
    if (PG.Draw.active) { PG.Draw.add(e.latlng); return; }
    if (placing) return;
    if (current && window.innerWidth < 900) { if (current !== "sheetEdit" && current !== "sheetLog") UI.closeSheets(); return; }
    var list = PG.landAt(e.latlng);
    var anyShown = PG.landLayers.some(function (c) { return PG.prefs.layers[c.id] && c.fill && map.getZoom() >= c.minZoom; });
    var mark = '<div class="acts"><button data-markhere="' + e.latlng.lat.toFixed(6) + ',' + e.latlng.lng.toFixed(6) + '">Mark a spot here</button></div>';
    if (list.length) L.popup({ maxWidth: 300 }).setLatLng(e.latlng).setContent(PG.landPopupHtml(list) + mark).openOn(map);
    else if (anyShown) L.popup({ maxWidth: 260 }).setLatLng(e.latlng).setContent('<div class="pop"><h3>No public land mapped here</h3><p class="tip">Treat it as private unless you have permission. Small or newly bought parcels can be missing, so check signs on the ground.</p>' + mark + '</div>').openOn(map);
  });
  map.on("contextmenu", function (e) {
    if (PG.Draw.active || placing) return;
    PG.Items.newSpot(e.latlng);
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-markhere]"); if (!b) return;
    var p = b.dataset.markhere.split(","); map.closePopup();
    PG.Items.newSpot(L.latLng(+p[0], +p[1]));
  });

  // ---------- search (OpenStreetMap Nominatim) ----------
  var qTimer, lastQ = "";
  $("q").addEventListener("input", function () {
    var v = this.value.trim(); clearTimeout(qTimer);
    if (v.length < 3) { $("results").hidden = true; return; }
    qTimer = setTimeout(function () { runSearch(v); }, 650);
  });
  $("q").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { clearTimeout(qTimer); lastQ = ""; runSearch(this.value.trim()); }
    if (e.key === "Escape") $("results").hidden = true;
  });
  function runSearch(v) {
    if (!v || v === lastQ) return; lastQ = v;
    var c = v.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (c) { map.setView([+c[1], +c[2]], 16); $("results").hidden = true; $("q").blur(); return; }
    if (!PG.isOnline()) { PG.toast("Place search needs a signal. Coordinates still work."); return; }
    fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=us&q=" + encodeURIComponent(v), { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (list) {
        var el = $("results");
        if (!list.length) { el.innerHTML = '<button disabled>No matches</button>'; el.hidden = false; return; }
        el.innerHTML = list.map(function (r, i) { return '<button data-i="' + i + '">' + esc(r.display_name) + '</button>'; }).join("");
        el.hidden = false;
        el.onclick = function (e) {
          var b = e.target.closest("[data-i]"); if (!b) return;
          var r = list[+b.dataset.i];
          if (r.boundingbox) map.fitBounds([[+r.boundingbox[0], +r.boundingbox[2]], [+r.boundingbox[1], +r.boundingbox[3]]], { maxZoom: 15 });
          else map.setView([+r.lat, +r.lon], 14);
          el.hidden = true; $("q").blur();
        };
      })
      .catch(function () { PG.toast("Search didn't respond. Try again."); lastQ = ""; });
  }

  // ---------- backup ----------
  $("exportGpx").addEventListener("click", function () { PG.Items.exportGpx(); });
  $("exportJson").addEventListener("click", function () { PG.Items.exportGeoJSON(); });
  $("importBtn").addEventListener("click", function () { $("importFile").click(); });
  $("importFile").addEventListener("change", function () {
    var file = this.files && this.files[0]; this.value = ""; if (!file) return;
    file.text().then(PG.Items.importText).then(function (n) {
      PG.toast(n ? "Imported " + n + " item" + (n === 1 ? "" : "s") : "Nothing new in that file");
    }).catch(function () { PG.toast("That file couldn't be read. Use a GPX or GeoJSON file."); });
  });

  // ---------- shared links ----------
  var shared = null;
  function handleShare() {
    var item = PG.Items.parseShare(location.hash);
    if (!item) return;
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
    shared = item;
    var what = item.kind === "spot" ? (PG.Items.TYPE[item.type] || PG.Items.TYPE.other).label : { line: "Line", area: "Area", track: "Track" }[item.kind];
    $("sharedBox").innerHTML = '<div class="row" style="border:0">' + PG.Items.glyph(item) + '<span class="meta"><span class="name">' + esc(item.name) + '</span><span class="sub">' + esc(what) +
      (item.kind !== "spot" ? " · " + esc(PG.Items.measure(item)) : " · " + PG.fmtLL(item.lat, item.lng)) + '</span></span></div>' +
      (item.notes ? '<p style="white-space:pre-wrap;margin:4px 0 0">' + esc(item.notes) + '</p>' : '');
    if (item.kind === "spot") map.setView([item.lat, item.lng], 16); else map.fitBounds(L.latLngBounds(item.pts), { maxZoom: 17, padding: [40, 40] });
    UI.openSheet("sheetShared");
  }
  $("sharedAdd").addEventListener("click", function () {
    if (!shared) return;
    var item = Object.assign({ id: PG.uid() }, shared); shared = null;
    UI.closeSheets();
    PG.Items.save(item).then(function () { PG.toast("Added to your spots"); PG.Items.focus(item.id); });
  });
  window.addEventListener("hashchange", handleShare);

  // ---------- start ----------
  PG.initLayers();
  PG.db.ready().then(function () {
    if (PG.storageBroken) PG.toast("This browser is blocking storage, so spots won't be kept after you close the page.", 6000);
    return PG.Items.load();
  }).then(function () {
    return Promise.all([PG.Offline.init(), PG.Sync.init(), PG.Field.resumeTrack()]);
  }).then(function () {
    PG.Field.updateLight();
    PG.Field.fetchWind();
    handleShare();
  }).catch(function (e) { console.error(e); });
})();
