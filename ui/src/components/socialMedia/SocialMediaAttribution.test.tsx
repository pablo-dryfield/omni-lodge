import { render, screen } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import type { SocialMediaContentItem, SocialMediaContentPerson } from "../../api/socialMedia";
import SocialMediaAttribution from "./SocialMediaAttribution";

jest.mock("../../utils/axiosInstance", () => ({
  __esModule: true,
  default: { defaults: { baseURL: "https://api.omni.test" } },
}));

const person = (id: number, firstName: string): SocialMediaContentPerson => ({
  id,
  firstName,
  lastName: "Example",
  username: firstName.toLowerCase(),
  profilePhotoUrl: `https://images.omni.test/${id}.jpg`,
});

describe("social media contributor strip", () => {
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
  });

  it("shows all three people, their photos, and the creation date/time in the Warsaw task timezone", () => {
    render(
      <MantineProvider>
        <SocialMediaAttribution item={{
          createdByUser: {
            ...person(1, "Creator"),
            hasStoredProfilePhoto: true,
            updatedAt: "2026-09-04T10:00:00.000Z",
          },
          producedByUser: person(2, "Producer"),
          publishedByUser: person(3, "Publisher"),
          createdAt: "2026-09-04T22:30:00.000Z",
          productionStartedAt: "2026-09-05T10:00:00.000Z",
          publishedAt: "2026-09-06T10:00:00.000Z",
        } as SocialMediaContentItem} />
      </MantineProvider>,
    );

    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Produced")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
    ["Creator", "Producer", "Publisher"].forEach((name, index) => {
      expect(screen.getByText(`${name} Example`)).toBeInTheDocument();
      expect(screen.getByRole("img", { name: `${name} Example` })).toHaveAttribute(
        "src",
        index === 0
          ? `https://api.omni.test/social-media/users/1/profile-photo?v=${new Date("2026-09-04T10:00:00.000Z").getTime()}`
          : `https://images.omni.test/${index + 1}.jpg`,
      );
    });
    expect(screen.getByText((_, element) => element?.tagName === "P"
      && element.textContent === "5 Sept 202600:30")).toBeInTheDocument();
  });

  it("distinguishes unknown historical contributors from stages that have not happened", () => {
    render(
      <MantineProvider>
        <SocialMediaAttribution item={{
          createdByName: "Original creator",
          createdAt: "2026-09-04T10:00:00.000Z",
          productionStartedAt: "2026-09-05T10:00:00.000Z",
          producedBy: null,
          publishedAt: null,
          publishedBy: null,
        } as SocialMediaContentItem} />
      </MantineProvider>,
    );

    expect(screen.getByText("Original creator")).toBeInTheDocument();
    expect(screen.getByText("Not recorded")).toBeInTheDocument();
    expect(screen.getByText("Not yet")).toBeInTheDocument();
  });
});
