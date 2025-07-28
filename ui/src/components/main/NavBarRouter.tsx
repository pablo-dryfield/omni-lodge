// src/components/main/NavBarRouter.tsx
import React from "react";
import { AppNavbarReports } from "../navbars/AppNavbarReports"; // The dummy Reports navbar component

interface NavBarRouterProps {
  currentPage: string;
}

export function NavBarRouter({ currentPage }: NavBarRouterProps) {
  // Example: Only show navbar on "/reports" and children
  if (currentPage.startsWith("Reports")) {
    return <AppNavbarReports />;
  }

  // Default: no navbar
  return <div />;
}
