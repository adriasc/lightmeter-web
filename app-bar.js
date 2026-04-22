const ISO_VALUES = [25, 50, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 3200];
const APP_VERSION = "2.6.0";
const APERTURE_RULER_VALUES = [
  1.0, 1.1, 1.2, 1.4, 1.6, 1.8,
  2.0, 2.2, 2.5, 2.8, 3.2, 3.5,
  4.0, 4.5, 5.0, 5.6, 6.3, 7.1,
  8.0, 9.0, 10.0, 11.0, 13.0, 14.0,
  16.0, 18.0, 20.0, 22.0
];
const RULER_SHUTTERS = [
  1 / 8000, 1 / 6400, 1 / 5000, 1 / 4000, 1 / 3200, 1 / 2500, 1 / 2000, 1 / 1600,
  1 / 1250, 1 / 1000, 1 / 800, 1 / 640, 1 / 500, 1 / 400, 1 / 320, 1 / 250,
  1 / 200, 1 / 160, 1 / 125, 1 / 100, 1 / 80, 1 / 60, 1 / 50, 1 / 40,
  1 / 30, 1 / 25, 1 / 20, 1 / 15, 1 / 13, 1 / 10, 1 / 8, 1 / 6,
  1 / 5, 1 / 4, 0.3, 0.4, 0.5, 0.6, 0.8,
  1.0, 1.3, 1.6, 2.0, 2.5, 3.2, 4.0, 5.0, 6.0,
  8.0, 10.0, 13.0, 15.0, 20.0, 25.0, 30.0
];

const GRID_ROWS = 10;
const GRID_COLS = 14;
const EV_CALIBRATION_OFFSET = 4.5;

const UPDATE_INTERVAL_MS = 220;
const GRID_SMOOTHING = 0.34;
const EV_SMOOTHING = 0.25;
const NEAR_ZERO_THRESHOLD = 0.2;
const STOP_EXPANSION_FACTOR = 1.8;
const REF_PATCH_RADIUS_PX = 8;
const REF_PATCH_STEP_PX = 1;
const ZONE_PATCH_RATIO = 0.06;
const ZONE_PATCH_STEP_PX = 1;
const RULER_COL_WIDTH = 66;
const RULER_GAP = 8;

const LABEL_STAGGER_CELL_FRACTION = 0.22;
const EXTREME_WARN_STOPS = 3.0;
const EXTREME_CRITICAL_STOPS = 6.0;
const NIGHT_EV_THRESHOLD = 7.0;
const MODE_SIMPLE = "simple";
const MODE_PRO = "pro";
const MODE_STORAGE_KEY = "filmLightMeterMode";
const SIMPLE_MODE_HINT = "Tap to lock exposure. Each number covers about 1/14 width x 1/10 height of frame.";
const PRO_MODE_HINT = "Tap to lock exposure. Each number covers about 1/14 width x 1/10 height of frame. Blue square = positive extreme, red square = negative extreme. Darker color from |zone| >= 6. Yellow squares = zones closest to the whole-frame average.";
const AVG_MARKER_MAX_COUNT = 4;
const AVG_MARKER_MAX_DELTA_STOPS = 0.2;
const AVG_MARKER_MIN_CELL_GAP = 2;

const video = document.getElementById("video");
const canvas = document.getElementById("meterCanvas");
const zoneOverlay = document.getElementById("zoneOverlay");
const tapMarker = document.getElementById("tapMarker");
const avgMarkers = document.getElementById("avgMarkers");
const startBtn = document.getElementById("startBtn");
const evReadout = document.getElementById("evReadout");
const appVersion = document.getElementById("appVersion");
const hintBanner = document.getElementById("hintBanner");
const modeSimpleBtn = document.getElementById("modeSimpleBtn");
const modeProBtn = document.getElementById("modeProBtn");
const isoSelect = document.getElementById("isoSelect");
const apertureRuler = document.getElementById("apertureRuler");
const shutterRuler = document.getElementById("shutterRuler");
const cameraWrap = document.getElementById("cameraWrap");

let selectedISO = 400;
let referenceCell = { row: Math.floor(GRID_ROWS / 2), col: Math.floor(GRID_COLS / 2) };
let referencePoint = cellCenter(referenceCell.row, referenceCell.col);
let averageCells = [{ row: Math.floor(GRID_ROWS / 2), col: Math.floor(GRID_COLS / 2) }];
let uiMode = readInitialMode();

