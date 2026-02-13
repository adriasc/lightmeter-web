# Film Light Meter Web (No Xcode)

This is a browser-based version of your light meter app.

## Features
- Live camera view (rear camera on iPhone)
- Approximate 28mm framing (if browser/device supports zoom constraints)
- Tap-to-meter point (that point becomes `0.0`)
- Numeric zone values (`+/-` stops relative to metering point)
- Film ISO selector
- Shutter-by-aperture and aperture-by-shutter tables

## Important
- Your original iOS/Xcode app is still untouched in:
  - `/Users/adriasalvadocoloma/Documents/CODEX/LightMeteriOS`

## Run locally from VS Code

Camera access usually requires `http://localhost` or `https` (not plain `file://`).

### Option A: VS Code Live Server (easiest)
1. Open folder `/Users/adriasalvadocoloma/Documents/CODEX/LightMeterWeb` in VS Code.
2. Install extension **Live Server**.
3. Right click `index.html` -> **Open with Live Server**.
4. On this computer, open the shown URL in browser.

### Option B: Python local server
From terminal in this folder:

```bash
cd /Users/adriasalvadocoloma/Documents/CODEX/LightMeterWeb
python3 -m http.server 8080
```

Open:
- On same computer: `http://localhost:8080`
- On iPhone (same Wi-Fi): `http://YOUR_COMPUTER_IP:8080`

## iPhone test
1. Open the URL in Safari.
2. Tap **Start Camera** and allow permission.
3. Tap scene to set metering point.
4. Change Film ISO and read both exposure tables.
