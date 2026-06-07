const config = window.ADMIN_UI_CONFIG || {};
const defaultRefreshIntervalMs = Number(config.refreshIntervalMs || 1000);
const adminToken = config.adminToken || "";
const historyLimit = 120;
const heartbeatTtlSeconds = 6;
const samples = [];
let refreshTimer = null;
let heartbeatTimer = null;
let refreshInFlight = false;

const el = {
  connectionStatus: document.getElementById("connectionStatus"),
  refreshEnabled: document.getElementById("refreshEnabled"),
  refreshInterval: document.getElementById("refreshInterval"),
  downloadingCount: document.getElementById("downloadingCount"),
  queuedCount: document.getElementById("queuedCount"),
  cpuValue: document.getElementById("cpuValue"),
  memoryValue: document.getElementById("memoryValue"),
  lastUpdated: document.getElementById("lastUpdated"),
  downloadRows: document.getElementById("downloadRows"),
  chart: document.getElementById("resourceChart"),
  downloaderOnline: document.getElementById("downloaderOnline"),
  botApiOnline: document.getElementById("botApiOnline"),
  botOnline: document.getElementById("botOnline"),
  userInfo: document.getElementById("userInfo"),
  downloadDiskText: document.getElementById("downloadDiskText"),
  downloadDiskBar: document.getElementById("downloadDiskBar"),
  botApiDiskText: document.getElementById("botApiDiskText"),
  botApiDiskBar: document.getElementById("botApiDiskBar"),
};

