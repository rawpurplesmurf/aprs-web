'use strict';

/**
 * direwolf.js — TCP KISS interface to Direwolf
 *
 * Handles:
 *  - TCP connection with auto-reconnect
 *  - KISS framing / unframing
 *  - AX.25 frame decode (address fields → callsigns)
 *  - AX.25 frame encode (for TX beacons and messages)
 *  - KISS transmit wrapper
 */

const net = require('net');
const { handleFrame } = require('./aprsHandler');

// ─── KISS constants ───────────────────────────────────────────────────────────
const FEND  = 0xC0; // Frame End
const FESC  = 0xDB; // Frame Escape
const TFEND = 0xDC; // Transposed FEND
const TFESC = 0xDD; // Transposed FESC
const CMD_DATA = 0x00; // KISS command: data frame, port 0

// ─── State ────────────────────────────────────────────────────────────────────
let socket = null;
let rxBuffer = Buffer.alloc(0);
let reconnectDelay = 2000; // ms, doubles on each failure up to 30 s
let io_ref = null;

// ─── Public connect ───────────────────────────────────────────────────────────
function connect(io) {
  io_ref = io;
  _connect();
}

function _connect() {
  const host = process.env.DIREWOLF_HOST;
  const port = parseInt(process.env.DIREWOLF_KISS_PORT || '8001', 10);

  console.log(`[TNC] Connecting to ${host}:${port} …`);
  socket = net.createConnection({ host, port });

  socket.on('connect', () => {
    console.log(`[TNC] Connected to Direwolf at ${host}:${port}`);
    reconnectDelay = 2000; // reset backoff on success
    rxBuffer = Buffer.alloc(0);
  });

  socket.on('data', (chunk) => {
    rxBuffer = Buffer.concat([rxBuffer, chunk]);
    _processBuffer();
  });

  socket.on('close', () => {
    console.warn(`[TNC] Connection closed. Reconnecting in ${reconnectDelay / 1000}s …`);
    _scheduleReconnect();
  });

  socket.on('error', (err) => {
    console.error('[TNC] Socket error:', err.message);
    socket.destroy();
  });
}

function _scheduleReconnect() {
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
    _connect();
  }, reconnectDelay);
}

// ─── KISS unframing ───────────────────────────────────────────────────────────
function _processBuffer() {
  while (true) {
    // Find opening FEND
    const start = rxBuffer.indexOf(FEND);
    if (start === -1) { rxBuffer = Buffer.alloc(0); return; }

    // Find closing FEND
    const end = rxBuffer.indexOf(FEND, start + 1);
    if (end === -1) {
      // Incomplete frame — keep from the opening FEND onwards
      rxBuffer = rxBuffer.slice(start);
      return;
    }

    // Extract data between the two FENDs
    const raw = rxBuffer.slice(start + 1, end);
    rxBuffer = rxBuffer.slice(end); // leave closing FEND as next opening

    if (raw.length === 0) continue; // empty frame (two consecutive FENDs)

    const unescaped = _kissUnescape(raw);

    // First byte is KISS command; 0x00 = data frame for port 0
    if (unescaped.length > 1 && (unescaped[0] & 0x0F) === 0) {
      const ax25 = unescaped.slice(1);
      _onFrame(ax25);
    }
  }
}

function _kissUnescape(data) {
  const out = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] === FESC) {
      i++;
      if (data[i] === TFEND)      out.push(FEND);
      else if (data[i] === TFESC) out.push(FESC);
      // else: malformed — skip
    } else {
      out.push(data[i]);
    }
  }
  return Buffer.from(out);
}

// ─── AX.25 decode ────────────────────────────────────────────────────────────
function _decodeAX25Address(buf, offset) {
  if (offset + 7 > buf.length) return null;
  let callsign = '';
  for (let i = 0; i < 6; i++) {
    const ch = buf[offset + i] >> 1;
    if (ch !== 0x20) callsign += String.fromCharCode(ch); // trim padding
  }
  callsign = callsign.trim();
  const ssidByte = buf[offset + 6];
  const ssid = (ssidByte >> 1) & 0x0F;
  const isLast = (ssidByte & 0x01) === 1;
  const addr = ssid > 0 ? `${callsign}-${ssid}` : callsign;
  return { addr, isLast };
}

