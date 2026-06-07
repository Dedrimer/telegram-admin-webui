#!/bin/sh
set -eu

api_upstream="${ADMIN_API_UPSTREAM:-http://bot:8088}"
enable_https="${ADMIN_WEBUI_ENABLE_HTTPS:-false}"
auto_self_signed="${ADMIN_WEBUI_AUTO_SELF_SIGNED:-false}"
ssl_cert="${ADMIN_WEBUI_SSL_CERT:-/etc/nginx/certs/tls.crt}"
ssl_key="${ADMIN_WEBUI_SSL_KEY:-/etc/nginx/certs/tls.key}"

cat > /usr/share/nginx/html/config.js <<EOF
window.ADMIN_UI_CONFIG = {
  refreshIntervalMs: ${ADMIN_UI_REFRESH_INTERVAL_MS:-1000},
  adminToken: "${ADMIN_API_TOKEN:-}"
};
EOF

cat > /etc/nginx/conf.d/default.conf <<EOF
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass ${api_upstream};
        proxy_http_version 1.1;
    }

    location /health {
        proxy_pass ${api_upstream};
        proxy_http_version 1.1;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

if [ "$enable_https" = "true" ] || [ "$enable_https" = "1" ] || [ "$enable_https" = "yes" ]; then
  if [ "$auto_self_signed" = "true" ] || [ "$auto_self_signed" = "1" ] || [ "$auto_self_signed" = "yes" ]; then
    if [ ! -f "$ssl_cert" ] || [ ! -f "$ssl_key" ]; then
      mkdir -p "$(dirname "$ssl_cert")" "$(dirname "$ssl_key")"
      openssl req -x509 -nodes -newkey rsa:2048 -days 3650 \
        -keyout "$ssl_key" \
        -out "$ssl_cert" \
        -subj "/CN=telegram-downloader-admin" >/dev/null 2>&1
    fi
  fi

  if [ ! -f "$ssl_cert" ] || [ ! -f "$ssl_key" ]; then
    echo "ADMIN_WEBUI_ENABLE_HTTPS is enabled, but certificate files are missing: $ssl_cert $ssl_key" >&2
    exit 1
  fi

  cat >> /etc/nginx/conf.d/default.conf <<EOF

server {
    listen 443 ssl;
    server_name _;

    ssl_certificate ${ssl_cert};
    ssl_certificate_key ${ssl_key};
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass ${api_upstream};
        proxy_http_version 1.1;
    }

    location /health {
        proxy_pass ${api_upstream};
        proxy_http_version 1.1;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
EOF
fi
