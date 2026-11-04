import { controlBackupConnection } from "./controlBackup.js";
describe("independent control archive identity", () => {
  test("backs up protected schemas without widening interactive runtime grants", () => {
    const result = new URL(
      controlBackupConnection(
        "postgresql://runtime:runtime-secret@127.0.0.1:5432/control",
        {
          DB_HOST: "localhost",
          DB_PORT: "5432",
          DB_USER: "maintenance",
          DB_PASSWORD: "backup-secret",
        },
      ),
    );
    expect(result.username).toBe("maintenance");
    expect(result.password).toBe("backup-secret");
    expect(result.pathname).toBe("/control");
  });
  test("rejects an unverified cluster or missing maintenance identity", () => {
    for (const [url, environment] of [
      [
        "postgresql://u:p@remote.example/control",
        { DB_USER: "maintenance", DB_PASSWORD: "x" },
      ],
      [
        "postgresql://u:p@127.0.0.1:5440/control",
        { DB_PORT: "5432", DB_USER: "maintenance", DB_PASSWORD: "x" },
      ],
      ["postgresql://u:p@localhost/control", {}],
    ] as const)
      expect(() => controlBackupConnection(url, environment)).toThrow();
  });
});
