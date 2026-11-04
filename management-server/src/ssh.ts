import ssh2 from "ssh2";
import type { Client as SSHClient, ClientChannel, SFTPWrapper } from "ssh2";
const { Client } = ssh2;
type Client = SSHClient;
import dns from "node:dns/promises";
import net from "node:net";
import crypto from "node:crypto";
import { Fault, requireValue, type Connection } from "./types.js";

export function blockedAddress(address: string): boolean {
  const lower = address.toLowerCase();
  if (net.isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    return (
      parts[0] === 0 ||
      parts[0] >= 224 ||
      (parts[0] === 169 && parts[1] === 254)
    );
  }
  return (
    lower === "::" ||
    lower.startsWith("::ffff:") ||
    lower.startsWith("ff") ||
    /^fe[89ab]/.test(lower)
  );
}
async function verifyNonRoot(client: Client): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const fail = () => {
      client.destroy();
      reject(
        new Fault(
          403,
          "IDENTITY_UNVERIFIED",
          "A generic server must allow the fixed id -u capability probe and return a nonroot UID.",
        ),
      );
    };
    const timer = setTimeout(fail, 5000);
    timer.unref();
    client.exec("id -u", (error, channel) => {
      if (error) {
        clearTimeout(timer);
        fail();
        return;
      }
      let output = "";
      channel.on("data", (bytes: Buffer) => {
        output += bytes.toString();
        if (output.length > 32) {
          channel.close();
          clearTimeout(timer);
          fail();
        }
      });
      channel.once("close", (code: number) => {
        clearTimeout(timer);
        if (code === 0 && /^[1-9][0-9]*\s*$/.test(output)) resolve();
        else fail();
      });
      channel.once("error", () => {
        clearTimeout(timer);
        fail();
      });
    });
  });
}
export async function resolveTarget(connection: Connection): Promise<string> {
  const host = connection.host;
  requireValue(
    host.addresses.length > 0,
    403,
    "NETWORK_DENIED",
    "No permitted server address is enrolled.",
  );
  const addresses = net.isIP(host.hostname)
    ? [{ address: host.hostname }]
    : await dns.lookup(host.hostname, { all: true, verbatim: true });
  requireValue(
    addresses.length > 0 &&
      addresses.every((a) => host.addresses.includes(a.address)),
    403,
    "NETWORK_DENIED",
    "DNS returned an address outside the enrolled server policy.",
  );
  const address = addresses[0].address;
  requireValue(
    net.isIP(address) !== 0 && !blockedAddress(address),
    403,
    "NETWORK_DENIED",
    "This network destination is not permitted.",
  );
  return address;
}
export async function connect(connection: Connection): Promise<Client> {
  const address = await resolveTarget(connection),
    client = new Client();
  return new Promise((resolve, reject) => {
    let mismatch = false;
    client.once("ready", () => {
      if (connection.host.managed) resolve(client);
      else void verifyNonRoot(client).then(() => resolve(client), reject);
    });
    client.on("error", () => {
      client.destroy();
      reject(
        new Fault(
          502,
          mismatch ? "HOST_KEY_CHANGED" : "SSH_CONNECTION_FAILED",
          mismatch
            ? "The server host key does not match its enrolled fingerprint."
            : "SSH connection failed. Check reachability and the assigned credential.",
        ),
      );
    });
    client.connect({
      host: address,
      port: connection.host.port,
      username: connection.username,
      ...connection.credential,
      readyTimeout: 15000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 3,
      hostVerifier: (key: Buffer) => {
        const fingerprint = `SHA256:${crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
        const valid = connection.host.fingerprints.includes(fingerprint);
        mismatch = !valid;
        return valid;
      },
      agentForward: false,
      tryKeyboard: false,
    });
  });
}
export function guardSftpStreams(s: SFTPWrapper) {
  const read = s.createReadStream.bind(s),
    write = s.createWriteStream.bind(s);
  // ssh2 can emit a delayed CLOSE error after an iterator has completed and the
  // connection is ending. Consumers still observe in-flight errors through their
  // iterator/pipeline; this listener also owns errors from late handle cleanup.
  s.createReadStream = ((...args: Parameters<typeof read>) => {
    const stream = read(...args);
    stream.on("error", () => {});
    return stream;
  }) as typeof s.createReadStream;
  s.createWriteStream = ((...args: Parameters<typeof write>) => {
    const stream = write(...args);
    stream.on("error", () => {});
    return stream;
  }) as typeof s.createWriteStream;
  return s;
}
export async function sftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) =>
    client.sftp((err, s) =>
      err
        ? reject(
            new Fault(
              502,
              "SFTP_UNAVAILABLE",
              "SFTP is unavailable for this server identity.",
            ),
          )
        : (() => {
            s.on("error", () => client.destroy());
            resolve(guardSftpStreams(s));
          })(),
    ),
  );
}
export async function execAdapter(
  client: Client,
  ticket: string,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) =>
    client.exec("omnilodge-system-v1", (err, stream) => {
      if (err) {
        reject(
          new Fault(
            502,
            "ADAPTER_UNAVAILABLE",
            "Managed host adapter unavailable.",
          ),
        );
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      const timer = setTimeout(() => {
        stream.close();
        reject(
          new Fault(
            504,
            "OUTCOME_UNKNOWN",
            "Adapter outcome was not confirmed.",
          ),
        );
      }, 30000);
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 4194304) {
          stream.close();
          reject(
            new Fault(
              502,
              "OUTPUT_LIMIT",
              "Adapter output exceeded its limit.",
            ),
          );
        } else chunks.push(chunk);
      });
      stream.on("close", (code: number) => {
        clearTimeout(timer);
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString());
          if (code || result.error)
            reject(
              new Fault(
                409,
                result.code || "REMOTE_FAILED",
                result.error || "Managed operation failed.",
              ),
            );
          else resolve(result);
        } catch {
          reject(
            new Fault(
              502,
              "ADAPTER_FAILED",
              "Adapter did not return a valid result.",
            ),
          );
        }
      });
      stream.on("error", () => {
        clearTimeout(timer);
        reject(
          new Fault(
            502,
            "OUTCOME_UNKNOWN",
            "Adapter connection ended without a confirmed outcome.",
          ),
        );
      });
      stream.end(ticket + "\n");
    }),
  );
}
export async function shell(
  client: Client,
  cols: number,
  rows: number,
): Promise<ClientChannel> {
  return new Promise((resolve, reject) =>
    client.shell({ term: "xterm-256color", cols, rows }, (err, stream) =>
      err ? reject(err) : resolve(stream),
    ),
  );
}
