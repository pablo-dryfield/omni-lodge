import { MantineProvider } from "@mantine/core";
import { fireEvent, render, screen } from "@testing-library/react";
import type { SocialMediaContentItem } from "../api/socialMedia";
import { SocialContentCard } from "./SocialMediaContentBoard";

jest.mock("../utils/axiosInstance", () => ({
  __esModule: true,
  default: {},
}));

jest.mock("../components/socialMedia/SocialMediaAttribution", () => ({
  __esModule: true,
  default: () => <div data-testid="social-media-attribution" />,
  socialMediaPersonName: jest.fn(),
}));

const readyItem: SocialMediaContentItem = {
  id: 41,
  title: "Warm-up reel",
  idea: "Show the team getting ready",
  onVideoCaptions: "Meet the team",
  platformCaption: "Tonight in Krakow",
  hashtags: ["krakow"],
  targetPlatforms: ["instagram", "tiktok"],
  status: "ready",
  scheduledAt: "2026-09-10",
  publishedAt: null,
  driveProjectUrl: "https://drive.google.com/drive/folders/project-41",
  platformLinks: {},
  thumbnailUrl: null,
  assets: [],
  productionStartedAt: "2026-09-09T18:00:00.000Z",
  readyAt: "2026-09-10T10:00:00.000Z",
  publishedBy: null,
  producedBy: 7,
  producedByName: "Producer Example",
  publishedByName: null,
  producedByUser: null,
  publishedByUser: null,
  publishedTaskLogId: null,
  createdBy: 5,
  createdByName: "Creator Example",
  createdByUser: null,
  updatedBy: 7,
  updatedByName: "Producer Example",
  createdAt: "2026-09-08T10:00:00.000Z",
  updatedAt: "2026-09-10T10:00:00.000Z",
};

const buildProps = (overrides: Partial<React.ComponentProps<typeof SocialContentCard>> = {}) => ({
  item: readyItem,
  canUpdate: true,
  canDelete: false,
  canEditPublicationDate: false,
  canPublish: true,
  busy: false,
  onEdit: jest.fn(),
  onNext: jest.fn(),
  onEditPlannedDate: jest.fn(),
  onManageAssets: jest.fn(),
  onEditPublicationLinks: jest.fn(),
  onEditPublicationDate: jest.fn(),
  onEditAttribution: jest.fn(),
  onThumbnail: jest.fn(),
  onArchive: jest.fn(),
  ...overrides,
});

const renderCard = (props: React.ComponentProps<typeof SocialContentCard>) => render(
  <MantineProvider>
    <SocialContentCard {...props} />
  </MantineProvider>,
);

describe("Social Media ready-stage file editing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
  });

  it("exposes Edit files beside Publish and opens the existing file manager callback", () => {
    const props = buildProps();
    renderCard(props);

    fireEvent.click(screen.getByRole("button", { name: "Edit files" }));

    expect(props.onManageAssets).toHaveBeenCalledTimes(1);
    expect(props.onNext).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
  });

  it("keeps Edit files available to an updater who is not allowed to publish", () => {
    const props = buildProps({ canPublish: false });
    renderCard(props);

    expect(screen.getByRole("button", { name: "Edit files" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
  });

  it("does not expose Edit files without update permission", () => {
    renderCard(buildProps({ canUpdate: false, canPublish: false }));

    expect(screen.queryByRole("button", { name: "Edit files" })).not.toBeInTheDocument();
  });

  it("keeps the ready-stage file action disabled while that item is busy", () => {
    renderCard(buildProps({ busy: true }));

    expect(screen.getByRole("button", { name: "Edit files" })).toBeDisabled();
  });
});
