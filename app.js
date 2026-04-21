const ISO_VALUES = [25, 50, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 3200];
const APP_VERSION = "1.5.0";

const TABLE_APERTURES = [1.4, 2.0, 2.8, 4.0, 5.6, 8.0, 11.0, 16.0];
const TABLE_SHUTTERS = [1 / 2000, 1 / 1000, 1 / 500, 1 / 250, 1 / 125, 1 / 60, 1 / 30, 1 / 15, 1 / 8, 1 / 4, 1 / 2, 1.0];

const APERTURE_STOPS = [
  1.0, 1.1, 1.2, 1.4, 1.6, 1.8,
  2.0, 2.2, 2.5, 2.8, 3.2, 3.5,
  4.0, 4.5, 5.0, 5.6, 6.3, 7.1,
  8.0, 9.0, 10.0, 11.0, 13.0, 14.0,
  16.0, 18.0, 20.0, 22.0
];
const SHUTTER_STOPS = [
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
const ZONE_PATCH_RATIO = 0.06;
const ZONE_PATCH_STEP_PX = 1;

const video = document.getElementById("video");
const canvas = document.getElementById("meterCanvas");
const zoneOverlay = document.getElementById("zoneOverlay");
const tapMarker = document.getElementById("tapMarker");
const startBtn = document.getElementById("startBtn");
const evReadout = document.getElementById("evReadout");
const appVersion = document.getElementById("appVersion");
const isoSelect = document.getElementById("isoSelect");
const shutterTable = document.getElementById("shutterTable");
const apertureTable = document.getElementById("apertureTable");
const cameraWrap = document.getElementById("cameraWrap");
const apertureSlider = document.getElementById("apertureSlider");
const shutterSlider = document.getElementById("shutterSlider");
const apertureValue = document.getElementById("apertureValue");
const shutterValue = document.getElementById("shutterValue");
const linkedMode = document.getElementById("linkedMode");

let selectedISO = 400;
let referenceCell = { row: Math.floor(GRID_ROWS / 2), col: Math.floor(GRID_COLS / 2) };
let referencePoint = cellCenter(referenceCell.row, referenceCell.col);

let animationFrameId = null;
let lastMeterTs = 0;
let smoothedGrid = null;
let smoothedEV = 10;
let selectedApertureIndex = findClosestIndex(APERTURE_STOPS, 5.6);
let selectedShutterIndex = findClosestIndex(SHUTTER_STOPS, 1 / 125);
let exposureAnchor = "aperture";

init();

function init() {
  if (appVersion) appVersion.textContent = `v${APP_VERSION}`;
  buildISOSelect();
  setupLinkedControls();
  renderTapMarker();
  renderTables(smoothedEV);
  createZoneCells();
  paintReferenceCell();
  syncLinkedExposure(smoothedEV);

  startBtn.addEventListener("click", startCamera);
  cameraWrap.addEventListener("click", onCameraTap);
  isoSelect.addEventListener("change", () => {
    selectedISO = Number(isoSelect.value);
    renderTables(smoothedEV);
    syncLinkedExposure(smoothedEV);
  });

  apertureSlider.addEventListener("input", () => {
    selectedApertureIndex = clamp(Math.round(Number(apertureSlider.value)), 0, APERTURE_STOPS.length - 1);
    exposureAnchor = "aperture";
    syncLinkedExposure(smoothedEV);
  });

  shutterSlider.addEventListener("input", () => {
    selectedShutterIndex = clamp(Math.round(Number(shutterSlider.value)), 0, SHUTTER_STOPS.length - 1);
    exposureAnchor = "shutter";
    syncLinkedExposure(smoothedEV);
  });
}

function buildISOSelect() {
  ISO_VALUES.forEach((iso) => {
    const option = document.createElement("option");
    option.value = String(iso);
    option.textContent = String(iso);
    if (iso === selectedISO) option.selected = true;
    isoSelect.appendChild(option);
  });
}

function setupLinkedControls() {
  apertureSlider.max = String(APERTURE_STOPS.length - 1);
  shutterSlider.max = String(SHUTTER_STOPS.length - 1);
  apertureSlider.value = String(selectedApertureIndex);
  shutterSlider.value = String(selectedShutterIndex);
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
  } catch (error) {
    console.error(error);
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
    // Keep default framing.
  }
}

function onCameraTap(event) {
  if (!video.srcObject) return;

  const rect = cameraWrap.getBoundingClientRect();
  const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);

  const col = clamp(Math.floor(x * GRID_COLS), 0, GRID_COLS - 1);
  const row = clamp(Math.floor(y * GRID_ROWS), 0, GRID_ROWS - 1);

  referenceCell = { row, col };
  referencePoint = cellCenter(row, col);

  renderTapMarker();
  paintReferenceCell();
}

function renderTapMarker() {
  tapMarker.style.left = `${referencePoint.x * 100}%`;
  tapMarker.style.top = `${referencePoint.y * 100}%`;
}

