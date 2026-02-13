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
let referencePoint = { x: 0.5, y: 0.5 };
let animationFrameId = null;

init();

function init() {
  buildISOSelect();
  renderTapMarker();
  renderTables(10);
  createZoneCells();

  startBtn.addEventListener("click", startCamera);
  cameraWrap.addEventListener("click", onCameraTap);
  isoSelect.addEventListener("change", () => {
    selectedISO = Number(isoSelect.value);
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
    // Not critical; keep default framing.
  }
}

function onCameraTap(event) {
  if (!video.srcObject) return;

  const rect = cameraWrap.getBoundingClientRect();
  const x = clamp((event.clientX - rect.left) / rect.width, 0, 1);
  const y = clamp((event.clientY - rect.top) / rect.height, 0, 1);

  referencePoint = { x, y };
  renderTapMarker();
}

function renderTapMarker() {
  tapMarker.style.left = `${referencePoint.x * 100}%`;
  tapMarker.style.top = `${referencePoint.y * 100}%`;
}

function loopMetering() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }

  const tick = () => {
    if (video.videoWidth > 0 && video.videoHeight > 0) {
      meterFrame();
    }
    animationFrameId = requestAnimationFrame(tick);
  };

  tick();
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
  const gridLuma = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill(1e-4));

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
          const r = imageData[idx] / 255;
          const g = imageData[idx + 1] / 255;
          const b = imageData[idx + 2] / 255;
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          sum += luma;
          count += 1;
        }
      }

      gridLuma[row][col] = Math.max(sum / Math.max(count, 1), 1e-4);
    }
  }

  const refCol = clamp(Math.floor(referencePoint.x * GRID_COLS), 0, GRID_COLS - 1);
  const refRow = clamp(Math.floor(referencePoint.y * GRID_ROWS), 0, GRID_ROWS - 1);
  const refLuma = Math.max(gridLuma[refRow][refCol], 1e-4);

  const zoneStops = gridLuma.map((row) => row.map((v) => Math.log2(v / refLuma)));
  updateZoneOverlay(zoneStops);

  const ev100 = estimateEV100(refLuma);
  evReadout.textContent = ev100.toFixed(1);
  renderTables(ev100);
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
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
