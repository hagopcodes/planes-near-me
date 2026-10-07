import { declination } from '/wmm.js';

const SETTINGS_KEY = 'planeradar.settings.v1';
const routeCache = new Map();
const photoCache = new Map();

const ADSB_BASES = [
  'https://api.adsb.lol/v2',
  'https://api.adsb.one/v2',
  'https://api.avioadsb.com/v2',
];

const state = {
  settings: loadSettings(),
  position: null,
  headingMagnetic: null,
  headingTrue: 0,
  declination: 0,
  declinationReady: false,
  phoneMode: false,
  running: false,
  aircraft: [],
  zoomLevels: [10, 25, 50, 100, 150, 250],
  zoomIndex: 2,
  queryRadiusNm: 75,
  activeAircraft: null,
};

const ui = {
  startPanel: document.getElementById('startPanel'),
  radarPage: document.getElementById('radarPage'),
  detailPage: document.getElementById('detailPage'),
  settingsPage: document.getElementById('settingsPage'),
  startBtn: document.getElementById('startBtn'),
  statusText: document.getElementById('statusText'),
  zoomText: document.getElementById('zoomText'),
  zoomInBtn: document.getElementById('zoomInBtn'),
  zoomOutBtn: document.getElementById('zoomOutBtn'),
  recalibrateBtn: document.getElementById('recalibrateBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsBackBtn: document.getElementById('settingsBackBtn'),
  distanceScaleSelect: document.getElementById('distanceScaleSelect'),
  detailBackBtn: document.getElementById('detailBackBtn'),
  detailCallsign: document.getElementById('detailCallsign'),
  detailAirline: document.getElementById('detailAirline'),
  detailOrigin: document.getElementById('detailOrigin'),
  detailDestination: document.getElementById('detailDestination'),
  detailAltitude: document.getElementById('detailAltitude'),
  detailSpeed: document.getElementById('detailSpeed'),
  detailHex: document.getElementById('detailHex'),
  planePhoto: document.getElementById('planePhoto'),
  photoCredit: document.getElementById('photoCredit'),
  radarWrap: document.getElementById('radarWrap'),
  canvas: document.getElementById('radarCanvas'),
};

const ctx = ui.canvas.getContext('2d');
let deviceHeadingOffset = 0;

init();

function init() {
  ui.distanceScaleSelect.value = state.settings.distanceScaleMode;
  ui.startBtn.addEventListener('click', startApp);
  ui.zoomInBtn.addEventListener('click', () => changeZoom(-1));
  ui.zoomOutBtn.addEventListener('click', () => changeZoom(1));
  ui.settingsBtn.addEventListener('click', () => showPage('settings'));
  ui.settingsBackBtn.addEventListener('click', () => showPage('radar'));
  ui.detailBackBtn.addEventListener('click', () => showPage('radar'));
  ui.recalibrateBtn.addEventListener('click', () => {
    if (state.headingMagnetic != null) {
      deviceHeadingOffset = state.headingMagnetic;
      setStatus('Recalibrated heading baseline');
    }
  });
  ui.distanceScaleSelect.addEventListener('change', () => {
    state.settings.distanceScaleMode = ui.distanceScaleSelect.value;
    saveSettings(state.settings);
    drawRadar();
  });
  ui.canvas.addEventListener('click', onCanvasTap);
  window.addEventListener('resize', () => {
    resizeCanvas();
    updateRangeAndRadius();
    drawRadar();
  });

  resizeCanvas();
  updateRangeAndRadius();
  drawRadar();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

async function startApp() {
  state.running = true;
  ui.startPanel.classList.add('hidden');
  ui.radarPage.classList.remove('hidden');
  showPage('radar');

  startGeolocation();
  await enableCompass();
  pollLoop();
}

function startGeolocation() {
  if (!navigator.geolocation) {
    setStatus('Geolocation unavailable');
    return;
  }

  navigator.geolocation.watchPosition(
    (pos) => {
      state.position = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
      };
      if (!state.declinationReady) {
        state.declination = declination(state.position.lat, state.position.lon);
        state.declinationReady = true;
      }
      updateRangeAndRadius();
      drawRadar();
    },
    () => setStatus('Geolocation denied - enable location'),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
  );
}

async function enableCompass() {
  const isIOSPermissionAPI =
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function';

  if (isIOSPermissionAPI) {
    try {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== 'granted') {
        setStatus('Compass denied - north-up mode');
        return;
      }
    } catch {
      setStatus('Compass blocked - north-up mode');
      return;
    }
  }

  window.addEventListener(
    'deviceorientation',
    (event) => {
      const heading =
        typeof event.webkitCompassHeading === 'number'
          ? event.webkitCompassHeading
          : event.alpha != null
          ? 360 - event.alpha
          : null;

      if (heading == null || Number.isNaN(heading)) return;
      state.phoneMode = true;
      state.headingMagnetic = normalizeHeading(heading - deviceHeadingOffset);
      state.headingTrue = normalizeHeading(state.headingMagnetic + state.declination);
      drawRadar();
    },
    true
  );
}