function _onFrame(ax25) {
  try {
    const addresses = [];
    let offset = 0;

    // Parse all address fields (7 bytes each)
    while (offset + 7 <= ax25.length) {
      const result = _decodeAX25Address(ax25, offset);
      if (!result) break;
      addresses.push(result.addr);
      offset += 7;
      if (result.isLast) break;
    }

    if (addresses.length < 2) return; // Need at least dst + src

    // Skip control (0x03) and PID (0xF0) bytes
    if (offset + 2 > ax25.length) return;
    // const control = ax25[offset]; // unused for APRS UI frames
    // const pid     = ax25[offset + 1];
    offset += 2;

    const infoField = ax25.slice(offset).toString('ascii');

    const dst  = addresses[0];
    const src  = addresses[1];
    const via  = addresses.slice(2);

    // Reconstruct TNC2 string for aprs-parser
    const tnc2 = `${src}>${dst}${via.length ? ',' + via.join(',') : ''}:${infoField}`;

    handleFrame(tnc2, src, io_ref);
  } catch (err) {
    console.warn('[TNC] Frame decode error:', err.message);
  }
}

// ─── AX.25 encode ────────────────────────────────────────────────────────────
function _encodeAddress(callsignWithSsid, isLast) {
  const dashIdx = callsignWithSsid.indexOf('-');
  const callsign = dashIdx >= 0 ? callsignWithSsid.slice(0, dashIdx) : callsignWithSsid;
  const ssid     = dashIdx >= 0 ? parseInt(callsignWithSsid.slice(dashIdx + 1), 10) : 0;

  const padded = callsign.toUpperCase().padEnd(6, ' ');
  const buf = Buffer.alloc(7);
  for (let i = 0; i < 6; i++) buf[i] = padded.charCodeAt(i) << 1;
  // SSID byte: bits 7-5 = 111 (reserved), bits 4-1 = SSID, bit 0 = end-of-address
  buf[6] = 0b11100000 | ((ssid & 0x0F) << 1) | (isLast ? 1 : 0);
  return buf;
}

function buildAX25Frame(fromCall, toCall, viaPath, infoString) {
  const viaCalls = viaPath
    ? viaPath.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const addrBuffers = [];
  // Destination (first address field) — isLast only if no via and no src (never true for APRS)
  addrBuffers.push(_encodeAddress(toCall, false));
  // Source
  const srcIsLast = viaCalls.length === 0;
  addrBuffers.push(_encodeAddress(fromCall, srcIsLast));
  // Via digipeaters
  viaCalls.forEach((via, idx) => {
    addrBuffers.push(_encodeAddress(via, idx === viaCalls.length - 1));
  });

  const addressBuf = Buffer.concat(addrBuffers);
  const controlPid = Buffer.from([0x03, 0xF0]); // UI frame, No Layer 3
  const infoBuf    = Buffer.from(infoString, 'ascii');

  return Buffer.concat([addressBuf, controlPid, infoBuf]);
}

// ─── KISS transmit ────────────────────────────────────────────────────────────
function _kissEscape(data) {
  const out = [];
  for (const byte of data) {
    if (byte === FEND)      { out.push(FESC, TFEND); }
    else if (byte === FESC) { out.push(FESC, TFESC); }
    else                    { out.push(byte); }
  }
  return Buffer.from(out);
}

function transmit(ax25Frame) {
  if (!socket || socket.destroyed) {
    console.warn('[TNC] Cannot transmit: not connected to Direwolf');
    return false;
  }
  const escaped = _kissEscape(ax25Frame);
  const frame = Buffer.concat([
    Buffer.from([FEND, CMD_DATA]),
    escaped,
    Buffer.from([FEND]),
  ]);
  socket.write(frame);
  return true;
}

module.exports = { connect, transmit, buildAX25Frame };
