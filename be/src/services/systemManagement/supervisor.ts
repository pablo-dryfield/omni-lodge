import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { getConfigValue, refreshConfigCacheKeys } from "../configService.js";
import { linuxProcessStart } from "../databaseWorkspace/workerLaunch.js";

export function startSystemManagementSupervisor(): () => void {
  if (
    process.env.NODE_ENV !== "production" ||
    !process.env.SYSTEM_MANAGEMENT_AUTHORITY_SOCKET
  )
    return () => {};
  let child: ChildProcess | undefined,
    unit = "",
    stopping = false,
    checking = false,
    next = 0,
    runningBudget = "";
  const script = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../systemManagement/server.mjs",
  );
  const stop = () => {
    if (child && unit) {
      const stopper = spawn("/usr/bin/systemctl", ["stop", unit], {
        stdio: "ignore",
        windowsHide: true,
      });
      stopper.on("error", () => {});
    }
  };
  const check = async () => {
    if (checking || stopping) return;
    checking = true;
    try {
      await refreshConfigCacheKeys([
        "SYSTEM_MANAGEMENT_ENABLED",
        "SYSTEM_MANAGEMENT_BROKER_BUDGET",
      ]);
      if (getConfigValue("SYSTEM_MANAGEMENT_ENABLED") !== true) {
        stop();
        return;
      }
      const requestedBudget = JSON.stringify(
        getConfigValue("SYSTEM_MANAGEMENT_BROKER_BUDGET"),
      );
      if (child) {
        if (requestedBudget !== runningBudget) stop();
        return;
      }
      if (Date.now() < next) return;
      if (!fs.statSync(script).isFile())
        throw new Error("Broker artifact is missing.");
      const budget = getConfigValue("SYSTEM_MANAGEMENT_BROKER_BUDGET") as {
        memoryMiB: number;
        cpuPercent: number;
        tasks: number;
      };
      if (
        !budget ||
        budget.memoryMiB < 64 ||
        budget.memoryMiB > 256 ||
        budget.cpuPercent < 1 ||
        budget.cpuPercent > 25 ||
        budget.tasks < 16 ||
        budget.tasks > 64
      )
        throw new Error("Broker resource policy exceeds the host ceiling.");
      unit = `omnilodge-system-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
      fs.writeFileSync(
        "/run/omnilodge-system/broker-unit",
        unit + ".service\n",
        { mode: 0o600 },
      );
      const ui = path.resolve(
        path.dirname(script),
        "../../../ui/build/system-management",
      );
      const args = [
        "--quiet",
        "--wait",
        "--collect",
        `--unit=${unit}`,
        "--uid=omnilodge-system",
        "--gid=omnilodge-system",
        "--property=Type=exec",
        "--property=KillMode=control-group",
        "--property=TimeoutStopSec=10s",
        "--property=NoNewPrivileges=yes",
        "--property=PrivateTmp=yes",
        "--property=ProtectSystem=strict",
        "--property=ProtectHome=yes",
        "--property=ReadWritePaths=/var/lib/omnilodge-system/broker",
        "--property=WorkingDirectory=/var/lib/omnilodge-system/broker",
        `--property=MemoryMax=${budget.memoryMiB * 1048576}`,
        `--property=CPUQuota=${budget.cpuPercent}%`,
        `--property=TasksMax=${budget.tasks}`,
        "--property=EnvironmentFile=/etc/omnilodge-system/broker.env",
        "--property=StandardOutput=journal",
        "--property=StandardError=journal",
        `--setenv=APP_VERSION=${process.env.APP_VERSION || "unknown"}`,
        `--setenv=SYSTEM_MANAGEMENT_UI_PATH=${ui}`,
        `--setenv=SYSTEM_MANAGEMENT_MEMORY_MIB=${budget.memoryMiB}`,
        `--setenv=SYSTEM_MANAGEMENT_CPU_PERCENT=${budget.cpuPercent}`,
        `--setenv=SYSTEM_MANAGEMENT_TASKS=${budget.tasks}`,
        `--setenv=SYSTEM_MANAGEMENT_PARENT_PID=${process.pid}`,
        `--setenv=SYSTEM_MANAGEMENT_PARENT_START=${linuxProcessStart(fs.readFileSync("/proc/self/stat", "utf8"))}`,
        "/usr/bin/node",
        `--max-old-space-size=${Math.floor(budget.memoryMiB * 0.6)}`,
        script,
      ];
      runningBudget = requestedBudget;
      child = spawn("/usr/bin/systemd-run", args, {
        stdio: "ignore",
        windowsHide: true,
      });
      const running = child;
      running.on("error", () => {});
      running.on("exit", () => {
        if (child === running) child = undefined;
        next = Date.now() + 3000;
      });
    } catch {
      stop();
      next = Date.now() + 10000;
    } finally {
      checking = false;
    }
  };
  const timer = setInterval(() => void check(), 5000);
  timer.unref();
  void check();
  const shutdown = () => {
    stopping = true;
    clearInterval(timer);
    stop();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return shutdown;
}
export async function systemManagementReadiness(): Promise<{
  required: boolean;
  ready: boolean;
}> {
  if (
    process.env.NODE_ENV !== "production" ||
    ["deployment-candidate", "dry-run"].includes(
      process.env.APP_RUNTIME_MODE || "",
    )
  )
    return { required: false, ready: true };
  await refreshConfigCacheKeys(["SYSTEM_MANAGEMENT_ENABLED"]);
  if (getConfigValue("SYSTEM_MANAGEMENT_ENABLED") !== true)
    return { required: false, ready: true };
  try {
    const result = await new Promise<{ ok: boolean; release: string }>(
      (resolve, reject) => {
        const req = http.get(
          "http://127.0.0.1:3011/management/health/ready",
          { timeout: 1500 },
          (res) => {
            let text = "";
            res.on("data", (chunk) => {
              text += chunk;
              if (text.length > 4096) res.destroy();
            });
            res.on("end", () => {
              try {
                resolve(JSON.parse(text));
              } catch {
                reject(new Error("Invalid broker readiness"));
              }
            });
          },
        );
        req.on("timeout", () => req.destroy());
        req.on("error", reject);
      },
    );
    return {
      required: true,
      ready: result.ok && result.release === process.env.APP_VERSION,
    };
  } catch {
    return { required: true, ready: false };
  }
}
