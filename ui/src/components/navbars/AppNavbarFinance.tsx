import { Stack, Title, NavLink } from "@mantine/core";
import { useLocation, useNavigate } from "react-router-dom";

const financeLinks = [
  { label: "Dashboard", path: "/finance" },
  { label: "Transactions", path: "/finance/transactions" },
  { label: "Accounts", path: "/finance/accounts" },
  { label: "Vendors", path: "/finance/vendors" },
  { label: "Clients", path: "/finance/clients" },
  { label: "Categories", path: "/finance/categories" },
  { label: "Recurring Rules", path: "/finance/recurring" },
  { label: "Budgets", path: "/finance/budgets" },
  { label: "Management Requests", path: "/finance/management-requests" },
  { label: "Files", path: "/finance/files" },
  { label: "Reports", path: "/finance/reports" },
  { label: "Settings", path: "/finance/settings" },
];

export const AppNavbarFinance = () => {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <Stack gap="xs">
      <Title order={5}>Finance</Title>
      {financeLinks.map((link) => (
        <NavLink
          key={link.path}
          label={link.label}
          active={location.pathname === link.path || (link.path !== "/finance" && location.pathname.startsWith(link.path))}
          onClick={() => navigate(link.path)}
        />
      ))}
    </Stack>
  );
};

