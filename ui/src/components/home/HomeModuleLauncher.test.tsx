import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { baseNavigationPages } from "../../reducers/navigationReducer";
import HomeModuleLauncher from "./HomeModuleLauncher";
import type { HomeModuleDescriptionAudience } from "./homeModuleRegistry";

const renderLauncher = (
  pages = baseNavigationPages,
  descriptionAudience: HomeModuleDescriptionAudience = "management",
) =>
  render(
    <MemoryRouter>
      <HomeModuleLauncher
        pages={pages}
        descriptionAudience={descriptionAudience}
        onOpenMiniGame={jest.fn()}
      />
    </MemoryRouter>,
  );

describe("HomeModuleLauncher", () => {
  it("renders only the modules supplied by permission filtering", () => {
    const bookings = baseNavigationPages.filter((page) => page.name === "Bookings");

    renderLauncher(bookings);

    expect(screen.getByRole("link", { name: /open bookings/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open finance/i })).not.toBeInTheDocument();
  });

  it("renders the module list without a welcome or search section", () => {
    renderLauncher();

    expect(screen.getByRole("heading", { level: 1, name: "Modules" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open scheduling/i })).toBeInTheDocument();
    expect(screen.queryByText(/welcome back/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows staff-focused descriptions for non-management users", () => {
    const bookings = baseNavigationPages.filter((page) => page.name === "Bookings");

    renderLauncher(bookings, "staff");

    expect(screen.getByText("Find reservations, guest details, dates, and booking information.")).toBeInTheDocument();
    expect(screen.queryByText("Manage reservations, guests, dates, and booking details.")).not.toBeInTheDocument();
  });

  it("explains when the account has no assigned modules", () => {
    renderLauncher([]);

    expect(screen.getByText("No modules assigned yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /play krakow runner/i })).not.toBeInTheDocument();
  });
});
