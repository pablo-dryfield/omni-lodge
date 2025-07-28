export const getNavbarSettings = (currentPage: string) => {
    if (currentPage.startsWith("Reports")) {
      return {
        width: 240,
        breakpoint: "sm",
        collapsed: { mobile: true, desktop: false },
      };
    }
    // Default: no navbar
    return undefined;
  }
  