import type { CSSProperties, ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Group,
  Modal,
  Paper,
  Skeleton,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  useMantineTheme,
  type ButtonProps,
  type MantineColor,
  type ModalProps,
  type PaperProps,
  type PolymorphicComponentProps,
} from "@mantine/core";
import { useMediaQuery, useReducedMotion } from "@mantine/hooks";
import { IconAlertTriangle, IconInbox, IconSearch } from "@tabler/icons-react";
import classes from "./FinanceUi.module.css";

export const FINANCE_ACCENTS = {
  blue: { color: "#2563eb", soft: "#eff6ff" },
  green: { color: "#047857", soft: "#ecfdf5" },
  orange: { color: "#c2410c", soft: "#fff7ed" },
  violet: { color: "#7c3aed", soft: "#f5f3ff" },
  rose: { color: "#be123c", soft: "#fff1f2" },
  slate: { color: "#475569", soft: "#f1f5f9" },
} as const;

type FinanceAccent = keyof typeof FINANCE_ACCENTS;

export const FinanceWorkspace = ({ children }: { children: ReactNode }) => (
  <Box className={classes.workspace}>{children}</Box>
);

type FinanceModuleBarProps = {
  icon: ReactNode;
  title?: string;
  description?: string;
  actions?: ReactNode;
};

export const FinanceModuleBar = ({
  icon,
  title = "Finance workspace",
  description = "Cash flow, planning, controls and supporting records in one place.",
  actions,
}: FinanceModuleBarProps) => (
  <Paper className={classes.moduleBar}>
    <Group justify="space-between" align="center" gap="md" wrap="wrap">
      <Group gap="sm" wrap="nowrap" style={{ minWidth: 0, flex: "1 1 320px" }}>
        <Box className={classes.moduleMark}>{icon}</Box>
        <Stack gap={1} style={{ minWidth: 0 }}>
          <Text fw={800} c="#172033" truncate>
            {title}
          </Text>
          <Text size="xs" c="dimmed" lineClamp={1}>
            {description}
          </Text>
        </Stack>
      </Group>
      {actions ? (
        <Group className={classes.moduleActions} gap="sm" wrap="wrap">
          {actions}
        </Group>
      ) : null}
    </Group>
  </Paper>
);

type FinancePageHeaderProps = {
  title: string;
  description: string;
  eyebrow?: string;
  icon?: ReactNode;
  actions?: ReactNode;
};

export const FinancePageHeader = ({
  title,
  description,
  eyebrow = "Finance",
  icon,
  actions,
}: FinancePageHeaderProps) => (
  <Paper component="header" className={classes.pageHeader}>
    <Group className={classes.pageHeaderMain} justify="space-between" align="center" gap="lg" wrap="wrap">
      <Group className={classes.pageHeading} gap="md" align="center" wrap="nowrap">
        {icon ? <Box className={classes.pageIcon}>{icon}</Box> : null}
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Text className={classes.eyebrow}>{eyebrow}</Text>
          <Title order={1} className={classes.pageTitle}>
            {title}
          </Title>
          <Text size="sm" className={classes.pageDescription}>
            {description}
          </Text>
        </Stack>
      </Group>
      {actions ? <Group className={classes.headerActions}>{actions}</Group> : null}
    </Group>
  </Paper>
);

type FinancePanelProps = PolymorphicComponentProps<"div", PaperProps> & {
  title?: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  noPadding?: boolean;
};

export const FinancePanel = ({
  title,
  description,
  icon,
  actions,
  noPadding = false,
  children,
  ...paperProps
}: FinancePanelProps) => (
  <Paper {...paperProps} className={`${classes.panel} ${paperProps.className ?? ""}`.trim()}>
    {title || description || actions ? (
      <Group className={classes.panelHeader} justify="space-between" align="center" gap="md" wrap="wrap">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          {icon ? (
            <ThemeIcon variant="light" radius="md" size={36}>
              {icon}
            </ThemeIcon>
          ) : null}
          <Stack gap={2} style={{ minWidth: 0 }}>
            {title ? <Text component="h2" fz="sm" fw={800}>{title}</Text> : null}
            {description ? (
              <Text size="xs" c="dimmed">
                {description}
              </Text>
            ) : null}
          </Stack>
        </Group>
        {actions}
      </Group>
    ) : null}
    <Box className={noPadding ? undefined : classes.panelBody}>{children}</Box>
  </Paper>
);

