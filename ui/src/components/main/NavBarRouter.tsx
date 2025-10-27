// src/components/main/NavBarRouter.tsx
import React from "react";
import { useLocation } from "react-router-dom";
import { AppNavbarReports } from "../navbars/AppNavbarReports";
import { AppNavbarSettings } from "../navbars/AppNavbarSettings";
import { AppNavbarFinance } from "../navbars/AppNavbarFinance";

interface NavBarRouterProps {
  currentPage: string;
}

export function NavBarRouter({ currentPage }: NavBarRouterProps) {
  const location = useLocation();

  if (currentPage.startsWith("Reports") || location.pathname.startsWith("/reports")) {
    return <AppNavbarReports />;
  }

  if (currentPage.startsWith("Finance") || location.pathname.startsWith("/finance")) {
    return <AppNavbarFinance />;
  }

  if (currentPage === "Settings" || location.pathname.startsWith("/settings")) {
    return <AppNavbarSettings />;
  }

  // Default: no navbar
  return <div />;
}
