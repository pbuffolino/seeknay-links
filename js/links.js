const container = document.getElementById("links-container");
const status = document.getElementById("links-status");
const retry = document.getElementById("links-retry");

function validLink(link) {
  return (
    link &&
    typeof link.name === "string" &&
    link.name.length > 0 &&
    typeof link.url === "string" &&
    /^https?:\/\//.test(link.url) &&
    typeof link.icon === "string" &&
    /^(fa-brands|fa-solid) fa-[a-z-]+$/.test(link.icon) &&
    [0, 50, 100, 150, 200, 250].includes(link.delay) &&
    (link.networkId === null ||
      ["tiktok", "youtube", "instagram", "bluesky", "facebook"].includes(link.networkId))
  );
}

async function loadLinks() {
  if (!container) return;
  if (retry) retry.disabled = true;
  try {
    const response = await fetch("assets/links.json", {
      cache: "no-store",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Links unavailable");
    const links = await response.json();
    if (!Array.isArray(links) || !links.length || !links.every(validLink)) {
      throw new Error("Invalid links data");
    }
    const fragment = document.createDocumentFragment();
    for (const link of links) {
      const anchor = document.createElement("a");
      anchor.className = `link-button delay-${link.delay}`;
      anchor.href = link.url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.dataset.linkName = link.name;
      anchor.dataset.linkUrl = link.url;
      const main = document.createElement("span");
      main.className = "link-main";
      const icon = document.createElement("i");
      icon.className = `${link.icon} link-icon`;
      icon.setAttribute("aria-hidden", "true");
      const info = document.createElement("span");
      info.className = "link-info-group";
      const label = document.createElement("span");
      label.className = "link-label";
      label.textContent = link.name;
      info.append(label);
      if (link.networkId) {
        const count = document.createElement("span");
        count.className = "link-followers";
        count.dataset.network = link.networkId;
        info.append(count);
      }
      const arrow = document.createElement("i");
      arrow.className = "fa-solid fa-arrow-up-right-from-square link-arrow";
      arrow.setAttribute("aria-hidden", "true");
      main.append(icon, info);
      anchor.append(main, arrow);
      fragment.append(anchor);
    }
    container.replaceChildren(fragment);
    if (status) status.hidden = true;
    window.updateSocialCounts?.();
  } catch {
    if (status) status.hidden = false;
  } finally {
    if (retry) retry.disabled = false;
  }
}
retry?.addEventListener("click", loadLinks);
loadLinks();
