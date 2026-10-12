let metricsData = null;
let metricsRequest = null;
const networks = ["tiktok", "youtube", "instagram", "bluesky", "facebook"];
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en-US");
const validCount = (count) => Number.isSafeInteger(count) && count >= 0;

window.updateSocialCounts = async () => {
  document.querySelector(".stats-card")?.removeAttribute("hidden");
  try {
    if (!metricsData) {
      metricsRequest ||= fetch("assets/social-metrics.json", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      }).then((response) => {
        if (!response.ok) throw new Error("Metrics unavailable");
        return response.json();
      });
      metricsData = await metricsRequest;
    }
    updateUI(metricsData);
  } catch {
    const total = document.getElementById("total-followers");
    if (total) total.textContent = "Unavailable";
    const status = document.getElementById("metrics-status");
    if (status) status.textContent = "Counts are temporarily unavailable.";
    metricsRequest = null;
  }
};

function updateUI(data) {
  let total = 0;
  const timestamps = [];
  let incomplete = false;
  for (const network of networks) {
    const metric = data?.[network];
    const valid = validCount(metric?.count);
    if (valid) total += metric.count;
    else incomplete = true;
    const noun = network === "youtube" ? "subscribers" : "followers";
    const date = Date.parse(metric?.lastSuccessAt);
    if (valid && Number.isFinite(date)) timestamps.push(date);
    else incomplete = true;
    document.querySelectorAll(`[data-network="${network}"]`).forEach((element) => {
      element.textContent = valid
        ? element.classList.contains("stat-mini-count")
          ? compact.format(metric.count)
          : `${full.format(metric.count)} ${noun}`
        : "Unavailable";
      if (Number.isFinite(date))
        element.title = `Last successful update: ${new Date(date).toLocaleString()}`;
    });
  }
  const totalEl = document.getElementById("total-followers");
  if (totalEl)
    totalEl.textContent = incomplete ? `${compact.format(total)} (partial)` : compact.format(total);
  const status = document.getElementById("metrics-status");
  if (status) {
    const oldest = timestamps.length ? Math.min(...timestamps) : null;
    const stale =
      incomplete ||
      oldest === null ||
      Date.now() - oldest > 48 * 60 * 60 * 1000 ||
      networks.some((network) => data?.[network]?.lastError);
    status.textContent =
      oldest === null
        ? "Cached counts; update time unavailable."
        : `${stale ? "Cached counts. " : ""}Oldest successful update: ${new Date(oldest).toLocaleDateString()}. Counts may include the same people on multiple platforms.`;
  }
}
window.updateSocialCounts();
