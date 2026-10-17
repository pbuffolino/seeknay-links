import { test } from "node:test";
import assert from "node:assert/strict";
import { elements, attributes, text, publicHtmlFingerprint } from "../scripts/html.mjs";
import { parseTikTokProfile } from "../scripts/update-social-metrics.mjs";

test("HTML parser recognizes uppercase tags, end-tag attributes, templates, and quoted angle brackets", () => {
  const nodes = elements(
    '<template><SCRIPT data-value=">" data-src="fake">alert(1)</SCRIPT foo="bar"></template>'
  );
  const script = nodes.find((node) => node.tagName === "script");
  assert.equal(text(script), "alert(1)");
  assert.equal(attributes(script).src, undefined);
  assert.equal(attributes(script)["data-value"], ">");
});
test("TikTok JSON extraction accepts browser-recognized script end tags without executing code", () => {
  const data = {
    __DEFAULT_SCOPE__: {
      "webapp.user-detail": {
        userInfo: { user: { uniqueId: "test" }, stats: { followerCount: 12 } },
      },
    },
  };
  assert.equal(
    parseTikTokProfile(`<SCRIPT data-value=">">${JSON.stringify(data)}</SCRIPT foo="bar">`, "test"),
    12
  );
  assert.throws(() =>
    parseTikTokProfile("<script>throw new Error('never execute')</script >", "test")
  );
});
test("live HTML comparison normalizes Cloudflare email protection but catches other changes", () => {
  const original = '<a href="mailto:a@b.co"><span>a@b.co</span></a>';
  const encoded = Buffer.from(
    [17, ...Buffer.from("a@b.co")].map((byte, index) => (index ? byte ^ 17 : byte))
  ).toString("hex");
  const transformed = `<a href="/cdn-cgi/l/email-protection#${encoded}"><span><span class="__cf_email__" data-cfemail="${encoded}">protected</span></span></a><script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script>`;
  assert.equal(publicHtmlFingerprint(original), publicHtmlFingerprint(transformed));
  for (const modified of [
    transformed + "<script>alert(1)</script>",
    transformed.replace("a href", 'a onclick="alert(1)" href'),
    original.replace("a@b.co", "other@example.com"),
    transformed.replace("cloudflare-static", "other"),
  ])
    assert.notEqual(publicHtmlFingerprint(original), publicHtmlFingerprint(modified));
});