function requestHeaders(json = false) {
  const result = {};
  if (adminToken) result["X-Admin-Token"] = adminToken;
  if (json) result["Content-Type"] = "application/json";
  return result;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatSpeed(bytesPerSecond) {
  return `${formatBytes(bytesPerSecond)}/s`;
}

function setBadge(target, online, text) {
  target.className = online ? "badge ok" : "badge bad";
  target.textContent = text || (online ? "Online" : "Offline");
}

function setConnection(ok, text) {
  el.connectionStatus.className = ok ? "status-pill ok" : "status-pill bad";
  el.connectionStatus.textContent = text;
}

function pct(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderDownloads(downloads) {
  const items = downloads.items || [];
  if (!items.length) {
    el.downloadRows.innerHTML = '<tr><td colspan="5" class="empty">No active downloads</td></tr>';
    return;
  }

  el.downloadRows.innerHTML = items.map((item) => {
    const progress = clampPercent(item.progress_percent);
    const statusClass = item.queued ? "" : " ok";
    return `
      <tr>
        <td class="file">
          <div class="file-name" title="${escapeHtml(item.file_name)}">${escapeHtml(item.file_name)}</div>
          <div class="file-meta">${formatBytes(item.downloaded_bytes)} / ${formatBytes(item.file_size_bytes)}</div>
        </td>
        <td><span class="badge${statusClass}">${escapeHtml(item.status)}</span></td>
        <td class="progress-cell">
          <div class="progress-track"><span style="width:${progress}%"></span></div>
          <div class="progress-text">${progress.toFixed(2)}%</div>
        </td>
        <td>${formatSpeed(item.speed_bps)}</td>
        <td>${escapeHtml(item.eta || "--")}</td>
      </tr>
    `;
  }).join("");
}

function renderStorage(info, textTarget, barTarget) {
  const used = clampPercent(info && info.used_percent);
  textTarget.textContent = `${pct(used)} · ${formatBytes(info && info.free_bytes)} free`;
  barTarget.style.width = `${used}%`;
}

function renderChart() {
  const canvas = el.chart;
  const ctx = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  ctx.scale(ratio, ratio);

  const width = rect.width;
  const height = rect.height;
  const padding = { left: 34, right: 10, top: 14, bottom: 24 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#dce3ea";
  ctx.lineWidth = 1;
  ctx.font = "12px Segoe UI, sans-serif";
  ctx.fillStyle = "#647282";

  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (chartHeight * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(`${100 - i * 25}`, 6, y + 4);
  }

  drawSeries(ctx, samples.map((item) => item.cpu), "#246bce", padding, chartWidth, chartHeight);
  drawSeries(ctx, samples.map((item) => item.memory), "#16815e", padding, chartWidth, chartHeight);
}

function drawSeries(ctx, values, color, padding, chartWidth, chartHeight) {
  if (values.length < 2) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  values.forEach((value, index) => {
    const x = padding.left + (chartWidth * index) / (historyLimit - 1);
    const y = padding.top + chartHeight - (clampPercent(value) / 100) * chartHeight;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function render(data) {
  const summary = data.downloads.summary || {};
  const resources = data.system.resources || {};
  const memory = resources.memory || {};
  const components = data.system.components || {};
  const botInfo = data.bot || {};
  const botApi = components.telegram_bot_api || {};

  el.downloadingCount.textContent = summary.downloading || 0;
  el.queuedCount.textContent = summary.queued || 0;
  el.cpuValue.textContent = pct(resources.cpu_percent);
  el.memoryValue.textContent = pct(memory.used_percent);
  el.lastUpdated.textContent = new Date().toLocaleTimeString();

  renderDownloads(data.downloads);
  setBadge(el.downloaderOnline, true, "Online");
  setBadge(el.botApiOnline, Boolean(botApi.online), botApi.online ? `Online · ${botApi.latency_ms}ms` : "Offline");
  setBadge(
    el.botOnline,
    Boolean(botInfo.bot && botInfo.bot.online),
    botInfo.bot && botInfo.bot.username ? `@${botInfo.bot.username}` : "Unknown",
  );
  el.userInfo.textContent = `${botInfo.configured_user_id || "--"} / ${botInfo.configured_chat_id || "--"}`;

  renderStorage(resources.download_disk || {}, el.downloadDiskText, el.downloadDiskBar);
  renderStorage(resources.bot_api_disk || {}, el.botApiDiskText, el.botApiDiskBar);

  samples.push({
    cpu: Number(resources.cpu_percent || 0),
    memory: Number(memory.used_percent || 0),
  });
  while (samples.length > historyLimit) samples.shift();
  renderChart();
}

async function postJson(path, payload, keepalive = false) {
  return fetch(path, {
    method: "POST",
    headers: requestHeaders(true),
    body: JSON.stringify(payload || {}),
    keepalive,
  });
}

function sendStopHeartbeat() {
  const payload = JSON.stringify({ enabled: false });
  if (!adminToken && navigator.sendBeacon) {
    const blob = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon("/api/admin/stop", blob);
    return;
  }
  postJson("/api/admin/stop", { enabled: false }, true).catch(() => {});
}

async function sendHeartbeat() {
  if (!isLiveRefreshActive()) return;
  try {
    await postJson("/api/admin/heartbeat", {
      enabled: true,
      ttl_seconds: heartbeatTtlSeconds,
    });
  } catch {
    // The normal data refresh path reports connection errors to the UI.
  }
}

async function refresh() {
  if (!isLiveRefreshActive() || refreshInFlight) return;
  refreshInFlight = true;
  try {
    const response = await fetch("/api/overview", { headers: requestHeaders() });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    render(data);
    setConnection(true, "Connected");
  } catch (error) {
    setConnection(false, `Failed: ${error.message}`);
  } finally {
    refreshInFlight = false;
  }
}

function getSavedRefreshInterval() {
  const saved = Number(localStorage.getItem("admin-webui-refresh-ms"));
  if ([500, 1000, 2000, 3000, 5000].includes(saved)) return saved;
  if ([500, 1000, 2000, 3000, 5000].includes(defaultRefreshIntervalMs)) return defaultRefreshIntervalMs;
  return 1000;
}

function getSavedRefreshEnabled() {
  return localStorage.getItem("admin-webui-refresh-enabled") !== "false";
}

function isLiveRefreshActive() {
  return el.refreshEnabled.checked && document.visibilityState === "visible";
}

function clearLoops() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  refreshTimer = null;
  heartbeatTimer = null;
}

function startLoops() {
  clearLoops();
  if (!isLiveRefreshActive()) {
    setConnection(false, "Paused");
    sendStopHeartbeat();
    return;
  }

  const intervalMs = Number(el.refreshInterval.value);
  localStorage.setItem("admin-webui-refresh-ms", String(intervalMs));
  localStorage.setItem("admin-webui-refresh-enabled", String(el.refreshEnabled.checked));
  sendHeartbeat();
  refresh();
  heartbeatTimer = setInterval(sendHeartbeat, Math.max(1000, Math.floor((heartbeatTtlSeconds * 1000) / 2)));
  refreshTimer = setInterval(refresh, intervalMs);
}

el.refreshInterval.value = String(getSavedRefreshInterval());
el.refreshEnabled.checked = getSavedRefreshEnabled();
el.refreshInterval.addEventListener("change", startLoops);
el.refreshEnabled.addEventListener("change", startLoops);
document.addEventListener("visibilitychange", startLoops);
window.addEventListener("pagehide", sendStopHeartbeat);
window.addEventListener("beforeunload", sendStopHeartbeat);
window.addEventListener("freeze", sendStopHeartbeat);
window.addEventListener("resize", renderChart);
startLoops();
