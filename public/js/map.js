/* global map variable — initialised here, consumed by ui.js and main.js */
/* eslint-disable no-unused-vars */
'use strict';

let _map;
const _markers = new Map(); // callsign → { marker, data }
const _tracks  = new Map(); // callsign → { polyline, dots, period }

// ─── APRS Symbol sprite sheet config ──────────────────────────────────────────
// Sprite sheets from hessu/aprs-symbols (aprs.fi symbol set)
// 16 columns × 6 rows, symbol_code maps to ASCII offset from 0x21
const SPRITE_COLS = 16;
const SPRITE_SIZE = 48; // using @2x sheets (48px rendered at 24px for retina)
const DISPLAY_SIZE = 24;

function _spriteSheet(symbolTable) {
  return symbolTable === '\\'
    ? '/symbols/aprs-symbols-24-1@2x.png'
    : '/symbols/aprs-symbols-24-0@2x.png';
}

function _spriteOffset(symbolCode) {
  const idx = symbolCode.charCodeAt(0) - 0x21;
  const col = idx % SPRITE_COLS;
  const row = Math.floor(idx / SPRITE_COLS);
  return { x: col * SPRITE_SIZE, y: row * SPRITE_SIZE };
}

/**
 * Build a Leaflet DivIcon using the APRS symbol sprite sheet.
 */
function _getSymbolIcon(symbolTable, symbolCode, callsign) {
  const sheet  = _spriteSheet(symbolTable);
  const offset = _spriteOffset(symbolCode);

  return L.divIcon({
    className: '',
    html: `
      <div class="aprs-marker-wrapper" data-callsign="${callsign}">
        <div class="aprs-symbol-icon"
             style="background-image:url('${sheet}');
                    background-position:-${offset.x}px -${offset.y}px;">
        </div>
        <span class="aprs-marker-label">${callsign}</span>
      </div>`,
    iconSize:   [80, 40],
    iconAnchor: [40, 12],
  });
}

// ─── Map initialisation ──────────────────────────────────────────────────────
/**
 * Initialise the Leaflet map, ask for geolocation to centre it.
 * Falls back to a sensible default if geolocation is denied.
 */
function initMap() {
  const DEFAULT_LAT = 39.8283;
  const DEFAULT_LON = -98.5795; // Geographic centre of the US

  _map = L.map('map', {
    center: [DEFAULT_LAT, DEFAULT_LON],
    zoom: 5,
    zoomControl: true,
    attributionControl: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(_map);

  // Request geolocation
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        _map.setView([pos.coords.latitude, pos.coords.longitude], 10);
      },
      () => { /* denied — keep default view */ },
      { timeout: 5000 }
    );
  }
}

// ─── Station markers ─────────────────────────────────────────────────────────
/**
 * Create or update a station marker on the map.
 * @param {object} station — { callsign, lat, lon, symbol_table, symbol_code, comment, last_heard }
 */
function updateStationMarker(station) {
  const { callsign, lat, lon, symbol_table, symbol_code } = station;

  const table = symbol_table || '/';
  const code  = symbol_code  || '>';
  const icon  = _getSymbolIcon(table, code, callsign);

  if (_markers.has(callsign)) {
    const { marker } = _markers.get(callsign);
    marker.setLatLng([lat, lon]);
    marker.setIcon(icon);
  } else {
    const marker = L.marker([lat, lon], { icon, title: callsign })
      .addTo(_map)
      .on('click', () => showInfoPanel(station));
    _markers.set(callsign, { marker });
  }

  // Keep station data on the marker entry for UI panel
  _markers.get(callsign).data = station;
}

// ─── Track history (polylines) ───────────────────────────────────────────────
/**
 * Fetch position history and draw a polyline on the map.
 */
