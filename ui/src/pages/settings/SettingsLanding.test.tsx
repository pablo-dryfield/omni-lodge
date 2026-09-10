import { MantineProvider } from "@mantine/core";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import {
  usePm2Processes,
  useRestartPm2Process,
} from "../../api/pm2";
import { useAppSelector } from "../../store/hooks";
import SettingsLanding from "./SettingsLanding";

jest.mock("../../components/access/PageAccessGuard", () => ({
  PageAccessGuard: ({ children }: { children: ReactNode }) => children,
}));

jest.mock("../../store/hooks", () => ({
  useAppSelector: jest.fn(),
}));

jest.mock("../../api/pm2", () => ({
  fetchLogFile: jest.fn(),
  fetchPm2ProcessLogs: jest.fn(),
  usePm2Processes: jest.fn(),
  useRestartPm2Process: jest.fn(),
}));

jest.mock("../../utils/refreshApp", () => ({
  clearCachedAppFilesAndReload: jest.fn(),
}));

jest.mock("../../utils/axiosInstance", () => ({
  __esModule: true,
  default: { post: jest.fn() },
}));

const mockUseAppSelector = useAppSelector as jest.MockedFunction<typeof useAppSelector>;
const mockUsePm2Processes = usePm2Processes as jest.MockedFunction<typeof usePm2Processes>;
const mockUseRestartPm2Process = useRestartPm2Process as jest.MockedFunction<typeof useRestartPm2Process>;

const renderPage = (roleSlug: string | null) => {
  const state = {
    accessControl: {
      loading: false,
      loaded: true,
      error: null,
      pages: ["settings-users"],
      modules: {},
      openBarModeAccess: null,
    },
    session: { roleSlug },
  };

  mockUseAppSelector.mockImplementation((selector) => selector(state as never));

  return render(
    <MemoryRouter>
      <MantineProvider>
        <SettingsLanding />
      </MantineProvider>
    </MemoryRouter>,
  );
};

describe("SettingsLanding PM2 access", () => {
  beforeEach(() => {
    Object.defineProperty(global, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: class ResizeObserverMock {
        observe = jest.fn();
        unobserve = jest.fn();
        disconnect = jest.fn();
      },
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: jest.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      })),
    });
    mockUsePm2Processes.mockReturnValue({
      data: [],
      error: null,
      isError: false,
      isLoading: false,
    } as unknown as ReturnType<typeof usePm2Processes>);
    mockUseRestartPm2Process.mockReturnValue({
      isPending: false,
      mutateAsync: jest.fn(),
    } as unknown as ReturnType<typeof useRestartPm2Process>);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it.each(["manager", "owner", "assistant-manager"])(
    "does not query or render PM2 controls for %s",
    (roleSlug) => {
      renderPage(roleSlug);

      expect(mockUsePm2Processes).toHaveBeenCalledWith({ enabled: false });
      expect(screen.queryByRole("heading", { name: "Restart backend" })).not.toBeInTheDocument();
    },
  );

  it.each(["admin", "administrator", " Administrator "])(
    "renders PM2 controls for backend-authorized role %s while retaining the environment gate",
    (roleSlug) => {
      renderPage(roleSlug);

      expect(mockUsePm2Processes).toHaveBeenCalledWith({ enabled: false });
      expect(screen.getByRole("heading", { name: "Restart backend" })).toBeInTheDocument();
    },
  );
});