type FinanceToolbarProps = {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  children?: ReactNode;
};

export const FinanceToolbar = ({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search records",
  children,
}: FinanceToolbarProps) => (
  <Paper className={classes.toolbar}>
    <Group gap="sm" wrap="wrap">
      {onSearchChange ? (
        <TextInput
          className={classes.toolbarSearch}
          leftSection={<IconSearch size={17} />}
          value={searchValue ?? ""}
          onChange={(event) => onSearchChange(event.currentTarget.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
        />
      ) : null}
      {children}
    </Group>
  </Paper>
);

type FinanceMetricCardProps = {
  label: string;
  value: ReactNode;
  description?: string;
  icon: ReactNode;
  accent?: FinanceAccent;
  detail?: ReactNode;
};

export const FinanceMetricCard = ({
  label,
  value,
  description,
  icon,
  accent = "blue",
  detail,
}: FinanceMetricCardProps) => {
  const palette = FINANCE_ACCENTS[accent];
  const style = {
    "--metric-color": palette.color,
    "--metric-soft": palette.soft,
  } as CSSProperties;

  return (
    <Paper className={classes.metricCard} style={style}>
      <Stack gap="sm" h="100%" justify="space-between">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={3} style={{ minWidth: 0 }}>
            <Text size="xs" fw={800} c="dimmed" tt="uppercase" style={{ letterSpacing: "0.075em" }}>
              {label}
            </Text>
            <Text className={classes.metricValue}>{value}</Text>
          </Stack>
          <ThemeIcon className={classes.metricIcon} variant="light" radius="lg" size={42}>
            {icon}
          </ThemeIcon>
        </Group>
        <Group justify="space-between" align="flex-end" gap="xs" wrap="nowrap">
          {description ? (
            <Text size="xs" c="dimmed" lineClamp={2}>
              {description}
            </Text>
          ) : <span />}
          {detail}
        </Group>
      </Stack>
    </Paper>
  );
};

type FinanceRecordField = {
  label: string;
  value: ReactNode;
};

type FinanceRecordCardProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  status?: ReactNode;
  fields?: FinanceRecordField[];
  actions?: ReactNode;
};

export const FinanceRecordCard = ({
  title,
  subtitle,
  leading,
  status,
  fields = [],
  actions,
}: FinanceRecordCardProps) => (
  <Paper className={classes.recordCard}>
    <Stack gap="sm">
      <Group justify="space-between" align="flex-start" gap="sm" wrap="nowrap">
        <Group gap="sm" align="flex-start" wrap="nowrap" style={{ minWidth: 0 }}>
          {leading}
          <Stack gap={2} style={{ minWidth: 0 }}>
            <Text fw={800} c="#172033" lineClamp={2}>
              {title}
            </Text>
            {subtitle ? (
              <Text size="xs" c="dimmed" lineClamp={2}>
                {subtitle}
              </Text>
            ) : null}
          </Stack>
        </Group>
        {status}
      </Group>
      {fields.length > 0 ? (
        <SimpleGrid cols={fields.length === 1 ? 1 : 2} spacing="xs">
          {fields.map((field) => (
            <Box className={classes.recordField} key={field.label}>
              <Text className={classes.recordFieldLabel}>{field.label}</Text>
              <Box className={classes.recordFieldValue}>{field.value}</Box>
            </Box>
          ))}
        </SimpleGrid>
      ) : null}
      {actions ? (
        <Group justify="flex-end" gap="xs" pt={2} wrap="wrap">
          {actions}
        </Group>
      ) : null}
    </Stack>
  </Paper>
);

type FinanceEmptyStateProps = {
  title: string;
  description: string;
  icon?: ReactNode;
  action?: ReactNode;
};

export const FinanceEmptyState = ({ title, description, icon, action }: FinanceEmptyStateProps) => (
  <Box className={classes.emptyState}>
    <Stack gap="sm" align="center" maw={440}>
      <Box className={classes.emptyIcon}>{icon ?? <IconInbox size={25} />}</Box>
      <Text fw={800} size="lg" c="#172033">
        {title}
      </Text>
      <Text size="sm" c="dimmed" ta="center" lh={1.55}>
        {description}
      </Text>
      {action ? <Box mt="xs">{action}</Box> : null}
    </Stack>
  </Box>
);

export const FinanceLoadingState = ({ label = "Loading finance data" }: { label?: string }) => (
  <Stack p="lg" gap="sm" aria-live="polite" aria-busy="true">
    <Text size="sm" fw={700} c="dimmed">
      {label}
    </Text>
    {[0, 1, 2].map((row) => (
      <Skeleton key={row} h={62} radius="md" animate />
    ))}
  </Stack>
);

type FinanceErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
};

