import {
  StaffPayoutReceiptAccessError,
  confirmStaffPayoutReceiptWithAccess,
  exchangeStaffPayoutReceiptAccess,
  getStaffPayoutReceiptWithAccess,
} from "./staffPayoutReceiptAccess";

const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
}) as Response;

describe("receipt-only payout access API", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    Object.defineProperty(global, "fetch", {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
  });

  it("exchanges credentials without cookies, a normal auth token, or URL secrets", async () => {
    fetchMock.mockResolvedValueOnce(response(200, {
      accessToken: "receipt-token",
      tokenType: "Bearer",
      expiresAt: "2026-08-30T18:20:00.000Z",
      expiresInSeconds: 1200,
      receiptId: 73,
      actionId: 91,
    }));

    await exchangeStaffPayoutReceiptAccess({
      receiptId: 73,
      identity: "former.staff@example.com",
      password: "secret",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/api/required-actions/staff-payout-receipts/access");
    expect(url).not.toContain("receipt-token");
    expect(init.credentials).toBe("omit");
    expect(init.cache).toBe("no-store");
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(JSON.parse(String(init.body))).toEqual({
      receiptId: 73,
      identity: "former.staff@example.com",
      password: "secret",
    });
  });

  it("binds the receipt token to the requested receipt path and surfaces expiry", async () => {
    fetchMock.mockResolvedValueOnce(response(401, [{ message: "Payout receipt access has expired." }]));

    await expect(getStaffPayoutReceiptWithAccess({
      receiptId: 73,
      accessToken: "receipt-token",
    })).rejects.toEqual(expect.objectContaining<Partial<StaffPayoutReceiptAccessError>>({
      status: 401,
      message: "Payout receipt access has expired.",
    }));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/api/required-actions/staff-payout-receipts/73/access");
    expect(url).not.toContain("receipt-token");
    expect(init.credentials).toBe("omit");
    expect(init.headers).toMatchObject({ Authorization: "Bearer receipt-token" });
  });

  it("submits confirmation evidence as isolated multipart data", async () => {
    fetchMock.mockResolvedValueOnce(response(200, {
      completed: true,
      receipt: { id: 73 },
    }));
    const photo = new File(["photo"], "receipt.jpg", { type: "image/jpeg" });
    const signature = {
      dataUrl: "data:image/png;base64,c2lnbmF0dXJl",
      signedAt: "2026-08-30T18:05:00.000Z",
      userAgent: "test",
    };

    await confirmStaffPayoutReceiptWithAccess({
      receiptId: 73,
      accessToken: "receipt-token",
      photo,
      signature,
      acknowledgedAmount: "1832.30",
      acknowledgedAt: "2026-08-30T18:06:00.000Z",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3001/api/required-actions/staff-payout-receipts/73/access/confirm");
    expect(url).not.toContain("receipt-token");
    expect(init.credentials).toBe("omit");
    expect(init.headers).toMatchObject({ Authorization: "Bearer receipt-token" });
    expect(init.headers).not.toHaveProperty("Content-Type");
    expect(init.body).toBeInstanceOf(FormData);
    const formData = init.body as FormData;
    expect(formData.get("photo")).toBe(photo);
    expect(formData.get("signature")).toBe(JSON.stringify(signature));
    expect(formData.get("acknowledgedAmount")).toBe("1832.30");
    expect(formData.get("acknowledgedAt")).toBe("2026-08-30T18:06:00.000Z");
  });
});