let animationFrameId = null;
let lastMeterTs = 0;
let smoothedGrid = null;
let smoothedEV = 10;
let smoothedRefLuma = null;
let lockedEV = 10;
let needsMeterLock = true;
let selectedApertureIndex = findClosestExposureIndex(APERTURE_RULER_VALUES, 5.6);
let selectedShutterIndex = findClosestExposureIndex(RULER_SHUTTERS, 1 / 125);
let activeExposureAxis = "aperture";
let isApertureAutoScrolling = false;
let isShutterAutoScrolling = false;

init();

function init() {
  if (appVersion) appVersion.textContent = `v${APP_VERSION}`;
  setupModeSwitch();
  applyUiMode();
  if (hintBanner) {
    window.setTimeout(() => {
      hintBanner.classList.add("is-hidden");
    }, 4500);
  }

  ISO_VALUES.forEach((iso) => {
    const option = document.createElement("option");
    option.value = String(iso);
    option.textContent = String(iso);
    if (iso === selectedISO) option.selected = true;
    isoSelect.appendChild(option);
  });

  renderTapMarker();
  renderAverageMarkers();
  createZoneCells();
  paintReferenceCell();
  buildRulers();

  setRulerSidePadding(apertureRuler);
  setRulerSidePadding(shutterRuler);
  centerRulerAtIndex(apertureRuler, selectedApertureIndex, false);
  centerRulerAtIndex(shutterRuler, selectedShutterIndex, false);
  highlightSelectedRulerIndex(apertureRuler, selectedApertureIndex);
  highlightSelectedRulerIndex(shutterRuler, selectedShutterIndex);

  evReadout.textContent = lockedEV.toFixed(1);
  syncRulersFromActiveAxis(false);

  startBtn.addEventListener("click", startCamera);
  cameraWrap.addEventListener("click", onCameraTap);
  isoSelect.addEventListener("change", () => {
    selectedISO = Number(isoSelect.value);
    syncRulersFromActiveAxis(true);
  });
  apertureRuler.addEventListener("scroll", onApertureRulerScroll, { passive: true });
  shutterRuler.addEventListener("scroll", onShutterRulerScroll, { passive: true });
  window.addEventListener("resize", onResize);
}

function readInitialMode() {
  try {
    const savedMode = localStorage.getItem(MODE_STORAGE_KEY);
    if (savedMode === MODE_PRO || savedMode === MODE_SIMPLE) return savedMode;
  } catch {
    // Ignore storage access issues.
  }
  return MODE_SIMPLE;
}

function setupModeSwitch() {
  if (!modeSimpleBtn || !modeProBtn) return;
  modeSimpleBtn.addEventListener("click", () => setUiMode(MODE_SIMPLE));
  modeProBtn.addEventListener("click", () => setUiMode(MODE_PRO));
}

function setUiMode(nextMode) {
  if (nextMode !== MODE_SIMPLE && nextMode !== MODE_PRO) return;
  if (uiMode === nextMode) return;
  uiMode = nextMode;

  try {
    localStorage.setItem(MODE_STORAGE_KEY, uiMode);
  } catch {
    // Ignore storage access issues.
  }

  applyUiMode();
}

function applyUiMode() {
  const isPro = uiMode === MODE_PRO;
  document.body.classList.toggle("mode-pro", isPro);
  document.body.classList.toggle("mode-simple", !isPro);

  if (modeSimpleBtn) {
    modeSimpleBtn.classList.toggle("is-active", !isPro);
    modeSimpleBtn.setAttribute("aria-pressed", String(!isPro));
  }

  if (modeProBtn) {
    modeProBtn.classList.toggle("is-active", isPro);
    modeProBtn.setAttribute("aria-pressed", String(isPro));
  }

  if (hintBanner) {
    hintBanner.textContent = isPro ? PRO_MODE_HINT : SIMPLE_MODE_HINT;
  }
}

async function startCamera() {
  startBtn.disabled = true;
  startBtn.textContent = "Starting...";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();
    applyWiderFraming(stream);

    startBtn.style.display = "none";
    loopMetering();
  } catch {
    startBtn.disabled = false;
    startBtn.textContent = "Camera permission needed";
  }
}

