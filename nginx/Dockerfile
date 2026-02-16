FROM debian:bookworm-slim

RUN apt-get update -y \
    && apt-get upgrade -y \
    && apt-get install -y dumb-init openssl nginx \
    && apt-get clean -y

RUN openssl req -x509 -nodes -days 365 -newkey rsa:4096 \
	-subj "/C=TR/ST=ISTANBUL/L=SARIYER/O=42Istanbul/OU=Student/CN=ahyildir.42.fr" \
	-keyout /etc/ssl/ahyildir.42.fr.key -out /etc/ssl/ahyildir.42.fr.crt

COPY ./conf/default.conf /etc/nginx/sites-enabled/default

EXPOSE 443

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["nginx", "-g", "daemon off;"]