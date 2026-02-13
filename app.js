const ISO_VALUES = [25, 50, 100, 125, 160, 200, 250, 320, 400, 500, 640, 800, 1000, 1250, 1600, 3200];
const APERTURES = [1.4, 2.0, 2.8, 4.0, 5.6, 8.0, 11.0, 16.0];
const SHUTTERS = [
  1 / 2000,
  1 / 1000,
  1 / 500,
  1 / 250,
  1 / 125,
  1 / 60,
  1 / 30,
  1 / 15,
  1 / 8,
  1 / 4,
  1 / 2,
  1
];

const GRID_ROWS = 5;
const GRID_COLS = 7;
const EV_CALIBRATION_OFFSET = 4.5;

const UPDATE_INTERVAL_MS = 220;
const GRID_SMOOTHING = 0.34;
const EV_SMOOTHING = 0.25;
const NEAR_ZERO_THRESHOLD = 0.2;
const ZONE_PATCH_RATIO = 0.09;
const ZONE_PATCH_STEP_PX = 1;

const video = document.getElementById("video");
const canvas = document.getElementById("meterCanvas");
const zoneOverlay = document.getElementById("zoneOverlay");
const tapMarker = document.getElementById("tapMarker");
const startBtn = document.getElementById("startBtn");
const evReadout = document.getElementById("evReadout");
const isoSelect = document.getElementById("isoSelect");
const shutterTable = document.getElementById("shutterTable");
const apertureTable = document.getElementById("apertureTable");
const cameraWrap = document.getElementById("cameraWrap");

let selectedISO = 400;
let referenceCell = { row: Math.floor(GRID_ROWS / 2), col: Math.floor(GRID_COLS / 2) };
let referencePoint = cellCenter(referenceCell.row, referenceCell.col);

let animationFrameId = null;
let lastMeterTs = 0;
let smoothedGrid = null;
let smoothedEV = 10;

init();

function init() {
  buildISOSelect();
  renderTapMarker();
  renderTables(smoothedEV);
  createZoneCells();
  paintReferenceCell();

  startBtn.addEventListener("click", startCamera);
  cameraWrap.addEventListener("click", onCameraTap);
  isoSelect.addEventListener("change", () => {
    selectedISO = Number(isoSelect.value);
    renderTables(smoothedEV);
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
    applyApprox28mmZoom(stream);

    startBtn.style.display = "none";
    loopMetering();
  } catch (error) {
    console.error(error);
    startBtn.disabled = false;
    startBtn.textContent = "Camera permission needed";
  }
}

async function applyApprox28mmZoom(stream) {
  const [track] = stream.getVideoTracks();
  if (!track) return;

  const caps = track.getCapabilities ? track.getCapabilities() : null;
  if (!caps || typeof caps.zoom !== "object") return;

  const targetZoom = 1.15;
  const zoom = clamp(targetZoom, caps.zoom.min ?? 1, caps.zoom.max ?? targetZoom);

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
  const zonePatchRadius = Math.max(3, Math.floor(Math.min(cellW, cellH) * ZONE_PATCH_RATIO));

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
}

function estimateEV100(normalizedLuma) {
  return Math.log2(normalizedLuma * 100) + EV_CALIBRATION_OFFSET;
}

function renderTables(ev100) {
  shutterTable.innerHTML = APERTURES.map((ap) => {
    const shutter = shutterSeconds(ev100, selectedISO, ap);
    return `<tr><td>f/${ap.toFixed(1)}</td><td>${formatShutter(shutter)}</td></tr>`;
  }).join("");

  apertureTable.innerHTML = SHUTTERS.map((sh) => {
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
  return `1/${Math.round(1 / seconds)}`;
}

function createZoneCells() {
  zoneOverlay.innerHTML = "";

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
