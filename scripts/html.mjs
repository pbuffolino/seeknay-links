import { parse } from "parse5";

export function elements(source) {
  const result = [];
  function visit(node) {
    if (node.tagName) result.push(node);
    for (const child of node.childNodes || []) visit(child);
    if (node.content) visit(node.content);
  }
  visit(parse(source));
  return result;
}
export const attributes = (node) =>
  Object.fromEntries(node.attrs.map(({ name, value }) => [name, value]));
export const text = (node) => (node.childNodes || []).map((child) => child.value || "").join("");

function decodeEmail(encoded) {
  if (!/^(?:[a-f0-9]{2}){2,}$/i.test(encoded || "")) throw new Error("Invalid email encoding");
  const bytes = Buffer.from(encoded, "hex");
  return Buffer.from(bytes.subarray(1).map((value) => value ^ bytes[0])).toString("utf8");
}
export function publicHtmlFingerprint(source) {
  function canonical(node) {
    if (node.nodeName === "#comment") return null;
    if (node.nodeName === "#text") return node.value.trim() ? ["text", node.value] : null;
    const attrs = node.attrs ? attributes(node) : {};
    // Normalize only the known Cloudflare email-protection transformation.
    if (
      node.tagName === "script" &&
      /^\/cdn-cgi\/scripts\/[a-f0-9]{8}\/cloudflare-static\/email-decode\.min\.js$/.test(
        attrs.src || ""
      ) &&
      attrs["data-cfasync"] === "false" &&
      Object.keys(attrs).length === 2 &&
      !text(node).trim()
    )
      return null;
    if (
      node.tagName === "span" &&
      attrs.class === "__cf_email__" &&
      Object.keys(attrs).length === 2 &&
      attrs["data-cfemail"]
    )
      return ["text", decodeEmail(attrs["data-cfemail"])];
    if (node.tagName === "a" && attrs.href?.startsWith("/cdn-cgi/l/email-protection#"))
      attrs.href = "mailto:" + decodeEmail(attrs.href.split("#")[1]);
    return [
      node.tagName || node.nodeName,
      Object.entries(attrs).sort(([left], [right]) => left.localeCompare(right)),
      (node.childNodes || []).map(canonical).filter(Boolean),
      node.content ? canonical(node.content) : null,
    ];
  }
  return JSON.stringify(canonical(parse(source)));
}
