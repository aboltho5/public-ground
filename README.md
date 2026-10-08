# Public Ground

A free, single-file hunting map: public land from the USGS Protected Areas Database (PAD-US), satellite / topo / road basemaps, GPS, and your own saved spots.

## Put it online for free (GitHub Pages, about 5 minutes)

1. Make a free account at github.com.
2. Click **New repository**, name it `public-ground`, set it to Public, and create it.
3. Click **Add file > Upload files**, drag in `index.html`, and commit.
4. Go to **Settings > Pages**. Under "Branch" pick `main` and `/ (root)`, then Save.
5. After a minute your map is live at `https://YOUR-USERNAME.github.io/public-ground/`.

It has to be served over https (GitHub Pages does this) for GPS to work on your phone.

## Put it on your phone like an app

- iPhone (Safari): open the link, tap Share, then **Add to Home Screen**.
- Android (Chrome): open the link, tap the menu, then **Add to Home screen** or **Install app**.

## Using it

- **Public land** shows once you zoom in to about county level. Green is open access, amber is restricted (permit or seasonal). Closed land can be turned on as a red outline in Layers.
- **Tap a parcel** to see its name, who manages it, and acreage.
- **Mark a spot**: tap the orange pin, line up the crosshair, tap Place here. Or press and hold on the map. Pick a type (stand, blind, trail cam, rub/scrape, bedding, water, parking, other) and add notes.
- **Use my GPS** while placing drops the crosshair on where you are standing.
- **Search** takes town or place names, or raw coordinates like `43.0125, -83.6875`.

## Things to know

- **Open access is not the same as legal to hunt.** City parks, most state parks, and national parks show as open but usually ban hunting. Always check the managing agency's rules.
- PAD-US is national but not perfect. Small parcels or recent purchases can be missing, and boundaries can be off by a bit. Treat it as a guide, not a survey line.
- **Spots are saved in your browser on that device only.** Export GPX or GeoJSON for a backup and Import it on another device. Clearing browser data erases them.
- There's no offline mode yet. In areas with no signal, map tiles you haven't already viewed won't load. Pre-scroll your hunting area at home on Wi-Fi.

## Data sources

- Public land: USGS Gap Analysis Project, PAD-US public access layer.
- Imagery and reference labels: Esri World Imagery.
- Topo: USGS The National Map.
- Roads and search: OpenStreetMap contributors / Nominatim.
