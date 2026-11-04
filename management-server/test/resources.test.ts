import test from "node:test";
import assert from "node:assert/strict";
import { resourceLimits } from "../src/resources.js";

test("effective cgroup v2 limits reject missing, unlimited and escaping controllers", () => {
  const values: Record<string, string> = {
    "/sys/fs/cgroup/console/memory.max": "268435456",
    "/sys/fs/cgroup/console/cpu.max": "25000 100000",
    "/sys/fs/cgroup/console/pids.max": "64",
  };
  const read = (p: string) => {
    assert(p in values);
    return values[p];
  };
  assert.deepEqual(resourceLimits("0::/console", read), {
    memoryBytes: 268435456,
    cpuPercent: 25,
    tasks: 64,
  });
  for (const value of ["max", "-1", "0", "NaN"]) {
    assert.throws(() =>
      resourceLimits("0::/console", (p) =>
        p.endsWith("memory.max") ? value : read(p),
      ),
    );
  }
  assert.throws(() => resourceLimits("0::/../escape", read));
});
test("hybrid production hosts use enforced legacy controllers instead of an unrelated unified subtree", () => {
  const paths: string[] = [];
  const result = resourceLimits(
    "0::/unified\n4:cpu,cpuacct:/console\n5:memory:/console\n6:pids:/console",
    (p) => {
      paths.push(p);
      if (p.endsWith("memory.limit_in_bytes")) return "134217728";
      if (p.endsWith("cpu.cfs_quota_us")) return "10000";
      if (p.endsWith("cpu.cfs_period_us")) return "100000";
      return "32";
    },
  );
  assert.deepEqual(result, {
    memoryBytes: 134217728,
    cpuPercent: 10,
    tasks: 32,
  });
  assert(paths.every((p) => !p.includes("unified")));
  assert.throws(() =>
    resourceLimits("0::/unified\n5:memory:/console", () => "64"),
  );
});
