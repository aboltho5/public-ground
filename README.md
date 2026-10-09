# Public Ground

A free hunting map that runs in your phone's browser. It shows public land, Michigan DNR layers, your own spots and drawings, tracks your walk, and works offline in areas you download.

Live at: https://aboltho5.github.io/public-ground/

## Install it on your phone

- iPhone (Safari): open the link, tap Share, then **Add to Home Screen**. Do this. Safari can erase saved data for websites you haven't opened in 7 days, but it doesn't do that to home screen apps.
- Android (Chrome): open the link, tap the menu, then **Add to Home screen** or **Install app**.

## What's in it

**Map layers** (layers button)
- Base maps: Esri satellite, USGS photo, USGS topo, roads.
- Terrain shading from USGS lidar. It makes ridges, saddles, benches and creek bottoms stand out.
- Public land nationwide from USGS PAD-US: open, restricted, and closed.
- Michigan DNR: all state land (updated weekly), Hunting Access Program (HAP) parcels, Commercial Forest land, game area boundaries, and deer management units.
- Tap anywhere to see what land you're on. You'll see every layer that covers that point, or a warning that no public land is mapped there.

**Spots** (orange pin, or press and hold on the map)
- Types: stand, blind, trail cam, rub/scrape, bedding, water, parking, other.
- Groups, with a show/hide toggle for each group.
- Good winds: tag which winds work for a stand. It gets a green ring on days the wind is right.
- Photos. These stay on the device that took them.
- Hunt log: log each sit with time, wind, deer seen and notes.
- Go to: an arrow and distance that guide you to the spot on foot.
- Share: sends a link that drops the spot on a buddy's map.

**In the field** (wind button)
- Shooting light for today and tomorrow, worked out for your exact location. The rule is 30 minutes before sunrise to 30 minutes after sunset (Michigan deer hours). The chip at the top counts down the last hour.
- Wind now plus the next 12 hours, with an arrow showing where your scent drifts.
- Track your walk. It records your path so you can follow it back. The screen stays on while recording, because phones pause web apps when the screen locks.

**Measure & draw** (pencil button)
- Lines show distance. Areas show acreage. Save them to mark trails, bedding, food plots or permission land.

**Menu**
- Offline maps: download the area on screen (USGS photo, topo, terrain, and all land layers). Afterward it works with no signal.
- Sync between devices through a private file in your own GitHub account. You'll need a GitHub token with only the "gist" permission.
- Backup: export or import GeoJSON (keeps everything) or GPX (opens in Google Earth, Gaia, and GPS units).

## Things to know

- **Open land is not always open to hunting.** City parks, many state parks, national parks and refuges can ban hunting or limit it. Always check the managing agency's rules.
- Boundaries are a guide, not a survey line. Small or newly bought parcels can be missing.
- Offline maps use USGS imagery and topo, which are public domain. The Esri satellite and road maps only work online.

## Data sources

USGS PAD-US and The National Map (imagery, topo, 3DEP elevation); Michigan DNR open data (land ownership, HAP, Commercial Forest, wildlife areas, DMUs); Esri World Imagery; OpenStreetMap and Nominatim; Open-Meteo for wind. Sun times use the SunCalc algorithm by Vladimir Agafonkin. The map engine is Leaflet.