export const FinanceErrorState = ({
  title = "We could not load this finance data",
  message,
  onRetry,
}: FinanceErrorStateProps) => (
  <Alert
    color="red"
    variant="light"
    radius="md"
    icon={<IconAlertTriangle size={19} />}
    title={title}
    m="md"
  >
    <Stack gap="sm">
      <Text size="sm">{message}</Text>
      {onRetry ? (
        <Button color="red" variant="light" size="xs" onClick={onRetry} style={{ alignSelf: "flex-start" }}>
          Try again
        </Button>
      ) : null}
    </Stack>
  </Alert>
);

type FinanceFormSectionProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  children: ReactNode;
};

export const FinanceFormSection = ({ title, description, icon, children }: FinanceFormSectionProps) => (
  <Box className={classes.formSection}>
    <Stack gap="md">
      <Group gap="sm" wrap="nowrap">
        {icon ? (
          <ThemeIcon variant="light" radius="md" size={34}>
            {icon}
          </ThemeIcon>
        ) : null}
        <Stack gap={1}>
          <Text component="h3" fw={800} size="sm">
            {title}
          </Text>
          {description ? (
            <Text size="xs" c="dimmed">
              {description}
            </Text>
          ) : null}
        </Stack>
      </Group>
      {children}
    </Stack>
  </Box>
);

type FinanceModalProps = ModalProps;

export const FinanceModal = ({ children, ...props }: FinanceModalProps) => {
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const reduceMotion = useReducedMotion();

  return (
    <Modal
      {...props}
      fullScreen={props.fullScreen ?? isMobile}
      centered={props.centered ?? !isMobile}
      radius={isMobile ? 0 : "xl"}
      overlayProps={{ backgroundOpacity: 0.42, blur: 4, ...props.overlayProps }}
      transitionProps={{
        transition: isMobile ? "slide-up" : "pop",
        duration: reduceMotion ? 0 : 180,
        ...props.transitionProps,
      }}
      closeButtonProps={{ "aria-label": "Close dialog", ...props.closeButtonProps }}
      classNames={{
        content: classes.modalContent,
        header: classes.modalHeader,
        title: classes.modalTitle,
        body: classes.modalBody,
        ...props.classNames,
      }}
    >
      {children}
    </Modal>
  );
};

export const FinanceModalFooter = ({ children }: { children: ReactNode }) => (
  <Group className={classes.modalFooter} justify="flex-end" gap="sm" wrap="wrap">
    {children}
  </Group>
);

type FinanceConfirmModalProps = {
  opened: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  confirmColor?: MantineColor;
  loading?: boolean;
  children?: ReactNode;
};

export const FinanceConfirmModal = ({
  opened,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  confirmColor = "red",
  loading = false,
  children,
}: FinanceConfirmModalProps) => (
  <FinanceModal opened={opened} onClose={onClose} title={title} size="sm" closeOnClickOutside={!loading} closeOnEscape={!loading}>
    <Stack gap="md">
      <Alert color={confirmColor} variant="light" icon={<IconAlertTriangle size={19} />}>
        {description}
      </Alert>
      {children}
      <FinanceModalFooter>
        <Button variant="default" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button color={confirmColor} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </FinanceModalFooter>
    </Stack>
  </FinanceModal>
);

export const FinancePrimaryAction = (props: PolymorphicComponentProps<"button", ButtonProps>) => (
  <Button {...props} color={props.color ?? "blue"} />
);

export const financePageClass = classes.page;
