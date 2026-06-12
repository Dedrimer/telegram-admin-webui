const config = window.ADMIN_UI_CONFIG || {};
const defaultRefreshIntervalMs = Number(config.refreshIntervalMs || 1000);
const adminToken = config.adminToken || "";
const historyLimit = 120;
const heartbeatTtlSeconds = 6;
const languageStorageKey = "admin-webui-language";
const themeStorageKey = "admin-webui-theme";
const sidebarCollapsedStorageKey = "admin-webui-sidebar-collapsed";
const themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
const translations = window.ADMIN_WEBUI_I18N || {};
const supportedLanguages = Object.keys(translations);
const samples = [];
let refreshTimer = null;
let heartbeatTimer = null;
let refreshInFlight = false;
let currentLanguage = getInitialLanguage();
let currentThemeMode = getInitialThemeMode();
let sidebarCollapsed = getInitialSidebarCollapsed();

const el = {
  languageSelect: document.getElementById("languageSelect"),
  themeSelect: document.getElementById("themeSelect"),
  sidebarToggle: document.getElementById("sidebarToggle"),
  connectionStatus: document.getElementById("connectionStatus"),
  sidebarQueueCount: document.getElementById("sidebarQueueCount"),
  refreshEnabled: document.getElementById("refreshEnabled"),
  refreshInterval: document.getElementById("refreshInterval"),
  downloadingCount: document.getElementById("downloadingCount"),
  queuedCount: document.getElementById("queuedCount"),
  cpuValue: document.getElementById("cpuValue"),
  memoryValue: document.getElementById("memoryValue"),
  lastUpdated: document.getElementById("lastUpdated"),
  downloadRows: document.getElementById("downloadRows"),
  historyRows: document.getElementById("historyRows"),
  historyCount: document.getElementById("historyCount"),
  settingsLanguage: document.getElementById("settingsLanguage"),
  singleFileGroupEnabled: document.getElementById("singleFileGroupEnabled"),
  singleFileGroupDelay: document.getElementById("singleFileGroupDelay"),
  downloadStatusUpdateInterval: document.getElementById("downloadStatusUpdateInterval"),
  downloadProgressPollInterval: document.getElementById("downloadProgressPollInterval"),
  adminProgressPollInterval: document.getElementById("adminProgressPollInterval"),
  historyRetentionDays: document.getElementById("historyRetentionDays"),
  historyRetentionUnlimited: document.getElementById("historyRetentionUnlimited"),
  historyMaxRecords: document.getElementById("historyMaxRecords"),
  historyMaxRecordsUnlimited: document.getElementById("historyMaxRecordsUnlimited"),
  saveHistorySettings: document.getElementById("saveHistorySettings"),
  historySettingsStatus: document.getElementById("historySettingsStatus"),
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

function normalizeLanguage(language) {
  const value = String(language || "").trim().replace("_", "-");
  const lower = value.toLowerCase();
  if (lower === "zh" || lower === "zh-cn" || lower === "zh-hans") return "zh-CN";
  if (lower === "en" || lower === "en-us" || lower === "en-gb") return "en";
  return supportedLanguages.includes(value) ? value : "";
}

function getInitialLanguage() {
  const saved = normalizeLanguage(localStorage.getItem(languageStorageKey));
  if (saved) return saved;
  const browserLanguages = navigator.languages && navigator.languages.length
    ? navigator.languages
    : [navigator.language];
  for (const language of browserLanguages) {
    const normalized = normalizeLanguage(language);
    if (normalized) return normalized;
  }
  return "en";
}

function t(key, values = {}) {
  const table = translations[currentLanguage] || translations.en || {};
  const fallback = translations.en || {};
  const template = table[key] || fallback[key] || key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

function applyLanguage() {
  document.documentElement.lang = currentLanguage;
  document.title = t("app.title");
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((node) => {
    node.title = t(node.dataset.i18nTitle);
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach((node) => {
    node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel));
  });
  if (el.languageSelect) {
    el.languageSelect.value = currentLanguage;
  }
  applySidebarState();
}

function normalizeThemeMode(mode) {
  const value = String(mode || "").trim().toLowerCase();
  return ["auto", "light", "dark"].includes(value) ? value : "";
}

function getInitialThemeMode() {
  return normalizeThemeMode(localStorage.getItem(themeStorageKey)) || "auto";
}

function getResolvedTheme() {
  if (currentThemeMode === "dark") return "dark";
  if (currentThemeMode === "light") return "light";
  return themeMediaQuery.matches ? "dark" : "light";
}

function applyTheme() {
  const resolvedTheme = getResolvedTheme();
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themeMode = currentThemeMode;
  document.documentElement.style.colorScheme = resolvedTheme;
  if (el.themeSelect) {
    el.themeSelect.value = currentThemeMode;
  }
  renderChart();
}

function getInitialSidebarCollapsed() {
  return localStorage.getItem(sidebarCollapsedStorageKey) === "true";
}

function applySidebarState() {
  document.documentElement.dataset.sidebar = sidebarCollapsed ? "collapsed" : "expanded";
  if (el.sidebarToggle) {
    const label = sidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse");
    el.sidebarToggle.setAttribute("aria-label", label);
    el.sidebarToggle.setAttribute("aria-pressed", String(sidebarCollapsed));
    el.sidebarToggle.title = label;
  }
  renderChart();
  window.setTimeout(renderChart, 220);
}

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
  target.textContent = text || (online ? t("state.online") : t("state.offline"));
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

function formatStatus(status) {
  const key = `status.${String(status || "").trim().toLowerCase()}`;
  const translated = t(key);
  return translated === key ? String(status || "") : translated;
}

function renderDownloads(downloads) {
  const items = downloads.items || [];
  if (!items.length) {
    el.downloadRows.innerHTML = `<tr><td colspan="5" class="empty">${t("downloads.empty")}</td></tr>`;
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
        <td><span class="badge${statusClass}">${escapeHtml(formatStatus(item.status))}</span></td>
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

function formatDateTime(value) {
  if (!value) return "--";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
}

function renderHistory(history) {
  const items = (history && history.items) || [];
  const summary = (history && history.summary) || {};
  if (el.historyCount) {
    el.historyCount.textContent = t("history.count", { count: summary.total || 0 });
  }
  if (!el.historyRows) return;
  if (!items.length) {
    el.historyRows.innerHTML = `<tr><td colspan="5" class="empty">${t("history.empty")}</td></tr>`;
    return;
  }

  el.historyRows.innerHTML = items.map((item) => {
    const progress = clampPercent(item.progress_percent);
    const ok = String(item.status || "").toLowerCase() === "complete";
    const bad = ["failed", "cancelled"].includes(String(item.status || "").toLowerCase());
    const statusClass = ok ? " ok" : (bad ? " bad" : "");
    return `
      <tr>
        <td class="file">
          <div class="file-name" title="${escapeHtml(item.file_name)}">${escapeHtml(item.file_name)}</div>
          <div class="file-meta">${formatBytes(item.downloaded_bytes)} / ${formatBytes(item.file_size_bytes)}</div>
        </td>
        <td><span class="badge${statusClass}">${escapeHtml(formatStatus(item.status))}</span></td>
        <td class="progress-cell">
          <div class="progress-track"><span style="width:${progress}%"></span></div>
          <div class="progress-text">${progress.toFixed(2)}%</div>
        </td>
        <td>${escapeHtml(formatDateTime(item.completed_at_iso || item.completed_at))}</td>
        <td class="error-cell" title="${escapeHtml(item.last_error || "")}">${escapeHtml(item.last_error || "--")}</td>
      </tr>
    `;
  }).join("");
}

function applyHistorySettings(settings) {
  const history = settings && settings.download_history;
  const runtime = settings && settings.runtime_settings;
  if (runtime) {
    if (el.settingsLanguage) el.settingsLanguage.value = normalizeLanguage(runtime.language) || "en";
    if (el.singleFileGroupEnabled) el.singleFileGroupEnabled.checked = Boolean(runtime.single_file_group_enabled);
    if (el.singleFileGroupDelay) el.singleFileGroupDelay.value = String(runtime.single_file_group_delay || 1);
    if (el.downloadStatusUpdateInterval) el.downloadStatusUpdateInterval.value = String(runtime.download_status_update_interval || 5);
    if (el.downloadProgressPollInterval) el.downloadProgressPollInterval.value = String(runtime.download_progress_poll_interval || 1);
    if (el.adminProgressPollInterval) el.adminProgressPollInterval.value = String(runtime.admin_progress_poll_interval || 0.5);
  }
  if (!history) return;
  const retentionUnlimited = Boolean(history.retention_unlimited);
  const recordsUnlimited = Boolean(history.max_records_unlimited);
  if (el.historyRetentionUnlimited) el.historyRetentionUnlimited.checked = retentionUnlimited;
  if (el.historyMaxRecordsUnlimited) el.historyMaxRecordsUnlimited.checked = recordsUnlimited;
  if (el.historyRetentionDays) {
    el.historyRetentionDays.disabled = retentionUnlimited;
    el.historyRetentionDays.value = retentionUnlimited ? "" : String(history.retention_days || 30);
  }
  if (el.historyMaxRecords) {
    el.historyMaxRecords.disabled = recordsUnlimited;
    el.historyMaxRecords.value = recordsUnlimited ? "" : String(history.max_records || 1000);
  }
}

function renderHistorySettingsStatus(settings) {
  if (!el.historySettingsStatus) return;
  const history = settings && settings.download_history;
  const runtime = settings && settings.runtime_settings;
  if (!history) {
    el.historySettingsStatus.textContent = "--";
    return;
  }
  const retention = history.retention_unlimited
    ? t("settings.unlimited")
    : t("settings.days_value", { value: history.retention_days });
  const records = history.max_records_unlimited
    ? t("settings.unlimited")
    : t("settings.records_value", { value: history.max_records });
  const language = runtime && runtime.language ? runtime.language : "--";
  el.historySettingsStatus.textContent = t("settings.current", { retention, records, language });
}

function renderStorage(info, textTarget, barTarget) {
  const used = clampPercent(info && info.used_percent);
  textTarget.textContent = `${pct(used)} - ${t("storage.free", { free: formatBytes(info && info.free_bytes) })}`;
  barTarget.style.width = `${used}%`;
}

function renderChart() {
  const canvas = el.chart;
  const ctx = canvas.getContext("2d");
  const styles = getComputedStyle(document.documentElement);
  const chartGridColor = styles.getPropertyValue("--chart-grid").trim() || "#dce3ea";
  const chartTextColor = styles.getPropertyValue("--chart-text").trim() || "#647282";
  const cpuColor = styles.getPropertyValue("--chart-cpu").trim() || "#246bce";
  const memoryColor = styles.getPropertyValue("--chart-memory").trim() || "#16815e";
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
  ctx.strokeStyle = chartGridColor;
  ctx.lineWidth = 1;
  ctx.font = "12px Segoe UI, sans-serif";
  ctx.fillStyle = chartTextColor;

  for (let i = 0; i <= 4; i += 1) {
    const y = padding.top + (chartHeight * i) / 4;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.stroke();
    ctx.fillText(`${100 - i * 25}`, 6, y + 4);
  }

  drawSeries(ctx, samples.map((item) => item.cpu), cpuColor, padding, chartWidth, chartHeight);
  drawSeries(ctx, samples.map((item) => item.memory), memoryColor, padding, chartWidth, chartHeight);
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

function render(data, history) {
  const summary = data.downloads.summary || {};
  const resources = data.system.resources || {};
  const memory = resources.memory || {};
  const components = data.system.components || {};
  const botInfo = data.bot || {};
  const botApi = components.telegram_bot_api || {};
  const settings = {
    download_history: data.system.download_history || {},
    runtime_settings: data.system.runtime_settings || {},
  };

  el.downloadingCount.textContent = summary.downloading || 0;
  el.queuedCount.textContent = summary.queued || 0;
  el.sidebarQueueCount.textContent = t("sidebar.active_tasks", { count: summary.total || 0 });
  el.cpuValue.textContent = pct(resources.cpu_percent);
  el.memoryValue.textContent = pct(memory.used_percent);
  el.lastUpdated.textContent = new Date().toLocaleTimeString();

  renderDownloads(data.downloads);
  renderHistory(history);
  applyHistorySettings(settings);
  renderHistorySettingsStatus(settings);
  setBadge(el.downloaderOnline, true, t("state.online"));
  setBadge(el.botApiOnline, Boolean(botApi.online), botApi.online ? `${t("state.online")} - ${botApi.latency_ms}ms` : t("state.offline"));
  setBadge(
    el.botOnline,
    Boolean(botInfo.bot && botInfo.bot.online),
    botInfo.bot && botInfo.bot.username ? `@${botInfo.bot.username}` : t("state.unknown"),
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

async function saveHistorySettings() {
  if (!el.saveHistorySettings) return;
  const retentionUnlimited = Boolean(el.historyRetentionUnlimited && el.historyRetentionUnlimited.checked);
  const recordsUnlimited = Boolean(el.historyMaxRecordsUnlimited && el.historyMaxRecordsUnlimited.checked);
  const payload = {
    runtime_settings: {
      language: el.settingsLanguage ? el.settingsLanguage.value : "en",
      single_file_group_enabled: Boolean(el.singleFileGroupEnabled && el.singleFileGroupEnabled.checked),
      single_file_group_delay: Number(el.singleFileGroupDelay && el.singleFileGroupDelay.value || 1),
      download_status_update_interval: Number(el.downloadStatusUpdateInterval && el.downloadStatusUpdateInterval.value || 5),
      download_progress_poll_interval: Number(el.downloadProgressPollInterval && el.downloadProgressPollInterval.value || 1),
      admin_progress_poll_interval: Number(el.adminProgressPollInterval && el.adminProgressPollInterval.value || 0.5),
    },
    download_history: {
      retention_unlimited: retentionUnlimited,
      retention_days: retentionUnlimited ? null : Number(el.historyRetentionDays.value || 30),
      max_records_unlimited: recordsUnlimited,
      max_records: recordsUnlimited ? null : Number(el.historyMaxRecords.value || 1000),
    },
  };
  el.saveHistorySettings.disabled = true;
  if (el.historySettingsStatus) el.historySettingsStatus.textContent = t("settings.saving");
  try {
    const response = await postJson("/api/settings", payload);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    applyHistorySettings(data);
    renderHistorySettingsStatus(data);
    if (el.historySettingsStatus) el.historySettingsStatus.textContent = t("settings.saved");
    await refresh();
  } catch (error) {
    if (el.historySettingsStatus) {
      el.historySettingsStatus.textContent = t("settings.save_failed", { message: error.message });
    }
  } finally {
    el.saveHistorySettings.disabled = false;
  }
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
    const [response, historyResponse] = await Promise.all([
      fetch("/api/overview", { headers: requestHeaders() }),
      fetch("/api/download-history?limit=50", { headers: requestHeaders() }),
    ]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!historyResponse.ok) throw new Error(`HTTP ${historyResponse.status}`);
    const data = await response.json();
    const history = await historyResponse.json();
    render(data, history);
    setConnection(true, t("connection.connected"));
  } catch (error) {
    setConnection(false, t("connection.failed", { message: error.message }));
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
    setConnection(false, t("connection.paused"));
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
if (el.languageSelect) {
  el.languageSelect.value = currentLanguage;
  el.languageSelect.addEventListener("change", () => {
    currentLanguage = normalizeLanguage(el.languageSelect.value) || "en";
    localStorage.setItem(languageStorageKey, currentLanguage);
    applyLanguage();
    renderChart();
    refresh();
  });
}
applyLanguage();
if (el.sidebarToggle) {
  el.sidebarToggle.addEventListener("click", () => {
    sidebarCollapsed = !sidebarCollapsed;
    localStorage.setItem(sidebarCollapsedStorageKey, String(sidebarCollapsed));
    applySidebarState();
  });
}
if (el.themeSelect) {
  el.themeSelect.value = currentThemeMode;
  el.themeSelect.addEventListener("change", () => {
    currentThemeMode = normalizeThemeMode(el.themeSelect.value) || "auto";
    localStorage.setItem(themeStorageKey, currentThemeMode);
    applyTheme();
  });
}
themeMediaQuery.addEventListener("change", () => {
  if (currentThemeMode === "auto") {
    applyTheme();
  }
});
applyTheme();
el.refreshInterval.addEventListener("change", startLoops);
el.refreshEnabled.addEventListener("change", startLoops);
if (el.historyRetentionUnlimited) {
  el.historyRetentionUnlimited.addEventListener("change", () => {
    if (el.historyRetentionDays) el.historyRetentionDays.disabled = el.historyRetentionUnlimited.checked;
  });
}
if (el.historyMaxRecordsUnlimited) {
  el.historyMaxRecordsUnlimited.addEventListener("change", () => {
    if (el.historyMaxRecords) el.historyMaxRecords.disabled = el.historyMaxRecordsUnlimited.checked;
  });
}
if (el.saveHistorySettings) {
  el.saveHistorySettings.addEventListener("click", saveHistorySettings);
}
document.addEventListener("visibilitychange", startLoops);
window.addEventListener("pagehide", sendStopHeartbeat);
window.addEventListener("beforeunload", sendStopHeartbeat);
window.addEventListener("freeze", sendStopHeartbeat);
window.addEventListener("resize", renderChart);
startLoops();
