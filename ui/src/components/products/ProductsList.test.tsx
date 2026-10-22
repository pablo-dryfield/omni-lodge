import { MantineProvider } from "@mantine/core";
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ProductsList from "./ProductsList";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { createProduct, updateProduct } from "../../actions/productActions";
import type { StorefrontProductConfig } from "../../types/products/Product";

jest.mock("../../store/hooks", () => ({ useAppDispatch: jest.fn(), useAppSelector: jest.fn() }));
jest.mock("../../hooks/useModuleAccess", () => ({ useModuleAccess: () => ({ ready: true, canView: true, canCreate: true, canUpdate: true, canDelete: false }) }));
jest.mock("../../actions/productActions", () => ({
  fetchProducts: jest.fn(() => ({ type: "fetchProducts" })),
  createProduct: jest.fn((payload) => ({ type: "createProduct", payload })),
  updateProduct: jest.fn((payload) => ({ type: "updateProduct", payload })),
  deleteProduct: jest.fn(), removeProductImageFile: jest.fn(),
}));
jest.mock("../../actions/productTypeActions", () => ({ fetchProductTypes: () => ({ type: "fetchTypes" }) }));
jest.mock("./ProductMediaEditor", () => () => <div>Product media</div>);
jest.mock("../storefront/StorefrontRulesEditors", () => ({
  cleanProductStorefrontConfig: (config: StorefrontProductConfig) => config,
  ProductStorefrontRulesEditor: ({ value, onChange }: { value: StorefrontProductConfig; onChange: (config: StorefrontProductConfig) => void }) => (
    <>
      <button onClick={() => onChange({ ...value, defaultStartTime: "20:00" })}>Set normal start time</button>
      <button onClick={() => onChange({ ...value, content: { ...value.content, description: "Updated long description" } })}>Update normal description</button>
    </>
  ),
}));

const dispatchMock = jest.fn();
const testTheme = { components: {
  Modal: { defaultProps: { transitionProps: { duration: 0 } } },
  Menu: { defaultProps: { transitionProps: { duration: 0 } } },
  Accordion: { defaultProps: { transitionDuration: 0 } },
  Select: { defaultProps: { comboboxProps: { withinPortal: false, transitionProps: { duration: 0 } } } },
} };
const originalConfig = {
  defaultStartTime: "21:00", phoneRequired: true,
  content: { summary: "Original summary" },
  duration: "3 hours", faqs: [{ question: "Vegetarian?", answer: "Yes" }],
};
let storedConfig: StorefrontProductConfig = originalConfig;

jest.setTimeout(20_000);
beforeAll(() => configure({ asyncUtilTimeout: 5000 }));
afterAll(() => configure({ asyncUtilTimeout: 1000 }));

// The action creators are mocked, so explicitly flush their resolved promises.
const finishMockedRequests = async () => { await act(async () => { await Promise.resolve(); }); };

beforeEach(() => {
  jest.clearAllMocks();
  storedConfig = originalConfig;
  dispatchMock.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  (useAppDispatch as jest.Mock).mockReturnValue(dispatchMock);
  (useAppSelector as jest.Mock).mockImplementation((select) => select({
    products: [{ loading: false, error: null, data: [{ data: [{
      id: 48, name: "Food Tour", productTypeId: 3, price: 200, storefrontConfig: storedConfig,
      images: [], imageUrl: null,
    }] }] }],
    productTypes: [{ data: [{ data: [{ id: 3, name: "Food Tour" }] }] }],
    session: { loggedUserId: 1 },
  }));
  Object.defineProperty(window, "matchMedia", { writable: true, value: jest.fn().mockImplementation((query) => ({
    matches: false, media: query, onchange: null, addListener: jest.fn(), removeListener: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), dispatchEvent: jest.fn(),
  })) });
  Object.defineProperty(global, "ResizeObserver", { configurable: true, writable: true, value: class {
    observe = jest.fn(); unobserve = jest.fn(); disconnect = jest.fn();
  } });
  Element.prototype.scrollIntoView = jest.fn();
});

const openEdit = async () => {
  render(<MantineProvider theme={testTheme}><ProductsList /></MantineProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Product actions" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Edit product" }));
  fireEvent.click(await screen.findByRole("button", { name: /Advanced storefront JSON/ }));
  return screen.getByLabelText("Additional storefront fields (JSON)");
};

