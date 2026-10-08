import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import axiosInstance from "../../utils/axiosInstance";
import SettingsStorefrontPromotions from "./SettingsStorefrontPromotions";

jest.mock("../../components/access/PageAccessGuard", () => ({ PageAccessGuard: ({ children }: { children: ReactNode }) => children }));
jest.mock("../../hooks/useModuleAccess", () => ({ useModuleAccess: () => ({ ready: true, canView: true, canCreate: true, canUpdate: true, canDelete: true }) }));
jest.mock("../../utils/axiosInstance", () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));

const renderPage = () => render(<MantineProvider><SettingsStorefrontPromotions /></MantineProvider>);
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(global, "ResizeObserver", { configurable: true, writable: true, value: class {
    observe = jest.fn(); unobserve = jest.fn(); disconnect = jest.fn();
  } });
  Object.defineProperty(window, "matchMedia", { writable: true, value: jest.fn().mockImplementation((query) => ({
    matches: false, media: query, onchange: null, addListener: jest.fn(), removeListener: jest.fn(), addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  })) });
  Element.prototype.scrollIntoView = jest.fn();
  (axiosInstance.get as jest.Mock).mockImplementation(async (url) => ({ data: url === "/products" ? [{ data: [{ id: 28, name: "Pub Crawl" }] }] : { data: [] } }));
  (axiosInstance.post as jest.Mock).mockResolvedValue({ data: {} });
});

it("saves fixed per-person tour-only settings and prevents incompatible Ecwid sync", async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "New code" }));
  fireEvent.change(await screen.findByLabelText(/^Code/), { target: { value: "TEN" } });
  fireEvent.change(screen.getByLabelText(/^Promotion name/), { target: { value: "Ten per person" } });
  fireEvent.click(screen.getByLabelText("Discount type", { selector: 'input' }));
  fireEvent.click(await screen.findByRole("option", { name: "Fixed amount" }));
  fireEvent.click(screen.getByLabelText("Apply discount", { selector: 'input' }));
  fireEvent.click(await screen.findByRole("option", { name: "Per person" }));
  expect(screen.getByLabelText("Discount applies to", { selector: 'input' })).toHaveValue("Tour price only");
  expect(screen.getByLabelText("Also synchronize this code to Ecwid")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save promotion" }));
  await waitFor(() => expect(axiosInstance.post).toHaveBeenCalledWith("/storefront-promotions", expect.objectContaining({
    type: "fixed", value: 10, applicationBasis: "person", discountScope: "tour", syncToEcwid: false,
  })));
  await screen.findByText('Promotion saved in OmniLodge.');
});

it("allows booking-wide discounts including add-ons to synchronize with Ecwid", async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "New code" }));
  fireEvent.click(await screen.findByLabelText("Discount applies to", { selector: 'input' }));
  fireEvent.click(await screen.findByRole("option", { name: "Tour price and add-ons" }));
  expect(screen.getByLabelText("Also synchronize this code to Ecwid")).not.toBeDisabled();
  fireEvent.click(screen.getByLabelText("Also synchronize this code to Ecwid"));
  fireEvent.click(screen.getByLabelText("Apply discount", { selector: 'input' }));
  fireEvent.click(await screen.findByRole("option", { name: "Per person" }));
  expect(screen.getByLabelText("Also synchronize this code to Ecwid")).not.toBeChecked();
});
