import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDebouncedValue, useMediaQuery } from "@mantine/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { GridStack } from "gridstack";
import "gridstack/dist/gridstack.min.css";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Flex,
  Group,
  Loader,
  Modal,
  NumberInput,
  Paper,
  ScrollArea,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
  useMantineTheme,
} from "@mantine/core";
import {
  IconAdjustments,
  IconArrowLeft,
  IconDeviceFloppy,
  IconLayoutGrid,
  IconPlus,
  IconSearch,
  IconTableExport,
  IconTrash,
} from "@tabler/icons-react";
import type { GenericPageProps } from "../types/general/GenericPageProps";
import { useAppDispatch } from "../store/hooks";
import { navigateToPage } from "../actions/navigationActions";
import {
  useReportDashboards,
  useCreateDashboard,
  useUpdateDashboard,
  useDeleteDashboard,
  useUpsertDashboardCard,
  useDeleteDashboardCard,
  useExportDashboard,
  useReportTemplates,
  type DashboardCardDto,
  type DashboardCardPayload,
  type ReportDashboardDto,
  type ReportTemplateDto,
  type DashboardExportResponse,
} from "../api/reports";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";

type DashboardCardLayout = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type DashboardGridItem = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type CardDraft = {
  id?: string;
  templateId: string;
  title: string;
  layout: DashboardCardLayout;
  viewConfig: Record<string, unknown>;
};

const DEFAULT_CARD_LAYOUT: DashboardCardLayout = {
  x: 0,
  y: 0,
  w: 6,
  h: 4,
};
const LAYOUT_EDITOR_CELL_HEIGHT = 80;
const LAYOUT_EDITOR_GRID_SIZE = Math.max(12, Math.floor(LAYOUT_EDITOR_CELL_HEIGHT / 8));
const DEMO_GRID_ITEMS: Array<DashboardGridItem & { label: string; accent?: boolean }> = [
  { id: "1", x: 0, y: 0, w: 4, h: 2, label: "1" },
  { id: "2", x: 4, y: 0, w: 4, h: 4, label: "2" },
  { id: "3", x: 8, y: 0, w: 2, h: 2, label: "Drag me!", accent: true },
  { id: "4", x: 10, y: 0, w: 2, h: 2, label: "4" },
  { id: "5", x: 0, y: 2, w: 2, h: 2, label: "5" },
  { id: "6", x: 2, y: 2, w: 2, h: 2, label: "6" },
  { id: "7", x: 8, y: 2, w: 4, h: 2, label: "7" },
  { id: "8", x: 0, y: 4, w: 2, h: 2, label: "8" },
  { id: "9", x: 4, y: 4, w: 4, h: 2, label: "9" },
  { id: "10", x: 8, y: 4, w: 2, h: 2, label: "10" },
  { id: "11", x: 10, y: 4, w: 2, h: 2, label: "11" },
];

const DASHBOARD_EDITOR_GRID_CSS = `
.dashboard-layout-grid .grid-stack-item-content {
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  border-radius: 14px;
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
  border: 1px solid rgba(15, 23, 42, 0.1);
  font-size: 16px;
  font-weight: 600;
  color: #111827;
  cursor: grab;
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}
.dashboard-layout-grid .grid-stack-item-content:active {
  cursor: grabbing;
}
.dashboard-layout-grid .grid-stack-item-content:hover {
  box-shadow: 0 16px 34px rgba(15, 23, 42, 0.12);
  transform: translateY(-2px);
}
.dashboard-layout-grid .demo-grid-item.is-accent {
  color: #2563eb;
}
.dashboard-layout-grid .ui-resizable-handle {
  background: transparent;
}
`;

const deepClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const resolveNumericValue = (value: number | string | undefined): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseLayout = (layout: Record<string, unknown> | undefined | null): DashboardCardLayout => {
  const safeLayout = layout && typeof layout === "object" ? layout : {};
  const resolveNumber = (key: string, fallback: number): number => {
    const candidate = safeLayout?.[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string") {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
  };
  const width = Math.max(1, Math.min(12, resolveNumber("w", DEFAULT_CARD_LAYOUT.w)));
  const height = Math.max(1, resolveNumber("h", DEFAULT_CARD_LAYOUT.h));
  return {
    x: resolveNumber("x", DEFAULT_CARD_LAYOUT.x),
    y: resolveNumber("y", DEFAULT_CARD_LAYOUT.y),
    w: width,
    h: height,
  };
};

const normalizeGridItem = (item: DashboardGridItem): DashboardCardLayout => ({
  x: Math.max(0, item.x),
  y: Math.max(0, item.y),
  w: Math.max(1, Math.min(12, item.w)),
  h: Math.max(1, item.h),
});

const layoutsAreEqual = (a: DashboardCardLayout, b: DashboardCardLayout): boolean =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

const downloadDashboardExport = (payload: DashboardExportResponse, filename: string) => {
  const blob = new Blob([JSON.stringify(payload.export, null, 2)], {
    type: payload.export.format ?? "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const getViewConfigDescription = (viewConfig: Record<string, unknown> | undefined | null): string => {
  if (!viewConfig || typeof viewConfig !== "object") {
    return "";
  }
  const candidate = (viewConfig as { description?: unknown }).description;
  return typeof candidate === "string" ? candidate : "";
};

const useTemplateLookup = (templates: ReportTemplateDto[]) => {
  return useMemo(() => {
    const map = new Map<string, ReportTemplateDto>();
    templates.forEach((template) => {
      if (template.id) {
        map.set(template.id, template);
      }
    });
    return map;
  }, [templates]);
};

const DashboardCardSummary = ({
  card,
  template,
}: {
  card: DashboardCardDto;
  template: ReportTemplateDto | undefined;
}) => {
  const layout = parseLayout(card.layout);
  const description = getViewConfigDescription(card.viewConfig);
  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text fw={600}>{card.title}</Text>
        <Badge variant="light" color="blue">
          {layout.w}×{layout.h}
        </Badge>
      </Group>
      <Text fz="sm" c="dimmed">
        Template: {template?.name ?? card.templateId}
      </Text>
      <Text fz="xs" c="dimmed">
        Position ({layout.x}, {layout.y})
      </Text>
      {description.length > 0 && (
        <Text fz="xs">{description}</Text>
      )}
    </Stack>
  );
};

const DashboardCardList = ({
  cards,
  templateLookup,
  onEdit,
  onRemove,
}: {
  cards: DashboardCardDto[];
  templateLookup: Map<string, ReportTemplateDto>;
  onEdit: (card: DashboardCardDto) => void;
  onRemove: (card: DashboardCardDto) => void;
}) => {
  if (cards.length === 0) {
    return (
      <Paper withBorder radius="md" p="lg">
        <Stack gap="xs" align="center">
          <IconLayoutGrid size={32} stroke={1.5} />
          <Text c="dimmed">No cards yet. Add a card to start building the dashboard.</Text>
        </Stack>
      </Paper>
    );
  }

  return (
    <Stack gap="sm">
      {cards.map((card) => {
        const template = templateLookup.get(card.templateId);
        return (
          <Card key={card.id} withBorder radius="md" padding="md" shadow="sm">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text fw={600}>{card.title}</Text>
                <Group gap="xs">
                  <Button variant="light" size="xs" onClick={() => onEdit(card)}>
                    Edit
                  </Button>
                  <ActionIcon variant="subtle" color="red" onClick={() => onRemove(card)} aria-label="Remove card">
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              </Group>
              <DashboardCardSummary card={card} template={template} />
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
};

const DashboardLayoutEditor = ({ onLayoutCommit }: { onLayoutCommit: (layout: DashboardGridItem[]) => void }) => {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gridInstanceRef = useRef<GridStack | null>(null);
  const layoutCommitRef = useRef(onLayoutCommit);
  const isSyncingRef = useRef(false);
  const lastMinRowRef = useRef<number | null>(null);
  const demoItems = useMemo(() => DEMO_GRID_ITEMS, []);
  const layoutById = useMemo(() => {
    const map = new Map<string, DashboardCardLayout>();
    demoItems.forEach((item) => {
      map.set(item.id, { x: item.x, y: item.y, w: item.w, h: item.h });
    });
    return map;
  }, [demoItems]);

  const updateGridMinRows = useCallback(() => {
    const container = gridRef.current;
    const grid = gridInstanceRef.current;
    if (!container || !grid) {
      return;
    }
    const baseHeight = container.parentElement?.getBoundingClientRect().height ?? container.clientHeight;
    if (!baseHeight) {
      return;
    }
    const cellHeight = resolveNumericValue(grid.opts.cellHeight);
    if (!cellHeight || cellHeight <= 0) {
      return;
    }
    const safeHeight = Math.max(0, baseHeight - 1);
    const nextMinRow = Math.max(1, Math.floor(safeHeight / cellHeight));
    if (lastMinRowRef.current === nextMinRow) {
      return;
    }
    lastMinRowRef.current = nextMinRow;
    grid.opts.minRow = nextMinRow;
    const gridWithUpdate = grid as GridStack & { _updateContainerHeight?: () => void };
    gridWithUpdate._updateContainerHeight?.();
  }, []);

  useEffect(() => {
    layoutCommitRef.current = onLayoutCommit;
  }, [onLayoutCommit]);

  useEffect(() => {
    const container = gridRef.current;
    if (!container) {
      return;
    }
    let grid = gridInstanceRef.current;
    if (!grid) {
      grid = GridStack.init(
        {
          column: 12,
          cellHeight: LAYOUT_EDITOR_CELL_HEIGHT,
          margin: "0px 0px",
          float: true,
          disableOneColumnMode: true,
          draggable: {
            handle: ".grid-stack-item-content",
          },
          resizable: {
            handles: "all",
            autoHide: true,
          },
        },
        container,
      );
      const handleChange = () => {
        if (isSyncingRef.current) {
          return;
        }
        const nodes = grid?.engine?.nodes ?? [];
        const nextLayout = nodes
          .map((node) => ({
            id: String(node.id ?? node.el?.getAttribute("gs-id") ?? node.el?.getAttribute("data-gs-id") ?? ""),
            x: node.x ?? 0,
            y: node.y ?? 0,
            w: node.w ?? 1,
            h: node.h ?? 1,
          }))
          .filter((node) => node.id.length > 0);
        if (nextLayout.length > 0) {
          layoutCommitRef.current(nextLayout);
        }
      };
      grid.on("change", handleChange);
      gridInstanceRef.current = grid;
      updateGridMinRows();
      requestAnimationFrame(() => updateGridMinRows());
      const activeGrid = grid;
      return () => {
        activeGrid.off("change");
        activeGrid.destroy(false);
        gridInstanceRef.current = null;
      };
    }
    return undefined;
  }, [updateGridMinRows]);

  useEffect(() => {
    const container = gridRef.current;
    const grid = gridInstanceRef.current;
    if (!container || !grid) {
      return;
    }
    isSyncingRef.current = true;
    grid.batchUpdate();
    grid.removeAll(false);
    container.querySelectorAll<HTMLElement>(".grid-stack-item").forEach((element) => {
      const cardId = element.getAttribute("gs-id") ?? element.getAttribute("data-gs-id");
      const layout = cardId ? layoutById.get(String(cardId)) : null;
      if (cardId && layout) {
        grid.makeWidget(element, {
          x: layout.x,
          y: layout.y,
          w: layout.w,
          h: layout.h,
          id: cardId,
        });
        return;
      }
      grid.makeWidget(element);
    });
    grid.batchUpdate(false);
    isSyncingRef.current = false;
    updateGridMinRows();
    requestAnimationFrame(() => updateGridMinRows());
  }, [demoItems, layoutById, updateGridMinRows]);

  useEffect(() => {
    const container = gridRef.current;
    if (!container) {
      return;
    }
    const observedElement = container.parentElement ?? container;
    let resizeObserver: ResizeObserver | null = null;
    const handleResize = () => updateGridMinRows();

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => updateGridMinRows());
      resizeObserver.observe(observedElement);
    } else {
      window.addEventListener("resize", handleResize);
    }
    updateGridMinRows();
    requestAnimationFrame(() => updateGridMinRows());

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener("resize", handleResize);
      }
    };
  }, [updateGridMinRows]);

  return (
    <Box
      ref={gridRef}
      className="dashboard-layout-grid grid-stack"
      style={{
        width: "100%",
        height: "100%",
        minHeight: "100%",
        borderRadius: 14,
        border: "1px dashed rgba(15, 23, 42, 0.18)",
        backgroundColor: "#f5f7fb",
        backgroundImage:
          "linear-gradient(0deg, rgba(15, 23, 42, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(15, 23, 42, 0.06) 1px, transparent 1px)",
        backgroundSize: `${LAYOUT_EDITOR_GRID_SIZE}px ${LAYOUT_EDITOR_GRID_SIZE}px`,
        overflow: "hidden",
      }}
    >
      <style>{DASHBOARD_EDITOR_GRID_CSS}</style>
      {demoItems.map((item) => (
        <div
          key={item.id}
          className="grid-stack-item"
          data-gs-id={item.id}
          data-gs-x={item.x}
          data-gs-y={item.y}
          data-gs-w={item.w}
          data-gs-h={item.h}
          data-gs-width={item.w}
          data-gs-height={item.h}
        >
          <div className={`grid-stack-item-content demo-grid-item${item.accent ? " is-accent" : ""}`}>
            {item.label}
          </div>
        </div>
      ))}
    </Box>
  );
};

const DEFAULT_VIEW_CONFIG: Record<string, unknown> = {
  mode: "template-default",
};

const createCardDraftFromTemplate = (template: ReportTemplateDto | undefined): CardDraft => {
  const title = template?.name ?? "Dashboard card";
  const viewConfig =
    template?.queryConfig !== null && template?.queryConfig !== undefined
      ? { ...DEFAULT_VIEW_CONFIG, queryConfig: deepClone(template.queryConfig) }
      : { ...DEFAULT_VIEW_CONFIG };
  return {
    templateId: template?.id ?? "",
    title,
    viewConfig,
    layout: { ...DEFAULT_CARD_LAYOUT },
  };
};

const createCardDraftFromCard = (card: DashboardCardDto): CardDraft => ({
  id: card.id,
  templateId: card.templateId,
  title: card.title,
  viewConfig: deepClone(card.viewConfig ?? DEFAULT_VIEW_CONFIG),
  layout: parseLayout(card.layout),
});

const ReportDashboards = ({ title }: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const theme = useMantineTheme();
  const isMobile = useMediaQuery(`(max-width: ${theme.breakpoints.sm})`);
  const layoutEditorHeaderHeight = isMobile ? 56 : 68;
  const layoutEditorPaddingX = isMobile ? 16 : 24;
  const layoutEditorPaddingY = isMobile ? 12 : 20;
  const layoutEditorGridPaddingX = isMobile ? 8 : 12;
  const layoutEditorGridPaddingY = isMobile ? 8 : 12;

  useEffect(() => {
    dispatch(navigateToPage(title ?? "Report dashboards"));
  }, [dispatch, title]);

  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, 250);
  const dashboardsQuery = useReportDashboards({ search: debouncedSearch.trim() });
  const templatesQuery = useReportTemplates();

  const dashboards = useMemo(
    () => dashboardsQuery.data?.dashboards ?? [],
    [dashboardsQuery.data?.dashboards],
  );
  const templates = useMemo(
    () => templatesQuery.data?.templates ?? [],
    [templatesQuery.data?.templates],
  );
  const templateLookup = useTemplateLookup(templates);
  const templateOptions = useMemo(
    () =>
      templates.map((template) => ({
        value: template.id,
        label: template.name ?? "Untitled template",
      })),
    [templates],
  );

  const [selectedDashboardId, setSelectedDashboardId] = useState<string | null>(null);
  const [dashboardDraft, setDashboardDraft] = useState<ReportDashboardDto | null>(null);
  const [cardModalOpen, setCardModalOpen] = useState(false);
  const [cardDraft, setCardDraft] = useState<CardDraft | null>(null);
  const [cardMode, setCardMode] = useState<"create" | "edit">("create");
  const [layoutEditorOpen, setLayoutEditorOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [pendingLayoutChanges, setPendingLayoutChanges] = useState<Record<string, DashboardCardLayout>>({});
  const [isSavingLayout, setIsSavingLayout] = useState(false);

  useEffect(() => {
    if (!selectedDashboardId && dashboards.length > 0) {
      setSelectedDashboardId(dashboards[0].id);
    }
  }, [dashboards, selectedDashboardId]);

  const selectedDashboard = useMemo(
    () => dashboards.find((dashboard) => dashboard.id === selectedDashboardId) ?? null,
    [dashboards, selectedDashboardId],
  );

  useEffect(() => {
    if (selectedDashboard) {
      setDashboardDraft(deepClone(selectedDashboard));
    } else {
      setDashboardDraft(null);
    }
  }, [selectedDashboard]);

  useEffect(() => {
    setPendingLayoutChanges({});
  }, [selectedDashboardId]);

  const createDashboardMutation = useCreateDashboard();
  const updateDashboardMutation = useUpdateDashboard();
  const deleteDashboardMutation = useDeleteDashboard();
  const upsertCardMutation = useUpsertDashboardCard();
  const deleteCardMutation = useDeleteDashboardCard();
  const exportDashboardMutation = useExportDashboard();

  const handleCreateDashboard = async () => {
    setFeedback(null);
    try {
      const created = await createDashboardMutation.mutateAsync({
        name: "Untitled dashboard",
        description: "",
      });
      queryClient.invalidateQueries({ queryKey: ["reports", "dashboards"] });
      setSelectedDashboardId(created.id);
      setFeedback({ type: "success", message: "Dashboard created." });
    } catch (error) {
      console.error("Failed to create dashboard", error);
      setFeedback({ type: "error", message: "Failed to create dashboard." });
    }
  };

  const handleSaveDashboard = async () => {
    if (!dashboardDraft) {
      return;
    }
    setFeedback(null);
    try {
      const payload = {
        name: dashboardDraft.name,
        description: dashboardDraft.description,
      };
      await updateDashboardMutation.mutateAsync({
        id: dashboardDraft.id,
        payload,
      });
      queryClient.invalidateQueries({ queryKey: ["reports", "dashboards"] });
      setFeedback({ type: "success", message: "Dashboard updated." });
    } catch (error) {
      console.error("Failed to update dashboard", error);
      setFeedback({ type: "error", message: "Failed to update dashboard." });
    }
  };

  const handleDeleteDashboard = async () => {
    if (!dashboardDraft) {
      return;
    }
    if (!window.confirm("Delete this dashboard? This cannot be undone.")) {
      return;
    }
    setFeedback(null);
    try {
      await deleteDashboardMutation.mutateAsync(dashboardDraft.id);
      queryClient.invalidateQueries({ queryKey: ["reports", "dashboards"] });
      setSelectedDashboardId(null);
      setFeedback({ type: "success", message: "Dashboard deleted." });
    } catch (error) {
      console.error("Failed to delete dashboard", error);
      setFeedback({ type: "error", message: "Failed to delete dashboard." });
    }
  };

  const handleOpenCreateCard = () => {
    if (!dashboardDraft) {
      return;
    }
    const template = templates[0];
    setCardDraft(createCardDraftFromTemplate(template));
    setCardMode("create");
    setCardModalOpen(true);
  };

  const handleOpenEditCard = (card: DashboardCardDto) => {
    setCardDraft(createCardDraftFromCard(card));
    setCardMode("edit");
    setCardModalOpen(true);
  };

  const handleRemoveCard = async (card: DashboardCardDto) => {
    if (!dashboardDraft) {
      return;
    }
    if (!window.confirm("Remove this card from the dashboard?")) {
      return;
    }
    setFeedback(null);
    try {
      await deleteCardMutation.mutateAsync({ dashboardId: dashboardDraft.id, cardId: card.id });
      queryClient.invalidateQueries({ queryKey: ["reports", "dashboards"] });
      setFeedback({ type: "success", message: "Card removed." });
    } catch (error) {
      console.error("Failed to remove card", error);
      setFeedback({ type: "error", message: "Failed to remove card." });
    }
  };

  const handleLayoutCommit = (nextLayout: DashboardGridItem[]) => {
    if (!dashboardDraft || nextLayout.length === 0) {
      return;
    }
    const normalized = new Map<string, DashboardCardLayout>();
    nextLayout.forEach((item) => {
      normalized.set(item.id, normalizeGridItem(item));
    });

    setDashboardDraft((current) => {
      if (!current) {
        return current;
      }
      const nextCards = current.cards.map((card) => {
        const layout = normalized.get(card.id);
        if (!layout) {
          return card;
        }
        return {
          ...card,
          layout: {
            x: layout.x,
            y: layout.y,
            w: layout.w,
            h: layout.h,
          },
        };
      });
      return { ...current, cards: nextCards };
    });

    setPendingLayoutChanges((current) => {
      const nextChanges = { ...current };
      normalized.forEach((layout, cardId) => {
        const baselineCard = selectedDashboard?.cards?.find((card) => card.id === cardId);
        const baselineLayout = baselineCard ? parseLayout(baselineCard.layout) : layout;
        if (layoutsAreEqual(layout, baselineLayout)) {
          delete nextChanges[cardId];
        } else {
          nextChanges[cardId] = layout;
        }
      });
      return nextChanges;
    });
  };

  const handleSaveLayoutChanges = async () => {
    if (!dashboardDraft) {
      return;
    }
    const entries = Object.entries(pendingLayoutChanges);
    if (entries.length === 0) {
      return;
    }
    setIsSavingLayout(true);
    setFeedback(null);
    try {
      await Promise.all(
        entries.map(([cardId, layout]) => {
          const card = dashboardDraft.cards.find((candidate) => candidate.id === cardId);
          if (!card) {
            return null;
          }
          return upsertCardMutation.mutateAsync({
            dashboardId: dashboardDraft.id,
            cardId,
            payload: {
              templateId: card.templateId,
              title: card.title,
              viewConfig: card.viewConfig as Record<string, unknown>,
              layout,
            },
          });
        }),
      );
      setPendingLayoutChanges({});
      await queryClient.invalidateQueries({ queryKey: ["reports", "dashboards"] });
      setFeedback({ type: "success", message: "Layout saved." });
    } catch (error) {
      console.error("Failed to save layout", error);
      setFeedback({ type: "error", message: "Failed to save layout." });
    } finally {
      setIsSavingLayout(false);
    }
  };

  const handleSaveCard = async () => {
    if (!dashboardDraft || !cardDraft) {
      return;
    }
    if (!cardDraft.templateId || cardDraft.templateId.trim().length === 0) {
      setFeedback({ type: "error", message: "Select a template for the card." });
      return;
    }
    if (!cardDraft.title || cardDraft.title.trim().length === 0) {
      setFeedback({ type: "error", message: "Card title is required." });
      return;
    }
    const payload: DashboardCardPayload = {
      templateId: cardDraft.templateId,
      title: cardDraft.title,
      viewConfig: deepClone(cardDraft.viewConfig),
      layout: {
        x: cardDraft.layout.x,
        y: cardDraft.layout.y,
        w: cardDraft.layout.w,
        h: cardDraft.layout.h,
      },
    };
    setFeedback(null);
    try {
      await upsertCardMutation.mutateAsync({
        dashboardId: dashboardDraft.id,
        cardId: cardMode === "edit" ? cardDraft.id : undefined,
        payload,
      });
      queryClient.invalidateQueries({ queryKey: ["reports", "dashboards"] });
      setCardModalOpen(false);
      setCardDraft(null);
      setFeedback({ type: "success", message: "Card saved." });
    } catch (error) {
      console.error("Failed to save dashboard card", error);
      setFeedback({ type: "error", message: "Failed to save dashboard card." });
    }
  };

  const handleExportDashboard = async () => {
    if (!dashboardDraft) {
      return;
    }
    setFeedback(null);
    try {
      const result = await exportDashboardMutation.mutateAsync(dashboardDraft.id);
      const filename = `${dashboardDraft.name.replace(/[^a-z0-9-_]+/gi, "_") || "dashboard"}_${Date.now()}.json`;
      downloadDashboardExport(result, filename);
      setFeedback({ type: "success", message: "Dashboard export downloaded." });
    } catch (error) {
      console.error("Failed to export dashboard", error);
      setFeedback({ type: "error", message: "Failed to export dashboard." });
    }
  };

  const isBusy =
    dashboardsQuery.isLoading ||
    templatesQuery.isLoading ||
    createDashboardMutation.isPending ||
    updateDashboardMutation.isPending ||
    deleteDashboardMutation.isPending ||
    upsertCardMutation.isPending ||
    deleteCardMutation.isPending ||
    exportDashboardMutation.isPending;

  const pendingLayoutCount = Object.keys(pendingLayoutChanges).length;

  const selectedDashboardCards = dashboardDraft?.cards ?? selectedDashboard?.cards ?? [];

  return (
    <PageAccessGuard pageSlug={PAGE_SLUGS.reports}>
      <Box bg="#f4f6f8" p="xl" style={{ minHeight: "100vh" }}>
        <Stack gap="xl">
          <Group justify="space-between" align="flex-start">
            <Stack gap="xs">
              <Group gap="sm">
                <ActionIcon variant="light" aria-label="Back to report builder" onClick={() => navigate("/reports")}>
                  <IconArrowLeft size={18} />
                </ActionIcon>
                <Title order={2}>Dashboards workspace</Title>
              </Group>
              <Text c="dimmed">
                Curate dashboards composed of saved report templates. Configure card layouts, tailor presets, and export
                the configuration for distribution.
              </Text>
            </Stack>
            <Group gap="sm">
              <Button
                variant="light"
                leftSection={<IconLayoutGrid size={16} />}
                onClick={handleCreateDashboard}
                loading={createDashboardMutation.isPending}
              >
                New dashboard
              </Button>
              {dashboardDraft && (
                <Button
                  variant="light"
                  leftSection={<IconTableExport size={16} />}
                  onClick={handleExportDashboard}
                  loading={exportDashboardMutation.isPending}
                >
                  Export dashboard
                </Button>
              )}
              <Button
                leftSection={<IconDeviceFloppy size={16} />}
                onClick={handleSaveDashboard}
                disabled={!dashboardDraft}
                loading={updateDashboardMutation.isPending}
              >
                Save changes
              </Button>
            </Group>
          </Group>

          {feedback && (
            <Text c={feedback.type === "success" ? "teal" : "red"}>{feedback.message}</Text>
          )}

          <Flex gap="lg" align="flex-start" direction={{ base: "column", lg: "row" }}>
            <Stack gap="lg" style={{ width: 320, flexShrink: 0 }}>
              <Paper withBorder radius="lg" p="md" shadow="xs">
                <Stack gap="sm">
                  <TextInput
                    placeholder="Search dashboards"
                    value={search}
                    onChange={(event) => setSearch(event.currentTarget.value)}
                    leftSection={<IconSearch size={14} />}
                    size="sm"
                  />
                  <Divider my="xs" />
                  {dashboardsQuery.isLoading ? (
                    <Stack align="center" gap="xs">
                      <Loader size="sm" />
                      <Text c="dimmed" fz="sm">
                        Loading dashboards...
                      </Text>
                    </Stack>
                  ) : dashboards.length === 0 ? (
                    <Text c="dimmed" fz="sm">
                      No dashboards found. Create one to get started.
                    </Text>
                  ) : (
                    <ScrollArea h={420} type="always" offsetScrollbars>
                      <Stack gap="sm">
                        {dashboards.map((dashboard) => {
                          const isActive = dashboard.id === selectedDashboardId;
                          return (
                            <Card
                              key={dashboard.id}
                              withBorder
                              padding="sm"
                              radius="md"
                              shadow={isActive ? "sm" : "xs"}
                              onClick={() => setSelectedDashboardId(dashboard.id)}
                              style={{ cursor: "pointer", borderColor: isActive ? "#1c7ed6" : undefined }}
                            >
                              <Stack gap={4}>
                                <Text fw={600}>{dashboard.name}</Text>
                                <Text fz="xs" c="dimmed">
                                  {dashboard.description ?? "No description"}
                                </Text>
                                <Group gap={6}>
                                  <Badge size="xs" variant="light">
                                    {dashboard.cards.length} cards
                                  </Badge>
                                  <Badge size="xs" variant="light" color="gray">
                                    {dashboard.updatedAt ? new Date(dashboard.updatedAt).toLocaleString() : "Draft"}
                                  </Badge>
                                </Group>
                              </Stack>
                            </Card>
                          );
                        })}
                      </Stack>
                    </ScrollArea>
                  )}
                </Stack>
              </Paper>
            </Stack>

            <Stack gap="lg" style={{ flex: 1, width: "100%" }}>
              <Paper withBorder radius="lg" p="lg" shadow="xs">
                {isBusy && !dashboardDraft && dashboards.length === 0 ? (
                  <Stack align="center" gap="xs">
                    <Loader size="sm" />
                    <Text c="dimmed" fz="sm">
                      Loading workspace...
                    </Text>
                  </Stack>
                ) : !dashboardDraft ? (
                  <Stack gap="sm" align="center">
                    <IconAdjustments size={36} stroke={1.5} />
                    <Text c="dimmed" fz="sm" ta="center">
                      Select a dashboard from the list or create a new one to configure cards and layout.
                    </Text>
                  </Stack>
                ) : (
                  <Stack gap="lg">
                    <Stack gap="xs">
                      <Group gap="sm">
                        <TextInput
                          label="Dashboard name"
                          value={dashboardDraft.name}
                          onChange={(event) =>
                            setDashboardDraft((current) =>
                              current ? { ...current, name: event.currentTarget.value } : current,
                            )
                          }
                          style={{ flex: 1 }}
                        />
                        <Button
                          variant="light"
                          color="red"
                          leftSection={<IconTrash size={16} />}
                          onClick={handleDeleteDashboard}
                          disabled={deleteDashboardMutation.isPending}
                        >
                          Delete
                        </Button>
                      </Group>
                      <Textarea
                        label="Description"
                        value={dashboardDraft.description ?? ""}
                        onChange={(event) =>
                          setDashboardDraft((current) =>
                            current ? { ...current, description: event.currentTarget.value } : current,
                          )
                        }
                        minRows={2}
                        placeholder="Summarize the purpose of this dashboard."
                      />
                    </Stack>

                    <Divider label="Cards" labelPosition="center" />

                    <Group justify="space-between" align="center">
                      <Text fw={600}>Dashboard cards</Text>
                      <Group gap="sm">
                        <Button
                          variant="light"
                          leftSection={<IconLayoutGrid size={16} />}
                          onClick={() => setLayoutEditorOpen(true)}
                        >
                          Open layout editor
                        </Button>
                        <Button
                          variant="light"
                          leftSection={<IconPlus size={16} />}
                          onClick={handleOpenCreateCard}
                          disabled={templates.length === 0}
                        >
                          Add card
                        </Button>
                      </Group>
                    </Group>

                    <DashboardCardList
                      cards={selectedDashboardCards}
                      templateLookup={templateLookup}
                      onEdit={handleOpenEditCard}
                      onRemove={handleRemoveCard}
                    />
                  </Stack>
                )}
              </Paper>
            </Stack>
          </Flex>
        </Stack>
      </Box>

      <Modal
        opened={cardModalOpen}
        onClose={() => setCardModalOpen(false)}
        title={cardMode === "create" ? "Add dashboard card" : "Edit dashboard card"}
        centered
        size="lg"
      >
        {cardDraft ? (
          <Stack gap="md">
            <Select
              label="Template"
              data={templateOptions}
              value={cardDraft.templateId || null}
              onChange={(value) => {
                const template = templateLookup.get(value ?? "");
                setCardDraft((current) => {
                  if (!current) {
                    return null;
                  }
                  const next = {
                    ...current,
                    templateId: value ?? "",
                  };
                  if (template && cardMode === "create") {
                    const fromTemplate = createCardDraftFromTemplate(template);
                    return {
                      ...next,
                      title: fromTemplate.title,
                      viewConfig: fromTemplate.viewConfig,
                      layout: fromTemplate.layout,
                    };
                  }
                  return next;
                });
              }}
              searchable
              placeholder={templates.length === 0 ? "No templates available" : "Select template"}
              disabled={templates.length === 0}
            />
            <TextInput
              label="Card title"
              value={cardDraft.title}
              onChange={(event) =>
                setCardDraft((current) => (current ? { ...current, title: event.currentTarget.value } : current))
              }
              placeholder="Display name for the card"
            />
            <Textarea
              label="Notes"
              value={getViewConfigDescription(cardDraft.viewConfig)}
              onChange={(event) =>
                setCardDraft((current) =>
                  current
                    ? {
                        ...current,
                        viewConfig: {
                          ...current.viewConfig,
                          description: event.currentTarget.value,
                        },
                      }
                    : current,
                )
              }
              minRows={2}
              placeholder="Optional context shown in the dashboard."
            />
            <Group align="flex-end" gap="sm">
              <NumberInput
                label="Columns (1-12)"
                value={cardDraft.layout.w}
                onChange={(value) =>
                  setCardDraft((current) =>
                    current
                      ? {
                          ...current,
                          layout: {
                            ...current.layout,
                            w: typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.min(12, value)) : 6,
                          },
                        }
                      : current,
                  )
                }
                min={1}
                max={12}
              />
              <NumberInput
                label="Rows"
                value={cardDraft.layout.h}
                onChange={(value) =>
                  setCardDraft((current) =>
                    current
                      ? {
                          ...current,
                          layout: {
                            ...current.layout,
                            h: typeof value === "number" && Number.isFinite(value) ? Math.max(1, value) : 4,
                          },
                        }
                      : current,
                  )
                }
                min={1}
              />
              <NumberInput
                label="Start column"
                value={cardDraft.layout.x}
                onChange={(value) =>
                  setCardDraft((current) =>
                    current
                      ? {
                          ...current,
                          layout: {
                            ...current.layout,
                            x: typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0,
                          },
                        }
                      : current,
                  )
                }
                min={0}
              />
              <NumberInput
                label="Start row"
                value={cardDraft.layout.y}
                onChange={(value) =>
                  setCardDraft((current) =>
                    current
                      ? {
                          ...current,
                          layout: {
                            ...current.layout,
                            y: typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0,
                          },
                        }
                      : current,
                  )
                }
                min={0}
              />
            </Group>
            <Group justify="flex-end" gap="sm">
              <Button variant="light" onClick={() => setCardModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveCard} loading={upsertCardMutation.isPending}>
                {cardMode === "create" ? "Add card" : "Save card"}
              </Button>
            </Group>
          </Stack>
        ) : (
          <Stack align="center" gap="xs">
            <Loader size="sm" />
          </Stack>
        )}
      </Modal>

      <Modal
        opened={layoutEditorOpen}
        onClose={() => setLayoutEditorOpen(false)}
        title={null}
        fullScreen
        padding={0}
        withCloseButton={false}
        styles={{
          inner: { padding: 0 },
          content: {
            display: "flex",
            flexDirection: "column",
            width: "100vw",
            maxWidth: "100vw",
            margin: 0,
            borderRadius: 0,
          },
          body: { flex: 1, display: "flex", flexDirection: "column", padding: 0 },
        }}
      >
        <Box
          style={{
            height: layoutEditorHeaderHeight,
            minHeight: layoutEditorHeaderHeight,
            display: "flex",
            flexWrap: "nowrap",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            columnGap: 12,
            padding: `0 ${layoutEditorPaddingX}px`,
            background: `linear-gradient(135deg, ${theme.colors.dark[7]} 0%, ${theme.colors.dark[8]} 45%, ${theme.colors.dark[9]} 100%)`,
            borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
            boxShadow: "0 10px 30px rgba(0, 0, 0, 0.22)",
            color: theme.white,
          }}
        >
          <Text
            fw={600}
            c="white"
            size={isMobile ? "sm" : "md"}
            style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
          >
            Layout editor
          </Text>
          <Group gap={isMobile ? 6 : "sm"} wrap="nowrap" justify="flex-end" style={{ flexShrink: 0 }}>
            <Button
              size={isMobile ? "xs" : "sm"}
              variant="outline"
              onClick={() => setLayoutEditorOpen(false)}
              styles={{
                root: {
                  borderColor: "rgba(255,255,255,0.4)",
                  color: "#fff",
                  paddingLeft: isMobile ? 10 : undefined,
                  paddingRight: isMobile ? 10 : undefined,
                  height: isMobile ? 28 : undefined,
                  minHeight: isMobile ? 28 : undefined,
                },
              }}
            >
              Close
            </Button>
            <Button
              size={isMobile ? "xs" : "sm"}
              leftSection={<IconDeviceFloppy size={isMobile ? 14 : 16} />}
              onClick={handleSaveLayoutChanges}
              disabled={pendingLayoutCount === 0 || isSavingLayout}
              loading={isSavingLayout}
              styles={{
                root: {
                  backgroundColor: "#ffffff",
                  color: "#0b0d12",
                  paddingLeft: isMobile ? 10 : undefined,
                  paddingRight: isMobile ? 10 : undefined,
                  height: isMobile ? 28 : undefined,
                  minHeight: isMobile ? 28 : undefined,
                },
              }}
            >
              {isMobile ? "Save" : "Save layout"}
            </Button>
          </Group>
        </Box>
        <Box
          style={{
            flex: 1,
            padding: `${layoutEditorGridPaddingY}px ${layoutEditorGridPaddingX}px`,
            backgroundColor: "#f4f4f7",
            minHeight: 0,
            display: "flex",
          }}
        >
          <Box style={{ flex: 1, minHeight: 0, height: "100%" }}>
            <DashboardLayoutEditor
              onLayoutCommit={handleLayoutCommit}
            />
          </Box>
        </Box>
      </Modal>
    </PageAccessGuard>
  );
};

export default ReportDashboards;
