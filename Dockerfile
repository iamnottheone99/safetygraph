# Multi-stage production Dockerfile for SafetyGraph VerifiedRAG Engine

# Stage 1: Build & compile TypeScript
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN npm run build

# Stage 2: Production runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# Non-root user for container security
USER node

EXPOSE 4000

CMD ["node", "dist/server.js"]
