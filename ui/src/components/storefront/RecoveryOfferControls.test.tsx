import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { RecoveryOfferControls, type RecoveryOfferSettings } from "./RecoveryOfferControls";

beforeEach(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Object.defineProperty(window, "matchMedia", { writable: true, value: jest.fn().mockImplementation(query => ({
    matches: false, media: query, onchange: null, addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  })) });
  Element.prototype.scrollIntoView = jest.fn();
});
const settings: RecoveryOfferSettings = {
  override: { mode: "automatic", promotionId: null }, groupSize: 9, guestCountMode: "largest_group", canEdit: true,
  offer: null, couponOptions: [{ value: "1", label: "GROUP10 · Group offer · 10%", disabled: false }], warnings: [], error: null,
};
it('keeps changes unsaved until the selected coupon is explicitly saved', async () => {
  const save = jest.fn().mockResolvedValue(undefined), dirty = jest.fn();
  render(<MantineProvider><RecoveryOfferControls settings={settings} saving={false} onSave={save} onDirtyChange={dirty} /></MantineProvider>);
  fireEvent.click(screen.getByRole("textbox", { name: "Offer for this cart" }));
  fireEvent.click(screen.getByRole("option", { name: "Choose a specific coupon" }));
  expect(screen.getByRole("button", { name: "Save and refresh preview" })).toBeDisabled();
  fireEvent.click(screen.getByRole("textbox", { name: "Coupon" }));
  fireEvent.click(screen.getByRole("option", { name: "GROUP10 · Group offer · 10%" }));
  fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "Group enquiry" } });
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save and refresh preview" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ mode: "coupon", promotionId: 1, reason: "Group enquiry" }));
  expect(dirty).toHaveBeenLastCalledWith(true);
});
it('shows the effective offer without editing controls to a viewer', () => {
  render(<MantineProvider><RecoveryOfferControls settings={{ ...settings, canEdit: false,
    offer: { code: "GROUP10", amount: 90, currency: "PLN", source: "rule", ruleName: "Large group", applyAutomatically: true } }} saving={false} onSave={jest.fn()} onDirtyChange={jest.fn()} /></MantineProvider>);
  expect(screen.queryByRole("textbox", { name: "Offer for this cart" })).not.toBeInTheDocument();
  expect(screen.getByText("GROUP10")).toBeInTheDocument();
  expect(screen.getByText(/Applied through email link/)).toBeInTheDocument();
});
it('keeps invalid manual settings visible so the manager can correct them', () => {
  render(<MantineProvider><RecoveryOfferControls settings={{ ...settings, override: { mode: "coupon", promotionId: 1 }, error: "Coupon is expired." }} saving={false} onSave={jest.fn()} onDirtyChange={jest.fn()} /></MantineProvider>);
  expect(screen.getByText("Coupon is expired.")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Offer for this cart" })).toBeInTheDocument();
});