async function showTrack(callsign, periodSeconds) {
  // Remove existing track for this station
  clearTrack(callsign);

  try {
    const res = await fetch(`/api/history/${encodeURIComponent(callsign)}?period=${periodSeconds}`);
    const points = await res.json();

    if (!points || points.length === 0) return;

    const latlngs = points.map(p => [p.lat, p.lon]);

    // Draw the polyline
    const polyline = L.polyline(latlngs, {
      color: '#38bdf8',
      weight: 3,
      opacity: 0.85,
      dashArray: null,
      lineJoin: 'round',
    }).addTo(_map);

    // Add small circle markers at each waypoint
    const dots = points.map(p =>
      L.circleMarker([p.lat, p.lon], {
        radius: 3,
        fillColor: '#38bdf8',
        fillOpacity: 0.9,
        color: '#fff',
        weight: 1,
      }).addTo(_map)
    );

    // Add directional arrows using a decorator-like approach
    // (simple approach: add arrow markers at intervals)
    _addTrackArrows(latlngs, polyline);

    _tracks.set(callsign, { polyline, dots, period: periodSeconds });

    // Fit map to show the entire track
    if (latlngs.length > 1) {
      _map.fitBounds(polyline.getBounds().pad(0.15));
    }
  } catch (err) {
    console.error(`[MAP] Failed to load track for ${callsign}:`, err);
  }
}

/**
 * Add simple directional arrow markers along a polyline.
 */
function _addTrackArrows(latlngs, polyline) {
  if (latlngs.length < 2) return;

  const arrows = [];
  // Place arrows every ~5 segments (or at least 3 total)
  const step = Math.max(1, Math.floor(latlngs.length / 8));

  for (let i = step; i < latlngs.length; i += step) {
    const from = L.latLng(latlngs[i - 1]);
    const to   = L.latLng(latlngs[i]);
    const angle = _bearing(from, to);

    const arrowIcon = L.divIcon({
      className: 'track-arrow',
      html: `<div class="track-arrow-inner" style="transform:rotate(${angle}deg)">▶</div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });

    const mid = L.latLng(
      (from.lat + to.lat) / 2,
      (from.lng + to.lng) / 2
    );

    arrows.push(L.marker(mid, { icon: arrowIcon, interactive: false }).addTo(_map));
  }

  // Store arrows with the track so they can be removed
  const track = _tracks.get(null); // not set yet, we'll attach after
  polyline._arrows = arrows;
}

/**
 * Calculate bearing between two points in degrees.
 */
function _bearing(from, to) {
  const dLon = (to.lng - from.lng) * Math.PI / 180;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat   * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

/**
 * Remove a station's track from the map.
 */
function clearTrack(callsign) {
  const track = _tracks.get(callsign);
  if (!track) return;

  _map.removeLayer(track.polyline);

  // Remove arrow markers
  if (track.polyline._arrows) {
    track.polyline._arrows.forEach(a => _map.removeLayer(a));
  }

  // Remove waypoint dots
  track.dots.forEach(d => _map.removeLayer(d));

  _tracks.delete(callsign);
}

/**
 * Extend an active track with a new position point (real-time).
 */
function extendTrack(callsign, lat, lon) {
  const track = _tracks.get(callsign);
  if (!track) return;

  // Add to polyline
  track.polyline.addLatLng([lat, lon]);

  // Add new waypoint dot
  const dot = L.circleMarker([lat, lon], {
    radius: 3,
    fillColor: '#38bdf8',
    fillOpacity: 0.9,
    color: '#fff',
    weight: 1,
  }).addTo(_map);
  track.dots.push(dot);
}

/**
 * Check if a track is currently displayed for a station.
 */
function hasActiveTrack(callsign) {
  return _tracks.has(callsign);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Centre the map on a given callsign (if it has a marker).
 */
function flyToStation(callsign) {
  const entry = _markers.get(callsign);
  if (entry) _map.flyTo(entry.marker.getLatLng(), 13, { duration: 0.8 });
}

/**
 * Return current map centre coordinates.
 */
function getMapCenter() {
  const c = _map.getCenter();
  return { lat: c.lat, lon: c.lng };
}
