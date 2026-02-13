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
const REF_PATCH_RADIUS_PX = 14;
const REF_PATCH_STEP_PX = 2;

const video = document.getElementById("video");
const canvas = document.getElementById("meterCanvas");
const zoneOverlay = document.getElementById("zoneOverlay");
const tapMarker = document.getElementById("tapMarker");
const startBtn = document.getElementById("startBtn");
const evReadout = document.getElementById("evReadout");
const isoSelect = document.getElementById("isoSelect");
const apertureBar = document.getElementById("apertureBar");
const shutterBar = document.getElementById("shutterBar");
const cameraWrap = document.getElementById("cameraWrap");

let selectedISO = 400;
let referenceCell = { row: Math.floor(GRID_ROWS / 2), col: Math.floor(GRID_COLS / 2) };
let referencePoint = cellCenter(referenceCell.row, referenceCell.col);

let animationFrameId = null;
let lastMeterTs = 0;
let smoothedGrid = null;
let smoothedEV = 10;
let smoothedRefLuma = null;

init();

function init() {
  ISO_VALUES.forEach((iso) => {
    const option = document.createElement("option");
    option.value = String(iso);
    option.textContent = String(iso);
    if (iso === selectedISO) option.selected = true;
    isoSelect.appendChild(option);
  });

  renderTapMarker();
  createZoneCells();
  paintReferenceCell();
  renderBars(smoothedEV);

  startBtn.addEventListener("click", startCamera);
  cameraWrap.addEventListener("click", onCameraTap);
  isoSelect.addEventListener("change", () => {
    selectedISO = Number(isoSelect.value);
    renderBars(smoothedEV);
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
  } catch {
    startBtn.disabled = false;
    startBtn.textContent = "Camera permission needed";
  }
}

async function applyApprox28mmZoom(stream) {
  const [track] = stream.getVideoTracks();
  if (!track) return;

  const caps = track.getCapabilities ? track.getCapabilities() : null;
  if (!caps || typeof caps.zoom !== "object") return;

  const zoom = clamp(1.15, caps.zoom.min ?? 1, caps.zoom.max ?? 1.15);
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
}

function renderTapMarker() {
  tapMarker.style.left = `${referencePoint.x * 100}%`;
  tapMarker.style.top = `${referencePoint.y * 100}%`;
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

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const x0 = Math.floor((col * w) / GRID_COLS);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * w) / GRID_COLS));
      const y0 = Math.floor((row * h) / GRID_ROWS);
      const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * h) / GRID_ROWS));

      const stepX = Math.max(1, Math.floor((x1 - x0) / 8));
      const stepY = Math.max(1, Math.floor((y1 - y0) / 8));

      let sum = 0;
      let count = 0;

      for (let y = y0; y < y1; y += stepY) {
        for (let x = x0; x < x1; x += stepX) {
          const idx = (y * w + x) * 4;
          const r = data[idx] / 255;
          const g = data[idx + 1] / 255;
          const b = data[idx + 2] / 255;
          sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
          count += 1;
        }
      }

      rawGrid[row][col] = Math.max(sum / Math.max(count, 1), 1e-4);
    }
  }

  smoothedGrid = smoothGrid(smoothedGrid, rawGrid, GRID_SMOOTHING);
  const refPixelX = clamp(Math.round(referencePoint.x * (w - 1)), 0, w - 1);
  const refPixelY = clamp(Math.round(referencePoint.y * (h - 1)), 0, h - 1);
  const rawRefLuma = sampleLumaPatch(data, w, h, refPixelX, refPixelY, REF_PATCH_RADIUS_PX, REF_PATCH_STEP_PX);
  smoothedRefLuma = smoothedRefLuma === null ? rawRefLuma : blend(smoothedRefLuma, rawRefLuma, GRID_SMOOTHING);

  const refLuma = Math.max(smoothedRefLuma, 1e-4);
  const zoneStops = smoothedGrid.map((row) => row.map((v) => Math.log2(v / refLuma)));

  updateZoneOverlay(zoneStops);

  const rawEV = Math.log2(refLuma * 100) + EV_CALIBRATION_OFFSET;
  smoothedEV = blend(smoothedEV, rawEV, EV_SMOOTHING);

  evReadout.textContent = smoothedEV.toFixed(1);
  renderBars(smoothedEV);
}

function renderBars(ev100) {
  apertureBar.innerHTML = APERTURES.map((ap) => {
    const shutter = shutterSeconds(ev100, selectedISO, ap);
    return `<span class="chip">f/${ap.toFixed(1)} -> ${formatShutter(shutter)}</span>`;
  }).join("");

  shutterBar.innerHTML = SHUTTERS.map((sh) => {
    const ap = apertureFor(ev100, selectedISO, sh);
    return `<span class="chip">${formatShutter(sh)} -> f/${ap.toFixed(1)}</span>`;
  }).join("");
}

function updateZoneOverlay(zoneStops) {
  zoneOverlay.querySelectorAll(".zone-cell").forEach((node) => {
    const row = Number(node.dataset.row);
    const col = Number(node.dataset.col);
    const value = zoneStops[row][col];

    node.textContent = `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;

    node.classList.remove("zone-positive", "zone-negative", "zone-neutral");
    if (Math.abs(value) <= NEAR_ZERO_THRESHOLD) node.classList.add("zone-neutral");
    else if (value > 0) node.classList.add("zone-positive");
    else node.classList.add("zone-negative");
  });

  paintReferenceCell();
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
      const r = imageData[idx] / 255;
      const g = imageData[idx + 1] / 255;
      const b = imageData[idx + 2] / 255;
      sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      count += 1;
    }
  }

  return Math.max(sum / Math.max(count, 1), 1e-4);
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
