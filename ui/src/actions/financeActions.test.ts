import axios from "axios";
import axiosInstance from "../utils/axiosInstance";
import { fetchFinanceTransactionById } from "./financeActions";

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    isAxiosError: jest.fn(),
  },
}));

jest.mock("../utils/axiosInstance", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

const mockedGet = axiosInstance.get as jest.Mock;
const mockedIsAxiosError = axios.isAxiosError as unknown as jest.Mock;

describe("fetchFinanceTransactionById", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads the exact transaction independently of the paged list", async () => {
    mockedGet.mockResolvedValue({ data: { id: 82518, kind: "expense" } });

    const result = await fetchFinanceTransactionById(82518)(jest.fn(), jest.fn(), undefined);

    expect(mockedGet).toHaveBeenCalledWith(
      "/finance/transactions/82518",
      { withCredentials: true },
    );
    expect(result.type).toBe("finance/transactions/fetchById/fulfilled");
    expect(result.payload).toMatchObject({ id: 82518 });
  });

  it("preserves a 404 status in the rejected payload for terminal URL cleanup", async () => {
    const error = {
      message: "Request failed with status code 404",
      response: {
        status: 404,
        data: [{ message: "Transaction not found" }],
      },
    };
    mockedIsAxiosError.mockReturnValue(true);
    mockedGet.mockRejectedValue(error);

    const result = await fetchFinanceTransactionById(99999)(jest.fn(), jest.fn(), undefined);

    expect(result.type).toBe("finance/transactions/fetchById/rejected");
    expect(result.payload).toEqual({
      message: "Transaction not found",
      status: 404,
    });
  });
});
