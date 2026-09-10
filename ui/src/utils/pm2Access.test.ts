import { canAccessPm2Controls, canQueryPm2Processes } from "./pm2Access";

describe("canAccessPm2Controls", () => {
  it.each([
    "admin",
    "ADMIN",
    "administrator",
    "Administrator",
    " admin ",
    "admin_istrator",
  ])("accepts backend-normalized admin role %s", (roleSlug) => {
    expect(canAccessPm2Controls(roleSlug)).toBe(true);
  });

  it.each([
    "owner",
    "manager",
    "assistant-manager",
    "assistant_manager",
    "staff",
    "",
    null,
    undefined,
  ])("rejects non-PM2 role %s", (roleSlug) => {
    expect(canAccessPm2Controls(roleSlug)).toBe(false);
  });

  it("enables the request only for an authorized role in production", () => {
    expect(canQueryPm2Processes("production", "administrator")).toBe(true);
    expect(canQueryPm2Processes("production", "manager")).toBe(false);
    expect(canQueryPm2Processes("test", "admin")).toBe(false);
    expect(canQueryPm2Processes("development", "admin")).toBe(false);
  });
});
