/* Public Ground core: namespace, helpers, storage, geo math, sun times. */
(function () {
  "use strict";
  var PG = window.PG = {};

  // ---------- small helpers ----------
  PG.$ = function (id) { return document.getElementById(id); };
  PG.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  PG.uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };
  PG.now = function () { return new Date().toISOString(); };
  PG.css = function (name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); };
  PG.debounce = function (fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; };

  var toastTimer;
  PG.toast = function (msg, ms) {
    var t = PG.$("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2800);
  };

  // tiny event bus
  var handlers = {};
  PG.on = function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); };
  PG.emit = function (ev, data) { (handlers[ev] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } }); };

  // ---------- formatting ----------
  PG.fmtLL = function (lat, lng) { return lat.toFixed(5) + ", " + lng.toFixed(5); };
  PG.fmtDist = function (m) {
    var ft = m * 3.28084;
    if (ft < 1000) return Math.round(ft) + " ft";
    var mi = m / 1609.344;
    return (mi < 10 ? mi.toFixed(2) : mi.toFixed(1)) + " mi";
  };
  PG.fmtYards = function (m) {
    var yd = m * 1.09361;
    if (yd < 1760) return Math.round(yd) + " yd";
    return (m / 1609.344).toFixed(2) + " mi";
  };
  PG.fmtAcres = function (m2) {
    var ac = m2 / 4046.8564;
    return (ac < 10 ? ac.toFixed(2) : ac < 100 ? ac.toFixed(1) : Math.round(ac).toLocaleString()) + " acres";
  };
  PG.fmtTime = function (d) { return d ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "--"; };
  PG.fmtDate = function (d) { return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" }); };
  PG.fmtDuration = function (ms) {
    var s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? h + "h " + String(m).padStart(2, "0") + "m" : m + "m " + String(s % 60).padStart(2, "0") + "s";
  };

  // ---------- compass ----------
  PG.DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  PG.dirName = function (deg) { return PG.DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]; };
  PG.DIRS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  PG.dirName16 = function (deg) { return PG.DIRS16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]; };

  // ---------- geo math ----------
  var R = 6371008.8, rad = Math.PI / 180;
  PG.distance = function (a, b) {
    var dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  PG.bearing = function (a, b) {
    var p1 = a[0] * rad, p2 = b[0] * rad, dl = (b[1] - a[1]) * rad;
    var y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) / rad + 360) % 360;
  };
  PG.lineLength = function (pts) {
    var d = 0; for (var i = 1; i < pts.length; i++) d += PG.distance(pts[i - 1], pts[i]); return d;
  };
  // spherical polygon area in m^2, pts as [lat,lng]
  PG.polyArea = function (pts) {
    if (pts.length < 3) return 0;
    var area = 0;
    for (var i = 0; i < pts.length; i++) {
      var p1 = pts[i], p2 = pts[(i + 1) % pts.length];
      area += (p2[1] - p1[1]) * rad * (2 + Math.sin(p1[0] * rad) + Math.sin(p2[0] * rad));
    }
    return Math.abs(area * R * R / 2);
  };
  // point in GeoJSON (Multi)Polygon, pt = [lng, lat]
  function inRing(pt, ring) {
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }
  function inPoly(pt, rings) {
    if (!rings.length || !inRing(pt, rings[0])) return false;
    for (var k = 1; k < rings.length; k++) if (inRing(pt, rings[k])) return false;
    return true;
  }
  PG.pointInGeom = function (pt, g) {
    if (!g) return false;
    if (g.type === "Polygon") return inPoly(pt, g.coordinates);
    if (g.type === "MultiPolygon") return g.coordinates.some(function (p) { return inPoly(pt, p); });
    return false;
  };
  PG.geomBBox = function (g) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    (function walk(c) {
      if (typeof c[0] === "number") { if (c[0] < b[0]) b[0] = c[0]; if (c[1] < b[1]) b[1] = c[1]; if (c[0] > b[2]) b[2] = c[0]; if (c[1] > b[3]) b[3] = c[1]; }
      else c.forEach(walk);
    })(g.coordinates);
    return b;
  };

  // web mercator tile math
  PG.tile = {
    lng2x: function (lng, z) { return Math.floor((lng + 180) / 360 * Math.pow(2, z)); },
    lat2y: function (lat, z) { var r = lat * rad; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z)); },
    x2lng: function (x, z) { return x / Math.pow(2, z) * 360 - 180; },
    y2lat: function (y, z) { var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); },
    range: function (bounds, z) {
      var t = PG.tile, max = Math.pow(2, z) - 1;
      return {
        x0: Math.max(0, t.lng2x(bounds.getWest(), z)), x1: Math.min(max, t.lng2x(bounds.getEast(), z)),
        y0: Math.max(0, t.lat2y(bounds.getNorth(), z)), y1: Math.min(max, t.lat2y(bounds.getSouth(), z))
      };
    }
  };

  // ---------- sun times (adapted from the SunCalc algorithm, BSD license, V. Agafonkin) ----------
  var dayMs = 864e5, J1970 = 2440588, J2000 = 2451545, e = rad * 23.4397, J0 = 0.0009;
  function toJulian(d) { return d.valueOf() / dayMs - 0.5 + J1970; }
  function fromJulian(j) { return new Date((j + 0.5 - J1970) * dayMs); }
  function toDays(d) { return toJulian(d) - J2000; }
  function declination(l, b) { return Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l)); }
  function solarMeanAnomaly(d) { return rad * (357.5291 + 0.98560028 * d); }
  function eclipticLongitude(M) {
    var C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)), P = rad * 102.9372;
    return M + C + P + Math.PI;
  }
  function julianCycle(d, lw) { return Math.round(d - J0 - lw / (2 * Math.PI)); }
  function approxTransit(Ht, lw, n) { return J0 + (Ht + lw) / (2 * Math.PI) + n; }
  function solarTransitJ(ds, M, L) { return J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L); }
  function hourAngle(h, phi, d) { return Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d))); }
  PG.sunTimes = function (date, lat, lng) {
    // anchor on local noon so "today" means the viewer's calendar day
    var noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
    var lw = rad * -lng, phi = rad * lat, d = toDays(noon), n = julianCycle(d, lw), ds = approxTransit(0, lw, n);
    var M = solarMeanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L, 0), Jnoon = solarTransitJ(ds, M, L);
    var h0 = -0.833 * rad, w = hourAngle(h0, phi, dec);
    if (isNaN(w)) return null;
    var a = approxTransit(w, lw, n), Jset = solarTransitJ(a, M, L), Jrise = Jnoon - (Jset - Jnoon);
    return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset), noon: fromJulian(Jnoon) };
  };
  PG.legalLight = function (date, lat, lng) {
    var s = PG.sunTimes(date, lat, lng); if (!s) return null;
    return { start: new Date(s.sunrise.getTime() - 30 * 6e4), sunrise: s.sunrise, sunset: s.sunset, end: new Date(s.sunset.getTime() + 30 * 6e4) };
  };

  // ---------- storage: IndexedDB with an in-memory fallback ----------
  var DB_NAME = "publicground", DB_VER = 1, dbp = null, memory = null;
  function openDb() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { resolve(null); return; }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("items")) db.createObjectStore("items", { keyPath: "id" });
        if (!db.objectStoreNames.contains("photos")) db.createObjectStore("photos", { keyPath: "id" }).createIndex("itemId", "itemId");
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("land")) db.createObjectStore("land");
        if (!db.objectStoreNames.contains("areas")) db.createObjectStore("areas", { keyPath: "id" });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
      req.onblocked = function () { resolve(null); };
    }).then(function (db) {
      if (!db) { memory = { items: new Map(), photos: new Map(), kv: new Map(), land: new Map(), areas: new Map() }; PG.storageBroken = true; }
      return db;
    });
    return dbp;
  }
  function wrap(req) { return new Promise(function (res, rej) { req.onsuccess = function () { res(req.result); }; req.onerror = function () { rej(req.error); }; }); }
  function keyOf(store, val, key) { return key !== undefined ? key : val.id; }

  PG.db = {
    ready: openDb,
    get: function (store, key) {
      return openDb().then(function (db) {
        if (!db) return memory[store].get(key);
        return wrap(db.transaction(store).objectStore(store).get(key));
      });
    },
    put: function (store, val, key) {
      return openDb().then(function (db) {
        if (!db) { memory[store].set(keyOf(store, val, key), val); return; }
        var os = db.transaction(store, "readwrite").objectStore(store);
        return wrap(key !== undefined ? os.put(val, key) : os.put(val));
      });
    },
    putMany: function (store, vals) {
      return openDb().then(function (db) {
        if (!db) { vals.forEach(function (v) { memory[store].set(v.id, v); }); return; }
        return new Promise(function (res, rej) {
          var tx = db.transaction(store, "readwrite"), os = tx.objectStore(store);
          vals.forEach(function (v) { os.put(v); });
          tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); };
        });
      });
    },
    del: function (store, key) {
      return openDb().then(function (db) {
        if (!db) { memory[store].delete(key); return; }
        return wrap(db.transaction(store, "readwrite").objectStore(store).delete(key));
      });
    },
    all: function (store) {
      return openDb().then(function (db) {
        if (!db) return Array.from(memory[store].values());
        return wrap(db.transaction(store).objectStore(store).getAll());
      });
    },
    byIndex: function (store, index, value) {
      return openDb().then(function (db) {
        if (!db) return Array.from(memory[store].values()).filter(function (v) { return v[index] === value; });
        return wrap(db.transaction(store).objectStore(store).index(index).getAll(value));
      });
    },
    count: function (store) {
      return openDb().then(function (db) {
        if (!db) return memory[store].size;
        return wrap(db.transaction(store).objectStore(store).count());
      });
    }
  };

  // ask the browser not to evict our data (spots, offline maps)
  PG.persist = function () {
    try { if (navigator.storage && navigator.storage.persist) return navigator.storage.persist(); } catch (e) {}
    return Promise.resolve(false);
  };

  // small synchronous prefs mirror (localStorage), wrapped
  PG.local = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  // ---------- downloads ----------
  PG.download = function (name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  };

  PG.isOnline = function () { return navigator.onLine !== false; };
})();
