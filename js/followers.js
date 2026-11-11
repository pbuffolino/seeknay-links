let metricsRequest = null;
const networks = ["tiktok", "youtube", "instagram", "bluesky", "facebook"];
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en-US");
const validCount = (count) => Number.isSafeInteger(count) && count >= 0;
const STALE_MS = 48 * 60 * 60 * 1000;

window.updateSocialCounts = async () => {
  document.querySelector(".stats-card")?.removeAttribute("hidden");
  try {
    metricsRequest ||= fetch("assets/social-metrics.json", {
      cache: "no-cache",
      signal: AbortSignal.timeout(10000),
    }).then((response) => {
      if (!response.ok) throw new Error("Metrics unavailable");
      return response.json();
    });
    updateUI(await metricsRequest);
  } catch {
    const total = document.getElementById("total-followers");
    if (total) total.textContent = "Unavailable";
    const status = document.getElementById("metrics-status");
    if (status) {
      status.textContent = "Counts are temporarily unavailable.";
      status.hidden = false;
    }
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
    const date = Date.parse(metric?.lastSuccessAt);
    if (valid) total += metric.count;
    if (valid && Number.isFinite(date)) timestamps.push(date);
    else incomplete = true;
    const noun = network === "youtube" ? "subscribers" : "followers";
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
    // incomplete is set whenever timestamps is missing an entry, so Math.min is never empty here.
    const stale =
      incomplete ||
      Date.now() - Math.min(...timestamps) > STALE_MS ||
      networks.some((network) => data?.[network]?.lastError);
    status.textContent = stale ? "Cached counts." : "";
    status.hidden = !stale;
  }
}
window.updateSocialCounts();
