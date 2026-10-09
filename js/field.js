/* In the field: GPS, go-to navigation with compass, shooting light, wind, track recorder, measuring and drawing. */
(function () {
  "use strict";
  var PG = window.PG, $ = PG.$, esc = PG.esc, map = PG.map;
  var Field = PG.Field = {};

  // ---------- GPS (one watch shared by everything that needs it) ----------
  var gps = PG.gps = { last: null, reasons: new Set(), watchId: null };
  var meMarker = null, meCircle = null;
  function showMe(p) {
    var ll = [p.lat, p.lng];
    if (!meMarker) {
      meMarker = L.marker(ll, { icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
      meCircle = L.circle(ll, { radius: p.acc || 20, color: "#2a7fff", weight: 1, fillOpacity: .08, interactive: false }).addTo(map);
    } else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(p.acc || 20); }
  }
  function hideMe() { if (meMarker) { map.removeLayer(meMarker); map.removeLayer(meCircle); meMarker = meCircle = null; } }
  function gpsError(err) {
    PG.toast(err.code === 1 ? "Location is blocked. Allow it for this site in your browser or phone settings." : "Couldn't get a GPS fix. Try again with a clearer view of the sky.");
    if (err.code === 1) { Array.from(gps.reasons).forEach(function (r) { PG.emit("gps-denied", r); }); gps.reasons.clear(); stopWatch(); }
  }
  function stopWatch() { if (gps.watchId !== null) navigator.geolocation.clearWatch(gps.watchId); gps.watchId = null; hideMe(); }
  gps.start = function (reason) {
    if (!navigator.geolocation) { PG.toast("This browser can't share location."); return false; }
    gps.reasons.add(reason);
    if (gps.watchId === null) {
      gps.watchId = navigator.geolocation.watchPosition(function (pos) {
        var p = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, heading: pos.coords.heading, speed: pos.coords.speed, t: pos.timestamp || Date.now() };
        gps.last = p; showMe(p); PG.emit("gps", p);
      }, gpsError, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
    }
    return true;
  };
  gps.stop = function (reason) { gps.reasons.delete(reason); if (!gps.reasons.size) stopWatch(); };
  gps.once = function (cb) {
    if (!navigator.geolocation) { PG.toast("This browser can't share location."); return; }
    if (gps.last && Date.now() - gps.last.t < 15000) { cb(gps.last); return; }
    navigator.geolocation.getCurrentPosition(function (pos) {
      var p = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: Date.now() };
      gps.last = p; cb(p);
    }, gpsError, { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 });
  };

  // locate button
  var firstFix = false;
  Field.toggleLocate = function () {
    var btn = $("btnLocate");
    if (gps.reasons.has("locate")) { gps.stop("locate"); btn.classList.remove("on"); return; }
    if (!gps.start("locate")) return;
    btn.classList.add("on"); firstFix = true;
    if (gps.last && Date.now() - gps.last.t < 15000) { map.setView([gps.last.lat, gps.last.lng], Math.max(map.getZoom(), 15)); firstFix = false; }
  };
  PG.on("gps", function (p) { if (firstFix && gps.reasons.has("locate")) { firstFix = false; map.setView([p.lat, p.lng], Math.max(map.getZoom(), 15)); } });
  PG.on("gps-denied", function (r) { if (r === "locate") $("btnLocate").classList.remove("on"); });

  // ---------- compass ----------
  var compass = { heading: null, listening: false, t: 0 };
  function onOrient(e) {
    var h = null;
    if (e.webkitCompassHeading != null && !isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading;
    else if (e.absolute && e.alpha != null) h = (360 - e.alpha) % 360;
    if (h == null) return;
    var so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    compass.heading = (h + so + 360) % 360; compass.t = Date.now();
    updateNav();
  }
  function listenCompass() {
    if (compass.listening) return;
    compass.listening = true;
    if ("ondeviceorientationabsolute" in window) window.addEventListener("deviceorientationabsolute", onOrient);
    else window.addEventListener("deviceorientation", onOrient);
  }
  function stopCompass() {
    if (!compass.listening) return;
    window.removeEventListener("deviceorientationabsolute", onOrient); window.removeEventListener("deviceorientation", onOrient);
    compass.listening = false; compass.heading = null;
  }
  function needsCompassPermission() { return typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function"; }
  function askCompass() {
    if (!needsCompassPermission()) { listenCompass(); return; }
    DeviceOrientationEvent.requestPermission().then(function (s) {
      if (s === "granted") { listenCompass(); $("navCompass").hidden = true; } else PG.toast("Compass access was declined. The arrow will point with north up.");
    }).catch(function () { $("navCompass").hidden = false; });
  }
  $("navCompass").addEventListener("click", askCompass);

  // ---------- go-to navigation ----------
  var nav = null, navLine = null;
  Field.navigateTo = function (target, name) {
    nav = { target: target, name: name };
    $("navName").textContent = "Heading to " + name;
    $("navbar").hidden = false; $("navCompass").hidden = true;
    PG.UI.closeSheets();
    askCompass(); // runs inside the tap, which iOS requires
    gps.start("nav");
    if (!navLine) navLine = L.polyline([], { pane: "track", color: "#ff7a33", weight: 3, dashArray: "6 8", interactive: false }).addTo(map);
    if (gps.last) map.fitBounds(L.latLngBounds([[gps.last.lat, gps.last.lng], target]), { maxZoom: 17, padding: [60, 60] });
    else map.setView(target, Math.max(map.getZoom(), 15));
    updateNav();
  };
  Field.stopNav = function () {
    nav = null; $("navbar").hidden = true; gps.stop("nav"); stopCompass();
    if (navLine) { map.removeLayer(navLine); navLine = null; }
  };
  $("navStop").addEventListener("click", Field.stopNav);
  function updateNav() {
    if (!nav) return;
    var p = gps.last;
    if (!p) { $("navDist").textContent = "Finding you..."; $("navBearing").textContent = ""; $("navHint").textContent = "Waiting for a GPS fix"; return; }
    var here = [p.lat, p.lng], d = PG.distance(here, nav.target), brg = PG.bearing(here, nav.target);
    navLine.setLatLngs([here, nav.target]);
    var close = d < Math.max(12, (p.acc || 10) * 0.8);
    $("navDist").textContent = close ? "You're here" : PG.fmtYards(d);
    $("navBearing").textContent = Math.round(brg) + "° " + PG.dirName16(brg);
    var heading = null, hint;
    if (compass.heading != null && Date.now() - compass.t < 3000) { heading = compass.heading; hint = "Hold the phone flat, top pointing ahead."; }
    else if (p.heading != null && !isNaN(p.heading) && p.speed > 0.6) { heading = p.heading; hint = "Arrow follows your walking direction."; }
    else hint = needsCompassPermission() && !compass.listening ? "Tap Use compass so the arrow turns with you." : "Arrow points with north up. Start walking and it will follow you.";
    if (needsCompassPermission() && !compass.listening) $("navCompass").hidden = false;
    $("navHint").textContent = (p.acc > 30 ? "GPS accuracy " + Math.round(p.acc * 3.28) + " ft. " : "") + hint;
    var rot = heading == null ? brg : brg - heading;
    $("navArrow").firstElementChild.style.transform = "rotate(" + rot + "deg)";
  }
  PG.on("gps", updateNav);

  // ---------- shooting light ----------
  function lightPlace() {
    var p = gps.last && Date.now() - gps.last.t < 30 * 6e4 ? gps.last : null;
    if (p) return { lat: p.lat, lng: p.lng, label: "at your location" };
    var c = map.getCenter(); return { lat: c.lat, lng: c.lng, label: "at map center" };
  }
  var SUN = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/></svg>';
  Field.updateLight = function () {
    var pl = lightPlace(), now = new Date();
    var today = PG.legalLight(now, pl.lat, pl.lng), tomorrow = PG.legalLight(new Date(now.getTime() + 864e5), pl.lat, pl.lng);
    var chip = $("chipLight");
    if (!today) { chip.hidden = true; return; }
    var text, on = false;
    if (now < today.start) text = "Shooting light " + PG.fmtTime(today.start);
    else if (now <= today.end) {
      on = true; var left = (today.end - now) / 6e4;
      text = left <= 60 ? "Legal light ends in " + Math.ceil(left) + " min" : "Legal until " + PG.fmtTime(today.end);
    } else text = "Tomorrow " + PG.fmtTime(tomorrow.start);
    chip.innerHTML = '<span class="dot"></span>' + esc(text); chip.classList.toggle("on", on); chip.hidden = false;
    if ($("sheetField").hidden) return;
    $("lightWhere").textContent = pl.label;
    function card(title, l) {
      return '<div class="lightcard"><h4>' + title + '</h4>' +
        '<span class="big">' + PG.fmtTime(l.start) + ' – ' + PG.fmtTime(l.end) + '</span>' +
        '<span class="sm">Sunrise ' + PG.fmtTime(l.sunrise) + ' · Sunset ' + PG.fmtTime(l.sunset) + '</span></div>';
    }
    $("lightBox").innerHTML = card("Today", today) + (tomorrow ? card("Tomorrow", tomorrow) : "");
  };
  setInterval(Field.updateLight, 30000);
  map.on("moveend", PG.debounce(Field.updateLight, 400));

  // ---------- wind (Open-Meteo, free, no key) ----------
  var wind = PG.local.get("publicground.wind.v1", null);
  Field.windNow = function () {
    if (!wind || Date.now() - wind.fetched > 3 * 3600e3) return null;
    // use the forecast hour closest to now once the "current" reading is old
    var now = Date.now(), best = { dir: wind.current.dir, speed: wind.current.speed, gust: wind.current.gust, t: wind.current.t };
    if (now - wind.current.t > 45 * 6e4 && wind.hours) {
      wind.hours.forEach(function (h) { if (Math.abs(h.t - now) < Math.abs(best.t - now)) best = h; });
    }
    return best;
  };
  var ARROW = '<svg viewBox="0 0 24 24"><path d="M12 2 18 20 12 16 6 20z"/></svg>';
  function windChip() {
    var w = Field.windNow(), chip = $("chipWind");
    if (!w) { chip.hidden = true; return; }
    var calm = w.speed < 2;
    chip.innerHTML = (calm ? "" : '<span style="display:inline-flex;transform:rotate(' + ((w.dir + 180) % 360) + 'deg)">' + ARROW.replace("<svg", '<svg style="fill:currentColor;stroke:none"') + '</span>') +
      esc(calm ? "Calm" : PG.dirName(w.dir) + " " + Math.round(w.speed) + " mph");
    chip.title = calm ? "Calm wind" : "Wind from the " + PG.dirName16(w.dir) + ". Arrow shows where your scent drifts.";
    chip.hidden = false;
  }
  function renderWind() {
    windChip();
    if ($("sheetField").hidden) return;
    var w = Field.windNow();
    if (!w) { $("windBox").innerHTML = '<p class="empty">' + (PG.isOnline() ? "Loading wind..." : "Wind needs a signal. It will update when you're back online.") + '</p>'; return; }
    $("windWhere").textContent = wind.label || "";
    var calm = w.speed < 2, down = (w.dir + 180) % 360;
    var good = PG.Items.list().filter(function (i) { return PG.Items.windState(i) === "good"; });
    var tagged = PG.Items.list().filter(function (i) { return i.goodWinds && i.goodWinds.length; });
    var hours = (wind.hours || []).filter(function (h) { return h.t > Date.now() - 30 * 6e4; }).slice(0, 12);
    $("windBox").innerHTML =
      '<div class="now"><div class="windrose"><b>N</b>' + (calm ? '' : '<svg viewBox="0 0 24 24" style="transform:rotate(' + down + 'deg)"><path d="M12 2 18 20 12 16 6 20z"/></svg>') + '</div>' +
      '<div><div class="big">' + (calm ? "Calm" : PG.dirName16(w.dir) + " " + Math.round(w.speed) + " mph") + '</div>' +
      '<div class="sm">' + (calm ? "Scent will pool and drift with the thermals." : "Gusts " + Math.round(w.gust || w.speed) + " mph. Your scent drifts " + PG.dirName16(down) + ".") + '</div>' +
      '<div class="sm">Updated ' + PG.fmtTime(new Date(wind.fetched)) + '</div></div></div>' +
      (hours.length ? '<div class="hours">' + hours.map(function (h) {
        return '<div><b>' + new Date(h.t).toLocaleTimeString([], { hour: "numeric" }) + '</b>' +
          (h.speed < 2 ? '<span style="display:block;margin:4px 0">calm</span>' : '<svg viewBox="0 0 24 24" style="transform:rotate(' + ((h.dir + 180) % 360) + 'deg)"><path d="M12 2 18 20 12 16 6 20z"/></svg>') +
          '<b>' + PG.dirName(h.dir) + '</b><span>' + Math.round(h.speed) + '</span></div>';
      }).join("") + '</div>' : '') +
      '<div class="goodlist">' + (tagged.length
        ? (good.length ? '<strong>Good wind now:</strong> ' + good.map(function (i) { return '<a href="#" data-goodspot="' + i.id + '">' + esc(i.name) + '</a>'; }).join(", ")
                       : "None of your tagged spots have a good wind right now.")
        : '<span class="fine">Tag your stands with the winds that work (edit a spot, pick Good winds) and they light up green here and on the map.</span>') + '</div>';
  }
  $("windBox").addEventListener("click", function (e) {
    var a = e.target.closest("[data-goodspot]"); if (!a) return; e.preventDefault();
    if (window.innerWidth < 900) PG.UI.closeSheets(); PG.Items.focus(a.dataset.goodspot);
  });

  var windBusy = false;
  Field.fetchWind = function (force) {
    if (windBusy || !PG.isOnline()) { renderWind(); return; }
    var pl = lightPlace();
    if (!force && wind && Date.now() - wind.fetched < 15 * 6e4 && PG.distance([wind.lat, wind.lng], [pl.lat, pl.lng]) < 15000) { renderWind(); return; }
    windBusy = true;
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + pl.lat.toFixed(3) + "&longitude=" + pl.lng.toFixed(3) +
      "&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m" +
      "&wind_speed_unit=mph&timezone=auto&forecast_hours=16";
    fetch(url).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (j) {
      var off = (j.utc_offset_seconds || 0) * 1000;
      function t(s) { return Date.parse(s + "Z") - off; }
      wind = {
        fetched: Date.now(), lat: pl.lat, lng: pl.lng, label: pl.label,
        current: { t: t(j.current.time), dir: j.current.wind_direction_10m, speed: j.current.wind_speed_10m, gust: j.current.wind_gusts_10m },
        hours: j.hourly.time.map(function (s, k) { return { t: t(s), dir: j.hourly.wind_direction_10m[k], speed: j.hourly.wind_speed_10m[k], gust: j.hourly.wind_gusts_10m[k] }; })
      };
      PG.local.set("publicground.wind.v1", wind);
      PG.emit("wind", wind);
    }).catch(function () {}).then(function () { windBusy = false; renderWind(); });
  };
  PG.on("wind", function () { PG.Items.refreshIcons(); });
  setInterval(function () { if (!document.hidden) Field.fetchWind(); }, 5 * 6e4);
  map.on("moveend", PG.debounce(function () { Field.fetchWind(); }, 1500));
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { Field.fetchWind(); Field.updateLight(); } });

  // ---------- track recorder ----------
  var rec = null, recLine = null, wakeLock = null, recTimer = null;
  var REC_KEY = "track-active";
  function requestWake() {
    try { if (navigator.wakeLock) navigator.wakeLock.request("screen").then(function (l) { wakeLock = l; }).catch(function () {}); } catch (e) {}
  }
  document.addEventListener("visibilitychange", function () { if (rec && !document.hidden) requestWake(); });
  function recStats() {
    if (!rec) return null;
    return { dist: PG.lineLength(rec.pts), dur: Date.now() - rec.start, n: rec.pts.length };
  }
  function saveRec() { if (rec) PG.db.put("kv", rec, REC_KEY).catch(function () {}); }
  var saveRecSoon = PG.debounce(saveRec, 4000);
  function onRecFix(p) {
    if (!rec) return;
    if (p.acc > 50) return;
    var last = rec.pts[rec.pts.length - 1];
    if (last && PG.distance(last, [p.lat, p.lng]) < Math.max(4, p.acc * 0.5)) return;
    rec.pts.push([+p.lat.toFixed(6), +p.lng.toFixed(6)]); rec.times.push(p.t);
    recLine.setLatLngs(rec.pts);
    saveRecSoon();
  }
  PG.on("gps", onRecFix);
  function recUI() {
    var chip = $("chipTrack");
    if (rec) {
      var s = recStats();
      chip.innerHTML = '<span class="dot"></span>REC ' + PG.fmtDist(s.dist) + " · " + PG.fmtDuration(s.dur);
      chip.hidden = false;
    } else chip.hidden = true;
    if ($("sheetField").hidden) return;
    if (!rec) {
      $("trackBox").innerHTML = '<button class="btn primary" id="trackStart">Start tracking</button>' +
        '<p class="fine">Draws your path as you walk so you can follow it back out in the dark. Keep this page open: phones pause web apps when the screen locks, so the app keeps your screen on while recording. Any locked time shows as a straight line.</p>';
      return;
    }
    var s2 = recStats();
    $("trackBox").innerHTML = '<div class="trackstats"><div><small>Distance</small><strong>' + PG.fmtDist(s2.dist) + '</strong></div>' +
      '<div><small>Time</small><strong>' + PG.fmtDuration(s2.dur) + '</strong></div><div><small>Points</small><strong>' + s2.n + '</strong></div></div>' +
      '<div class="tools"><button class="btn primary" id="trackStop">Stop and save</button>' +
      (rec.pts.length ? '<button class="btn" id="trackBack">Back to start</button>' : '') +
      '<button class="btn danger" id="trackDiscard">Discard</button></div>';
  }
  Field.startTrack = function (resume) {
    if (!resume) rec = { id: PG.uid(), start: Date.now(), pts: [], times: [] };
    if (!gps.start("track")) { rec = null; return; }
    if (!recLine) recLine = L.polyline(rec.pts, { pane: "track", color: "#ff3b30", weight: 4, opacity: .95, interactive: false }).addTo(map);
    else recLine.setLatLngs(rec.pts);
    requestWake(); saveRec();
    clearInterval(recTimer); recTimer = setInterval(recUI, 1000);
    if (gps.last && Date.now() - gps.last.t < 10000) onRecFix(gps.last);
    recUI(); PG.persist();
  };
  function endTrack() {
    gps.stop("track"); clearInterval(recTimer);
    if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
    if (recLine) { map.removeLayer(recLine); recLine = null; }
    PG.db.del("kv", REC_KEY).catch(function () {});
    rec = null; recUI();
  }
  Field.stopTrack = function () {
    if (!rec) return;
    var r = rec;
    if (r.pts.length < 2) { endTrack(); PG.toast("Track was too short to save."); return; }
    endTrack();
    var item = { id: r.id, kind: "track", name: "Track " + PG.fmtDate(new Date(r.start)) + " " + PG.fmtTime(new Date(r.start)), pts: r.pts, times: r.times, color: "#c62f2f", group: PG.local.get("publicground.lastGroup", "") };
    PG.Items.save(item).then(function () { PG.toast("Track saved"); PG.Items.openEditor(item.id); });
  };
  $("trackBox").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.id === "trackStart") Field.startTrack();
    else if (b.id === "trackStop") Field.stopTrack();
    else if (b.id === "trackBack" && rec && rec.pts.length) Field.navigateTo(rec.pts[0], "track start");
    else if (b.id === "trackDiscard") {
      if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Tap again to discard"; b.classList.add("armed"); return; }
      endTrack(); PG.toast("Track discarded");
    }
  });
  $("chipTrack").addEventListener("click", function () { PG.UI.openSheet("sheetField"); });
  Field.resumeTrack = function () {
    return PG.db.get("kv", REC_KEY).then(function (r) {
      if (!r || !r.pts) return;
      rec = r; Field.startTrack(true);
      PG.toast("Still recording your track from " + PG.fmtTime(new Date(r.start)));
    }).catch(function () {});
  };

  Field.renderSheet = function () { Field.updateLight(); renderWind(); recUI(); Field.fetchWind(); };
  $("chipLight").addEventListener("click", function () { PG.UI.openSheet("sheetField"); });
  $("chipWind").addEventListener("click", function () { PG.UI.openSheet("sheetField"); });

  // ---------- measure + draw ----------
  var Draw = PG.Draw = { active: null };
  var drawLayer = null, vtx = [];
  function vertexIcon() { return L.divIcon({ className: "", html: '<div class="vertex"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }); }
  Draw.start = function (kind) {
    Draw.cancel();
    Draw.active = { kind: kind, pts: [] };
    drawLayer = (kind === "area" ? L.polygon([], { color: "#e8601c", weight: 3, fillOpacity: .15, pane: "shapes", interactive: false }) : L.polyline([], { color: "#e8601c", weight: 3, pane: "shapes", interactive: false })).addTo(map);
    $("drawbar").hidden = false; PG.UI.closeSheets();
    Draw.update();
  };
  Draw.add = function (ll) {
    if (!Draw.active) return;
    Draw.active.pts.push([ll.lat, ll.lng]);
    vtx.push(L.marker(ll, { icon: vertexIcon(), interactive: false, pane: "track" }).addTo(map));
    Draw.update();
  };
  Draw.update = function () {
    var d = Draw.active; if (!d) return;
    drawLayer.setLatLngs(d.pts);
    var n = d.pts.length, label, stat;
    if (d.kind === "line") {
      label = n < 2 ? "Tap the map to add points" : "Distance";
      stat = PG.fmtDist(PG.lineLength(d.pts)) + (n > 2 ? " · last leg " + PG.fmtDist(PG.distance(d.pts[n - 2], d.pts[n - 1])) : n === 2 ? " · " + PG.fmtYards(PG.lineLength(d.pts)) : "");
    } else {
      label = n < 3 ? "Tap at least 3 corners" : "Area";
      stat = n < 3 ? n + " of 3 points" : PG.fmtAcres(PG.polyArea(d.pts)) + " · " + PG.fmtDist(PG.lineLength(d.pts.concat([d.pts[0]]))) + " around";
    }
    $("drawLabel").textContent = label; $("drawStat").textContent = stat;
    $("drawSave").disabled = d.kind === "line" ? n < 2 : n < 3;
    $("drawUndo").disabled = !n;
  };
  Draw.undo = function () {
    if (!Draw.active || !Draw.active.pts.length) return;
    Draw.active.pts.pop(); map.removeLayer(vtx.pop()); Draw.update();
  };
  Draw.cancel = function () {
    if (drawLayer) map.removeLayer(drawLayer); drawLayer = null;
    vtx.forEach(function (m) { map.removeLayer(m); }); vtx = [];
    Draw.active = null; $("drawbar").hidden = true;
  };
  Draw.save = function () {
    var d = Draw.active; if (!d) return;
    var pts = d.pts.slice(), kind = d.kind;
    Draw.cancel();
    PG.Items.newShape(kind, pts);
  };
  $("drawUndo").addEventListener("click", Draw.undo);
  $("drawClose").addEventListener("click", Draw.cancel);
  $("drawSave").addEventListener("click", Draw.save);
  document.querySelectorAll("[data-draw]").forEach(function (b) { b.addEventListener("click", function () { Draw.start(b.dataset.draw); }); });
})();
