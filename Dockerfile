FROM nginx:1.27-alpine

RUN apk add --no-cache openssl

ENV ADMIN_API_UPSTREAM=http://bot:8088 \
    ADMIN_UI_REFRESH_INTERVAL_MS=1000 \
    ADMIN_WEBUI_ENABLE_HTTPS=false \
    ADMIN_WEBUI_AUTO_SELF_SIGNED=false \
    ADMIN_WEBUI_SSL_CERT=/etc/nginx/certs/tls.crt \
    ADMIN_WEBUI_SSL_KEY=/etc/nginx/certs/tls.key

COPY entrypoint.sh /docker-entrypoint.d/40-admin-webui-config.sh
COPY public /usr/share/nginx/html
RUN chmod +x /docker-entrypoint.d/40-admin-webui-config.sh