async function applyWiderFraming(stream) {
  const [track] = stream.getVideoTracks();
  if (!track) return;

  const caps = track.getCapabilities ? track.getCapabilities() : null;
  if (!caps || typeof caps.zoom !== "object") return;

  const minZoom = caps.zoom.min ?? 1;
  const maxZoom = caps.zoom.max ?? 1;
  const zoom = clamp(minZoom, minZoom, maxZoom);

  try {
    await track.applyConstraints({ advanced: [{ zoom }] });
  } catch {
    // Ignore unsupported zoom controls.
  }
}

function onCameraTap(event) {
  if (!video.srcObject) return;

  const rect = cameraWrap.getBoundingClientRect();
  const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);

  referencePoint = { x, y };
  const col = clamp(Math.floor(referencePoint.x * GRID_COLS), 0, GRID_COLS - 1);
  const row = clamp(Math.floor(referencePoint.y * GRID_ROWS), 0, GRID_ROWS - 1);
  referenceCell = { row, col };

  renderTapMarker();
  paintReferenceCell();
  needsMeterLock = true;
}

function renderTapMarker() {
  tapMarker.style.left = `${referencePoint.x * 100}%`;
  tapMarker.style.top = `${referencePoint.y * 100}%`;
}

function renderAverageMarkers() {
  if (!avgMarkers) return;
  avgMarkers.innerHTML = "";

  averageCells.forEach((cell) => {
    const center = cellCenter(cell.row, cell.col);
    const marker = document.createElement("div");
    marker.className = "avg-marker";
    marker.style.left = `${center.x * 100}%`;
    marker.style.top = `${center.y * 100}%`;
    avgMarkers.appendChild(marker);
  });
}

function updateAverageMarkerFromGrid(grid) {
  if (!avgMarkers || !grid || !grid.length) return;

  let sum = 0;
  let count = 0;
  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      sum += grid[row][col];
      count += 1;
    }
  }

  const meanLuma = sum / Math.max(count, 1);
  const candidates = [];

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const deltaStops = Math.abs(
        Math.log2(Math.max(grid[row][col], 1e-4) / Math.max(meanLuma, 1e-4))
      );
      candidates.push({ row, col, deltaStops });
    }
  }

  candidates.sort((a, b) => a.deltaStops - b.deltaStops);

  const chosen = [];
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];

    if (chosen.length && candidate.deltaStops > AVG_MARKER_MAX_DELTA_STOPS && chosen.length >= 2) {
      break;
    }

    const tooClose = chosen.some((cell) => {
      return Math.abs(cell.row - candidate.row) < AVG_MARKER_MIN_CELL_GAP
        && Math.abs(cell.col - candidate.col) < AVG_MARKER_MIN_CELL_GAP;
    });

    if (!tooClose) {
      chosen.push({ row: candidate.row, col: candidate.col });
      if (chosen.length >= AVG_MARKER_MAX_COUNT) break;
    }
  }

  if (!chosen.length && candidates.length) {
    chosen.push({ row: candidates[0].row, col: candidates[0].col });
  }

  averageCells = chosen;
  renderAverageMarkers();
}

function loopMetering() {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);

  const tick = (ts) => {
    if (video.videoWidth > 0 && video.videoHeight > 0 && ts - lastMeterTs >= UPDATE_INTERVAL_MS) {
      meterFrame();
      lastMeterTs = ts;
    }
    animationFrameId = requestAnimationFrame(tick);
  };

  animationFrameId = requestAnimationFrame(tick);
}

