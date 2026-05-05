'use strict';

/**
 * aprsHandler.js — Parse APRS packets and dispatch to DB + WebSocket
 *
 * Uses aprs-parser v1.x API (named export { APRSParser }).
 * Field reference (verified against live package):
 *   Position:  parsed.data.latitude, .longitude, .symbol (e.g. "/>"), .comment
 *   Weather:   parsed.data.weather.{ temperature(°C), humidity, rain1h, windGust }
 *              parsed.data.extension.{ courseDeg, speedMPerS }
 *   Message:   parsed.data.addressee.{ call, ssid }, .text, .type === 'msg'
 */

const { APRSParser } = require('aprs-parser');
const db = require('./database');

const parser = new APRSParser();
const MY_CALLSIGN = () => (process.env.MY_CALLSIGN || '').toUpperCase().trim();

// ─── Incoming frame handler ───────────────────────────────────────────────────
function handleFrame(tnc2String, srcCallsign, io) {
  let parsed;
  try {
    parsed = parser.parse(tnc2String);
  } catch (err) {
    console.warn('[APRS] Parse error:', err.message, '| Raw:', tnc2String.slice(0, 80));
    io.emit('packet_log', {
      timestamp: Math.floor(Date.now() / 1000),
      callsign: srcCallsign.toUpperCase(),
      type: 'error',
      raw: tnc2String,
    });
    return;
  }

  if (!parsed || !parsed.data) return;

  const callsign = srcCallsign.toUpperCase();
  const now      = Math.floor(Date.now() / 1000);
  const data     = parsed.data;

  // ── Emit packet trace event (always) ─────────────────────────────────────
  const pktType = data.type === 'msg'   ? 'message'
                : data.weather          ? 'weather'
                : data.latitude != null ? 'position'
                : 'unknown';
  io.emit('packet_log', {
    timestamp: now,
    callsign,
    type: pktType,
    raw: tnc2String,
  });

  // ── Message ───────────────────────────────────────────────────────────────
  // Check messages first — message packets can also have position info
  if (data.type === 'msg' && data.addressee) {
    const toCallObj = data.addressee;
    const toCall = (typeof toCallObj === 'object'
      ? (toCallObj.ssid ? `${toCallObj.call}-${toCallObj.ssid}` : toCallObj.call)
      : String(toCallObj)
    ).toUpperCase().trim();

    const myBase = MY_CALLSIGN().split('-')[0];
    const toBase = toCall.split('-')[0];

    if (toCall === MY_CALLSIGN() || toBase === myBase) {
      console.log(`[APRS] Message from ${callsign} to ${toCall}: "${data.text}"`);
      db.insertMessage({
        from_call:   callsign,
        to_call:     toCall,
        message:     data.text || '',
        is_outgoing: false,
        timestamp:   now,
      });
      io.emit('message_received', {
        from_call:   callsign,
        to_call:     toCall,
        message:     data.text || '',
        is_outgoing: false,
        timestamp:   now,
      });
    }
    return;
  }

  // ── Weather (has data.weather sub-object) ──────────────────────────────────
  if (data.weather) {
    const wx     = data.weather;
    const ext    = data.extension || {};
    const lat    = data.latitude  ?? null;
    const lon    = data.longitude ?? null;
    const symbol = data.symbol    || '/_';

    console.log(`[APRS] Weather from ${callsign}`);

    if (lat != null && lon != null) {
      db.upsertStation({
        callsign,
        lat,
        lon,
        symbol_table: symbol[0] || '/',
        symbol_code:  symbol[1] || '_',
        comment:      data.comment || '',
        last_heard:   now,
      });
      io.emit('station_updated', {
        callsign,
        lat,
        lon,
        symbol_table: symbol[0] || '/',
        symbol_code:  symbol[1] || '_',
        comment:      data.comment || '',
        last_heard:   now,
      });

      // Record position history for track replay
      db.insertPositionHistory({
        callsign, lat, lon,
        speed:   ext.speedMPerS != null ? ext.speedMPerS * 2.23694 : null,
        course:  ext.courseDeg  ?? null,
        comment: data.comment || '',
        timestamp: now,
      });
    }

    // wind: speedMPerS → convert to mph for storage; temperature is °C
    const windSpeedMph = ext.speedMPerS != null
      ? ext.speedMPerS * 2.23694
      : null;

    const wxRow = {
      callsign,
      temp:       wx.temperature ?? null,  // °C
      humidity:   wx.humidity    ?? null,
      wind_dir:   ext.courseDeg  ?? null,
      wind_speed: windSpeedMph,
      rain_1h:    wx.rain1h      ?? null,  // mm
      timestamp:  now,
    };

    db.insertWeatherLog(wxRow);
    io.emit('weather_updated', { callsign, ...wxRow });
    return;
  }

  // ── Position / Location ───────────────────────────────────────────────────
  if (data.latitude != null && data.longitude != null) {
    const symbol = data.symbol || '/>';
    console.log(`[APRS] Position from ${callsign}: ${data.latitude},${data.longitude}`);

    db.upsertStation({
      callsign,
      lat:          data.latitude,
      lon:          data.longitude,
      symbol_table: symbol[0] || '/',
      symbol_code:  symbol[1] || '>',
      comment:      data.comment || '',
      last_heard:   now,
    });

    io.emit('station_updated', {
      callsign,
      lat:          data.latitude,
      lon:          data.longitude,
      symbol_table: symbol[0] || '/',
      symbol_code:  symbol[1] || '>',
      comment:      data.comment || '',
      last_heard:   now,
    });

    // Record position history for track replay
    const ext = data.extension || {};
    db.insertPositionHistory({
      callsign,
      lat:     data.latitude,
      lon:     data.longitude,
      speed:   ext.speedMPerS != null ? ext.speedMPerS * 2.23694 : null,
      course:  ext.courseDeg  ?? null,
      comment: data.comment || '',
      timestamp: now,
    });
  }
}

// ─── APRS info string builders (for TX) ──────────────────────────────────────

/**
 * Build an APRS position report info string.
 * Uses symbol and path from env vars.
 * Output format: !DDMM.mmN/DDDMM.mmW>comment
 */
function buildPositionInfo(lat, lon, comment) {
  const symbolTable = process.env.BEACON_SYMBOL_TABLE || '/';
  const symbolCode  = process.env.BEACON_SYMBOL_CODE  || '>';
  return `!${_formatLat(lat)}${symbolTable}${_formatLon(lon)}${symbolCode}${comment || ''}`;
}

/**
 * Build an APRS message info string.
 * Format: :{ADDRESSEE padded to 9}:{text}{msgnum}
 */
function buildMessageInfo(toCall, messageText, msgNum) {
  const addressee = toCall.toUpperCase().padEnd(9, ' ');
  const num = String(msgNum || '').slice(0, 5);
  return `:${addressee}:${messageText}${num ? '{' + num + '}' : ''}`;
}

// ─── Coordinate formatters ────────────────────────────────────────────────────
function _formatLat(decDeg) {
  const abs = Math.abs(decDeg);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const dir = decDeg >= 0 ? 'N' : 'S';
  return `${String(deg).padStart(2, '0')}${min.toFixed(2).padStart(5, '0')}${dir}`;
}

function _formatLon(decDeg) {
  const abs = Math.abs(decDeg);
  const deg = Math.floor(abs);
  const min = (abs - deg) * 60;
  const dir = decDeg >= 0 ? 'E' : 'W';
  return `${String(deg).padStart(3, '0')}${min.toFixed(2).padStart(5, '0')}${dir}`;
}

module.exports = { handleFrame, buildPositionInfo, buildMessageInfo };
