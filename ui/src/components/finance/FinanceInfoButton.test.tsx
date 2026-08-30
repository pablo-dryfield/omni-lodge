import { fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import FinanceInfoButton from "./FinanceInfoButton";

describe("FinanceInfoButton", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
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
    Object.defineProperty(global, "ResizeObserver", {
      writable: true,
      value: jest.fn().mockImplementation(() => ({
        observe: jest.fn(),
        unobserve: jest.fn(),
        disconnect: jest.fn(),
      })),
    });
  });

  it("opens plain-language help from its accessible rounded button", async () => {
    render(
      <MantineProvider>
        <FinanceInfoButton
          label="Available balance"
          description="Allocations add to the balance; spends reduce it."
        />
      </MantineProvider>,
    );

    const button = screen.getByRole("button", { name: "Information about Available balance" });
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("Allocations add to the balance; spends reduce it.")).toBeInTheDocument();
  });
});
