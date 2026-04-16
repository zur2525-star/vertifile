# -- Stage 1: Install dependencies --
FROM node:18-alpine AS deps

WORKDIR /app

# Copy only package files first for better layer caching
COPY package.json package-lock.json* ./

RUN npm ci --production

# -- Stage 2: Production image --
FROM node:18-alpine

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user for security
RUN addgroup -S vertifile && adduser -S vertifile -G vertifile

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY . .

# Set ownership to non-root user
RUN chown -R vertifile:vertifile /app

USER vertifile

# Render uses port 10000
EXPOSE 10000

CMD ["node", "server.js"]
