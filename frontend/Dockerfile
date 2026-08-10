# NebulaProxy Frontend - Production Docker Image

# Build stage — build-only, but keeping it off the EOL Node 20 line too
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# wget is provided by busybox (already in nginx:alpine base image)

# Copy built files from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf.default 2>/dev/null || true

# Expose HTTP and HTTPS ports
EXPOSE 80 443

# Health check (wget is available via busybox in nginx:alpine)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:80/ > /dev/null || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
