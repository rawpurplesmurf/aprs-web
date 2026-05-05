'use strict';

const express = require('express');
const router  = express.Router();
const db      = require('./database');
const { transmit, buildAX25Frame } = require('./direwolf');
const { buildPositionInfo, buildMessageInfo } = require('./aprsHandler');

const MY_CALLSIGN   = () => (process.env.MY_CALLSIGN  || '').toUpperCase().trim();
const BEACON_PATH   = () =>  process.env.BEACON_PATH  || 'WIDE1-1,WIDE2-1';

// Monotonically incrementing message number (resets on restart — acceptable for a local tool)
let msgCounter = 1;

// ─── GET /api/stations ────────────────────────────────────────────────────────
router.get('/stations', (req, res) => {
  try {
    const stations = db.getAllStations();
    res.json(stations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/weather/:callsign ───────────────────────────────────────────────
router.get('/weather/:callsign', (req, res) => {
  try {
    const since = Math.floor(Date.now() / 1000) - 86400; // last 24 h
    const logs  = db.getWeatherLogs(req.params.callsign.toUpperCase(), since);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/messages ────────────────────────────────────────────────────────
router.get('/messages', (req, res) => {
  try {
    const messages = db.getMessages(MY_CALLSIGN());
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/history/:callsign ───────────────────────────────────────────────
router.get('/history/:callsign', (req, res) => {
  try {
    const period = parseInt(req.query.period || '3600', 10);
    const since  = Math.floor(Date.now() / 1000) - period;
    const rows   = db.getPositionHistory(req.params.callsign.toUpperCase(), since);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/transmit/beacon ────────────────────────────────────────────────
router.post('/transmit/beacon', (req, res) => {
  const { lat, lon, comment } = req.body;

  if (lat == null || lon == null || isNaN(Number(lat)) || isNaN(Number(lon))) {
    return res.status(400).json({ error: 'lat and lon are required numbers' });
  }

  const myCall = MY_CALLSIGN();
  if (!myCall) return res.status(500).json({ error: 'MY_CALLSIGN not configured' });

  try {
    const infoStr  = buildPositionInfo(Number(lat), Number(lon), comment || '');
    const ax25     = buildAX25Frame(myCall, 'APRS', BEACON_PATH(), infoStr);
    const ok       = transmit(ax25);

    if (!ok) return res.status(503).json({ error: 'Not connected to Direwolf TNC' });

    console.log(`[TX] Beacon: ${myCall} → ${lat},${lon} "${comment || ''}"`);
    res.json({ ok: true, info: infoStr });
  } catch (err) {
    console.error('[TX] Beacon error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/transmit/message ───────────────────────────────────────────────
router.post('/transmit/message', (req, res) => {
  const { to_call, message } = req.body;

  if (!to_call || !message) {
    return res.status(400).json({ error: 'to_call and message are required' });
  }

  const myCall = MY_CALLSIGN();
  if (!myCall) return res.status(500).json({ error: 'MY_CALLSIGN not configured' });

  try {
    const num      = String(msgCounter++).padStart(3, '0');
    const infoStr  = buildMessageInfo(to_call, message, num);
    const ax25     = buildAX25Frame(myCall, 'APRS', BEACON_PATH(), infoStr);
    const ok       = transmit(ax25);

    if (!ok) return res.status(503).json({ error: 'Not connected to Direwolf TNC' });

    const now = Math.floor(Date.now() / 1000);
    db.insertMessage({ from_call: myCall, to_call: to_call.toUpperCase(), message, is_outgoing: true, timestamp: now });

    // Broadcast to all connected browsers
    const io = req.app.get('io');
    io.emit('message_received', { from_call: myCall, to_call: to_call.toUpperCase(), message, is_outgoing: true, timestamp: now });

    console.log(`[TX] Message to ${to_call}: "${message}"`);
    res.json({ ok: true, msgNum: num });
  } catch (err) {
    console.error('[TX] Message error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
