import { baseNavigationPages } from "../../reducers/navigationReducer";
import {
  getHomeModulePresentation,
  HOME_MODULE_PRESENTATIONS,
  isHomeManagementRole,
} from "./homeModuleRegistry";

describe("Home module registry", () => {
  it("provides professional presentation metadata for every main navigation page", () => {
    expect(baseNavigationPages.map((page) => page.slug).filter((slug) => !HOME_MODULE_PRESENTATIONS[slug])).toEqual([]);
    expect(Object.values(HOME_MODULE_PRESENTATIONS).every(
      (presentation) => presentation.staffDescription !== presentation.description,
    )).toBe(true);
  });

  it.each(["owner", "admin", "administrator", "manager"])(
    "uses management descriptions for the %s user type",
    (roleSlug) => {
      expect(isHomeManagementRole(roleSlug)).toBe(true);
    },
  );

  it("does not treat assistant managers or regular staff as management copy audiences", () => {
    expect(isHomeManagementRole("assistant-manager")).toBe(false);
    expect(isHomeManagementRole("pub-crawl-guide")).toBe(false);
  });

  it("returns different descriptions for management and staff", () => {
    const bookings = baseNavigationPages.find((page) => page.name === "Bookings");
    expect(bookings).toBeDefined();
    if (!bookings) {
      return;
    }

    expect(getHomeModulePresentation(bookings, "management").description).toBe(
      "Manage reservations, guests, dates, and booking details.",
    );
    expect(getHomeModulePresentation(bookings, "staff").description).toBe(
      "Find reservations, guest details, dates, and booking information.",
    );
  });
});