function meterFrame() {
  const w = video.videoWidth;
  const h = video.videoHeight;

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, w, h);

  const data = ctx.getImageData(0, 0, w, h).data;
  const rawGrid = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(1e-4));
  const cellW = w / GRID_COLS;
  const cellH = h / GRID_ROWS;
  const zonePatchRadius = Math.max(2, Math.floor(Math.min(cellW, cellH) * ZONE_PATCH_RATIO));

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const centerX = Math.round(((col + 0.5) * w) / GRID_COLS);
      const centerY = Math.round(((row + 0.5) * h) / GRID_ROWS);
      rawGrid[row][col] = sampleLumaPatch(data, w, h, centerX, centerY, zonePatchRadius, ZONE_PATCH_STEP_PX);
    }
  }

  smoothedGrid = smoothGrid(smoothedGrid, rawGrid, GRID_SMOOTHING);
  updateAverageMarkerFromGrid(smoothedGrid);
  const refPixelX = clamp(Math.round(referencePoint.x * (w - 1)), 0, w - 1);
  const refPixelY = clamp(Math.round(referencePoint.y * (h - 1)), 0, h - 1);
  const rawRefLuma = sampleLumaPatch(data, w, h, refPixelX, refPixelY, REF_PATCH_RADIUS_PX, REF_PATCH_STEP_PX);
  smoothedRefLuma = smoothedRefLuma === null ? rawRefLuma : blend(smoothedRefLuma, rawRefLuma, GRID_SMOOTHING);

  const refLuma = Math.max(smoothedRefLuma, 1e-4);
  const zoneStops = smoothedGrid.map((row) => row.map((v) => Math.log2(v / refLuma) * STOP_EXPANSION_FACTOR));

  updateZoneOverlay(zoneStops);

  const rawEV = Math.log2(refLuma * 100) + EV_CALIBRATION_OFFSET;
  smoothedEV = blend(smoothedEV, rawEV, EV_SMOOTHING);

  if (needsMeterLock) {
    lockedEV = smoothedEV;
    needsMeterLock = false;
    evReadout.textContent = lockedEV.toFixed(1);
    syncRulersFromActiveAxis(true);
  }
}

function buildRulers() {
  apertureRuler.innerHTML = APERTURE_RULER_VALUES.map((aperture) => {
    return `<div class="ruler-col"><div class="ruler-top">f/${aperture.toFixed(1)}</div><div class="ruler-tick"></div><div class="ruler-bottom">&nbsp;</div></div>`;
  }).join("");

  shutterRuler.innerHTML = RULER_SHUTTERS.map((shutter) => {
    return `<div class="ruler-col"><div class="ruler-top">&nbsp;</div><div class="ruler-tick"></div><div class="ruler-bottom">${formatShutter(shutter)}</div></div>`;
  }).join("");
}

function syncRulersFromActiveAxis(smoothScroll) {
  if (activeExposureAxis === "shutter") {
    updateApertureRulerFromShutter(lockedEV, smoothScroll);
  } else {
    updateShutterRulerFromAperture(lockedEV, smoothScroll);
  }
}

function updateShutterRulerFromAperture(ev100, smoothScroll) {
  const selectedAperture = APERTURE_RULER_VALUES[selectedApertureIndex];
  const requiredShutter = shutterSeconds(ev100, selectedISO, selectedAperture);
  selectedShutterIndex = findClosestExposureIndex(RULER_SHUTTERS, requiredShutter);

  centerRulerAtIndex(shutterRuler, selectedShutterIndex, smoothScroll);
  highlightSelectedRulerIndex(shutterRuler, selectedShutterIndex);
}

function updateApertureRulerFromShutter(ev100, smoothScroll) {
  const selectedShutter = RULER_SHUTTERS[selectedShutterIndex];
  const requiredAperture = apertureFor(ev100, selectedISO, selectedShutter);
  selectedApertureIndex = findClosestExposureIndex(APERTURE_RULER_VALUES, requiredAperture);

  centerRulerAtIndex(apertureRuler, selectedApertureIndex, smoothScroll);
  highlightSelectedRulerIndex(apertureRuler, selectedApertureIndex);
}

function onApertureRulerScroll() {
  if (isApertureAutoScrolling) return;

  const index = getCenteredRulerIndex(apertureRuler, APERTURE_RULER_VALUES.length);
  if (index !== selectedApertureIndex) {
    selectedApertureIndex = index;
    activeExposureAxis = "aperture";
    highlightSelectedRulerIndex(apertureRuler, selectedApertureIndex);
    updateShutterRulerFromAperture(lockedEV, true);
  }
}

function onShutterRulerScroll() {
  if (isShutterAutoScrolling) return;

  const index = getCenteredRulerIndex(shutterRuler, RULER_SHUTTERS.length);
  if (index !== selectedShutterIndex) {
    selectedShutterIndex = index;
    activeExposureAxis = "shutter";
    highlightSelectedRulerIndex(shutterRuler, selectedShutterIndex);
    updateApertureRulerFromShutter(lockedEV, true);
  }
}

