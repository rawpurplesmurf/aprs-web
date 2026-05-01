'use strict';

// ─── Info panel ───────────────────────────────────────────────────────────────
let _currentCallsign = null;

function showInfoPanel(station) {
  // Clear previous station's track if different
  if (_currentCallsign && _currentCallsign !== station.callsign) {
    clearTrack(_currentCallsign);
    _resetTrackButtons();
  }

  _currentCallsign = station.callsign;

  document.getElementById('info-callsign').textContent = station.callsign;
  document.getElementById('info-comment').textContent  = station.comment || '—';
  document.getElementById('info-coords').textContent   =
    `${station.lat.toFixed(5)}, ${station.lon.toFixed(5)}`;
  document.getElementById('info-last-heard').textContent =
    station.last_heard ? _relativeTime(station.last_heard) : '—';
  document.getElementById('btn-msg-callsign').textContent = station.callsign;

  // Hide weather until we know
  const wxSection = document.getElementById('weather-section');
  wxSection.classList.add('hidden');

  // Restore track button state if this station has an active track
  _restoreTrackButtons(station.callsign);

  document.getElementById('info-panel').classList.remove('hidden');

  // Fetch weather data
  fetch(`/api/weather/${encodeURIComponent(station.callsign)}`)
    .then(r => r.json())
    .then(logs => {
      if (logs && logs.length > 0) {
        const latest = logs[0];
        _populateWeather(latest);
        wxSection.classList.remove('hidden');
      }
    })
    .catch(() => { /* no weather — that's fine */ });
}

function _populateWeather(wx) {
  const fmtTemp = (t) => t != null ? `${_cToF(t).toFixed(1)} °F (${Number(t).toFixed(1)} °C)` : '—';
  const fmtWind = (spd, dir) => {
    if (spd == null) return '—';
    return `${Number(spd).toFixed(1)} mph @ ${dir != null ? dir + '°' : '?'}`;
  };
  const fmtRain = (r) => r != null ? `${Number(r).toFixed(1)} mm` : '—';

  document.getElementById('wx-temp').textContent    = fmtTemp(wx.temp);
  document.getElementById('wx-humidity').textContent = wx.humidity != null ? `${wx.humidity}%` : '—';
  document.getElementById('wx-wind').textContent    = fmtWind(wx.wind_speed, wx.wind_dir);
  document.getElementById('wx-rain').textContent    = fmtRain(wx.rain_1h);
}

function _cToF(c) { return (Number(c) * 9 / 5) + 32; }

function _relativeTime(unixTs) {
  const diff = Math.floor(Date.now() / 1000) - unixTs;
  if (diff < 60)    return `${diff}s ago`;
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(unixTs * 1000).toLocaleDateString();
}

// ─── Messaging panel ─────────────────────────────────────────────────────────
let _unread = 0;

function initMessaging() {
  fetch('/api/messages')
    .then(r => r.json())
    .then(msgs => msgs.forEach(appendMessage))
    .catch(err => console.error('Failed to load messages:', err));
}

