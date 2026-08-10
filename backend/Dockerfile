# Was node:20.18-alpine — Node 20 is past its April 2026 EOL (no more
# security patches). 22 is current LTS (maintained until April 2027). No
# native-binding deps in package.json (bcrypt/sharp/etc), so this should be
# a drop-in bump — still worth a full test cycle before deploying.
FROM node:22.23-alpine

WORKDIR /app

RUN apk add --no-cache certbot git postgresql-client redis docker-cli docker-cli-compose

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Copy entrypoint script
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

CMD ["/app/entrypoint.sh"]
