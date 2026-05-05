'use strict';

// ─── Socket.io client ────────────────────────────────────────────────────────
const socket = io();

// ─── TNC connection status ────────────────────────────────────────────────────
socket.on('connect',    () => _setTncStatus(true));
socket.on('disconnect', () => _setTncStatus(false));

function _setTncStatus(connected) {
  const badge = document.getElementById('tnc-status');
  const label = badge.querySelector('.status-label');
  badge.classList.toggle('connected',    connected);
  badge.classList.toggle('disconnected', !connected);
  label.textContent = connected ? 'Connected' : 'Disconnected';
}

// ─── Real-time events ─────────────────────────────────────────────────────────
socket.on('station_updated', (station) => {
  updateStationMarker(station);
  // Extend active track polyline in real-time
  if (hasActiveTrack(station.callsign)) {
    extendTrack(station.callsign, station.lat, station.lon);
  }
});

socket.on('weather_updated', (wx) => {
  console.log('[WS] Weather update from', wx.callsign);
});

socket.on('message_received', (msg) => {
  appendMessage(msg);
});

socket.on('packet_log', (pkt) => {
  appendTraceEntry(pkt);
});

// ─── Bootstrap ───────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // Initialise map (map.js)
  initMap();

  // Initialise time window slider (map.js)
  _initTimeSlider();

  // Initialise UI event listeners (ui.js)
  initUI();

  // Load messaging history (ui.js)
  initMessaging();

  // Seed map with all known stations from DB
  try {
    const res      = await fetch('/api/stations');
    const stations = await res.json();
    stations.forEach(updateStationMarker);
    applyTimeFilter(); // hide stations outside the default time window
    console.log(`[INIT] Loaded ${stations.length} stations from DB`);
  } catch (err) {
    console.error('[INIT] Failed to load stations:', err);
  }
});
