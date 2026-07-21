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
COPY cli/src/ ./cli/src/

# Build shared first, then cli
RUN npm run build -w @jobpulse/shared
RUN npm run build -w @jobpulse/cli

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Production image
FROM node:22-alpine AS production
WORKDIR /app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy built shared package
COPY --from=builder /app/shared/dist ./shared/dist
COPY --from=builder /app/shared/package.json ./shared/

# Copy built cli package
COPY --from=builder /app/cli/dist ./cli/dist
COPY --from=builder /app/cli/package.json ./cli/

# Copy root package.json
COPY --from=builder /app/package.json ./

# Install only production dependencies
RUN npm ci --omit=dev --workspace=@jobpulse/cli --workspace=@jobpulse/shared

# Switch to non-root user
USER appuser

# Metadata
ENV NODE_ENV=production

# Create symlink to make `jobpulse` command available in PATH
RUN ln -s /app/cli/dist/index.js /usr/local/bin/jobpulse

# Entry point
ENTRYPOINT ["node", "cli/dist/index.js"]
