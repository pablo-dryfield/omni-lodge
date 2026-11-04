import fs from "node:fs";
import { Fault, requireValue } from "./types.js";
export function resourceLimits(
  cgroups: string,
  read: (path: string) => string,
) {
  const rows = cgroups
    .trim()
    .split("\n")
    .map((line) => line.split(":"));
  const positive = (value: string) => {
    const n = Number(value.trim());
    requireValue(
      Number.isFinite(n) && n > 0,
      503,
      "RESOURCE_UNBOUNDED",
      "Resource controller is unbounded.",
    );
    return n;
  };
  const safe = (p: string) => {
    requireValue(
      p.startsWith("/") && !p.split("/").includes(".."),
      503,
      "RESOURCE_UNBOUNDED",
      "Invalid cgroup path.",
    );
    return p;
  };
  const unified = rows.find((row) => row[0] === "0" && row[1] === "");
  if (unified && !rows.some((row) => row[1].split(",").includes("memory"))) {
    const root = "/sys/fs/cgroup" + safe(unified[2]),
      [quota, period] = read(root + "/cpu.max")
        .trim()
        .split(/\s+/);
    return {
      memoryBytes: positive(read(root + "/memory.max")),
      cpuPercent: (positive(quota) / positive(period)) * 100,
      tasks: positive(read(root + "/pids.max")),
    };
  }
  const location = (controller: string) => {
    const row = rows.find((row) => row[1].split(",").includes(controller));
    requireValue(
      row,
      503,
      "RESOURCE_UNBOUNDED",
      "Resource controller unavailable.",
    );
    return (
      "/sys/fs/cgroup/" +
      (controller === "cpu" ? "cpu,cpuacct" : controller) +
      safe(row[2])
    );
  };
  return {
    memoryBytes: positive(read(location("memory") + "/memory.limit_in_bytes")),
    cpuPercent:
      (positive(read(location("cpu") + "/cpu.cfs_quota_us")) /
        positive(read(location("cpu") + "/cpu.cfs_period_us"))) *
      100,
    tasks: positive(read(location("pids") + "/pids.max")),
  };
}
export function assertProductionResources() {
  if (process.env.NODE_ENV !== "production") return null;
  requireValue(
    process.platform === "linux" && process.getuid?.() !== 0,
    503,
    "RESOURCE_UNBOUNDED",
    "Broker must run as a nonroot Linux service.",
  );
  const limits = resourceLimits(
    fs.readFileSync("/proc/self/cgroup", "utf8"),
    (file) => fs.readFileSync(file, "utf8"),
  );
  requireValue(
    limits.memoryBytes <= Math.min(256,Number(process.env.SYSTEM_MANAGEMENT_MEMORY_MIB)||256)*1048576 &&
      limits.cpuPercent <= Math.min(25,Number(process.env.SYSTEM_MANAGEMENT_CPU_PERCENT)||25) &&
      limits.tasks <= Math.min(64,Number(process.env.SYSTEM_MANAGEMENT_TASKS)||64),
    503,
    "RESOURCE_UNBOUNDED",
    "Broker resource limits exceed the host ceiling.",
  );
  return limits;
}
