import {Recordings,type RecordingBuffer} from './recordings.js';
import crypto from "node:crypto";
import type { Client, ClientChannel } from "ssh2";
import type { WebSocket } from "ws";
import { Authority } from "./authority.js";
import { Store, type Job } from "./store.js";
import { connect, shell, execAdapter } from "./ssh.js";
import { Fault, requireValue, limit, type Context } from "./types.js";

type TerminalSession = {
  recording?:RecordingBuffer; recordingContext:Context;
  id: string;
  actorId: number;
  hostId: string;
  session: string;
  initialSession:string;
  client: Client;
  channel: ClientChannel;
  job: Job;
  sequence: number;
  acked: number;
  frames: { sequence: number; bytes: Buffer }[];
  buffered: number;
  socket?: WebSocket;
  attachment: number;
  detached?: NodeJS.Timeout;
  timer: NodeJS.Timeout;
  lastInput: number;
  ringLimit: number;
  managed: boolean;
  stopCapability: string;
  closing: boolean;
};
export class Terminals {
  private sessions = new Map<string, TerminalSession>();
  private pending = new Map<number, number>();
  private tickets = new Map<
    string,
    {
      id: string;
      actorId: number;
      session: string;
      expires: number;
      takeover: boolean;
    }
  >();
  constructor(
    private authority: Authority,
    private store: Store,
    private recordings:Recordings,
  ) {}
  async create(
    session: string,
    ctx: Context,
    hostId: string,
    cols = 100,
    rows = 28,
  ) {
    requireValue(
      this.sessions.size +
        [...this.pending.values()].reduce((a, b) => a + b, 0) <
        limit(ctx, "TERMINAL_LIMITS", "total", 4),
      429,
      "CAPACITY_EXCEEDED",
      "The terminal limit has been reached.",
    );
    requireValue(
      [...this.sessions.values()].filter((t) => t.actorId === ctx.actorId)
        .length +
        (this.pending.get(ctx.actorId) || 0) <
        limit(ctx, "TERMINAL_LIMITS", "perActor", 2),
      429,
      "CAPACITY_EXCEEDED",
      "Close another terminal before opening a new one.",
    );
    requireValue(
      Number.isInteger(cols) &&
        cols >= 10 &&
        cols <= 500 &&
        Number.isInteger(rows) &&
        rows >= 2 &&
        rows <= 200,
      400,
      "INVALID_PTY",
      "Invalid terminal dimensions.",
    );
    this.pending.set(ctx.actorId, (this.pending.get(ctx.actorId) || 0) + 1);
    try {
      const connection = await this.authority.connection(
        session,
        hostId,
        "terminal",
        "connectTerminal",
      );
      const job = await this.store.create(ctx.actorId, hostId, "terminal", {});
      const client=await connect(connection).catch(async error=>{await this.store.update(job,"failed");throw error;});
      const stopCapability = crypto.randomBytes(32).toString("base64url");
    let terminalForNotice:TerminalSession|undefined;
    let recording:RecordingBuffer|undefined;
      let channel: ClientChannel;
      try {
        recording=await this.recordings.create(ctx,hostId,job.id,message=>{if(terminalForNotice)this.send(terminalForNotice,{type:"recordingNotice",message});});
        if (connection.host.managed) {
          const ticket = await this.authority.ticket(
            session,
            hostId,
            "terminal",
            { sessionId: job.id, cols, rows, stopCapability },
            "connectTerminal",
          );
          channel = await new Promise((resolve, reject) =>
            client.exec(
              "omnilodge-system-v1",
              { pty: { term: "xterm-256color", cols, rows, modes:{ECHO:0,ICANON:0,ISIG:0} } },
              (err, stream) => {
                if (err) reject(err);
                else {
                  stream.write(ticket + "\n");
                  resolve(stream);
                }
              },
            ),
          );
        } else channel = await shell(client, cols, rows);
      } catch (error) {
        client.end();
        if(recording){recording.truncated=true;await recording.finish().catch(()=>{});}
        await this.store.update(job, "failed");
        throw error;
      }
      const terminal: TerminalSession = {
      recording,recordingContext:ctx,
        id: job.id,
        actorId: ctx.actorId,
        hostId,
        session,
        initialSession:session,
        client,
        channel,
        job,
        sequence: 0,
        acked: 0,
        frames: [],
        buffered: 0,
        attachment: 0,
        timer: undefined as unknown as NodeJS.Timeout,
        lastInput: Date.now(),
        ringLimit: limit(ctx, "TERMINAL_LIMITS", "ringBytes", 2097152),
        managed: connection.host.managed,
        stopCapability,
        closing: false,
      };
      terminalForNotice=terminal;
    this.sessions.set(terminal.id, terminal);
    terminal.detached=setTimeout(()=>void this.close(terminal,"closed"),limit(ctx,"SESSION_POLICY","detachSeconds",120)*1000);
      terminal.timer = setInterval(() => void this.validate(terminal).catch(()=>{}), 15000);
      channel.on("data", (bytes: Buffer) => this.output(terminal, bytes));
      channel.stderr.on("data", (bytes: Buffer) =>
        this.output(terminal, bytes),
      );
      channel.on("close", (code: number, signal: string) => {
        this.send(terminal, {
          type: "exit",
          code: typeof code === "number" ? code : null,
          signal: signal || null,
        });
        void this.close(terminal, "closed").catch(()=>{});
      });
      channel.on("error", () => void this.close(terminal, "transport_lost"));
      client.on("close", () => void this.close(terminal, "transport_lost"));
      await this.store.update(job, "active", { managed: terminal.managed,recording:Boolean(recording) });
      return { id: terminal.id, hostId, managed: terminal.managed,recording:Boolean(recording) };
    } finally {
      this.pending.set(ctx.actorId, (this.pending.get(ctx.actorId) || 1) - 1);
    }
  }
  private async validate(t: TerminalSession) {
    try {
      await this.authority.check(t.initialSession,"connectTerminal");
      const ctx = await this.authority.check(t.session, "connectTerminal");
      if (
        Date.now() - t.lastInput >
        limit(ctx, "SESSION_POLICY", "idleSeconds", 900) * 1000
      )
        throw new Fault(401, "EXPIRED", "Terminal idle timeout.");
      if (!ctx.stepUpUntil || Date.parse(ctx.stepUpUntil) < Date.now()) {
        this.send(t, {
          type: "locked",
          message: "Confirm your password to continue.",
        });
        return;
      }
      if (t.managed) {
        const ticket = await this.authority.ticket(
          t.session,
          t.hostId,
          "renew",
          { sessionId: t.id },
          "connectTerminal",
        );
        await execAdapter(t.client, ticket);
      }
    } catch {
      this.send(t, {
        type: "error",
        code: "AUTHORITY_REVOKED",
        message: "Terminal authorization ended.",
      });
      await this.close(t, "expired");
    }
  }
  private send(t: TerminalSession, value: unknown) {
    if (t.socket?.readyState === 1) t.socket.send(JSON.stringify(value));
  }
  private output(t: TerminalSession, bytes: Buffer) {
    if (t.closing) return;
    t.recording?.append(bytes);
    const sequence = ++t.sequence;
    t.frames.push({ sequence, bytes: Buffer.from(bytes) });
    t.buffered += bytes.length;
    while (t.buffered > t.ringLimit && t.frames.length) {
      const discarded = t.frames.shift()!;
      t.buffered -= discarded.bytes.length;
    }
    this.send(t, { type: "output", sequence, data: bytes.toString("base64") });
    if (
      t.socket &&
      (t.socket.bufferedAmount > 262144 || t.sequence - t.acked > 128)
    )
      t.channel.pause();
  }
  async ticket(session: string, ctx: Context, id: string, takeover = false) {
    const t = this.sessions.get(id);
    requireValue(
      t && t.actorId === ctx.actorId,
      404,
      "NOT_FOUND",
      "Terminal is no longer available.",
    );
    requireValue(
      !t.socket || takeover,
      409,
      "ATTACHMENT_EXISTS",
      "This terminal is open in another tab. Choose Take over.",
    );
    await this.authority.check(t.initialSession,"connectTerminal");
    const token = crypto.randomBytes(32).toString("base64url");
    for (const [key, value] of this.tickets)
      if (value.expires < Date.now()) this.tickets.delete(key);
    this.tickets.set(crypto.createHash("sha256").update(token).digest("hex"), {
      id,
      actorId: ctx.actorId,
      session,
      expires: Date.now() + 15000,
      takeover,
    });
    return { ticket: token };
  }
  async attach(socket: WebSocket, session: string, input: unknown) {
    const data = input as { ticket?: string; after?: number; fresh?: boolean };
    const key = crypto
      .createHash("sha256")
      .update(data.ticket || "")
      .digest("hex");
    // Tickets live only for the active broker generation. Never persist bearer values.
    const ticket = data.ticket ? this.tickets.get(key) : undefined;
    if (data.ticket) this.tickets.delete(key);
    requireValue(
      ticket && ticket.session === session && ticket.expires > Date.now(),
      401,
      "INVALID_TICKET",
      "Stream ticket expired or already used.",
    );
    const ctx = await this.authority.check(session, "connectTerminal"),
      t = this.sessions.get(ticket.id);
    requireValue(
      t && t.actorId === ctx.actorId,
      404,
      "NOT_FOUND",
      "Terminal is no longer available.",
    );
    if (t.socket) {
      requireValue(
        ticket.takeover,
        409,
        "ATTACHMENT_EXISTS",
        "Terminal already attached.",
      );
      t.socket.close(4001, "Terminal taken over.");
    }
    t.session=session;
    t.attachment++;
    const generation = t.attachment;
    clearTimeout(t.detached);
    t.socket = socket;
    t.acked = Number.isSafeInteger(data.after)
      ? Math.max(0, Number(data.after))
      : t.sequence;
    const completeReplay = t.frames.length === 0 || t.frames[0]?.sequence === 1;
    const canReplay = data.fresh !== true || completeReplay;
    if (data.fresh === true && completeReplay) t.acked = 0;
    this.send(t, {
      type: "attached",
      id: t.id,
      generation,
      fresh: data.fresh === true,
      sequence: t.sequence,
      screenRestored: canReplay,
    });
    if (canReplay) {
      const first = t.frames[0]?.sequence || t.sequence + 1;
      if (t.acked < first - 1)
        this.send(t, {
          type: "gap",
          message: "Some terminal output is no longer retained.",
        });
      else
        for (const frame of t.frames)
          if (frame.sequence > t.acked)
            this.send(t, {
              type: "output",
              sequence: frame.sequence,
              data: frame.bytes.toString("base64"),
            });
    }
    t.channel.resume();
    let inputBytes = 0,
      inputWindow = Date.now();
    let messageQueue = Promise.resolve(),pendingMessages=0,pendingBytes=0,lastInputSequence=0;
    let lastCheck=Date.now(),cachedContext=ctx;
    socket.on("message", (raw) => {
      const size=Buffer.byteLength(raw.toString());
      if(pendingMessages>=128 || pendingBytes+size>262144){socket.close(1008,'Terminal input queue is full; unacknowledged input was not replayed.');return;}
      pendingMessages++;pendingBytes+=size;
      messageQueue = messageQueue
        .then(async () => {
          if (t.attachment !== generation || t.socket !== socket) return;
          const m = JSON.parse(raw.toString());
          if (m.type === "renderAck" && Number.isSafeInteger(m.sequence)) {
            t.acked = Math.max(t.acked, Math.min(m.sequence, t.sequence));
            if (socket.bufferedAmount < 65536) t.channel.resume();
            return;
          }
          if (m.type === "heartbeat") {
            this.send(t, { type: "heartbeat" });
            return;
          }
          if(Date.now()-lastCheck>1000){cachedContext=await this.authority.check(session,"connectTerminal");lastCheck=Date.now();}
          const fresh=cachedContext;
          if(t.attachment!==generation || t.socket!==socket)return;
          requireValue(
            fresh.stepUpUntil && Date.parse(fresh.stepUpUntil) > Date.now(),
            401,
            "STEP_UP_REQUIRED",
            "Confirm your password to send terminal input.",
          );
          if (m.type === "input") {
            requireValue(
              typeof m.data === "string" && Buffer.byteLength(m.data) <= 65536,
              413,
              "TOO_LARGE",
              "Terminal input is too large.",
            );
            if (Date.now() - inputWindow > 1000) {
              inputWindow = Date.now();
              inputBytes = 0;
            }
            inputBytes += Buffer.byteLength(m.data);
            requireValue(
              inputBytes <= 131072,
              429,
              "RATE_LIMITED",
              "Terminal input rate exceeded.",
            );
            requireValue(Number.isSafeInteger(m.sequence)&&m.sequence>lastInputSequence,409,'INPUT_SEQUENCE','Input was already acknowledged or is out of order. Do not replay uncertain keystrokes.');
            lastInputSequence=m.sequence;
            t.lastInput = Date.now();
            t.channel.write(m.data);
            this.send(t, { type: "inputAck", sequence: m.sequence });
          } else if (
            m.type === "resize" &&
            Number.isInteger(m.cols) &&
            Number.isInteger(m.rows) &&
            m.cols >= 10 &&
            m.cols <= 500 &&
            m.rows >= 2 &&
            m.rows <= 200
          )
            t.channel.setWindow(m.rows, m.cols, 0, 0);
        })
        .catch((error) =>
          this.send(t, {
            type: "error",
            code: error instanceof Fault ? error.code : "INVALID_MESSAGE",
            message:
              error instanceof Fault
                ? error.message
                : "Invalid terminal message.",
          }),
        ).finally(()=>{pendingMessages--;pendingBytes-=size;});
    });
    socket.on("close", () => {
      if (t.attachment !== generation) return;
      t.socket = undefined;
      t.channel.resume();
      t.detached = setTimeout(
        () => void this.close(t, "closed").catch(()=>{}),
        limit(ctx, "SESSION_POLICY", "detachSeconds", 120) * 1000,
      );
    });
    await this.store.event(
      ctx.actorId,
      t.hostId,
      "terminal.attach",
      "active",
      t.id,
      { attachment: key.slice(0, 12) },
    );
  }
  async terminate(ctx: Context, id: string) {
    const t = this.sessions.get(id);
    requireValue(
      t && t.actorId === ctx.actorId,
      404,
      "NOT_FOUND",
      "Terminal is no longer available.",
    );
    await this.close(t, "closed");
    return {
      ok: true,
      remoteProcessesStopped: false,
      managedWatchdog: t.managed,
    };
  }
  private async close(t: TerminalSession, state: string) {
    if (t.closing) return;
    t.closing = true;
    clearInterval(t.timer);
    clearTimeout(t.detached);
    this.sessions.delete(t.id);
    if (t.managed) {
      try {
        await execAdapter(
          t.client,
          JSON.stringify({ stop: t.id, capability: t.stopCapability }),
        );
      } catch {
        /* Remote watchdog enforces the independent lease. */
      }
    }
    t.channel.close();
    t.client.end();
    t.socket?.close(1000, "Session ended.");
    if(t.recording)try{await t.recording.finish();}catch{await this.store.event(t.actorId,t.hostId,"recording.storage","incomplete",t.id).catch(()=>{});}
    await this.store.update(t.job, state, {
      remoteStop: t.managed
        ? "requested; watchdog bounds orphan lifetime"
        : "SSH closed; detached processes may remain",
    });
    await this.store.event(t.actorId, t.hostId, "terminal.close", state, t.id);
  }
  async drain() {
    await Promise.allSettled(
      [...this.sessions.values()].map((t) => this.close(t, "closed")),
    );
  }
}
