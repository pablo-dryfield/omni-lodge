import type { ReactNode } from "react";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SettingsControlPanel from "./SettingsControlPanel";
import {
  useConfigEntries,
  useUpdateConfigEntry,
  fetchConfigHistory,
  type ConfigEntry,
} from "../../api/config";
jest.mock("../../components/access/PageAccessGuard", () => ({
  PageAccessGuard: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock("../../store/hooks", () => ({ useAppDispatch: () => jest.fn() }));
jest.mock("../../api/config", () => ({
  useConfigEntries: jest.fn(),
  useUpdateConfigEntry: jest.fn(),
  fetchConfigHistory: jest.fn(),
}));
const entry = (input: Partial<ConfigEntry>): ConfigEntry => ({
  key: "KEY",
  label: "Setting",
  description: "Operational configuration",
  category: "General",
  valueType: "string",
  value: "value",
  defaultValue: null,
  validationRules: null,
  isSecret: false,
  isEditable: true,
  impact: "low",
  maskedValue: null,
  isSet: true,
  isCleared: false,
  updatedAt: null,
  updatedBy: null,
  ...input,
});
const entries = [
  entry({
    key: "JSON_POLICY",
    label: "JSON policy",
    valueType: "json",
    value: '{"enabled":true,"count":1}',
  }),
  entry({
    key: "TOKEN",
    label: "Integration token",
    category: "Integrations",
    isSecret: true,
    value: "NEVER-RENDER-SECRET",
    maskedValue: "********",
  }),
  entry({
    key: "SYSTEM",
    label: "System setting",
    isEditable: false,
    isSystemManaged: true,
  }),
];
let client: QueryClient;
const save = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = jest
    .fn()
    .mockImplementation(() => ({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }));
  (useConfigEntries as jest.Mock).mockReturnValue({
    data: entries,
    refetch: jest.fn(),
  });
  (useUpdateConfigEntry as jest.Mock).mockReturnValue({
    mutateAsync: save,
    isPending: false,
  });
  (fetchConfigHistory as jest.Mock).mockResolvedValue([]);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
});
afterEach(() => client.clear());
function open() {
  render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <SettingsControlPanel />
      </QueryClientProvider>
    </MantineProvider>,
  );
}
test("category tabs and global search filter responsive setting cards without exposing secrets", () => {
  open();
  expect(
    screen.queryByDisplayValue("NEVER-RENDER-SECRET"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: /Integrations/ }));
  expect(screen.getByText("Integration token")).toBeInTheDocument();
  expect(screen.queryByText("JSON policy")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("tab", { name: /All settings/ }));
  fireEvent.change(screen.getByLabelText("Search"), {
    target: { value: "JSON_POLICY" },
  });
  expect(screen.getByText("JSON policy")).toBeInTheDocument();
  expect(screen.queryByText("Integration token")).not.toBeInTheDocument();
});
test("the JSON form blocks invalid edits and submits the corrected complete value", async () => {
  open();
  const card = screen.getByRole('group',{name:'JSON policy setting'});
  fireEvent.click(within(card).getByRole("button", { name: "Edit setting" }));
  const count = await screen.findByLabelText("Value of $.count");
  fireEvent.change(count, { target: { value: "1e" } });
  expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(count, { target: { value: "2" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  expect(JSON.parse(save.mock.calls[0][0].value)).toEqual({
    enabled: true,
    count: 2,
  });
  expect(save.mock.calls[0][0].key).toBe("JSON_POLICY");
});
test("secret history hides values even if a response unexpectedly contains them", async () => {
  (fetchConfigHistory as jest.Mock).mockResolvedValue([
    {
      id: 1,
      isSecret: true,
      oldValue: "NEVER-RENDER-SECRET",
      newValue: "NEW-PRIVATE",
      actorId: 1,
      createdAt: "2026-11-04T10:00:00Z",
      reason: "Rotation",
    },
  ]);
  open();
  const card = screen.getByRole('group',{name:'Integration token setting'});
  fireEvent.click(within(card).getByRole("button", { name: "History" }));
  expect(
    await screen.findByText(
      "Secret updated. Values are never shown in history.",
    ),
  ).toBeInTheDocument();
  expect(screen.queryByText("NEVER-RENDER-SECRET")).not.toBeInTheDocument();
  expect(screen.queryByText("NEW-PRIVATE")).not.toBeInTheDocument();
});
