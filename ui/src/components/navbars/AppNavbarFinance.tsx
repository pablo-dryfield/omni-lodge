import { Box, Group, NavLink, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { Link, useLocation } from "react-router-dom";
import { IconWallet } from "@tabler/icons-react";
import {
  financeNavigationGroups,
  isFinanceNavigationItemActive,
} from "../finance/financeNavigation";

type AppNavbarFinanceProps = {
  onNavigate?: () => void;
};

export const AppNavbarFinance = ({ onNavigate }: AppNavbarFinanceProps) => {
  const location = useLocation();

  return (
    <Stack gap="lg" pb="md">
      <Group gap="sm" wrap="nowrap" px={4}>
        <ThemeIcon size={42} radius="md" variant="gradient" gradient={{ from: "blue.6", to: "indigo.8", deg: 145 }}>
          <IconWallet size={21} />
        </ThemeIcon>
        <Box style={{ minWidth: 0 }}>
          <Title order={5}>Finance</Title>
          <Text size="xs" c="dimmed">
            Operations & control
          </Text>
        </Box>
      </Group>
      {financeNavigationGroups.map((group) => (
        <Stack key={group.label} gap={5}>
          <Text px={8} size="10px" fw={800} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.11em" }}>
            {group.label}
          </Text>
          {group.items.map((link) => {
            const active = isFinanceNavigationItemActive(location.pathname, link.path);
            const Icon = link.icon;
            return (
              <NavLink
                component={Link}
                to={link.path}
                key={link.path}
                label={link.label}
                description={link.description}
                leftSection={<Icon size={18} stroke={1.8} />}
                active={active}
                color="blue"
                variant="light"
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  onNavigate?.();
                }}
                styles={{
                  root: {
                    minHeight: 48,
                    height: "auto",
                    padding: "8px 9px",
                    borderRadius: 12,
                    background: active ? "#eaf2ff" : "transparent",
                  },
                  label: {
                    color: active ? "#1d4ed8" : "#263247",
                    fontSize: 13,
                    fontWeight: 750,
                  },
                  description: {
                    marginTop: 2,
                    color: active ? "#405f91" : "#657287",
                    fontSize: 10,
                    lineHeight: 1.25,
                  },
                  section: {
                    color: active ? "#2563eb" : "#738197",
                  },
                }}
              />
            );
          })}
        </Stack>
      ))}
    </Stack>
  );
};
