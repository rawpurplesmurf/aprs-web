'use strict';
require('dotenv').config();

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const path = require('path');

const { initDb } = require('./database');
const { connect: connectDirewolf } = require('./direwolf');
const routes = require('./routes');

// ─── Validate required env vars ──────────────────────────────────────────────
const REQUIRED = ['MY_CALLSIGN', 'DIREWOLF_HOST'];
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`[FATAL] Missing required env var: ${key}`);
    process.exit(1);
  }
}

const WEB_PORT = parseInt(process.env.WEB_PORT || '3000', 10);

// ─── App setup ───────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

// Make io available to routes and handlers
app.set('io', io);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api', routes);

// ─── Socket.io ───────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// ─── Startup ─────────────────────────────────────────────────────────────────
async function main() {
  // Initialize SQLite database
  initDb();
  console.log('[DB] Database initialised');

  // Connect to Direwolf TNC
  connectDirewolf(io);

  // Start web server
  server.listen(WEB_PORT, () => {
    console.log(`[HTTP] APRS Dashboard listening on http://localhost:${WEB_PORT}`);
  });
}

main().catch((err) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
