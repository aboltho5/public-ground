/* Weather: next-hour chip beside the wind, and the Weather sheet with rain timing, a 7-day forecast and the moon. */
(function () {
  "use strict";
  var PG = window.PG, $ = PG.$, esc = PG.esc;
  var W = PG.Weather = {};

  // ---------- WMO weather codes ----------
  var CODES = {
    0: ["Clear", "sun"], 1: ["Mostly clear", "partly"], 2: ["Partly cloudy", "partly"], 3: ["Cloudy", "cloud"],
    45: ["Fog", "fog"], 48: ["Freezing fog", "fog"],
    51: ["Light drizzle", "drizzle"], 53: ["Drizzle", "drizzle"], 55: ["Heavy drizzle", "drizzle"], 56: ["Freezing drizzle", "sleet"], 57: ["Freezing drizzle", "sleet"],
    61: ["Light rain", "rain"], 63: ["Rain", "rain"], 65: ["Heavy rain", "rain"], 66: ["Freezing rain", "sleet"], 67: ["Freezing rain", "sleet"],
    71: ["Light snow", "snow"], 73: ["Snow", "snow"], 75: ["Heavy snow", "snow"], 77: ["Snow grains", "snow"],
    80: ["Rain showers", "rain"], 81: ["Rain showers", "rain"], 82: ["Heavy showers", "rain"], 85: ["Snow showers", "snow"], 86: ["Snow showers", "snow"],
    95: ["Thunderstorms", "storm"], 96: ["Storms with hail", "storm"], 99: ["Storms with hail", "storm"]
  };
  function wx(code, day) {
    var c = CODES[code] || ["--", "cloud"];
    if (code === 0 && day === 0) return { label: "Clear", kind: "moon" };
    if (code === 1 && day === 0) return { label: "Mostly clear", kind: "moon" };
    return { label: c[0], kind: c[1] };
  }
  W.describe = wx;

  var CLOUD = '<path d="M6.5 15.5h11a3.5 3.5 0 0 0 .3-6.99A5 5 0 0 0 8.1 9.6 3 3 0 0 0 6.5 15.5z" fill="#c3cac5" stroke="#6f7a72" stroke-width="1.2" stroke-linejoin="round"/>';
  var SUN_RAYS = '<g stroke="#e6a91f" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></g><circle cx="12" cy="12" r="4.6" fill="#f0b429"/>';
  function drops(color, kind) {
    if (kind === "snow") return '<g fill="' + color + '"><circle cx="8.5" cy="19" r="1.3"/><circle cx="12.5" cy="21" r="1.3"/><circle cx="16.5" cy="19" r="1.3"/></g>';
    if (kind === "drizzle") return '<g fill="' + color + '"><circle cx="9" cy="19" r="1"/><circle cx="13" cy="20.5" r="1"/><circle cx="16.5" cy="18.5" r="1"/></g>';
    return '<g stroke="' + color + '" stroke-width="1.8" stroke-linecap="round"><path d="M9 17.5l-1 3M13 17.5l-1 3M17 17.5l-1 3"/></g>';
  }
  W.icon = function (kind, size) {
    var s = size || 24, inner;
    if (kind === "sun") inner = SUN_RAYS;
    else if (kind === "moon") inner = '<path d="M15.5 3.5a8.5 8.5 0 1 0 5 15.4A7 7 0 0 1 15.5 3.5z" fill="#d9d2b4" stroke="#8b958d" stroke-width=".8"/>';
    else if (kind === "partly") inner = '<g transform="translate(-2 -3) scale(.75)">' + SUN_RAYS + '</g><g transform="translate(1.5 3)">' + CLOUD + '</g>';
    else if (kind === "fog") inner = '<g transform="translate(0 -2)">' + CLOUD + '</g><g stroke="#8f9a92" stroke-width="1.6" stroke-linecap="round"><path d="M5 17h14M7 20h10"/></g>';
    else if (kind === "rain") inner = '<g transform="translate(0 -3)">' + CLOUD + '</g>' + drops("#3b82c4", "rain");
    else if (kind === "drizzle") inner = '<g transform="translate(0 -3)">' + CLOUD + '</g>' + drops("#3b82c4", "drizzle");
    else if (kind === "snow") inner = '<g transform="translate(0 -3)">' + CLOUD + '</g>' + drops("#7fb2d9", "snow");
    else if (kind === "sleet") inner = '<g transform="translate(0 -3)">' + CLOUD + '</g><g stroke="#3b82c4" stroke-width="1.8" stroke-linecap="round"><path d="M9 17.5l-1 3"/></g><circle cx="13" cy="19.5" r="1.3" fill="#7fb2d9"/><path d="M17 17.5l-1 3" stroke="#3b82c4" stroke-width="1.8" stroke-linecap="round"/>';
    else if (kind === "storm") inner = '<g transform="translate(0 -3)">' + CLOUD + '</g><path d="M12.5 14.5 9.5 19h3l-1.5 4 4.5-5.5h-3l1.5-3z" fill="#f0b429" stroke="#b07d10" stroke-width=".6" stroke-linejoin="round"/>';
    else inner = '<g transform="translate(0 2)">' + CLOUD + '</g>';
    return '<svg class="wxicon" viewBox="0 0 24 24" width="' + s + '" height="' + s + '" aria-hidden="true">' + inner + '</svg>';
  };

  // ---------- data helpers ----------
  function data() { var d = PG.Field && PG.Field.weatherData && PG.Field.weatherData(); return d && d.hours && d.hours.length && d.hours[0].temp != null ? d : null; }
  function fresh(d) { return d && Date.now() - d.fetched < 3 * 3600e3; }
  function isSnow(code) { return [71, 73, 75, 77, 85, 86].indexOf(code) >= 0; }

  W.nextHour = function () {
    var d = data(); if (!fresh(d)) return null;
    var now = Date.now(), hs = d.hours.filter(function (h) { return h.t > now - 36e5 && h.t <= now + 36e5; });
    if (!hs.length) return null;
    var mid = now + 18e5, best = hs[0];
    hs.forEach(function (h) { if (Math.abs(h.t + 18e5 - mid) < Math.abs(best.t + 18e5 - mid)) best = h; });
    var pop = Math.max.apply(null, hs.map(function (h) { return h.pop || 0; }));
    var wet = hs.reduce(function (a, h) { return (h.pop || 0) > (a.pop || 0) ? h : a; }, hs[0]);
    return { temp: best.temp, code: best.code, day: best.day, pop: pop, precip: hs.reduce(function (s, h) { return s + (h.precip || 0); }, 0) / hs.length, snow: isSnow(wet.code) };
  };
  // first hour in the next 12 where rain or snow becomes likely
  W.precipStart = function () {
    var d = data(); if (!fresh(d)) return null;
    var now = Date.now(), list = d.hours.filter(function (h) { return h.t >= now - 36e5 && h.t <= now + 12 * 36e5; });
    for (var i = 0; i < list.length; i++) if ((list[i].pop || 0) >= 50) return list[i];
    return null;
  };

  // ---------- chip ----------
  W.update = function () {
    var chip = $("chipWx"), n = W.nextHour();
    if (!n) { chip.hidden = true; } else {
      var w = wx(n.code, n.day), text = Math.round(n.temp) + "°";
      text += n.pop >= 20 ? " · " + (n.snow ? "Snow " : "Rain ") + Math.round(n.pop) + "%" : " " + w.label;
      chip.innerHTML = W.icon(n.pop >= 40 && w.kind !== "rain" && w.kind !== "snow" && w.kind !== "storm" && w.kind !== "drizzle" ? (n.snow ? "snow" : "rain") : w.kind, 18) + esc(text);
      chip.title = "Next hour: " + w.label + ", " + Math.round(n.pop) + "% chance of " + (n.snow ? "snow" : "rain");
      chip.classList.toggle("wet", n.pop >= 50);
      chip.hidden = false;
    }
    if (!$("sheetWeather").hidden) W.render();
  };
  $("chipWx").addEventListener("click", function () { PG.UI.openSheet("sheetWeather"); });

  // ---------- sheet ----------
  function dayLabel(dateStr, i) {
    var p = dateStr.split("-"), d = new Date(+p[0], +p[1] - 1, +p[2], 12);
    return { name: i === 0 ? "Today" : d.toLocaleDateString([], { weekday: "short" }), date: d };
  }
  function place() {
    var d = data();
    if (d) return { lat: d.lat, lng: d.lng };
    var c = PG.map.getCenter(); return { lat: c.lat, lng: c.lng };
  }

  W.render = function () {
    var d = data(), pl = place(), now = new Date(), html = "";
    $("wxWhere").textContent = d ? (d.label || "") : "";

    // next hour
    var n = W.nextHour();
    if (n) {
      var w = wx(n.code, n.day), wind = PG.Field.windNow();
      var start = W.precipStart(), startTxt = "";
      if (start) {
        var kind = isSnow(start.code) ? "Snow" : "Rain";
        startTxt = start.t <= Date.now() + 36e5 ? kind + " likely in the next hour." : kind + " likely starting around " + new Date(start.t).toLocaleTimeString([], { hour: "numeric" }) + " (" + Math.round(start.pop) + "%).";
      } else startTxt = "No rain or snow expected in the next 12 hours.";
      html += '<div class="wxnow">' + W.icon(w.kind, 56) + '<div><div class="big">' + Math.round(n.temp) + '° ' + esc(w.label) + '</div>' +
        '<div class="sm">' + Math.round(n.pop) + '% chance of ' + (n.snow ? "snow" : "rain") + (n.precip >= 0.01 ? ' · ' + n.precip.toFixed(2) + ' in' : '') +
        (wind ? ' · Wind ' + (wind.speed < 2 ? "calm" : PG.dirName(wind.dir) + " " + Math.round(wind.speed) + " mph") : '') + '</div>' +
        '<div class="sm wxalert' + (start ? " on" : "") + '">' + esc(startTxt) + '</div></div></div>';
      var hrs = d.hours.filter(function (h) { return h.t > Date.now() - 36e5; }).slice(0, 12);
      html += '<div class="eyebrow">Rain chance, next 12 hours</div><div class="popbars">' + hrs.map(function (h) {
        var p = Math.round(h.pop || 0);
        return '<div><span class="pv">' + p + '%</span><span class="pbar"><i style="height:' + Math.max(2, p) + '%"' + (isSnow(h.code) ? ' class="snow"' : '') + '></i></span>' +
          '<b>' + new Date(h.t).toLocaleTimeString([], { hour: "numeric" }).replace(" ", "").toLowerCase() + '</b><span class="tv">' + Math.round(h.temp) + '°</span></div>';
      }).join("") + '</div>';
    } else {
      html += '<p class="empty">' + (PG.isOnline() ? "Loading the forecast..." : "The forecast needs a signal. It will update when you're back online.") + '</p>';
    }

    // 7 days, with the moon for each night
    if (d && d.daily && d.daily.length) {
      html += '<div class="eyebrow">7-day forecast</div><div class="days">' + d.daily.map(function (day, i) {
        var lab = dayLabel(day.date, i), w2 = wx(day.code, 1);
        var night = new Date(lab.date.getFullYear(), lab.date.getMonth(), lab.date.getDate(), 22);
        var m = PG.moonIllumination(night);
        return '<div class="day"><b class="dn">' + esc(lab.name) + '</b>' + W.icon(w2.kind, 30) +
          '<span class="cond">' + esc(w2.label) + '<small>' + (day.wind != null ? PG.dirName(day.dir) + ' ' + Math.round(day.wind) + ' mph' : '') + (day.precip >= 0.01 ? ' · ' + day.precip.toFixed(2) + ' in' : '') + '</small></span>' +
          '<span class="pop' + ((day.pop || 0) >= 50 ? ' hi' : '') + '">' + Math.round(day.pop || 0) + '%</span>' +
          '<span class="temps"><b>' + Math.round(day.hi) + '°</b>' + Math.round(day.lo) + '°</span>' +
          '<span class="mo" title="' + esc(PG.moonPhaseName(m.phase)) + ', ' + Math.round(m.fraction * 100) + '% lit">' + PG.moonSvg(m.phase, 22) + '</span></div>';
      }).join("") + '</div>';
    }

    // moon cycle (works offline)
    var mi = PG.moonIllumination(now), mt = PG.moonTimes(now, pl.lat, pl.lng), nx = PG.nextMoons(now);
    function dd(x) { return x ? x.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "--"; }
    html += '<div class="eyebrow">Moon</div><div class="mooncard">' + PG.moonSvg(mi.phase, 60) +
      '<div><div class="big">' + esc(PG.moonPhaseName(mi.phase)) + '</div>' +
      '<div class="sm">' + Math.round(mi.fraction * 100) + '% lit · ' + (mi.phase < 0.5 ? "growing" : "shrinking") + '</div>' +
      '<div class="sm">' + (mt.rise ? 'Moonrise ' + PG.fmtTime(mt.rise) : 'No moonrise today') + ' · ' + (mt.set ? 'Moonset ' + PG.fmtTime(mt.set) : 'no moonset today') + '</div></div></div>' +
      '<div class="moonnext"><div><small>Next full moon</small><strong>' + dd(nx.full) + '</strong></div><div><small>Next new moon</small><strong>' + dd(nx.newMoon) + '</strong></div></div>' +
      '<div class="moonweek">' + Array.from({ length: 30 }, function (_, k) {
        var dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k, 22), m = PG.moonIllumination(dt);
        return '<div' + (k === 0 ? ' class="today"' : '') + '>' + PG.moonSvg(m.phase, 26) + '<small>' + (k === 0 ? "Tonight" : dt.toLocaleDateString([], { month: "numeric", day: "numeric" })) + '</small></div>';
      }).join("") + '</div>';

    if (d) html += '<p class="fine">Forecast from Open-Meteo, updated ' + PG.fmtTime(new Date(d.fetched)) + '. Moon times are worked out on your phone, so they work without a signal.</p>';
    $("wxBox").innerHTML = html;
  };

  W.open = function () { W.render(); PG.Field.fetchWind(); };
})();
