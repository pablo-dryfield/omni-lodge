import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { Fault, type Context, type Connection, type Action } from "./types.js";

export class Authority {
  constructor(
    private socket: string,
    private secret: string,
  ) {}
  static async fromEnvironment() {
    if (
      !process.env.SYSTEM_MANAGEMENT_AUTHORITY_SOCKET ||
      !process.env.SYSTEM_MANAGEMENT_RPC_SECRET_FILE
    )
      throw new Error("Authority bootstrap is required.");
    return new Authority(
      process.env.SYSTEM_MANAGEMENT_AUTHORITY_SOCKET,
      (
        await fs.readFile(process.env.SYSTEM_MANAGEMENT_RPC_SECRET_FILE, "utf8")
      ).trim(),
    );
  }
  async rpc<T = Record<string, unknown>>(
    method: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const body = Buffer.from(JSON.stringify({ method, args })),
      time = String(Date.now()),
      nonce = crypto.randomBytes(24).toString("base64url");
    const signature = crypto
      .createHmac("sha256", this.secret)
      .update(`${time}\n${nonce}\n`)
      .update(body)
      .digest("hex");
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          socketPath: this.socket,
          path: "/rpc",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": body.length,
            "X-Management-Time": time,
            "X-Management-Nonce": nonce,
            "X-Management-Signature": signature,
          },
          timeout: 10000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (c: Buffer) => {
            size += c.length;
            if (size > 1048576) {
              res.destroy();
              reject(
                new Fault(
                  503,
                  "AUTHORITY_UNAVAILABLE",
                  "Authority response exceeded its limit.",
                ),
              );
            } else chunks.push(c);
          });
          res.on("end", () => {
            try {
              const data = JSON.parse(Buffer.concat(chunks).toString());
              if ((res.statusCode || 500) >= 400)
                reject(
                  new Fault(
                    res.statusCode || 503,
                    data.code || "AUTHORITY_UNAVAILABLE",
                    data.message || "Authority unavailable.",
                  ),
                );
              else resolve(data);
            } catch {
              reject(
                new Fault(
                  503,
                  "AUTHORITY_UNAVAILABLE",
                  "Authority unavailable.",
                ),
              );
            }
          });
          res.on("error", () =>
            reject(
              new Fault(503, "AUTHORITY_UNAVAILABLE", "Authority unavailable."),
            ),
          );
        },
      );
      req.on("timeout", () => req.destroy());
      req.on("error", () =>
        reject(
          new Fault(
            503,
            "AUTHORITY_UNAVAILABLE",
            "Administration authority is unavailable.",
          ),
        ),
      );
      req.end(body);
    });
  }
  check(session: string, action: Action = "view") {
    return this.rpc<Context>("check", { session, action });
  }
  connection(
    session: string,
    hostId: string,
    kind: "terminal" | "sftp",
    action: Action,
  ) {
    return this.rpc<Connection>("connection", {
      session,
      hostId,
      kind,
      action,
    });
  }
  async ticket(
    session: string,
    hostId: string,
    operation: string,
    params: unknown,
    action: Action,
  ) {
    return (
      await this.rpc<{ ticket: string }>("envelope", {
        session,
        hostId,
        operation,
        params,
        action,
      })
    ).ticket;
  }
}
