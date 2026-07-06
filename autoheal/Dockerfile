FROM alpine:3.21

RUN apk add --no-cache curl jq

WORKDIR /autoheal

COPY autoheal.sh /autoheal/autoheal.sh
RUN chmod +x /autoheal/autoheal.sh

CMD ["/autoheal/autoheal.sh"]
