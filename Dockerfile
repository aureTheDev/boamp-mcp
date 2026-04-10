FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine AS runtime

LABEL com.docker.mcp.name="boamp-mcp"
LABEL com.docker.mcp.description="Recherche d'appels d'offres BOAMP (marchés publics français)"
LABEL com.docker.mcp.version="1.0.0"
LABEL com.docker.mcp.vendor="boamp-mcp"

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/build ./build

ENTRYPOINT ["node", "build/index.js"]

# ── Bundle stage — produces boamp-mcp.mcpb ────────────────────────────────────
# Usage: docker build --target export --output . .
# Requires: icon.png in the project root (optional but recommended)
FROM runtime AS bundle

RUN apk add --no-cache zip

WORKDIR /bundle

# Copy compiled code and production deps from runtime
RUN cp -r /app/build . && cp -r /app/node_modules .

# Copy static assets
COPY manifest.json ./
COPY Dockerfile ./
COPY icon.png ./

RUN zip -r /boamp-mcp.mcpb . \
      --exclude "*.map" \
      --exclude "node_modules/.cache/*"

# Export only the archive so `--output .` drops it at the project root
FROM scratch AS export
COPY --from=bundle /boamp-mcp.mcpb /boamp-mcp.mcpb
