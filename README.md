# Film Light Meter Web (No Xcode)

This is a browser-based version of your light meter app.

## Modes
- Standard mode (tables): `index.html`
- Horizontal bar mode (bottom bars): `index-bar.html`

## Features
- Live camera view (rear camera on iPhone)
- Approximate 28mm framing (if browser/device supports zoom constraints)
- Tap-to-meter point (snaps to zone center)
- Numeric zone values (`+/-` stops relative to metering point)
- Zone colors:
  - positive = bright blue
  - negative = bright red
  - near zero = white
- Slower/stabler updates (less flicker)
- Film ISO selector
- Exposure suggestions

## Run locally from VS Code

Camera access usually requires `http://localhost` or `https` (not plain `file://`).

### Option A: VS Code Live Server
1. Open this folder in VS Code.
2. Install extension **Live Server**.
3. Right click `index.html` or `index-bar.html` -> **Open with Live Server**.

### Option B: Python local server
From terminal in this project folder:

```bash
python3 -m http.server 8080
```

Open:
- Standard mode: `http://localhost:8080/index.html`
- Horizontal bars: `http://localhost:8080/index-bar.html`

## iPhone test
1. Open the URL in Safari.
2. Tap **Start Camera** and allow permission.
3. Tap scene to set metering point.
4. Change Film ISO and read values.