function appendMessage(msg) {
  const log  = document.getElementById('chat-log');
  const isOut = Boolean(msg.is_outgoing);
  const div  = document.createElement('div');
  div.className = `chat-bubble ${isOut ? 'outgoing' : 'incoming'}`;
  div.innerHTML = `
    <div class="chat-from">${isOut ? '▶ You → ' + msg.to_call : '◀ ' + msg.from_call}</div>
    ${escHtml(msg.message)}
    <div class="chat-meta">${_relativeTime(msg.timestamp)}</div>
  `;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;

  // Badge
  if (!isOut && document.getElementById('messages-panel').classList.contains('hidden')) {
    _unread++;
    const badge = document.getElementById('msg-badge');
    badge.textContent = _unread;
    badge.classList.remove('hidden');
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let _toastTimer;
function showToast(text, type = '') {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.className   = `toast ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ─── Packet trace panel ───────────────────────────────────────────────────────
const MAX_TRACE_ENTRIES = 500; // cap to avoid memory bloat

function appendTraceEntry(pkt) {
  const log  = document.getElementById('trace-log');
  if (!log) return;

  const time = new Date(pkt.timestamp * 1000).toLocaleTimeString([], { hour12: false });

  const div  = document.createElement('div');
  div.className = `trace-entry ${pkt.type}`;
  div.innerHTML =
    `<span class="trace-time">${time}</span>` +
    `<span class="trace-call">${escHtml(pkt.callsign)}</span>` +
    `<span class="trace-type">${escHtml(pkt.type)}</span>` +
    `<span class="trace-raw">${escHtml(pkt.raw)}</span>`;

  log.prepend(div);

  // Trim oldest entries (from the bottom)
  while (log.children.length > MAX_TRACE_ENTRIES) {
    log.removeChild(log.lastChild);
  }
}

// ─── UI wiring ────────────────────────────────────────────────────────────────
function initUI() {
  // Close info panel
  document.getElementById('btn-close-info').addEventListener('click', () => {
    if (_currentCallsign) {
      clearTrack(_currentCallsign);
      _resetTrackButtons();
    }
    document.getElementById('info-panel').classList.add('hidden');
    _currentCallsign = null;
  });

  // Track history buttons
  document.querySelectorAll('.track-btn[data-period]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!_currentCallsign) return;
      const period = parseInt(btn.dataset.period, 10);

      // Toggle: if already active, clear instead
      if (btn.classList.contains('active')) {
        clearTrack(_currentCallsign);
        _resetTrackButtons();
        return;
      }

      // Highlight active button
      _resetTrackButtons();
      btn.classList.add('active');
      document.getElementById('btn-track-clear').classList.remove('hidden');

      showTrack(_currentCallsign, period);
    });
  });

  document.getElementById('btn-track-clear').addEventListener('click', () => {
    if (_currentCallsign) clearTrack(_currentCallsign);
    _resetTrackButtons();
  });

  // Message this station button
  document.getElementById('btn-msg-this-station').addEventListener('click', () => {
    if (_currentCallsign) {
      document.getElementById('chat-to').value = _currentCallsign;
      document.getElementById('messages-panel').classList.remove('hidden');
      _resetUnread();
    }
  });

  // Trace panel toggle
  document.getElementById('btn-trace-toggle').addEventListener('click', () => {
    document.getElementById('trace-panel').classList.toggle('hidden');
  });
  document.getElementById('btn-close-trace').addEventListener('click', () => {
    document.getElementById('trace-panel').classList.add('hidden');
  });
  document.getElementById('btn-trace-clear').addEventListener('click', () => {
    document.getElementById('trace-log').innerHTML = '';
  });

  // Messages panel toggle
  document.getElementById('btn-messages-toggle').addEventListener('click', () => {
    document.getElementById('messages-panel').classList.toggle('hidden');
    _resetUnread();
  });
  document.getElementById('btn-close-messages').addEventListener('click', () => {
    document.getElementById('messages-panel').classList.add('hidden');
  });

  // Send message
  document.getElementById('btn-send-message').addEventListener('click', _sendMessage);
  document.getElementById('chat-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') _sendMessage();
  });

  // Beacon button — open modal
  document.getElementById('btn-beacon').addEventListener('click', _openBeaconModal);
  document.getElementById('btn-close-beacon').addEventListener('click',  _closeBeaconModal);
  document.getElementById('btn-beacon-cancel').addEventListener('click', _closeBeaconModal);
  document.getElementById('beacon-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) _closeBeaconModal();
  });
  document.getElementById('btn-beacon-send').addEventListener('click', _sendBeacon);
}

function _resetUnread() {
  _unread = 0;
  const badge = document.getElementById('msg-badge');
  badge.textContent = '0';
  badge.classList.add('hidden');
}

async function _sendMessage() {
  const to      = document.getElementById('chat-to').value.trim().toUpperCase();
  const text    = document.getElementById('chat-text').value.trim();
  if (!to || !text) return;

  try {
    const res = await fetch('/api/transmit/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_call: to, message: text }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    document.getElementById('chat-text').value = '';
    showToast('Message sent ✓', 'success');
  } catch (err) {
    showToast(`Send failed: ${err.message}`, 'error');
  }
}

function _openBeaconModal() {
  const { lat, lon } = getMapCenter();
  document.getElementById('beacon-lat').value = lat.toFixed(6);
  document.getElementById('beacon-lon').value = lon.toFixed(6);
  document.getElementById('beacon-modal').classList.remove('hidden');
}

function _closeBeaconModal() {
  document.getElementById('beacon-modal').classList.add('hidden');
}

async function _sendBeacon() {
  const lat     = parseFloat(document.getElementById('beacon-lat').value);
  const lon     = parseFloat(document.getElementById('beacon-lon').value);
  const comment = document.getElementById('beacon-comment').value.trim();

  if (isNaN(lat) || isNaN(lon)) {
    showToast('Invalid coordinates', 'error');
    return;
  }

  try {
    const res = await fetch('/api/transmit/beacon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lon, comment }),
    });
    if (!res.ok) throw new Error((await res.json()).error);
    _closeBeaconModal();
    showToast('Beacon transmitted ✓', 'success');
  } catch (err) {
    showToast(`Beacon failed: ${err.message}`, 'error');
  }
}

// ─── Track button helpers ────────────────────────────────────────────────────
function _resetTrackButtons() {
  document.querySelectorAll('.track-btn[data-period]').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-track-clear').classList.add('hidden');
}

function _restoreTrackButtons(callsign) {
  _resetTrackButtons();
  if (hasActiveTrack(callsign)) {
    const track = _tracks.get(callsign);
    const btn = document.querySelector(`.track-btn[data-period="${track.period}"]`);
    if (btn) btn.classList.add('active');
    document.getElementById('btn-track-clear').classList.remove('hidden');
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
