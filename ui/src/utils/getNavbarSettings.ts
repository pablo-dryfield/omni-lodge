export const getNavbarSettings = (currentPage: string) => {
  if (currentPage.startsWith("Reports")) {
    return undefined;
  }

  if (currentPage.startsWith("Finance")) {
    return {
      width: 260,
      breakpoint: "md",
      collapsed: { mobile: true, desktop: false },
    };
  }

  if (currentPage === "Settings") {
    return {
      width: 260,
      breakpoint: "sm",
      collapsed: { mobile: true, desktop: false },
    };
  }
  // Default: no navbar
  return undefined;
};