async function pollLoop() {
  while (state.running) {
    if (!state.position) {
      await wait(1000);
      continue;
    }

    const started = performance.now();
    await fetchAircraft();
    drawRadar();

    const elapsed = performance.now() - started;
    await wait(Math.max(0, 1000 - elapsed));
  }
}

async function fetchAircraft() {
  const { lat, lon } = state.position;
  const dist = Math.max(1, Math.min(250, Math.round(state.queryRadiusNm)));

  for (const base of ADSB_BASES) {
    const url = `${base}/lat/${lat.toFixed(5)}/lon/${lon.toFixed(5)}/dist/${dist}`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = await res.json();
      const all = Array.isArray(data?.ac) ? data.ac : [];
      state.aircraft = all.filter((ac) => {
        if (ac?.alt_baro === 'ground') return false;
        const altitude = Number(ac?.alt_baro);
        return Number.isFinite(altitude);
      });
      setStatus(`Tracking ${state.aircraft.length} airborne aircraft via ${new URL(base).host}`);
      return;
    } catch {
      // fallback to next provider
    }
  }

  setStatus('Live feed unavailable right now');
  state.aircraft = [];
}

function drawRadar() {
  const dpr = window.devicePixelRatio || 1;
  const size = ui.canvas.width / dpr;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2;

  ctx.clearRect(0, 0, ui.canvas.width, ui.canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);

  // dial rotation for phone mode only
  ctx.save();
  ctx.translate(cx, cy);
  const heading = state.phoneMode ? state.headingTrue : 0;
  ctx.rotate((-heading * Math.PI) / 180);
  ctx.translate(-cx, -cy);

  ctx.strokeStyle = 'rgba(116,255,125,0.35)';
  ctx.lineWidth = 1;

  for (let i = 1; i <= 4; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (radius * i) / 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  // cardinal lines
  drawLine(cx - radius, cy, cx + radius, cy);
  drawLine(cx, cy - radius, cx, cy + radius);

  // cardinal labels
  ctx.fillStyle = '#74ff7d';
  ctx.font = '14px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillText('N', cx - 5, 16);
  ctx.fillText('S', cx - 5, size - 8);
  ctx.fillText('W', 8, cy + 5);
  ctx.fillText('E', size - 14, cy + 5);

  const edgeRangeNm = state.zoomLevels[state.zoomIndex];

  for (const ac of state.aircraft) {
    if (!state.position || ac.lat == null || ac.lon == null) continue;

    const distanceNm = haversineNm(state.position.lat, state.position.lon, ac.lat, ac.lon);
    if (!Number.isFinite(distanceNm) || distanceNm > edgeRangeNm) continue;

    const bearing = bearingDeg(state.position.lat, state.position.lon, ac.lat, ac.lon);
    const radialRatio = radialRatioFor(distanceNm, edgeRangeNm, state.settings.distanceScaleMode);
    const pixelR = radialRatio * radius;

    const theta = (bearing * Math.PI) / 180;
    const x = cx + pixelR * Math.sin(theta);
    const y = cy - pixelR * Math.cos(theta);

    const nearOverhead = distanceNm < 1;

    if (Number.isFinite(ac.track)) {
      drawTrackCone(x, y, normalizeHeading(ac.track - heading));
    }

    ctx.fillStyle = nearOverhead ? '#c8ffd0' : '#74ff7d';
    ctx.beginPath();
    ctx.arc(x, y, nearOverhead ? 4 : 3, 0, Math.PI * 2);
    ctx.fill();

    const callsign = getCallsign(ac);
    ctx.fillStyle = '#74ff7d';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillText(callsign, x + 6, y - 6);

    ac._screenX = x;
    ac._screenY = y;
  }

  ctx.restore();
  ctx.restore();

  function drawLine(x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}

function drawTrackCone(x, y, relativeTrack) {
  const len = 16;
  const spread = 0.35;
  const a = (relativeTrack * Math.PI) / 180;
  const x1 = x + len * Math.sin(a - spread);
  const y1 = y - len * Math.cos(a - spread);
  const x2 = x + len * Math.sin(a + spread);
  const y2 = y - len * Math.cos(a + spread);

  ctx.fillStyle = 'rgba(116,255,125,0.22)';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.fill();
}

function onCanvasTap(event) {
  if (ui.detailPage.classList.contains('hidden') === false) return;

  const rect = ui.canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * ui.canvas.clientWidth;
  const y = ((event.clientY - rect.top) / rect.height) * ui.canvas.clientHeight;

  let hit = null;
  let minDist = 18;

  for (const ac of state.aircraft) {
    if (ac._screenX == null) continue;
    const dx = x - ac._screenX;
    const dy = y - ac._screenY;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < minDist) {
      minDist = d;
      hit = ac;
    }
  }

  if (hit) openDetail(hit);
}

async function openDetail(ac) {
  state.activeAircraft = ac;
  showPage('detail');

  const callsign = getCallsign(ac);
  ui.detailCallsign.textContent = callsign;
  ui.detailAltitude.textContent = Number.isFinite(Number(ac.alt_baro)) ? `${Number(ac.alt_baro).toLocaleString()} ft` : '—';
  ui.detailSpeed.textContent = Number.isFinite(Number(ac.gs)) ? `${Math.round(ac.gs)} kt` : '—';
  ui.detailHex.textContent = ac.hex || '—';
  ui.detailAirline.textContent = 'Loading...';
  ui.detailOrigin.textContent = 'Loading...';
  ui.detailDestination.textContent = 'Loading...';

  const route = await fetchRoute(callsign);
  ui.detailAirline.textContent = route.airline;
  ui.detailOrigin.textContent = route.origin;
  ui.detailDestination.textContent = route.destination;

  const photo = await fetchPhoto(ac.hex);
  if (photo?.url) {
    ui.planePhoto.src = photo.url;
    ui.planePhoto.classList.remove('hidden');
    ui.photoCredit.textContent = photo.credit ? `Photo: ${photo.credit}` : '';
  } else {
    ui.planePhoto.classList.add('hidden');
    ui.photoCredit.textContent = '';
  }
}

async function fetchRoute(callsign) {
  const key = callsign.trim().toUpperCase();
  if (!key || key === 'UNKNOWN') {
    return { airline: 'route unavailable', origin: 'route unavailable', destination: 'route unavailable' };
  }

  if (routeCache.has(key)) return routeCache.get(key);

  const fallback = { airline: 'route unavailable', origin: 'route unavailable', destination: 'route unavailable' };

  try {
    const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(key)}`);
    if (res.status === 404) {
      routeCache.set(key, fallback);
      return fallback;
    }
    if (!res.ok) return fallback;

    const data = await res.json();
    const response = {
      airline: data?.response?.airline?.name || 'route unavailable',
      origin: data?.response?.flightroute?.origin?.name || data?.response?.flightroute?.origin?.icao_code || 'route unavailable',
      destination:
        data?.response?.flightroute?.destination?.name || data?.response?.flightroute?.destination?.icao_code || 'route unavailable',
    };
    routeCache.set(key, response);
    return response;
  } catch {
    return fallback;
  }
}

async function fetchPhoto(hex) {
  const key = (hex || '').trim().toLowerCase();
  if (!key) return null;
  if (photoCache.has(key)) return photoCache.get(key);

  try {
    const res = await fetch(`https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const data = await res.json();
    const first = data?.photos?.[0];
    if (!first) return null;
    const image = {
      url: first.thumbnail_large?.src || first.thumbnail?.src || first.link || null,
      credit: first.photographer || '',
    };
    photoCache.set(key, image);
    return image;
  } catch {
    return null;
  }
}

