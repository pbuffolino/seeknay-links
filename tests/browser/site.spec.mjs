import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs/promises";

const links = JSON.parse(await fs.readFile("assets/links.json", "utf8"));
test.beforeEach(async ({ page }) => {
  await page.route("https://www.googletagmanager.com/**", (route) =>
    route.fulfill({ body: "", contentType: "text/javascript" })
  );
});
for (const colorScheme of ["light", "dark"]) {
  test(`${colorScheme} theme is accessible and has no CSP violations`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.cspViolations = [];
      document.addEventListener("securitypolicyviolation", (event) =>
        window.cspViolations.push(event.violatedDirective)
      );
    });
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    await expect(page.locator("#links-container a")).toHaveCount(links.length);
    await expect(page.locator("#total-followers")).not.toHaveText("Loading...");
    await expect(page.locator("#cookie-consent-banner")).toBeVisible();
    const accessibility = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    expect(await page.evaluate(() => window.cspViolations)).toEqual([]);
    expect(errors).toEqual([]);
    await page
      .getByRole("button", {
        name: colorScheme === "dark" ? "Switch to light mode" : "Switch to dark mode",
      })
      .click();
    await expect(page.locator("body")).toHaveClass(colorScheme === "dark" ? "" : "dark-mode");
  });
}
test("saved navigation survives failed and invalid JSON, and retry recovers", async ({ page }) => {
  let failure = true;
  await page.route("**/assets/links.json", (route) =>
    failure ? route.fulfill({ status: 503, body: "unavailable" }) : route.continue()
  );
  await page.goto("/");
  await expect(page.locator("#links-status")).toBeVisible();
  for (const link of links)
    await expect(
      page.locator("#links-container").getByRole("link", { name: link.name, exact: false })
    ).toHaveAttribute("href", link.url);
  failure = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator("#links-status")).toBeHidden();
  await page.route("**/assets/links.json", (route) =>
    route.fulfill({ json: [{ name: "Injected", url: "javascript:alert(1)" }] })
  );
  await page.reload();
  await expect(page.locator("#links-status")).toBeVisible();
  await expect(page.locator("#links-container a")).toHaveCount(links.length);
});
test("consent works with storage disabled and can be revoked", async ({ page }) => {
  let loads = 0;
  await page.route("https://www.googletagmanager.com/**", (route) => {
    loads++;
    return route.fulfill({ body: "", contentType: "text/javascript" });
  });
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException("Unavailable", "SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("Unavailable", "SecurityError");
    };
  });
  await page.goto("/");
  expect(loads).toBe(0);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect.poll(() => loads).toBe(1);
  await page.getByRole("button", { name: "Privacy settings" }).click();
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  expect(await page.evaluate(() => window["ga-disable-G-C9JSC7H6WW"])).toBe(true);
  expect(await page.evaluate(() => typeof window.gtag)).toBe("undefined");
  await expect(page.locator("#cookie-consent-banner")).toBeHidden();
});
test("declining analytics persists and privacy settings remains available", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await page.reload();
  await expect(page.locator("#cookie-consent-banner")).toBeHidden();
  expect(await page.locator('script[src*="googletagmanager"]').count()).toBe(0);
  await page.getByRole("button", { name: "Privacy settings" }).click();
  await expect(page.locator("#cookie-consent-banner")).toBeVisible();
});
test("no JavaScript keeps all navigation and hides unavailable dynamic controls", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4175/");
  await expect(page.locator("#links-container a")).toHaveCount(links.length);
  await expect(page.locator(".stats-card")).toBeHidden();
  await expect(page.locator("#privacy-settings")).toBeHidden();
  await context.close();
});
test("nested 404 loads its assets and stays on the missing URL", async ({ page }) => {
  const assets = [];
  await page.route("https://links.seeknay.com/**", async (route) => {
    const url = new URL(route.request().url());
    assets.push(url.pathname);
    const response = await page.request.get("http://127.0.0.1:4175" + url.pathname);
    await route.fulfill({ response });
  });
  const response = await page.goto("https://links.seeknay.com/missing/nested/path");
  expect(response.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  expect(assets).toContain("/css/styles.css");
  expect(await page.locator('meta[http-equiv="refresh"]').count()).toBe(0);
  await expect(page.getByRole("link", { name: "Back to seeknay's Links" })).toHaveAttribute(
    "href",
    "https://links.seeknay.com/"
  );
});
test("failed metrics show an explicit unavailable state", async ({ page }) => {
  await page.route("**/assets/social-metrics.json", (route) => route.fulfill({ status: 503 }));
  await page.goto("/");
  await expect(page.locator("#total-followers")).toHaveText("Unavailable");
  await expect(page.locator("#metrics-status")).toBeVisible();
  await expect(page.locator("#metrics-status")).toContainText("temporarily unavailable");
});
test("mobile layout fits and clipboard sharing gives feedback", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => Object.defineProperty(navigator, "share", { value: undefined }));
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Share Profile" }).click();
  await expect(page.locator("#ui-toast")).toHaveText("Link copied to clipboard!");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("http://127.0.0.1:4175/");
});

test("saved acceptance loads analytics once and revocation survives reload", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("consent-test-initialized")) {
      localStorage.setItem("analytics_consent", "granted");
      sessionStorage.setItem("consent-test-initialized", "true");
    }
  });
  await page.goto("/");
  await expect(page.locator('script[src*="googletagmanager"]')).toHaveCount(1);
  await page.evaluate(() => {
    document.cookie = "_ga=test;path=/";
  });
  await page.getByRole("button", { name: "Privacy settings" }).click();
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  expect(await page.evaluate(() => document.cookie)).not.toContain("_ga=");
  await page.reload();
  await expect(page.locator('script[src*="googletagmanager"]')).toHaveCount(0);
  await expect(page.locator("#cookie-consent-banner")).toBeHidden();
});

test("HTML requests versioned assets even when unversioned copies are stale", async ({ page }) => {
  let staleRequests = 0;
  await page.route(/\/(?:js\/[\w.-]+\.js|css\/styles\.css)(?:\?|$)/, (route) => {
    if (!new URL(route.request().url()).searchParams.has("v")) {
      staleRequests++;
      return route.fulfill({
        contentType: "text/javascript",
        body: "throw new Error('stale asset')",
      });
    }
    return route.continue();
  });
  await page.goto("/");
  await expect(page.locator("#links-container a")).toHaveCount(links.length);
  await expect(page.getByRole("button", { name: "Privacy settings" })).toBeVisible();
  expect(staleRequests).toBe(0);
});