function onResize() {
  setRulerSidePadding(apertureRuler);
  setRulerSidePadding(shutterRuler);
  centerRulerAtIndex(apertureRuler, selectedApertureIndex, false);
  centerRulerAtIndex(shutterRuler, selectedShutterIndex, false);
  syncRulersFromActiveAxis(false);
}

function setRulerSidePadding(rulerEl) {
  const side = Math.max(0, Math.floor(rulerEl.clientWidth / 2 - RULER_COL_WIDTH / 2));
  rulerEl.style.paddingLeft = `${side}px`;
  rulerEl.style.paddingRight = `${side}px`;
}

function centerRulerAtIndex(rulerEl, index, smoothScroll) {
  const target = index * (RULER_COL_WIDTH + RULER_GAP);

  if (rulerEl === apertureRuler) {
    isApertureAutoScrolling = true;
    rulerEl.scrollTo({ left: target, behavior: smoothScroll ? "smooth" : "auto" });
    window.setTimeout(() => {
      isApertureAutoScrolling = false;
    }, smoothScroll ? 220 : 0);
    return;
  }

  if (rulerEl === shutterRuler) {
    isShutterAutoScrolling = true;
    rulerEl.scrollTo({ left: target, behavior: smoothScroll ? "smooth" : "auto" });
    window.setTimeout(() => {
      isShutterAutoScrolling = false;
    }, smoothScroll ? 220 : 0);
    return;
  }

  rulerEl.scrollTo({ left: target, behavior: smoothScroll ? "smooth" : "auto" });
}

function getCenteredRulerIndex(rulerEl, totalCount) {
  const step = RULER_COL_WIDTH + RULER_GAP;
  const idx = Math.round(rulerEl.scrollLeft / step);
  return clamp(idx, 0, totalCount - 1);
}

function highlightSelectedRulerIndex(rulerEl, selectedIndex) {
  const cols = rulerEl.querySelectorAll(".ruler-col");
  cols.forEach((col, idx) => {
    col.classList.toggle("is-selected", idx === selectedIndex);
  });
}

