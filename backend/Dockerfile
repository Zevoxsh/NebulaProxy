FROM node:20.18-alpine

WORKDIR /app

RUN apk add --no-cache certbot git postgresql-client redis docker-cli docker-cli-compose curl

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Copy entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

CMD ["/app/entrypoint.sh"]
