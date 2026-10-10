/* Map, basemaps, terrain shading, public land layers (PAD-US + Michigan DNR) and "what land is this" lookups. */
(function () {
  "use strict";
  var PG = window.PG, $ = PG.$, esc = PG.esc;

  // ---------- prefs ----------
  var PREFS_KEY = "publicground.prefs.v2";
  var defaults = {
    base: "sat", opacity: 35, terrain: false, terrainOpacity: 60,
    layers: { padus_open: true, padus_restricted: true, padus_closed: false, mi_dnr: true, mi_hap: true, mi_cfa: true, mi_game: false, mi_dmu: false },
    hiddenGroups: []
  };
  var old = PG.local.get("publicground.prefs.v1", null);
  PG.prefs = PG.local.get(PREFS_KEY, null) || (function () {
    var p = JSON.parse(JSON.stringify(defaults));
    if (old) {
      p.base = old.base || p.base; p.opacity = old.opacity || p.opacity;
      p.layers.padus_open = old.open !== false; p.layers.padus_restricted = old.restricted !== false; p.layers.padus_closed = !!old.closed;
    }
    return p;
  })();
  Object.keys(defaults).forEach(function (k) { if (PG.prefs[k] === undefined) PG.prefs[k] = JSON.parse(JSON.stringify(defaults[k])); });
  Object.keys(defaults.layers).forEach(function (k) { if (PG.prefs.layers[k] === undefined) PG.prefs.layers[k] = defaults.layers[k]; });
  PG.savePrefs = function () { PG.local.set(PREFS_KEY, PG.prefs); };

  // ---------- map ----------
  var view = PG.local.get("publicground.view.v1", { lat: 43.45, lng: -84.6, z: 8 });
  var map = PG.map = L.map("map", { zoomControl: false, attributionControl: true, maxZoom: 20, tap: true, worldCopyJump: true })
    .setView([view.lat, view.lng], view.z);
  L.control.scale({ imperial: true, metric: false, position: "bottomright" }).addTo(map);
  map.on("moveend", function () {
    var c = map.getCenter(); PG.local.set("publicground.view.v1", { lat: c.lat, lng: c.lng, z: map.getZoom() });
  });

  function pane(name, z, cls) { var p = map.createPane(name); p.style.zIndex = z; if (cls) p.classList.add(cls); return p; }
  pane("terrain", 250, "terrain-pane");
  pane("landfill", 350);
  pane("landline", 360);
  pane("shapes", 420);
  pane("track", 430);

  // ---------- basemaps ----------
  var ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/";
  var USGS = "https://basemap.nationalmap.gov/arcgis/rest/services/";
  PG.tileUrls = {
    usgs: USGS + "USGSImageryTopo/MapServer/tile/{z}/{y}/{x}",
    topo: USGS + "USGSTopo/MapServer/tile/{z}/{y}/{x}"
  };
  var bases = {
    sat: L.layerGroup([
      L.tileLayer(ESRI + "World_Imagery/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20, maxNativeZoom: 19, attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics" }),
      L.tileLayer(ESRI + "Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20, maxNativeZoom: 19, opacity: .8 }),
      L.tileLayer(ESRI + "Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 20, maxNativeZoom: 19 })
    ]),
    usgs: L.tileLayer(PG.tileUrls.usgs, { maxZoom: 20, maxNativeZoom: 16, attribution: "USGS The National Map" }),
    topo: L.tileLayer(PG.tileUrls.topo, { maxZoom: 20, maxNativeZoom: 16, attribution: "USGS The National Map" }),
    street: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 20, maxNativeZoom: 19, attribution: "&copy; OpenStreetMap contributors" })
  };
  PG.offlineBases = ["usgs", "topo"];
  var currentBase = null;
  PG.setBase = function (id) {
    if (!bases[id]) id = "sat";
    if (currentBase) map.removeLayer(currentBase);
    currentBase = bases[id].addTo(map);
    PG.prefs.base = id; PG.savePrefs();
    document.querySelectorAll("#baseSeg button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.base === id)); });
  };

  // ---------- terrain shading (USGS 3DEP lidar hillshade, requested as map tiles) ----------
  var HALF = 20037508.342789244;
  PG.terrainUrl = function (x, y, z) {
    var size = 2 * HALF / Math.pow(2, z);
    var minx = -HALF + x * size, maxy = HALF - y * size;
    var bbox = [minx, maxy - size, minx + size, maxy].map(function (v) { return v.toFixed(2); }).join(",");
    return "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?bbox=" + bbox +
      "&bboxSR=3857&imageSR=3857&size=256,256&format=jpgpng&f=image&renderingRule=%7B%22rasterFunction%22%3A%22Hillshade%20Multidirectional%22%7D";
  };
  var TerrainLayer = L.TileLayer.extend({ getTileUrl: function (c) { return PG.terrainUrl(c.x, c.y, c.z); } });
  var terrain = new TerrainLayer("", { pane: "terrain", maxZoom: 20, maxNativeZoom: 17, minZoom: 9, opacity: PG.prefs.terrainOpacity / 100, attribution: "USGS 3DEP" });
  PG.setTerrain = function (on) {
    PG.prefs.terrain = !!on; PG.savePrefs();
    if (on) terrain.addTo(map); else map.removeLayer(terrain);
  };

  // ---------- public land layers ----------
  var MI_BBOX = [-90.6, 41.6, -82.1, 48.4];
  var PADUS = "https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/Public_Access/FeatureServer/0";
  var MIDNR = "https://services3.arcgis.com/Jdnp1TjADvSDxMAX/arcgis/rest/services/";

  var DES = { NF: "National Forest", NWR: "National Wildlife Refuge", NG: "National Grassland", PUB: "BLM public land", NP: "National Park", NRA: "National Recreation Area", NLS: "National Lakeshore", WA: "Wilderness Area", WSA: "Wilderness Study Area", SP: "State Park", SREC: "State Recreation Area", SCA: "State Conservation Area", SRMA: "State Resource Mgmt Area", SW: "State Wilderness", SOTH: "State land (other)", LP: "Local park", LCA: "Local Conservation Area", LREC: "Local Recreation Area", LRMA: "Local Resource Mgmt Area", LOTH: "Local land (other)", ACC: "Access Area", MIL: "Military land", REC: "Recreation Mgmt Area", RMA: "Resource Mgmt Area", CONE: "Conservation easement", RECE: "Recreation easement", PCON: "Private conservation", WPA: "Watershed Protection Area", HCA: "Historic or Cultural Area", NM: "National Monument", NCA: "Conservation Area", MPA: "Marine Protected Area" };
  var MANG = { USFS: "U.S. Forest Service", BLM: "Bureau of Land Management", FWS: "U.S. Fish & Wildlife Service", NPS: "National Park Service", USACE: "Army Corps of Engineers", DOD: "Dept. of Defense", USBR: "Bureau of Reclamation", SDNR: "State Dept. of Natural Resources", SFW: "State Fish & Wildlife", SPR: "State Parks & Recreation", SDC: "State Dept. of Conservation", SLB: "State Land Board", SDOL: "State Dept. of Land", OTHS: "Other state agency", CNTY: "County", CITY: "City", REG: "Regional agency", NGO: "Nonprofit", PVT: "Private", TVA: "Tennessee Valley Authority", JNT: "Joint" };
  var DIV_COLORS = { "Forest Resources Division": "#2f7d32", "Wildlife Division": "#3a8f7a", "Parks and Recreation Division": "#7a5ab5", "Fisheries Division": "#2d7fb8" };
  var DIV_LABEL = { "Forest Resources Division": "State forest", "Wildlife Division": "State game / wildlife land", "Parks and Recreation Division": "State park or recreation area", "Fisheries Division": "DNR fisheries land", "Office of Land Administration": "DNR land", "Finance & Operations Division": "DNR land" };

  function acres(v) { return v ? Math.round(v).toLocaleString() + " acres" : null; }
  function padusPopup(p, accessLabel, accessVar) {
    return {
      tag: accessLabel, tagColor: PG.css(accessVar),
      title: p.Unit_Nm || "Unnamed parcel",
      rows: [["Managed by", MANG[p.Mang_Name] || p.Mang_Name || "Unknown"], ["Type", DES[p.Des_Tp] || p.Des_Tp || "Unknown"], ["Size", acres(p.SUM_GIS_Acres || p.DOCACRES)]],
      source: "USGS PAD-US"
    };
  }

  var LAYERS = [
    { id: "padus_open", section: "nation", label: "Open access", desc: "National forest, state forest and game areas, BLM and similar",
      url: PADUS, where: "Pub_Access='OA'", fields: "OBJECTID,Unit_Nm,Mang_Name,Des_Tp,Pub_Access,SUM_GIS_Acres,DOCACRES",
      color: function () { return PG.css("--open"); }, fill: true, minZoom: 11, cellZ: 11, offset: 0.00002,
      popup: function (p) { return padusPopup(p, "Open access", "--open"); } },
    { id: "padus_restricted", section: "nation", label: "Restricted access", desc: "Needs a permit, seasonal, or limited entry",
      url: PADUS, where: "Pub_Access='RA'", fields: "OBJECTID,Unit_Nm,Mang_Name,Des_Tp,Pub_Access,SUM_GIS_Acres,DOCACRES",
      color: function () { return PG.css("--restricted"); }, fill: true, minZoom: 11, cellZ: 11, offset: 0.00002,
      popup: function (p) { return padusPopup(p, "Restricted access", "--restricted"); } },
    { id: "padus_closed", section: "nation", label: "Closed to the public", desc: "Red dashed outline so you know where not to go",
      url: PADUS, where: "Pub_Access='XA'", fields: "OBJECTID,Unit_Nm,Mang_Name,Des_Tp,Pub_Access,SUM_GIS_Acres,DOCACRES",
      color: function () { return PG.css("--closed"); }, fill: false, dash: "5 5", minZoom: 11, cellZ: 11, offset: 0.00002,
      popup: function (p) { return padusPopup(p, "Closed", "--closed"); } },

    { id: "mi_dnr", section: "mi", label: "State land", desc: "Every DNR parcel: state forest, game areas, parks. Updated weekly.",
      url: MIDNR + "DNRLOTSParcelsOPENDATA/FeatureServer/2", where: "ParcelType <> 'Great Lakes Bottom Lands'",
      fields: "ObjectID,ProjectName,DivisionDepartment,County,Acreage,LandStatus", region: MI_BBOX,
      color: function (p) { return (p && DIV_COLORS[p.DivisionDepartment]) || "#4f7a4a"; }, swatch: "#2f7d32", fill: true, minZoom: 11, cellZ: 11, offset: 0.00001,
      popup: function (p) {
        return { tag: DIV_LABEL[p.DivisionDepartment] || "DNR land", tagColor: DIV_COLORS[p.DivisionDepartment] || "#4f7a4a",
          title: p.ProjectName || "DNR parcel",
          rows: [["Managed by", p.DivisionDepartment || "Michigan DNR"], ["County", p.County], ["Parcel", acres(p.Acreage)]],
          tip: p.DivisionDepartment === "Parks and Recreation Division" ? "Hunting in state parks and recreation areas is limited to certain areas and seasons. Check the park's rules." : null,
          source: "Michigan DNR land ownership" };
      } },
    { id: "mi_hap", section: "mi", label: "Hunting Access Program", desc: "Private land the DNR leases for public hunting. Register at the check-in before you hunt.",
      url: MIDNR + "DNRWILDLandsOPENDATA/FeatureServer/0", where: "ActiveOrInactive='Active'",
      fields: "OBJECTID,HAPID,COUNTY,acres,HuntType,HAPInfo,SpecialComment,ForestAcres,AgriculturalAcres,GrasslandandBushAcres,WetlandAcres", region: MI_BBOX,
      color: function () { return "#a23fb5"; }, fill: true, minZoom: 10, cellZ: 10, offset: 0.00001,
      popup: function (p) {
        var cover = [["Woods", p.ForestAcres], ["Fields", p.AgriculturalAcres], ["Grass/brush", p.GrasslandandBushAcres], ["Wetland", p.WetlandAcres]]
          .filter(function (c) { return c[1]; }).map(function (c) { return c[0] + " " + c[1]; }).join(", ");
        return { tag: "HAP land", tagColor: "#a23fb5", title: "HAP property #" + p.HAPID,
          rows: [["County", p.COUNTY], ["Size", acres(p.acres)], ["Hunting", (p.HuntType || "").replace(/\.$/, "")], ["Check-in", (p.HAPInfo || "").replace(/\.$/, "")], ["Cover", cover || null]],
          tip: (p.SpecialComment && p.SpecialComment.trim() ? p.SpecialComment.trim() + " " : "") + "You must register at the HAP check-in station before every hunt.",
          source: "Michigan DNR HAP" };
      } },
    { id: "mi_cfa", section: "mi", label: "Commercial Forest", desc: "Private timber land open to the public on foot for hunting, fishing and trapping.",
      url: MIDNR + "CommercialForestOPENDATA/FeatureServer/0", where: "1=1", fields: "OBJECTID,parid,GISAcres", region: MI_BBOX,
      color: function () { return "#b8742c"; }, fill: true, minZoom: 11, cellZ: 11, offset: 0.00001,
      popup: function (p) {
        return { tag: "Commercial Forest", tagColor: "#b8742c", title: "Commercial Forest land",
          rows: [["Parcel", p.parid], ["Size", acres(p.GISAcres)]],
          tip: "Open on foot for hunting, fishing and trapping. No vehicles, and the owner's other rules still apply. Check the DNR's Commercial Forest rules.",
          source: "Michigan DNR Commercial Forest" };
      } },
    { id: "mi_game", section: "mi", label: "Game area boundaries", desc: "Names and units of state game areas, wildlife areas and refuges (outline).",
      url: MIDNR + "DNRWILDLandsOPENDATA/FeatureServer/1", where: "1=1", fields: "OBJECTID,PropertyName,PropertyType,AdditionalInfo,County,Acres", region: MI_BBOX,
      color: function () { return "#1d6fa5"; }, fill: false, pane: "landline", minZoom: 10, cellZ: 10, offset: 0.00002,
      popup: function (p) {
        var info = p.AdditionalInfo && p.AdditionalInfo !== "-99" ? p.AdditionalInfo : null;
        var refuge = /refuge|no hunt|closed/i.test((info || "") + " " + (p.PropertyType || ""));
        return { tag: refuge ? "Check closure" : "Wildlife area", tagColor: refuge ? PG.css("--closed") : "#1d6fa5",
          title: p.PropertyName || "Wildlife property",
          rows: [["Type", p.PropertyType && p.PropertyType !== "-99" ? p.PropertyType : null], ["Unit", info], ["County", p.County], ["Size", acres(p.Acres)]],
          tip: refuge ? "Parts marked refuge or no-hunt are closed to hunting or entry for some or all of the year." : null,
          source: "Michigan DNR Wildlife Division" };
      } },
    { id: "mi_dmu", section: "mi", label: "Deer management units", desc: "DMU boundaries with unit numbers.",
      url: MIDNR + "Deer_Management_Units_for_Deer_Camp_Survey/FeatureServer/0", where: "1=1", fields: "OBJECTID,DMU", region: MI_BBOX,
      color: function () { return "#111"; }, swatch: "#111", fill: false, dash: "8 6", weight: 2.5, pane: "landline", minZoom: 7, cellZ: 7, offset: 0.0004,
      mapLabel: function (p) { return "DMU " + p.DMU; },
      popup: function (p) { return { tag: "Deer unit", tagColor: "#333", title: "DMU " + p.DMU, rows: [], source: "Michigan DNR" }; } }
  ];
  var BY_ID = {}; LAYERS.forEach(function (l) { BY_ID[l.id] = l; });
  PG.landLayers = LAYERS;

  var renderers = { landfill: L.canvas({ pane: "landfill", padding: 0.3 }), landline: L.canvas({ pane: "landline", padding: 0.3 }) };

  function styleFor(cfg, props) {
    var c = cfg.color(props);
    var op = PG.prefs.opacity / 100;
    return cfg.fill
      ? { color: c, weight: cfg.weight || 1.4, opacity: .95, fillColor: c, fillOpacity: op, dashArray: cfg.dash || null }
      : { color: c, weight: cfg.weight || 2, opacity: .95, fill: false, dashArray: cfg.dash || null };
  }

  // per-layer state
  LAYERS.forEach(function (cfg) {
    cfg.group = L.layerGroup();
    cfg.cells = new Map();     // key -> { ids, t }
    cfg.feats = new Map();     // id -> { lyr, refs, props, geom, bbox }
    cfg.pending = new Set();
  });

  // fetch queue (keeps us polite to the servers)
  var queue = [], active = 0, MAX_ACTIVE = 4;
  function pump() {
    while (active < MAX_ACTIVE && queue.length) {
      var job = queue.shift(); active++;
      job().then(done, done);
    }
    function done() { active--; pump(); }
  }
  function enqueue(fn) { return new Promise(function (res, rej) { queue.push(function () { return fn().then(res, rej); }); pump(); }); }

  function cellBBox(z, x, y) { return [PG.tile.x2lng(x, z), PG.tile.y2lat(y + 1, z), PG.tile.x2lng(x + 1, z), PG.tile.y2lat(y, z)]; }
  function intersects(a, b) { return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]; }

  function queryUrl(cfg, bb, offset) {
    return cfg.url + "/query?where=" + encodeURIComponent(cfg.where) +
      "&geometry=" + bb.map(function (v) { return v.toFixed(6); }).join(",") +
      "&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects" +
      "&outFields=" + encodeURIComponent(cfg.fields) + "&returnGeometry=true&outSR=4326&geometryPrecision=6" +
      "&maxAllowableOffset=" + cfg.offset + "&resultOffset=" + offset + "&resultRecordCount=1000&f=geojson";
  }

  // network fetch of one cell (with paging); returns array of GeoJSON features
  function fetchCellNet(cfg, z, x, y) {
    var bb = cellBBox(z, x, y), all = [];
    function page(offset, n) {
      return fetch(queryUrl(cfg, bb, offset)).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }).then(function (j) {
        if (j.error) throw new Error(j.error.message || "query error");
        var feats = j.features || [];
        all = all.concat(feats);
        var more = j.exceededTransferLimit || (j.properties && j.properties.exceededTransferLimit);
        if (more && feats.length && n < 15) return page(offset + feats.length, n + 1);
        return all;
      });
    }
    return page(0, 0);
  }
  function cellKey(cfg, z, x, y) { return cfg.id + ":" + z + "/" + x + "/" + y; }

  // get a cell: network first, IndexedDB copy when offline or the network fails
  PG.getLandCell = function (cfg, z, x, y, opts) {
    var key = cellKey(cfg, z, x, y);
    var fromDb = function () { return PG.db.get("land", key).then(function (v) { return v ? v.features : null; }); };
    if (!PG.isOnline() && !(opts && opts.forceNet)) return fromDb();
    return enqueue(function () { return fetchCellNet(cfg, z, x, y); }).then(function (feats) {
      PG.db.put("land", { t: Date.now(), features: feats }, key).catch(function () {});
      return feats;
    }, function (err) {
      if (opts && opts.forceNet) throw err;
      return fromDb();
    });
  };

  function addFeature(cfg, f) {
    var id = f.id != null ? f.id : (f.properties && (f.properties.OBJECTID || f.properties.ObjectID));
    if (id == null || !f.geometry) return null;
    var rec = cfg.feats.get(id);
    if (rec) { rec.refs++; return id; }
    var lyr = L.geoJSON(f, { pane: cfg.pane || "landfill", renderer: renderers[cfg.pane || "landfill"], interactive: false, style: function () { return styleFor(cfg, f.properties); } });
    if (cfg.mapLabel) lyr.eachLayer(function (l) { l.bindTooltip(esc(cfg.mapLabel(f.properties)), { permanent: true, direction: "center", className: "dmu-label", interactive: false }); });
    lyr.addTo(cfg.group);
    cfg.feats.set(id, { lyr: lyr, refs: 1, props: f.properties || {}, geom: f.geometry, bbox: PG.geomBBox(f.geometry) });
    return id;
  }
  function dropCell(cfg, key) {
    var c = cfg.cells.get(key); if (!c) return;
    c.ids.forEach(function (id) {
      var rec = cfg.feats.get(id); if (!rec) return;
      if (--rec.refs <= 0) { cfg.group.removeLayer(rec.lyr); cfg.feats.delete(id); }
    });
    cfg.cells.delete(key);
  }

  var errorShown = false;
  function updateLayer(cfg) {
    var on = !!PG.prefs.layers[cfg.id];
    var z = map.getZoom();
    if (!on || z < cfg.minZoom) { if (map.hasLayer(cfg.group)) map.removeLayer(cfg.group); return; }
    if (!map.hasLayer(cfg.group)) cfg.group.addTo(map);
    var b = map.getBounds().pad(0.15);
    if (cfg.region && !intersects([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], cfg.region)) return;
    var r = PG.tile.range(b, cfg.cellZ), want = new Set();
    for (var x = r.x0; x <= r.x1; x++) for (var y = r.y0; y <= r.y1; y++) {
      if (cfg.region && !intersects(cellBBox(cfg.cellZ, x, y), cfg.region)) continue;
      var key = cfg.cellZ + "/" + x + "/" + y; want.add(key);
      if (cfg.cells.has(key) || cfg.pending.has(key)) continue;
      loadCell(cfg, cfg.cellZ, x, y, key);
    }
    // forget far-away cells once we hold a lot
    if (cfg.cells.size > 250) {
      Array.from(cfg.cells.keys()).filter(function (k) { return !want.has(k); })
        .sort(function (a, b) { return cfg.cells.get(a).t - cfg.cells.get(b).t; })
        .slice(0, cfg.cells.size - 200).forEach(function (k) { dropCell(cfg, k); });
    }
  }
  function loadCell(cfg, z, x, y, key) {
    cfg.pending.add(key);
    PG.getLandCell(cfg, z, x, y).then(function (feats) {
      cfg.pending.delete(key);
      if (!feats) { if (!PG.isOnline()) return; throw new Error("no data"); }
      if (!PG.prefs.layers[cfg.id]) return;
      var ids = [];
      feats.forEach(function (f) { var id = addFeature(cfg, f); if (id != null) ids.push(id); });
      cfg.cells.set(key, { ids: ids, t: Date.now() });
    }).catch(function (err) {
      if (window.console) console.warn("land " + cfg.id + " " + key, err);
      cfg.pending.delete(key);
      if (!errorShown && PG.isOnline()) { errorShown = true; PG.toast("Some land data didn't load. Pan the map to retry."); setTimeout(function () { errorShown = false; }, 20000); }
    });
  }

  PG.refreshLand = function () { LAYERS.forEach(updateLayer); updateHint(); };
  PG.restyleLand = function () {
    LAYERS.forEach(function (cfg) { cfg.feats.forEach(function (rec) { rec.lyr.setStyle(styleFor(cfg, rec.props)); }); });
  };
  PG.setLandLayer = function (id, on) {
    PG.prefs.layers[id] = !!on; PG.savePrefs();
    var cfg = BY_ID[id];
    if (!on) { cfg.cells.forEach(function (_, k) { dropCell(cfg, k); }); map.removeLayer(cfg.group); }
    PG.refreshLand();
  };
  function updateHint() {
    var z = map.getZoom();
    var need = LAYERS.some(function (c) { return PG.prefs.layers[c.id] && c.section === "nation" && z < c.minZoom; }) ||
      LAYERS.some(function (c) { return PG.prefs.layers[c.id] && c.fill && z < c.minZoom; });
    $("zoomHint").hidden = !need;
  }
  map.on("moveend", PG.debounce(PG.refreshLand, 150));

  // ---------- "what land is this?" ----------
  var ORDER = ["mi_hap", "mi_cfa", "mi_dnr", "mi_game", "padus_open", "padus_restricted", "padus_closed", "mi_dmu"];
  PG.landAt = function (latlng) {
    var pt = [latlng.lng, latlng.lat], out = [];
    ORDER.forEach(function (id) {
      var cfg = BY_ID[id];
      if (!PG.prefs.layers[id] || !map.hasLayer(cfg.group)) return;
      cfg.feats.forEach(function (rec) {
        var b = rec.bbox;
        if (pt[0] < b[0] || pt[0] > b[2] || pt[1] < b[1] || pt[1] > b[3]) return;
        if (PG.pointInGeom(pt, rec.geom)) out.push(cfg.popup(rec.props));
      });
    });
    // collapse exact duplicates (the same parcel from overlapping datasets)
    var seen = {};
    return out.filter(function (p) { var k = p.title + "|" + p.tag; if (seen[k]) return false; seen[k] = 1; return true; });
  };
  PG.landPopupHtml = function (list) {
    return '<div class="landpops">' + list.map(function (p) {
      return '<div class="pop"><span class="tag" style="background:' + p.tagColor + '">' + esc(p.tag) + '</span>' +
        '<h3>' + esc(p.title) + '</h3><dl>' +
        p.rows.filter(function (r) { return r[1]; }).map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join("") +
        '</dl>' + (p.tip ? '<p class="tip">' + esc(p.tip) + '</p>' : '') + '</div>';
    }).join("") + '</div>';
  };

  // ---------- county parcel viewers (owner lookups open the county's own map) ----------
  // The counties' terms don't allow copying their parcel data into other apps, so we link out instead.
  var COUNTY_VIEWERS = [
    { name: "Newaygo County", bbox: [-86.045, 43.290, -85.555, 43.8155],
      url: "https://arcgisweb.countyofnewaygo.com/portal/apps/webappviewer/index.html?id=6f09e33488614e8eabd2e8a0f006a9be" },
    { name: "Lake County", bbox: [-86.045, 43.8155, -85.555, 44.168],
      url: "https://lakecounty-mi.maps.arcgis.com/apps/webappviewer/index.html?id=afaee30ca6e542c0876f9996d9d72452" }
  ];
  PG.countyViewer = function (latlng) {
    var c = COUNTY_VIEWERS.find(function (v) {
      return latlng.lng >= v.bbox[0] && latlng.lng <= v.bbox[2] && latlng.lat >= v.bbox[1] && latlng.lat <= v.bbox[3];
    });
    if (!c) return null;
    return { name: c.name, url: c.url + "&center=" + latlng.lng.toFixed(6) + "," + latlng.lat.toFixed(6) + "&level=17" };
  };

  // ---------- layer toggles UI ----------
  function toggleHtml(cfg) {
    var c = cfg.swatch || cfg.color({});
    return '<div class="toggle"><input type="checkbox" id="lyr_' + cfg.id + '"' + (PG.prefs.layers[cfg.id] ? " checked" : "") + '>' +
      '<span class="sw' + (cfg.fill ? '' : ' outline') + '" style="background:' + c + ';border-color:' + c + '"></span>' +
      '<label for="lyr_' + cfg.id + '">' + esc(cfg.label) + '<small>' + esc(cfg.desc) + '</small></label></div>';
  }
  PG.buildLayerUI = function () {
    $("landToggles").innerHTML = LAYERS.filter(function (c) { return c.section === "nation"; }).map(toggleHtml).join("");
    $("miToggles").innerHTML = LAYERS.filter(function (c) { return c.section === "mi"; }).map(toggleHtml).join("");
    LAYERS.forEach(function (cfg) {
      $("lyr_" + cfg.id).addEventListener("change", function () { PG.setLandLayer(cfg.id, this.checked); });
    });
    $("lyr_terrain").checked = !!PG.prefs.terrain;
    $("lyr_terrain").addEventListener("change", function () { PG.setTerrain(this.checked); });
    $("opacity").value = PG.prefs.opacity;
    $("opacity").addEventListener("input", function () { PG.prefs.opacity = +this.value; PG.savePrefs(); PG.restyleLand(); });
    document.querySelectorAll("#baseSeg button").forEach(function (b) { b.addEventListener("click", function () { PG.setBase(b.dataset.base); }); });
  };

  try { window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", PG.restyleLand); } catch (e) {}

  PG.initLayers = function () {
    PG.setBase(PG.prefs.base);
    if (PG.prefs.terrain) PG.setTerrain(true);
    PG.buildLayerUI();
    PG.refreshLand();
  };
})();
