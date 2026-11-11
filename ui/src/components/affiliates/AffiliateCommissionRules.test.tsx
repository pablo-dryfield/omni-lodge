import { fireEvent, render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { AffiliateCommissionRules } from "./AffiliateCommissionRules";

const originalMatchMedia = window.matchMedia;
beforeAll(() => {
  window.matchMedia = query => ({ matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {},
    removeEventListener: () => {}, dispatchEvent: () => false });
});
afterAll(() => { window.matchMedia = originalMatchMedia; });

it("opens the backend-supplied rules from an accessible information button", async () => {
  render(<MantineProvider><AffiliateCommissionRules rules={["No commission when a discount is applied.", "Same-day cutoff: 20:45 Warsaw."]} /></MantineProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Commission eligibility rules" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("No commission when a discount is applied.")).toBeInTheDocument();
  expect(screen.getByText("Same-day cutoff: 20:45 Warsaw.")).toBeInTheDocument();
});

it("does not invent rules when the server response is unavailable", async () => {
  render(<MantineProvider><AffiliateCommissionRules rules={[]} /></MantineProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Commission eligibility rules" }));
  expect(await screen.findByText(/rules could not be loaded/)).toBeInTheDocument();
});
