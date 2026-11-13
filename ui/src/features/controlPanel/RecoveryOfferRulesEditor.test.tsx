import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import axiosInstance from "../../utils/axiosInstance";
import { RecoveryOfferRulesEditor } from "./RecoveryOfferRulesEditor";

jest.mock("../../utils/axiosInstance", () => ({ __esModule: true, default: { get: jest.fn() } }));
const initial = JSON.stringify({ guestCountMode: "largest_group", applyAutomatically: true, rules: [] });
const onError = jest.fn();
function Harness() {
  const [value, setValue] = useState(initial);
  return <MantineProvider><RecoveryOfferRulesEditor value={value} onChange={setValue} onError={onError} /><output data-testid="stored-rules">{value}</output></MantineProvider>;
}
beforeEach(() => {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia = jest.fn().mockImplementation(() => ({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() }));
  Element.prototype.scrollIntoView = jest.fn();
  Object.defineProperty(window, "crypto", { configurable: true, value: { randomUUID: () => "group-offer" } });
  (axiosInstance.get as jest.Mock).mockResolvedValue({ data: { data: [{ value: "7", label: "GROUP10", disabled: false }] } });
});

it('uses the chosen coupon and inclusive guest minimum while retaining the automatic-link defaults', async () => {
  render(<Harness />);
  await waitFor(() => expect(onError).toHaveBeenLastCalledWith(null));
  fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
  await waitFor(() => expect(onError).toHaveBeenLastCalledWith("Select a coupon for every rule."));
  expect(screen.getByText("Inclusive: 9 means more than 8 people.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("textbox", { name: "Coupon to offer" }));
  fireEvent.click(await screen.findByRole("option", { name: "GROUP10" }));
  await waitFor(() => expect(onError).toHaveBeenLastCalledWith(null));
  const stored = JSON.parse(screen.getByTestId("stored-rules").textContent!);
  expect(stored).toMatchObject({ guestCountMode: "largest_group", applyAutomatically: true,
    rules: [{ minGuests: 9, promotionId: 7, enabled: true }] });
});

it('blocks invalid advanced configuration instead of silently saving an unusable rule', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByText("Advanced JSON"));
  fireEvent.change(screen.getByRole("textbox", { name: "Recovery offer rules JSON" }), {
    target: { value: JSON.stringify({ guestCountMode: "largest_group", applyAutomatically: true,
      rules: [{ id: "bad", name: "Bad rule", enabled: true, minGuests: 0, promotionId: 7 }] }) },
  });
  await waitFor(() => expect(onError).toHaveBeenLastCalledWith("Minimum guests must be between 1 and 10,000."));
});

it('blocks saving when coupons cannot be loaded and provides a retry', async () => {
  (axiosInstance.get as jest.Mock).mockRejectedValue(new Error("Unavailable"));
  render(<Harness />);
  expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
  await waitFor(() => expect(onError).toHaveBeenLastCalledWith("Could not load coupons. Try again before saving rules."));
});
