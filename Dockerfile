FROM nginx:1.27-alpine

ENV ADMIN_API_UPSTREAM=http://bot:8088 \
    ADMIN_UI_REFRESH_INTERVAL_MS=3000

COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY entrypoint.sh /docker-entrypoint.d/40-admin-webui-config.sh
COPY public /usr/share/nginx/html
RUN chmod +x /docker-entrypoint.d/40-admin-webui-config.sh
