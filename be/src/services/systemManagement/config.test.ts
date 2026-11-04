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
});
