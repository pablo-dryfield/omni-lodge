import {
  SYSTEM_MANAGEMENT_CONFIG,
  SYSTEM_DEFAULTS,
  validateSystemManagementValue,
} from "../../config/systemManagementConfig";
describe("System Management Control Panel validation", () => {
  test("every default policy passes its own schema", () => {
    for (const [key, value] of Object.entries(SYSTEM_DEFAULTS))
      expect(() =>
        validateSystemManagementValue(
          `SYSTEM_MANAGEMENT_${key}`,
          JSON.stringify(value),
        ),
      ).not.toThrow();
  });
  test("credentials are encrypted and non-revealable", () => {
    const entry = SYSTEM_MANAGEMENT_CONFIG.find((c) =>
      c.key.endsWith("_CREDENTIALS"),
    );
    expect(entry?.isSecret).toBe(true);
    expect(entry?.isRevealable).toBe(false);
  });
  test("host enrollment requires explicit network and independently verified keys", () => {
    const host = {
      id: "production",
      name: "Production",
      environment: "production",
      hostname: "127.0.0.1",
      port: 22,
      addresses: ["127.0.0.1"],
      fingerprints: ["SHA256:" + "a".repeat(43)],
      enabled: true,
      managed: true,
      identities: { "1": { username: "gateway", credentialId: "operator" } },
      roots: [
        {
          id: "work",
          name: "Work",
          path: "/work",
          writable: true,
          managed: true,
        },
      ],
      services: ["backend"],
    };
    expect(() =>
      validateSystemManagementValue(
        "SYSTEM_MANAGEMENT_HOSTS",
        JSON.stringify([host]),
      ),
    ).not.toThrow();
    for (const override of [
      { addresses: [] },
      { addresses: ["999.999.1.1"] },
      { privateKey: "must use encrypted credentials" },
      { identities: { "1": { username: "root", credentialId: "operator" } } },
      {
        identities: {
          "1": {
            username: "gateway",
            credentialId: "operator",
            password: "plaintext",
          },
        },
      },
      { fingerprints: [] },
      { port: 0 },
      {
        identities: {
          "1": { username: "root; injected", credentialId: "operator" },
        },
      },
      {
        roots: [
          { id: "work", path: "/work/../etc", writable: true, managed: true },
        ],
      },
    ])
      expect(() =>
        validateSystemManagementValue(
          "SYSTEM_MANAGEMENT_HOSTS",
          JSON.stringify([{ ...host, ...override }]),
        ),
      ).toThrow();
  });
  test("session limits cannot widen the hard security ceiling", () => {
    expect(() =>
      validateSystemManagementValue(
        "SYSTEM_MANAGEMENT_SESSION_POLICY",
        JSON.stringify({
          ...SYSTEM_DEFAULTS.SESSION_POLICY,
          authoritySeconds: 60,
        }),
      ),
    ).toThrow();
  });
  test("root filesystem enrollment requires all explicit capabilities and a dedicated file identity", () => {
    const host = {
      id: "production",
      name: "Production",
      environment: "production",
      hostname: "127.0.0.1",
      port: 22,
      addresses: ["127.0.0.1"],
      fingerprints: ["SHA256:" + "a".repeat(43)],
      enabled: true,
      managed: true,
      rootFiles: true,
      identities: {
        "1": {
          username: "gateway",
          credentialId: "gateway",
          fileUsername: "omnilodge-root-files-1",
          fileCredentialId: "root-key",
        },
      },
      roots: [
        {
          id: "server",
          name: "Server filesystem",
          path: "/",
          writable: true,
          managed: true,
          privileged: true,
        },
      ],
      services: [],
    };
    const validate = (h: unknown) =>
      validateSystemManagementValue(
        "SYSTEM_MANAGEMENT_HOSTS",
        JSON.stringify([h]),
      );
    expect(() => validate(host)).not.toThrow();
    for (const change of [
      { rootFiles: false },
      { managed: false },
      { roots: [{ ...host.roots[0], privileged: false }] },
      {
        identities: {
          "1": { ...host.identities["1"], fileUsername: "omnilodge-sftp-1" },
        },
      },
    ])
      expect(() => validate({ ...host, ...change })).toThrow();
    expect(
      SYSTEM_MANAGEMENT_CONFIG.find((c) => c.key.endsWith("ROOT_FILES_ENABLED"))
        ?.defaultValue,
    ).toBe(false);
  });
});
