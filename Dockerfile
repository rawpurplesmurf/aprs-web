# ─── Build stage ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Install build tools required by better-sqlite3 native addon
RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

# ─── Runtime stage ───────────────────────────────────────────────────────────
FROM node:22-alpine

LABEL org.opencontainers.image.title="APRS Dashboard" \
      org.opencontainers.image.description="Self-hosted APRS dashboard with Direwolf KISS/TCP interface" \
      org.opencontainers.image.source="https://github.com/yourusername/aprs-web"

WORKDIR /app

# Create non-root user for security
RUN addgroup -S aprs && adduser -S aprs -G aprs

# Copy production deps from build stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY server/ ./server/
COPY public/ ./public/
COPY package.json ./

# Persistent data directory (mount a volume here for SQLite)
RUN mkdir -p /app/data && chown -R aprs:aprs /app

USER aprs

EXPOSE 3000

# Health check — verifies the HTTP server is responding
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${WEB_PORT:-3000}/api/stations > /dev/null || exit 1

CMD ["node", "server/index.js"]