function loopMetering() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }

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

  const imageData = ctx.getImageData(0, 0, w, h).data;
  const rawGrid = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(1e-4));
  const cellW = w / GRID_COLS;
  const cellH = h / GRID_ROWS;
  const zonePatchRadius = Math.max(2, Math.floor(Math.min(cellW, cellH) * ZONE_PATCH_RATIO));

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const centerX = Math.round(((col + 0.5) * w) / GRID_COLS);
      const centerY = Math.round(((row + 0.5) * h) / GRID_ROWS);
      rawGrid[row][col] = sampleLumaPatch(imageData, w, h, centerX, centerY, zonePatchRadius, ZONE_PATCH_STEP_PX);
    }
  }

  smoothedGrid = smoothGrid(smoothedGrid, rawGrid, GRID_SMOOTHING);

  const refLuma = Math.max(smoothedGrid[referenceCell.row][referenceCell.col], 1e-4);
  const zoneStops = smoothedGrid.map((row) => row.map((v) => Math.log2(v / refLuma)));
  updateZoneOverlay(zoneStops);

  const rawEV = estimateEV100(refLuma);
  smoothedEV = blend(smoothedEV, rawEV, EV_SMOOTHING);

  evReadout.textContent = smoothedEV.toFixed(1);
  renderTables(smoothedEV);
  syncLinkedExposure(smoothedEV);
}

function syncLinkedExposure(ev100) {
  if (exposureAnchor === "shutter") {
    const chosenShutter = SHUTTER_STOPS[selectedShutterIndex];
    const matchingAperture = apertureFor(ev100, selectedISO, chosenShutter);
    selectedApertureIndex = findClosestIndex(APERTURE_STOPS, matchingAperture);
  } else {
    const chosenAperture = APERTURE_STOPS[selectedApertureIndex];
    const matchingShutter = shutterSeconds(ev100, selectedISO, chosenAperture);
    selectedShutterIndex = findClosestIndex(SHUTTER_STOPS, matchingShutter);
  }

  apertureSlider.value = String(selectedApertureIndex);
  shutterSlider.value = String(selectedShutterIndex);

  apertureValue.textContent = `f/${APERTURE_STOPS[selectedApertureIndex].toFixed(1)}`;
  shutterValue.textContent = formatShutter(SHUTTER_STOPS[selectedShutterIndex]);
  linkedMode.textContent = exposureAnchor === "shutter" ? "Shutter priority" : "Aperture priority";
}

function estimateEV100(normalizedLuma) {
  return Math.log2(normalizedLuma * 100) + EV_CALIBRATION_OFFSET;
}

function renderTables(ev100) {
  shutterTable.innerHTML = TABLE_APERTURES.map((ap) => {
    const shutter = shutterSeconds(ev100, selectedISO, ap);
    return `<tr><td>f/${ap.toFixed(1)}</td><td>${formatShutter(shutter)}</td></tr>`;
  }).join("");

  apertureTable.innerHTML = TABLE_SHUTTERS.map((sh) => {
    const ap = apertureFor(ev100, selectedISO, sh);
    return `<tr><td>${formatShutter(sh)}</td><td>f/${ap.toFixed(1)}</td></tr>`;
  }).join("");
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

function createZoneCells() {
  zoneOverlay.innerHTML = "";
  zoneOverlay.style.setProperty("--grid-rows", String(GRID_ROWS));
  zoneOverlay.style.setProperty("--grid-cols", String(GRID_COLS));

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const cell = document.createElement("div");
      cell.className = "zone-cell";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      cell.style.left = `${((col + 0.5) / GRID_COLS) * 100}%`;
      cell.style.top = `${((row + 0.5) / GRID_ROWS) * 100}%`;
      cell.textContent = "+0.0";
      zoneOverlay.appendChild(cell);
    }
  }
}

function updateZoneOverlay(zoneStops) {
  const nodes = zoneOverlay.querySelectorAll(".zone-cell");

  nodes.forEach((node) => {
    const row = Number(node.dataset.row);
    const col = Number(node.dataset.col);
    const value = zoneStops[row][col];

    const sign = value >= 0 ? "+" : "";
    node.textContent = `${sign}${value.toFixed(1)}`;

    node.classList.remove("zone-positive", "zone-negative", "zone-neutral");
    if (Math.abs(value) <= NEAR_ZERO_THRESHOLD) {
      node.classList.add("zone-neutral");
    } else if (value > 0) {
      node.classList.add("zone-positive");
    } else {
      node.classList.add("zone-negative");
    }
  });

  paintReferenceCell();
}

function paintReferenceCell() {
  const nodes = zoneOverlay.querySelectorAll(".zone-cell");
  nodes.forEach((node) => {
    const row = Number(node.dataset.row);
    const col = Number(node.dataset.col);
    const isRef = row === referenceCell.row && col === referenceCell.col;
    node.classList.toggle("reference-zone", isRef);
  });
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

function smoothGrid(prevGrid, nextGrid, alpha) {
  if (!prevGrid) return nextGrid;

  return nextGrid.map((row, r) => row.map((v, c) => blend(prevGrid[r][c], v, alpha)));
}

function blend(prev, next, alpha) {
  return prev + (next - prev) * alpha;
}

function cellCenter(row, col) {
  return {
    x: (col + 0.5) / GRID_COLS,
    y: (row + 0.5) / GRID_ROWS
  };
}

function findClosestIndex(values, target) {
  let bestIdx = 0;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let i = 0; i < values.length; i += 1) {
    const delta = Math.abs(values[i] - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
