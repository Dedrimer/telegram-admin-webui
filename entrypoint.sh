#!/bin/sh
set -eu

cat > /usr/share/nginx/html/config.js <<EOF
window.ADMIN_UI_CONFIG = {
  refreshIntervalMs: ${ADMIN_UI_REFRESH_INTERVAL_MS:-3000},
  adminToken: "${ADMIN_API_TOKEN:-}"
};
EOF
