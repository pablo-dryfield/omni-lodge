import { Fault } from "./types.js";
export function decodeText(bytes: Buffer) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Fault(
      415,
      "BINARY_FILE",
      "This file is not valid UTF-8. Download it instead.",
    );
  }
  if (text.includes("\0"))
    throw new Fault(415, "BINARY_FILE", "Binary files cannot be edited.");
  const endings = new Set(text.match(/\r\n|\r|\n/g) || []);
  const newline =
    endings.size > 1
      ? "mixed"
      : endings.has("\r\n")
        ? "CRLF"
        : endings.has("\r")
          ? "CR"
          : "LF";
  return {
    text,
    bom: bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])),
    newline,
  };
}