function findClosestExposureIndex(values, target) {
  let bestIdx = 0;
  let bestDelta = Number.POSITIVE_INFINITY;

  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value <= 0 || target <= 0) continue;

    const deltaStops = Math.abs(Math.log2(value / target));
    if (deltaStops < bestDelta) {
      bestDelta = deltaStops;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function updateZoneOverlay(zoneStops) {
  const readableBoost = clamp((NIGHT_EV_THRESHOLD - smoothedEV) / NIGHT_EV_THRESHOLD, 0, 1);

  zoneOverlay.querySelectorAll(".zone-cell").forEach((node) => {
    const row = Number(node.dataset.row);
    const col = Number(node.dataset.col);
    const value = zoneStops[row][col];
    const absValue = Math.abs(value);

    node.textContent = `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;

    const fontSize = clamp(8.8 + absValue * 1.2 + readableBoost * 2.8, 9, 14);
    const padX = 3.0 + readableBoost * 1.8;
    const padY = 1.0 + readableBoost * 0.9;
    node.style.fontSize = `${fontSize}px`;
    node.style.padding = `${padY.toFixed(1)}px ${padX.toFixed(1)}px`;

    node.classList.remove("zone-positive-low", "zone-positive-high", "zone-negative-low", "zone-negative-high", "zone-neutral", "zone-low-light");
    if (absValue <= NEAR_ZERO_THRESHOLD) node.classList.add("zone-neutral");
    else if (value > 0 && absValue < 1.5) node.classList.add("zone-positive-low");
    else if (value > 0) node.classList.add("zone-positive-high");
    else if (absValue < 1.5) node.classList.add("zone-negative-low");
    else node.classList.add("zone-negative-high");

    if (readableBoost >= 0.35) {
      node.classList.add("zone-low-light");
    }
  });

  zoneOverlay.querySelectorAll(".zone-hotspot").forEach((box) => {
    const row = Number(box.dataset.row);
    const col = Number(box.dataset.col);
    const value = zoneStops[row][col];
    const absValue = Math.abs(value);

    box.classList.remove(
      "zone-hotspot-warn",
      "zone-hotspot-critical",
      "zone-hotspot-warn-positive",
      "zone-hotspot-critical-positive"
    );

    if (absValue >= EXTREME_CRITICAL_STOPS) {
      box.classList.add(value >= 0 ? "zone-hotspot-critical-positive" : "zone-hotspot-critical");
    } else if (absValue >= EXTREME_WARN_STOPS) {
      box.classList.add(value >= 0 ? "zone-hotspot-warn-positive" : "zone-hotspot-warn");
    }
  });

  paintReferenceCell();
}

function createZoneCells() {
  zoneOverlay.innerHTML = "";
  zoneOverlay.style.setProperty("--grid-rows", String(GRID_ROWS));
  zoneOverlay.style.setProperty("--grid-cols", String(GRID_COLS));

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const center = cellCenter(row, col);
      const labelCenter = displayCellLabelCenter(row, col);

      const hotspot = document.createElement("div");
      hotspot.className = "zone-hotspot";
      hotspot.dataset.row = String(row);
      hotspot.dataset.col = String(col);
      hotspot.style.left = `${center.x * 100}%`;
      hotspot.style.top = `${center.y * 100}%`;
      hotspot.style.width = `${100 / GRID_COLS}%`;
      hotspot.style.height = `${100 / GRID_ROWS}%`;
      zoneOverlay.appendChild(hotspot);

      const cell = document.createElement("div");
      cell.className = "zone-cell";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.style.left = `${labelCenter.x * 100}%`;
      cell.style.top = `${labelCenter.y * 100}%`;
      cell.textContent = "+0.0";
      zoneOverlay.appendChild(cell);
    }
  }
}

function displayCellLabelCenter(row, col) {
  const offset = col % 2 === 0 ? -LABEL_STAGGER_CELL_FRACTION : LABEL_STAGGER_CELL_FRACTION;
  const y = clamp((row + 0.5 + offset) / GRID_ROWS, 0.02, 0.98);
  return {
    x: (col + 0.5) / GRID_COLS,
    y
  };
}

function sampleLumaPatch(imageData, w, h, cx, cy, radius, step) {
  const x0 = Math.max(0, cx - radius);
  const x1 = Math.min(w - 1, cx + radius);
  const y0 = Math.max(0, cy - radius);
  const y1 = Math.min(h - 1, cy + radius);

  let sum = 0;
  let count = 0;

  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const idx = (y * w + x) * 4;
      const r = srgbToLinear(imageData[idx] / 255);
      const g = srgbToLinear(imageData[idx + 1] / 255);
      const b = srgbToLinear(imageData[idx + 2] / 255);
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      count += 1;
    }
  }

  return Math.max(sum / Math.max(count, 1), 1e-4);
}

function srgbToLinear(v) {
  if (v <= 0.04045) return v / 12.92;
  return Math.pow((v + 0.055) / 1.055, 2.4);
}

function paintReferenceCell() {
  zoneOverlay.querySelectorAll(".zone-cell").forEach((node) => {
    const row = Number(node.dataset.row);
    const col = Number(node.dataset.col);
    node.classList.toggle("reference-zone", row === referenceCell.row && col === referenceCell.col);
  });
}

function shutterSeconds(ev100, iso, aperture) {
  return Math.max((aperture * aperture * 100) / (Math.pow(2, ev100) * iso), 1 / 8000);
}

function apertureFor(ev100, iso, shutter) {
  return Math.sqrt(Math.max((shutter * Math.pow(2, ev100) * iso) / 100, 0.1));
}

function formatShutter(seconds) {
  if (seconds >= 1) return `${seconds.toFixed(1)}s`;
  if (seconds >= 0.3) return `${seconds.toFixed(1)}s`;
  return `1/${Math.round(1 / seconds)}`;
}

function smoothGrid(prevGrid, nextGrid, alpha) {
  if (!prevGrid) return nextGrid;
  return nextGrid.map((row, r) => row.map((v, c) => blend(prevGrid[r][c], v, alpha)));
}

function blend(prev, next, alpha) {
  return prev + (next - prev) * alpha;
}

function cellCenter(row, col) {
  return { x: (col + 0.5) / GRID_COLS, y: (row + 0.5) / GRID_ROWS };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
