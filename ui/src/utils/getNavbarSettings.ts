type NavbarSettings = {
  width: number;
  breakpoint: string;
  collapsed?: { mobile?: boolean; desktop?: boolean };
};

const matchesSection = (target: string, currentPage: string, pathname: string) => {
  const lowerTarget = target.toLowerCase();
  const normalizedPath = pathname?.toLowerCase() ?? "";

  if (normalizedPath.startsWith(`/${lowerTarget}`)) {
    return true;
  }

  if (!normalizedPath && currentPage) {
    return currentPage.toLowerCase().startsWith(lowerTarget);
  }

  return false;
};

export const getNavbarSettings = (currentPage: string, pathname = ""): NavbarSettings | undefined => {
  if (matchesSection("finance", currentPage, pathname)) {
    return {
      width: 260,
      breakpoint: "md",
      collapsed: { mobile: true, desktop: false },
    };
  }

  if (matchesSection("settings", currentPage, pathname)) {
    return {
      width: 260,
      breakpoint: "sm",
      collapsed: { mobile: true, desktop: false },
    };
  }

  if (matchesSection("reports", currentPage, pathname)) {
    return undefined;
  }

  return undefined;
};