it("loads custom fields, formats them and saves alongside the latest normal settings", async () => {
  const input = await openEdit();
  expect(JSON.parse((input as HTMLTextAreaElement).value)).toEqual({
    duration: originalConfig.duration, faqs: originalConfig.faqs,
  });
  expect(screen.getByText(/Never enter passwords/)).toBeInTheDocument();
  fireEvent.change(input, { target: { value: '{"duration":"4 hours","inclusions":["Guide"]}' } });
  fireEvent.click(screen.getByRole("button", { name: "Format JSON" }));
  expect(input).toHaveValue(JSON.stringify({ duration: "4 hours", inclusions: ["Guide"] }, null, 2));
  fireEvent.click(screen.getByRole("button", { name: "Set normal start time" }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await finishMockedRequests();
  await waitFor(() => expect(updateProduct).toHaveBeenCalledWith({
    productId: 48, productData: expect.objectContaining({ storefrontConfig: {
      defaultStartTime: "20:00", phoneRequired: true, content: originalConfig.content,
      duration: "4 hours", inclusions: ["Guide"],
    } }),
  }));
  await waitFor(() => expect(screen.queryByLabelText(/^Product name/)).not.toBeInTheDocument());
});

it.each(['{"duration":}', '[]', '{"phoneRequired":false}', '{"content":{"description":"Blocked"}}', '{"content":null}'])("blocks saving invalid or protected JSON %s and allows correction", async (text) => {
  const input = await openEdit();
  fireEvent.change(input, { target: { value: text } });
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Format JSON" })).toBeDisabled();
  expect(updateProduct).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "{}" } });
  expect(screen.getByRole("button", { name: "Save changes" })).not.toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await finishMockedRequests();
  await waitFor(() => expect(updateProduct).toHaveBeenCalledWith(expect.objectContaining({
    productData: expect.objectContaining({ storefrontConfig: {
      defaultStartTime: "21:00", phoneRequired: true, content: originalConfig.content,
    } }),
  })));
  await waitFor(() => expect(screen.queryByLabelText(/^Product name/)).not.toBeInTheDocument());
});

it("starts new products with an empty custom object and discards unsaved drafts on close", async () => {
  const input = await openEdit();
  fireEvent.change(input, { target: { value: '{"duration":"unsaved"}' } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Add product" }));
  fireEvent.click(await screen.findByRole("button", { name: /Advanced storefront JSON/ }));
  expect(screen.getByLabelText("Additional storefront fields (JSON)")).toHaveValue("{}");
  expect(updateProduct).not.toHaveBeenCalled();
  expect(createProduct).not.toHaveBeenCalled();
});

it("creates a new product with direct custom fields", async () => {
  render(<MantineProvider theme={testTheme}><ProductsList /></MantineProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Add product" }));
  fireEvent.change(await screen.findByLabelText(/^Product name/), { target: { value: "New tour" } });
  fireEvent.click(screen.getByLabelText(/^Product type/, { selector: "input" }));
  fireEvent.click(await screen.findByRole("option", { name: "Food Tour" }));
  fireEvent.click(screen.getByRole("button", { name: /Advanced storefront JSON/ }));
  fireEvent.change(screen.getByLabelText("Additional storefront fields (JSON)"), {
    target: { value: '{"durationMinutes":120,"content":{"card":{"subtitle":"Local flavours","description":"Short card copy","stats":[{"icon":"plate","count":5,"label":"Tastings"}]}}}' },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create product" }));
  await finishMockedRequests();
  await waitFor(() => expect(createProduct).toHaveBeenCalledWith(expect.objectContaining({
    name: "New tour", productTypeId: 3,
    storefrontConfig: { durationMinutes: 120, content: { card: {
      subtitle: "Local flavours", description: "Short card copy",
      stats: [{ icon: "plate", count: 5, label: "Tastings" }],
    } } },
  })));
  await waitFor(() => expect(screen.queryByLabelText(/^Product name/)).not.toBeInTheDocument());
});

it("edits and reloads card content while preserving normal long descriptions and booking rules", async () => {
  const card = { subtitle: "Food tour", description: "Short description", stats: [{ icon: "plate", count: 10, label: "Tastings" }] };
  storedConfig = { ...originalConfig, durationMinutes: 180, content: { ...originalConfig.content, description: "Long description", card } };
  const input = await openEdit();
  const initialAdvanced = JSON.parse((input as HTMLTextAreaElement).value);
  expect(initialAdvanced.content).toEqual({ card });
  expect(initialAdvanced.durationMinutes).toBe(180);
  const updatedCard = { ...card, subtitle: "New subtitle", description: "New short description" };
  const advanced = { ...initialAdvanced, durationMinutes: 150, content: { card: updatedCard } };
  fireEvent.change(input, { target: { value: JSON.stringify(advanced) } });
  fireEvent.click(screen.getByRole("button", { name: "Format JSON" }));
  expect(input).toHaveValue(JSON.stringify(advanced, null, 2));
  fireEvent.click(screen.getByRole("button", { name: "Update normal description" }));
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await finishMockedRequests();
  await waitFor(() => expect(screen.queryByLabelText(/^Product name/)).not.toBeInTheDocument());
  storedConfig = (updateProduct as unknown as jest.Mock).mock.calls[0][0].productData.storefrontConfig;
  expect(storedConfig).toEqual({
    ...originalConfig, durationMinutes: 150,
    content: { summary: "Original summary", description: "Updated long description", card: updatedCard },
  });
  cleanup();
  const reloadedInput = await openEdit();
  expect(JSON.parse((reloadedInput as HTMLTextAreaElement).value)).toEqual(advanced);
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await finishMockedRequests();
  expect(updateProduct).toHaveBeenLastCalledWith(expect.objectContaining({ productData: expect.objectContaining({ storefrontConfig: storedConfig }) }));
  await waitFor(() => expect(screen.queryByLabelText(/^Product name/)).not.toBeInTheDocument());
});
