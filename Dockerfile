FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:20-alpine

LABEL com.docker.mcp.name="boamp-mcp"
LABEL com.docker.mcp.description="Recherche d'appels d'offres BOAMP (marchés publics français)"
LABEL com.docker.mcp.version="1.0.0"
LABEL com.docker.mcp.vendor="boamp-mcp"

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/build ./build

ENTRYPOINT ["node", "build/index.js"]