function updateRangeAndRadius() {
  const edgeRangeNm = state.zoomLevels[state.zoomIndex];
  ui.zoomText.textContent = `Range: ${edgeRangeNm} NM`;

  const rect = ui.radarWrap.getBoundingClientRect();
  const radiusPx = Math.max(1, Math.min(rect.width, rect.height) / 2);
  const nmPerPx = edgeRangeNm / radiusPx;
  const query = Math.max(rect.width, rect.height) * nmPerPx * 1.5;
  state.queryRadiusNm = Math.max(1, Math.min(250, query));
}

function changeZoom(delta) {
  const next = Math.max(0, Math.min(state.zoomLevels.length - 1, state.zoomIndex + delta));
  if (next === state.zoomIndex) return;
  state.zoomIndex = next;
  updateRangeAndRadius();
  drawRadar();
}

function showPage(page) {
  ui.radarPage.classList.add('hidden');
  ui.detailPage.classList.add('hidden');
  ui.settingsPage.classList.add('hidden');

  if (page === 'radar') ui.radarPage.classList.remove('hidden');
  if (page === 'detail') ui.detailPage.classList.remove('hidden');
  if (page === 'settings') ui.settingsPage.classList.remove('hidden');
}

function resizeCanvas() {
  const rect = ui.radarWrap.getBoundingClientRect();
  const size = Math.max(260, Math.floor(Math.min(rect.width || 600, rect.height || rect.width || 600)));
  const dpr = window.devicePixelRatio || 1;

  ui.canvas.style.width = `${size}px`;
  ui.canvas.style.height = `${size}px`;
  ui.canvas.width = Math.floor(size * dpr);
  ui.canvas.height = Math.floor(size * dpr);
}

function getCallsign(ac) {
  return (ac?.flight || ac?.callsign || 'UNKNOWN').trim() || 'UNKNOWN';
}

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return {
      distanceScaleMode: parsed.distanceScaleMode === 'sqrt' ? 'sqrt' : 'linear',
    };
  } catch {
    return { distanceScaleMode: 'linear' };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function radialRatioFor(distanceNm, edgeRangeNm, mode) {
  const ratio = Math.min(1, Math.max(0, distanceNm / edgeRangeNm));
  return mode === 'sqrt' ? Math.sqrt(ratio) : ratio;
}

function setStatus(text) {
  ui.statusText.textContent = text;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeHeading(deg) {
  let h = deg % 360;
  if (h < 0) h += 360;
  return h;
}

function haversineNm(lat1, lon1, lat2, lon2) {
  const Rnm = 3440.065;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Rnm * c;
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const lambda1 = (lon1 * Math.PI) / 180;
  const lambda2 = (lon2 * Math.PI) / 180;
  const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
}
