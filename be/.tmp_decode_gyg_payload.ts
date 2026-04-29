import fs from "fs";

const decodeBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLength);
  return Buffer.from(padded, "base64").toString("utf8");
};

const collectBodies = (node: any, out: { text: string[]; html: string[] }) => {
  if (!node || typeof node !== "object") return;
  const mimeType = String(node.mimeType ?? "").toLowerCase();
  const data = node?.body?.data;
  if (typeof data === "string" && data.length > 0) {
    const decoded = decodeBase64Url(data);
    if (mimeType.includes("text/plain")) out.text.push(decoded);
    if (mimeType.includes("text/html")) out.html.push(decoded);
  }
  const parts = Array.isArray(node.parts) ? node.parts : [];
  for (const part of parts) collectBodies(part, out);
};

const buf = fs.readFileSync(".tmp_19bf99a7f4798ed0_raw_payload.json");
let raw = buf.toString("utf8");
if (raw.includes("\u0000")) {
  raw = buf.toString("utf16le");
}
raw = raw.replace(/^\uFEFF/, "").trim();
const parsed = JSON.parse(raw);
const out = { text: [] as string[], html: [] as string[] };
collectBodies(parsed?.payload, out);

const src = (out.text.join("\n\n") + "\n\n" + out.html.join("\n\n")).replace(/\s+/g, " ");
const needles = ["participant", "participants", "adult", "traveller", "traveler", "removed", "changed", "old", "new", "booking has changed", "number of"]; 
console.log("text parts", out.text.length, "html parts", out.html.length, "src len", src.length);
for (const needle of needles) {
  const idx = src.toLowerCase().indexOf(needle.toLowerCase());
  console.log(needle, idx);
  if (idx >= 0) {
    console.log(src.slice(Math.max(0, idx - 150), Math.min(src.length, idx + 250)));
    console.log("---");
  }
}
fs.writeFileSync('.tmp_19bf99a7f4798ed0_flat.txt', src);
console.log('wrote flat');
