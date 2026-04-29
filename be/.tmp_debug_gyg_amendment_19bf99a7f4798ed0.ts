import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: ".env.dev" });

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

const main = async () => {
  const client = new pg.Client();
  await client.connect();
  const rs = await client.query(
    "SELECT raw_payload FROM booking_emails WHERE message_id = $1 LIMIT 1",
    ["19bf99a7f4798ed0"],
  );
  if (rs.rowCount === 0) {
    console.log("not found");
    await client.end();
    return;
  }
  const raw = rs.rows[0].raw_payload;
  const parsed = JSON.parse(raw);
  const payload = parsed?.payload;
  const out = { text: [] as string[], html: [] as string[] };
  collectBodies(payload, out);

  console.log("text parts:", out.text.length, "html parts:", out.html.length);
  const text = out.text.join("\n\n");
  const html = out.html.join("\n\n");

  const needles = [
    "participant",
    "participants",
    "adult",
    "traveller",
    "traveler",
    "removed",
    "changed",
    "new",
    "old",
    "booking has changed",
    "number of",
  ];

  const source = (text || html || "").replace(/\s+/g, " ");
  console.log("source length", source.length);
  for (const needle of needles) {
    const idx = source.toLowerCase().indexOf(needle.toLowerCase());
    console.log(needle, idx);
    if (idx >= 0) {
      console.log(source.slice(Math.max(0, idx - 120), Math.min(source.length, idx + 220)));
      console.log("---");
    }
  }

  const preview = source.slice(0, 5000);
  console.log("PREVIEW_START\n" + preview + "\nPREVIEW_END");

  await client.end();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
