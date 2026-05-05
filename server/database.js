'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'aprs.db');
let db;

// ─── Initialisation ──────────────────────────────────────────────────────────
function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS stations (
      callsign        TEXT PRIMARY KEY,
      lat             REAL,
      lon             REAL,
      symbol_table    TEXT,
      symbol_code     TEXT,
      comment         TEXT,
      last_heard      INTEGER
    );

    CREATE TABLE IF NOT EXISTS weather_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      callsign    TEXT REFERENCES stations(callsign),
      temp        REAL,
      humidity    INTEGER,
      wind_dir    INTEGER,
      wind_speed  REAL,
      rain_1h     REAL,
      timestamp   INTEGER
    );

    CREATE TABLE IF NOT EXISTS messages (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      from_call   TEXT,
      to_call     TEXT,
      message     TEXT,
      is_outgoing INTEGER DEFAULT 0,
      timestamp   INTEGER
    );

    CREATE TABLE IF NOT EXISTS position_history (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      callsign  TEXT NOT NULL,
      lat       REAL NOT NULL,
      lon       REAL NOT NULL,
      speed     REAL,
      course    INTEGER,
      comment   TEXT,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_poshistory_call_ts
      ON position_history(callsign, timestamp);
  `);

  return db;
}

// ─── Prepared statements (lazy-initialised) ──────────────────────────────────
let _upsertStation, _insertWeather, _insertMessage, _insertPosHistory;
let _getAllStations, _getWeatherLogs, _getMessages, _getPosHistory;

function getDb() {
  if (!db) throw new Error('Database not initialised — call initDb() first');
  return db;
}

function upsertStation({ callsign, lat, lon, symbol_table, symbol_code, comment, last_heard }) {
  if (!_upsertStation) {
    _upsertStation = getDb().prepare(`
      INSERT INTO stations (callsign, lat, lon, symbol_table, symbol_code, comment, last_heard)
      VALUES (@callsign, @lat, @lon, @symbol_table, @symbol_code, @comment, @last_heard)
      ON CONFLICT(callsign) DO UPDATE SET
        lat          = excluded.lat,
        lon          = excluded.lon,
        symbol_table = excluded.symbol_table,
        symbol_code  = excluded.symbol_code,
        comment      = excluded.comment,
        last_heard   = excluded.last_heard
    `);
  }
  return _upsertStation.run({ callsign, lat, lon, symbol_table, symbol_code, comment, last_heard });
}

function insertWeatherLog({ callsign, temp, humidity, wind_dir, wind_speed, rain_1h, timestamp }) {
  if (!_insertWeather) {
    _insertWeather = getDb().prepare(`
      INSERT INTO weather_logs (callsign, temp, humidity, wind_dir, wind_speed, rain_1h, timestamp)
      VALUES (@callsign, @temp, @humidity, @wind_dir, @wind_speed, @rain_1h, @timestamp)
    `);
  }
  return _insertWeather.run({ callsign, temp, humidity, wind_dir, wind_speed, rain_1h, timestamp });
}

function insertMessage({ from_call, to_call, message, is_outgoing, timestamp }) {
  if (!_insertMessage) {
    _insertMessage = getDb().prepare(`
      INSERT INTO messages (from_call, to_call, message, is_outgoing, timestamp)
      VALUES (@from_call, @to_call, @message, @is_outgoing, @timestamp)
    `);
  }
  return _insertMessage.run({ from_call, to_call, message, is_outgoing: is_outgoing ? 1 : 0, timestamp });
}

function getAllStations() {
  if (!_getAllStations) {
    _getAllStations = getDb().prepare('SELECT * FROM stations ORDER BY last_heard DESC');
  }
  return _getAllStations.all();
}

function getWeatherLogs(callsign, since) {
  if (!_getWeatherLogs) {
    _getWeatherLogs = getDb().prepare(
      'SELECT * FROM weather_logs WHERE callsign = ? AND timestamp >= ? ORDER BY timestamp DESC'
    );
  }
  return _getWeatherLogs.all(callsign, since);
}

function getMessages(myCallsign) {
  if (!_getMessages) {
    _getMessages = getDb().prepare(`
      SELECT * FROM messages
      WHERE from_call = ? OR to_call = ?
      ORDER BY timestamp ASC
    `);
  }
  return _getMessages.all(myCallsign, myCallsign);
}

function insertPositionHistory({ callsign, lat, lon, speed, course, comment, timestamp }) {
  if (!_insertPosHistory) {
    _insertPosHistory = getDb().prepare(`
      INSERT INTO position_history (callsign, lat, lon, speed, course, comment, timestamp)
      VALUES (@callsign, @lat, @lon, @speed, @course, @comment, @timestamp)
    `);
  }
  return _insertPosHistory.run({ callsign, lat, lon, speed: speed ?? null, course: course ?? null, comment: comment ?? '', timestamp });
}

function getPositionHistory(callsign, since) {
  if (!_getPosHistory) {
    _getPosHistory = getDb().prepare(
      'SELECT lat, lon, speed, course, comment, timestamp FROM position_history WHERE callsign = ? AND timestamp >= ? ORDER BY timestamp ASC'
    );
  }
  return _getPosHistory.all(callsign, since);
}

module.exports = {
  initDb,
  upsertStation,
  insertWeatherLog,
  insertMessage,
  insertPositionHistory,
  getAllStations,
  getWeatherLogs,
  getMessages,
  getPositionHistory,
};
