FROM alpine:3.21

RUN apk add --no-cache git docker-cli docker-cli-compose redis

WORKDIR /watchdog

COPY update-watchdog.sh /watchdog/update-watchdog.sh
RUN chmod +x /watchdog/update-watchdog.sh

CMD ["/watchdog/update-watchdog.sh"]
