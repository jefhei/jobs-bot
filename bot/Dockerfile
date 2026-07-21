# syntax=docker/dockerfile:1
# Stage 1: Build all workspace packages
FROM node:22-alpine AS builder
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy dependency manifests
COPY package.json tsconfig.base.json ./
COPY shared/package.json shared/tsconfig.json ./shared/
COPY bot/package.json bot/tsconfig.json ./bot/
COPY monitor/package.json monitor/tsconfig.json ./monitor/
COPY cli/package.json cli/tsconfig.json ./cli/

# Install all dependencies (including devDeps for build)
RUN npm ci

# Copy source code
COPY shared/src/ ./shared/src/
COPY bot/src/ ./bot/src/

# Build shared first, then bot
RUN npm run build -w @jobpulse/shared
RUN npm run build -w @jobpulse/bot

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Production image
FROM node:22-alpine AS production
WORKDIR /app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy built shared package
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/shared/package.json ./shared/

# Copy built bot package
COPY --from=builder /app/bot/dist ./bot/dist
COPY --from=builder /app/bot/package.json ./bot/

# Copy root package.json (for workspace resolution without node_modules traversal)
COPY --from=builder /app/package.json ./

# Install only production dependencies
RUN npm ci --omit=dev --workspace=@jobpulse/bot --workspace=@jobpulse/shared

# Switch to non-root user
USER appuser

# Metadata
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8443/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Default command
CMD ["node", "bot/dist/index.js"]
