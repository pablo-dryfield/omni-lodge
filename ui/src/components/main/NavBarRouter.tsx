// src/components/main/NavBarRouter.tsx
import React from "react";
import { useLocation } from "react-router-dom";
import { AppNavbarSettings } from "../navbars/AppNavbarSettings";
import { AppNavbarFinance } from "../navbars/AppNavbarFinance";

interface NavBarRouterProps {
  currentPage: string;
  onNavigate?: () => void;
}

export function NavBarRouter({ currentPage, onNavigate }: NavBarRouterProps) {
  const location = useLocation();

  if (currentPage.startsWith("Reports") || location.pathname.startsWith("/reports")) {
    return null;
  }

  if (currentPage.startsWith("Finance") || location.pathname.startsWith("/finance")) {
    return <AppNavbarFinance onNavigate={onNavigate} />;
  }

  if (currentPage === "Settings" || location.pathname.startsWith("/settings")) {
    return <AppNavbarSettings onNavigate={onNavigate} />;
  }

  // Default: no navbar
  return null;
}
