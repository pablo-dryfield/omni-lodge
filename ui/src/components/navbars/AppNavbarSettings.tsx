import React, { useMemo } from "react";
import { Box, Stack, Text } from "@mantine/core";
import {
  IconGauge,
  IconUsers,
  IconIdBadge,
  IconLayoutSidebar,
  IconComponents,
  IconShieldLock,
  IconLayoutSidebarLeftExpand,
  IconTools,
  IconPackage,
  IconCategory2,
  IconPuzzle,
  IconHierarchy2,
  IconCreditCard,
  IconBroadcast,
  IconBolt,
  IconCurrencyDollar,
  IconCurrencyEuro,
  IconPercentage,
} from "@tabler/icons-react";
import { useLocation, useNavigate } from "react-router-dom";
import { ActiveNavLink } from "./ActiveNavLink";
import { useAppSelector } from "../../store/hooks";
import { selectAllowedPageSlugs } from "../../selectors/accessControlSelectors";
import { PAGE_SLUGS } from "../../constants/pageSlugs";

type SettingsNavLink = {
  label: string;
  to: string;
  icon: React.ReactNode;
  slug: string;
};

type SettingsNavSection = {
  title: string;
  links: SettingsNavLink[];
};

const settingsNav: SettingsNavSection[] = [
  {
    title: "Control panel",
    links: [
      { label: "Overview", to: "/settings", slug: PAGE_SLUGS.settings, icon: <IconGauge size={20} /> },
    ],
  },
  {
    title: "Directory",
    links: [
      { label: "Users", to: "/settings/users", slug: PAGE_SLUGS.settingsUsers, icon: <IconUsers size={20} /> },
      {
        label: "User Types",
        to: "/settings/user-types",
        slug: PAGE_SLUGS.settingsUserTypes,
        icon: <IconIdBadge size={20} />,
      },
    ],
  },
  {
    title: "Navigation",
    links: [
      { label: "Pages", to: "/settings/pages", slug: PAGE_SLUGS.settingsPages, icon: <IconLayoutSidebar size={20} /> },
      { label: "Modules", to: "/settings/modules", slug: PAGE_SLUGS.settingsModules, icon: <IconComponents size={20} /> },
    ],
  },
  {
    title: "Catalog",
    links: [
      {
        label: "Products",
        to: "/settings/products",
        slug: PAGE_SLUGS.settingsProducts,
        icon: <IconPackage size={20} />,
      },
      {
        label: "Product Types",
        to: "/settings/product-types",
        slug: PAGE_SLUGS.settingsProductTypes,
        icon: <IconCategory2 size={20} />,
      },
      {
        label: "Product Prices",
        to: "/settings/product-prices",
        slug: PAGE_SLUGS.settingsProductPrices,
        icon: <IconCurrencyDollar size={20} />,
      },
      {
        label: "Add-Ons",
        to: "/settings/addons",
        slug: PAGE_SLUGS.settingsAddons,
        icon: <IconPuzzle size={20} />,
      },
      {
        label: "Product Add-Ons",
        to: "/settings/product-addons",
        slug: PAGE_SLUGS.settingsProductAddons,
        icon: <IconHierarchy2 size={20} />,
      },
    ],
  },
  {
    title: "Integrations",
    links: [
      {
        label: "Channels",
        to: "/settings/channels",
        slug: PAGE_SLUGS.settingsChannels,
        icon: <IconBroadcast size={20} />,
      },
      {
        label: "Payment Methods",
        to: "/settings/payment-methods",
        slug: PAGE_SLUGS.settingsPaymentMethods,
        icon: <IconCreditCard size={20} />,
      },
      {
        label: "Channel Product Prices",
        to: "/settings/channel-product-prices",
        slug: PAGE_SLUGS.settingsChannelProductPrices,
        icon: <IconCurrencyEuro size={20} />,
      },
      {
        label: "Channel Commissions",
        to: "/settings/channel-commissions",
        slug: PAGE_SLUGS.settingsChannelCommissions,
        icon: <IconPercentage size={20} />,
      },
    ],
  },
  {
    title: "Permissions",
    links: [
      { label: "Overview", to: "/settings/permissions", slug: PAGE_SLUGS.settingsPermissions, icon: <IconShieldLock size={20} /> },
      {
        label: "Page Permissions",
        to: "/settings/permissions/pages",
        slug: PAGE_SLUGS.settingsPagePermissions,
        icon: <IconLayoutSidebarLeftExpand size={20} />,
      },
      {
        label: "Module Permissions",
        to: "/settings/permissions/modules",
        slug: PAGE_SLUGS.settingsModulePermissions,
        icon: <IconTools size={20} />,
      },
    ],
  },
  {
    title: "Access Control",
    links: [
      {
        label: "Actions",
        to: "/settings/actions",
        slug: PAGE_SLUGS.settingsActions,
        icon: <IconBolt size={20} />,
      },
    ],
  },
];

export const AppNavbarSettings = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const allowedPageSlugs = useAppSelector(selectAllowedPageSlugs);

  const visibleSections = useMemo(() => {
    return settingsNav
      .map((section) => ({
        ...section,
        links: section.links.filter((link) => allowedPageSlugs.has(link.slug)),
      }))
      .filter((section) => section.links.length > 0);
  }, [allowedPageSlugs]);

  const handleNavigate = (to: string) => {
    navigate(to);
  };

  if (visibleSections.length === 0) {
    return null;
  }

  return (
    <Box p="md" pt="xl" style={{ height: "100%" }}>
      <Stack gap="lg">
        {visibleSections.map((section) => (
          <Stack key={section.title} gap="xs">
            <Text fw={600} fz="sm" tt="uppercase" c="dimmed">
              {section.title}
            </Text>
            <Stack gap={4}>
              {section.links.map((link) => {
                const isActive =
                  location.pathname === link.to || location.pathname.startsWith(`${link.to}/`);
                return (
                  <ActiveNavLink
                    key={link.to}
                    icon={link.icon}
                    label={link.label}
                    active={isActive}
                    onClick={() => handleNavigate(link.to)}
                  />
                );
              })}
            </Stack>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
};
