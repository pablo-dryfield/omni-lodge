import { startTransition, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  NumberInput,
  Modal,
  Paper,
  Popover,
  Select,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import { DateInput } from "@mantine/dates";
import { useMediaQuery } from "@mantine/hooks";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconChartBar,
  IconBeer,
  IconChevronLeft,
  IconChevronRight,
  IconChevronDown,
  IconChevronUp,
  IconCheck,
  IconClipboardList,
  IconClockPlay,
  IconFlask,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSettings,
  IconTags,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import dayjs from "dayjs";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError, type AxiosError } from "axios";
import type { GenericPageProps } from "../types/general/GenericPageProps";
import type { User } from "../types/users/User";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import axiosInstance from "../utils/axiosInstance";
import { navigateToPage } from "../actions/navigationActions";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";
import {
  type OpenBarDrinkLabelDisplayMode as ApiDrinkLabelDisplayMode,
  useCloseOpenBarSession,
  useCreateOpenBarIngredientVariant,
  useCreateOpenBarDelivery,
  useDeleteOpenBarSession,
  useDeleteOpenBarDrinkIssue,
  useCreateOpenBarDrinkIssue,
  useCreateOpenBarIngredient,
  useCreateOpenBarIngredientCategory,
  useCreateOpenBarSessionType,
  useCreateOpenBarInventoryAdjustment,
  useCreateOpenBarRecipe,
  useCreateOpenBarSession,
  useOpenBarBootstrap,
  useJoinOpenBarSession,
  useLeaveOpenBarSession,
  useUpdateOpenBarIngredientCategory,
  useStartOpenBarSession,
  useUpdateOpenBarIngredient,
  useUpdateOpenBarDrinkLabelSettings,
  useUpdateOpenBarSessionType,
  useUpdateOpenBarIngredientVariant,
  useUpdateOpenBarRecipe,
  useReplaceOpenBarRecipeIngredients,
} from "../api/openBar";

const PAGE_SLUG = PAGE_SLUGS.openBarControl;

type RecipeLineDraft = {
  lineType: "fixed_ingredient" | "category_selector";
  ingredientId: string;
  categoryId: string;
  quantity: number;
  isOptional: boolean;
  affectsStrength: boolean;
  isTopUp: boolean;
};

type DeliveryLineDraft = {
  ingredientId: string;
  variantId: string;
  quantity: number;
  unitCost: number | null;
};

type ReconciliationLineDraft = {
  ingredientId: string;
  ingredientName: string;
  baseUnit: "ml" | "unit";
  systemStock: number;
  countedStock: number | null;
};
type ReconciliationTargetSession = {
  id: number;
  sessionName: string | null;
  canClose: boolean;
};

type BartenderLaunchStep = "sessionStart" | "recipe" | "categorySelection" | "strength" | "ice";
type BartenderStrength = "single" | "double";
type RecipePreviewStrength = "single" | "double";

type RecipePreviewSegment = {
  key: string;
  label: string;
  quantity: number;
  color: string;
};

const DEFAULT_ICE_CUBES_PER_DRINK = 3;
const ICE_CUBE_VOLUME_ML = 25;
const ICE_FLOATING_SUBMERGED_RATIO = 0.917;
const BARTENDER_SESSION_PANEL_MIN_WIDTH = 320;
const BARTENDER_SESSION_PANEL_DEFAULT_WIDTH = 420;
const BARTENDER_SERVICE_PANEL_MIN_WIDTH = 520;

const resolveIceCubes = (hasIce: boolean, iceCubes: number): number => {
  if (!hasIce) {
    return 0;
  }
  const parsed = Number(iceCubes);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_ICE_CUBES_PER_DRINK;
  }
  return Math.max(0, Math.floor(parsed));
};

const getIceDisplacementMl = (hasIce: boolean, iceCubes: number): number => {
  const cubes = resolveIceCubes(hasIce, iceCubes);
  if (cubes <= 0) {
    return 0;
  }
  return cubes * ICE_CUBE_VOLUME_ML * ICE_FLOATING_SUBMERGED_RATIO;
};

const getAvailableLiquidCapacityMl = (
  cupCapacityMl: number | null,
  hasIce: boolean,
  iceCubes: number,
): number | null => {
  if (cupCapacityMl == null || cupCapacityMl <= 0) {
    return null;
  }
  return Math.max(cupCapacityMl - getIceDisplacementMl(hasIce, iceCubes), 0);
};

const RecipeCupPreview = ({
  title,
  segments,
  totalQuantity,
  cupCapacityMl,
  hasIce,
  iceCubes,
}: {
  title: string;
  segments: RecipePreviewSegment[];
  totalQuantity: number;
  cupCapacityMl: number | null;
  hasIce: boolean;
  iceCubes: number;
}) => {
  const clipId = useId();
  const svgWidth = 180;
  const svgHeight = 280;
  const cupTopY = 26;
  const cupHeight = 220;
  const cupTopWidth = 122;
  const cupBottomWidth = 76;
  const cupTopLeft = (svgWidth - cupTopWidth) / 2;
  const cupBottomLeft = (svgWidth - cupBottomWidth) / 2;
  const cupTopRight = cupTopLeft + cupTopWidth;
  const cupBottomRight = cupBottomLeft + cupBottomWidth;
  const cupBottomY = cupTopY + cupHeight;
  const resolvedIceCubes = resolveIceCubes(hasIce, iceCubes);
  const iceDisplacementMl = getIceDisplacementMl(hasIce, resolvedIceCubes);
  const availableLiquidCapacityMl = getAvailableLiquidCapacityMl(cupCapacityMl, hasIce, resolvedIceCubes);
  const volumeScaleMl = cupCapacityMl != null && cupCapacityMl > 0 ? cupCapacityMl : Math.max(totalQuantity, 0.000001);
  const maxLiquidMl = availableLiquidCapacityMl == null ? Infinity : availableLiquidCapacityMl;
  const cupBottomRadius = cupBottomWidth / 2;
  const cupTopRadius = cupTopWidth / 2;
  const radiusSlope = (cupTopRadius - cupBottomRadius) / cupHeight;

  const areaIntegral = (heightFromBottom: number): number => {
    const h = Math.max(0, Math.min(heightFromBottom, cupHeight));
    const rb = cupBottomRadius;
    const k = radiusSlope;
    return rb * rb * h + rb * k * h * h + (k * k * h * h * h) / 3;
  };

  const totalAreaIntegral = areaIntegral(cupHeight);

  const getHeightForVolumeRatio = (volumeRatio: number): number => {
    const normalized = Math.max(0, Math.min(volumeRatio, 1));
    if (normalized <= 0) {
      return 0;
    }
    if (normalized >= 1) {
      return cupHeight;
    }
    if (Math.abs(radiusSlope) < 0.000001 || totalAreaIntegral <= 0) {
      return cupHeight * normalized;
    }

    const target = totalAreaIntegral * normalized;
    let low = 0;
    let high = cupHeight;
    for (let i = 0; i < 24; i += 1) {
      const mid = (low + high) / 2;
      if (areaIntegral(mid) < target) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return (low + high) / 2;
  };

  const getCupEdgesAtHeightFromBottom = (heightFromBottom: number) => {
    const y = cupBottomY - heightFromBottom;
    const ratioFromTop = Math.max(0, Math.min((y - cupTopY) / cupHeight, 1));
    const left = cupTopLeft + (cupBottomLeft - cupTopLeft) * ratioFromTop;
    const right = cupTopRight + (cupBottomRight - cupTopRight) * ratioFromTop;
    return { y, left, right };
  };

  const previewIceCubes = cupCapacityMl != null && cupCapacityMl > 0 && resolvedIceCubes > 0
    ? Array.from({ length: Math.min(resolvedIceCubes, 8) }, (_, index) => {
        const cubeSize = 44;
        const zigzagOffset = 16;
        const verticalStep = 44;
        const halfSize = cubeSize / 2;
        const baseCenterY = cupBottomY - halfSize - 12;
        const preferredCenterY = baseCenterY - index * verticalStep;
        const minCenterY = cupTopY + halfSize + 8;
        const maxCenterY = cupBottomY - halfSize - 8;
        const centerY = Math.max(minCenterY, Math.min(preferredCenterY, maxCenterY));
        const heightFromBottom = cupBottomY - centerY;
        const { left, right } = getCupEdgesAtHeightFromBottom(heightFromBottom);
        const minCenterX = left + halfSize + 2;
        const maxCenterX = right - halfSize - 2;
        const xOffset = index % 2 === 0 ? -zigzagOffset : zigzagOffset;
        const centerX = Math.max(minCenterX, Math.min(svgWidth / 2 + xOffset, maxCenterX));
        return {
          x: centerX - halfSize,
          y: centerY - halfSize,
          size: cubeSize,
          rotate: index % 2 === 0 ? -14 : 12,
        };
      })
    : [];

  const getDisplacedIceMlAtHeight = (heightFromBottom: number): number => {
    if (previewIceCubes.length === 0 || iceDisplacementMl <= 0) {
      return 0;
    }
    const liquidSurfaceY = cupBottomY - Math.max(0, Math.min(heightFromBottom, cupHeight));
    const representedCubeCount = previewIceCubes.length;
    const totalCubeCount = Math.max(resolvedIceCubes, representedCubeCount);
    const representedToActualScale = totalCubeCount / representedCubeCount;

    return previewIceCubes.reduce((sum, cube) => {
      const cubeTopY = cube.y;
      const cubeBottomYLocal = cube.y + cube.size;
      let submergedRatio = 0;
      if (liquidSurfaceY <= cubeTopY) {
        submergedRatio = 1;
      } else if (liquidSurfaceY < cubeBottomYLocal) {
        submergedRatio = (cubeBottomYLocal - liquidSurfaceY) / cube.size;
      }
      const normalizedSubmergedRatio = Math.max(0, Math.min(submergedRatio, 1));
      const displacedMlPerRepresentedCube =
        Math.min(normalizedSubmergedRatio, ICE_FLOATING_SUBMERGED_RATIO) * ICE_CUBE_VOLUME_ML;
      return sum + displacedMlPerRepresentedCube * representedToActualScale;
    }, 0);
  };

  const getLiquidMlAtHeight = (heightFromBottom: number): number => {
    if (cupCapacityMl == null || cupCapacityMl <= 0 || totalAreaIntegral <= 0) {
      const normalized = Math.max(0, Math.min(heightFromBottom / cupHeight, 1));
      return volumeScaleMl * normalized;
    }
    const clampedHeight = Math.max(0, Math.min(heightFromBottom, cupHeight));
    const cupVolumeAtHeightMl = cupCapacityMl * (areaIntegral(clampedHeight) / totalAreaIntegral);
    const displacedIceMl = getDisplacedIceMlAtHeight(clampedHeight);
    return Math.max(cupVolumeAtHeightMl - displacedIceMl, 0);
  };

  const getHeightForLiquidMl = (liquidMl: number): number => {
    const targetLiquidMl = Math.max(0, Math.min(liquidMl, maxLiquidMl));
    if (targetLiquidMl <= 0) {
      return 0;
    }
    if (cupCapacityMl == null || cupCapacityMl <= 0) {
      return getHeightForVolumeRatio(targetLiquidMl / volumeScaleMl);
    }
    if (maxLiquidMl !== Infinity && targetLiquidMl >= maxLiquidMl) {
      return cupHeight;
    }

    let low = 0;
    let high = cupHeight;
    for (let i = 0; i < 24; i += 1) {
      const mid = (low + high) / 2;
      if (getLiquidMlAtHeight(mid) < targetLiquidMl) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return (low + high) / 2;
  };

  let accumulatedMl = 0;
  const liquidRects = segments.map((segment) => {
    if (accumulatedMl >= maxLiquidMl) {
      return null;
    }
    const startMl = Math.max(0, Math.min(accumulatedMl, maxLiquidMl));
    accumulatedMl += Math.max(segment.quantity, 0);
    const endMl = Math.max(0, Math.min(accumulatedMl, maxLiquidMl));
    if (endMl <= startMl) {
      return null;
    }

    const startHeight = getHeightForLiquidMl(startMl);
    const endHeight = getHeightForLiquidMl(endMl);
    const height = Math.max(endHeight - startHeight, 0);
    if (height <= 0) {
      return null;
    }
    const y = cupBottomY - endHeight;
    return {
      key: segment.key,
      color: segment.color,
      y,
      height,
    };
  }).filter((segment): segment is { key: string; color: string; y: number; height: number } => segment !== null);

  const roundedLevelMls =
    cupCapacityMl != null && cupCapacityMl > 0
      ? Array.from(
          new Set(
            Array.from({ length: 5 }, (_, index) => {
              const rawMl = cupCapacityMl * (1 - (index + 1) / 6);
              return Math.round(rawMl / 10) * 10;
            }).filter((ml) => ml > 0 && ml < cupCapacityMl),
          ),
        ).sort((a, b) => b - a)
      : [];

  const levelLines =
    cupCapacityMl != null && cupCapacityMl > 0
      ? roundedLevelMls.map((labelMl) => {
          const filledRatio = labelMl / cupCapacityMl;
          const { y, left, right } = getCupEdgesAtHeightFromBottom(getHeightForVolumeRatio(filledRatio));
          const labelY = y;
          return { y, left, right, labelMl, labelY };
        })
      : Array.from({ length: 5 }, (_, index) => {
          const filledRatio = 1 - (index + 1) / 6;
          const { y, left, right } = getCupEdgesAtHeightFromBottom(getHeightForVolumeRatio(filledRatio));
          const labelY = y;
      return { y, left, right, labelMl: null, labelY };
        });
  const topMeasurementLabel =
    cupCapacityMl != null && cupCapacityMl > 0 ? `${cupCapacityMl.toFixed(0)} ml` : null;

  return (
    <Paper withBorder p="md" h="100%">
      <Stack>
        <Title order={5}>{title}</Title>
        <Text size="sm" c="dimmed">
          Visual composition per serving
        </Text>
        <Group align="start" wrap="wrap">
          <svg width={svgWidth} height={svgHeight} role="img" aria-label="Frustum cup preview">
            <defs>
              <clipPath id={clipId}>
                <path d={`M ${cupTopLeft} ${cupTopY} L ${cupTopRight} ${cupTopY} L ${cupBottomRight} ${cupBottomY} L ${cupBottomLeft} ${cupBottomY} Z`} />
              </clipPath>
            </defs>

            <path
              d={`M ${cupTopLeft} ${cupTopY} L ${cupTopRight} ${cupTopY} L ${cupBottomRight} ${cupBottomY} L ${cupBottomLeft} ${cupBottomY} Z`}
              fill="rgba(248,250,252,0.95)"
              stroke="var(--mantine-color-gray-5)"
              strokeWidth={3}
            />

            <g clipPath={`url(#${clipId})`}>
              <rect x={0} y={0} width={svgWidth} height={svgHeight} fill="rgba(255,255,255,0.25)" />
              {liquidRects.map((segment) => (
                <rect
                  key={`liquid-${segment.key}`}
                  x={0}
                  y={segment.y}
                  width={svgWidth}
                  height={segment.height}
                  fill={segment.color}
                  opacity={0.9}
                />
              ))}
              {levelLines.map((line, index) => (
                <g key={`level-line-${index}`}>
                  <line
                    x1={line.left}
                    y1={line.y}
                    x2={line.right}
                    y2={line.y}
                    stroke="rgba(255,255,255,0.45)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                  />
                  {line.labelMl != null ? (
                    <text
                      x={(line.left + line.right) / 2}
                      y={line.labelY}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="10"
                      fill="rgba(255,255,255,0.92)"
                      stroke="rgba(15,23,42,0.55)"
                      strokeWidth="0.8"
                      paintOrder="stroke"
                    >
                      {`${line.labelMl.toFixed(0)} ml`}
                    </text>
                  ) : null}
                </g>
              ))}
              {previewIceCubes.map((cube, index) => (
                <rect
                  key={`ice-cube-${index}`}
                  x={cube.x}
                  y={cube.y}
                  width={cube.size}
                  height={cube.size}
                  rx={4}
                  fill="rgba(255,255,255,0.86)"
                  stroke="rgba(148,163,184,0.85)"
                  strokeWidth={1}
                  transform={`rotate(${cube.rotate} ${cube.x + cube.size / 2} ${cube.y + cube.size / 2})`}
                />
              ))}
            </g>

            <ellipse
              cx={svgWidth / 2}
              cy={cupTopY}
              rx={cupTopWidth / 2}
              ry={7}
              fill="none"
              stroke="var(--mantine-color-gray-4)"
              strokeWidth={2}
            />

            {topMeasurementLabel ? (
              <text
                x={svgWidth / 2}
                y={cupTopY - 6}
                textAnchor="middle"
                fontSize="11"
                fontWeight={600}
                fill="#111111"
              >
                {topMeasurementLabel}
              </text>
            ) : null}
          </svg>
          <Stack gap={6} style={{ flex: 1 }}>
            <Text size="sm" fw={600}>
              Total liquid: {totalQuantity.toFixed(1)} ml
              {cupCapacityMl != null
                ? ` / ${(availableLiquidCapacityMl ?? cupCapacityMl).toFixed(0)} ml available`
                : ""}
            </Text>
            {hasIce && (
              <Text size="xs" c="dimmed">
                Ice: {resolvedIceCubes} cube{resolvedIceCubes === 1 ? "" : "s"}
                {cupCapacityMl != null ? ` (~${iceDisplacementMl.toFixed(1)} ml displacement)` : ""}
              </Text>
            )}
            {segments.length === 0 ? (
              <Text size="sm" c="dimmed">
                No valid recipe lines yet.
              </Text>
            ) : (
              segments.map((segment) => (
                <Group key={`legend-${segment.key}`} justify="space-between" wrap="nowrap">
                  <Group gap={8} wrap="nowrap">
                    <Box
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 3,
                        background: segment.color,
                        flexShrink: 0,
                      }}
                    />
                    <Text size="sm" lineClamp={1}>
                      {segment.label}
                    </Text>
                  </Group>
                  <Text size="sm" fw={600}>
                    {segment.quantity.toFixed(1)}
                  </Text>
                </Group>
              ))
            )}
          </Stack>
        </Group>
      </Stack>
    </Paper>
  );
};

const extractApiMessage = (error: unknown, fallback: string): string => {
  const axiosError = error as AxiosError<unknown>;
  const data = axiosError?.response?.data;

  const readMessage = (value: unknown): string | null => {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (Array.isArray(value)) {
      for (const entry of value) {
        const message = readMessage(entry);
        if (message) {
          return message;
        }
      }
      return null;
    }
    if (!value || typeof value !== "object") {
      return null;
    }
    const record = value as Record<string, unknown>;
    const direct = readMessage(record.message);
    if (direct) {
      return direct;
    }
    const nested = readMessage(record.error);
    if (nested) {
      return nested;
    }
    return null;
  };

  const readDetails = (value: unknown): string | null => {
    if (value == null) {
      return null;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (Array.isArray(value)) {
      const parts = value
        .map((entry) => readMessage(entry) ?? readDetails(entry))
        .filter((entry): entry is string => Boolean(entry));
      return parts.length > 0 ? parts.join(" | ") : null;
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return null;
      }
    }
    return String(value);
  };

  const message = readMessage(data);
  const details =
    data && typeof data === "object"
      ? readDetails((data as { details?: unknown }).details)
      : null;

  if (message && details && !message.includes(details)) {
    return `${message} (${details})`;
  }
  return message ?? details ?? fallback;
};

const drinkTypeOrder: Array<"classic" | "cocktail" | "beer" | "soft" | "custom"> = [
  "classic",
  "cocktail",
  "beer",
  "soft",
  "custom",
];

const drinkTypeLabel: Record<(typeof drinkTypeOrder)[number], string> = {
  classic: "Classic Drinks",
  cocktail: "Cocktails",
  beer: "Beer",
  soft: "Soft Drinks",
  custom: "Custom",
};

const OPEN_BAR_DRINK_TYPE_ORDER_STORAGE_KEY = "open_bar_drink_type_order_v1";
const OPEN_BAR_RECIPE_ORDER_STORAGE_KEY = "open_bar_recipe_order_v1";
const OPEN_BAR_LOCAL_ISSUES_STORAGE_KEY = "open_bar_local_issues_v1";
const OPEN_BAR_LAUNCH_ISSUE_SCOPE_STORAGE_KEY = "open_bar_launch_issue_scope_v1";

type LocalDrinkIssueSyncStatus = "pending" | "syncing" | "synced" | "failed";
type LaunchIssueScope = "mine" | "all";
type LocalDrinkIssuePayload = {
  sessionId: number;
  recipeId: number;
  servings: number;
  strength?: "single" | "double";
  includeIce?: boolean;
  isStaffDrink?: boolean;
  categorySelections?: Array<{
    recipeLineId: number;
    ingredientId: number;
  }>;
  allowInactiveSession?: boolean;
  issuedAt?: string;
  orderRef?: string | null;
  notes?: string | null;
};
type LocalDrinkIssueQueueEntry = {
  localId: string;
  recipeName: string | null;
  payload: LocalDrinkIssuePayload;
  status: LocalDrinkIssueSyncStatus;
  errorMessage: string | null;
  remoteIssueId: number | null;
  createdAt: string;
  updatedAt: string;
};
type SessionIssueRow = {
  rowKey: string;
  issueId: number | null;
  localId: string | null;
  remoteIssueId: number | null;
  issuedAt: string;
  issuedById: number | null;
  issuedByName: string | null;
  recipeId: number | null;
  drinkType: DrinkTypeKey | null;
  recipeName: string | null;
  drinkDisplayName: string;
  servings: number;
  strength: BartenderStrength | null;
  includeIce: boolean | null;
  notes: string | null;
  isStaffDrink: boolean;
  syncState: LocalDrinkIssueSyncStatus;
  syncError: string | null;
  source: "server" | "local";
};
type NormalizedRecipeLineInput = {
  lineType: "fixed_ingredient" | "category_selector";
  ingredientId?: number;
  categoryId?: number;
  quantity: number;
  sortOrder: number;
  isOptional: boolean;
  affectsStrength: boolean;
  isTopUp: boolean;
};

type DrinkTypeKey = (typeof drinkTypeOrder)[number];
type RecipeOrderByDrinkType = Record<DrinkTypeKey, number[]>;
type DrinkLabelDisplayMode = ApiDrinkLabelDisplayMode;
type RecipeLabelDisplayModeValue = DrinkLabelDisplayMode | "";
type DrinkLabelDisplayByType = Record<DrinkTypeKey, DrinkLabelDisplayMode>;

const buildEmptyRecipeOrderByDrinkType = (): RecipeOrderByDrinkType => ({
  classic: [],
  cocktail: [],
  beer: [],
  soft: [],
  custom: [],
});

const buildDefaultDrinkLabelDisplayByType = (): DrinkLabelDisplayByType => ({
  classic: "recipe_with_ingredients",
  cocktail: "recipe_name",
  beer: "recipe_name",
  soft: "recipe_name",
  custom: "recipe_name",
});

const drinkLabelDisplayModeOptions: Array<{ value: DrinkLabelDisplayMode; label: string }> = [
  { value: "recipe_name", label: "Recipe Name" },
  { value: "recipe_with_ingredients", label: "Recipe + Ingredients" },
  { value: "ingredients_only", label: "Ingredients Only" },
];

const recipeLabelDisplayModeOptions: Array<{ value: RecipeLabelDisplayModeValue; label: string }> = [
  { value: "", label: "Use Global Default" },
  ...drinkLabelDisplayModeOptions,
];

const isDrinkLabelDisplayMode = (value: string | null): value is DrinkLabelDisplayMode =>
  value === "recipe_name" || value === "recipe_with_ingredients" || value === "ingredients_only";

const formatDrinkLabelDisplayMode = (mode: DrinkLabelDisplayMode): string => {
  const option = drinkLabelDisplayModeOptions.find((entry) => entry.value === mode);
  return option?.label ?? "Recipe Name";
};

const resolveDrinkTypeKey = (value: string): DrinkTypeKey =>
  drinkTypeOrder.includes(value as DrinkTypeKey) ? (value as DrinkTypeKey) : "custom";

const arraysEqual = <T,>(left: T[], right: T[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const readLocalDrinkIssuesFromStorage = (): LocalDrinkIssueQueueEntry[] => {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(OPEN_BAR_LOCAL_ISSUES_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry) => {
        if (!entry || typeof entry !== "object") {
          return false;
        }
        const candidate = entry as Partial<LocalDrinkIssueQueueEntry>;
        return (
          typeof candidate.localId === "string" &&
          typeof candidate.createdAt === "string" &&
          candidate.payload != null &&
          typeof candidate.payload.sessionId === "number" &&
          typeof candidate.payload.recipeId === "number"
        );
      })
      .map((entry) => {
        const candidate = entry as LocalDrinkIssueQueueEntry;
        return candidate.status === "syncing"
          ? { ...candidate, status: "pending", updatedAt: new Date().toISOString() }
          : candidate;
      }) as LocalDrinkIssueQueueEntry[];
  } catch {
    return [];
  }
};

const readDrinkTypeOrderFromStorage = (): DrinkTypeKey[] => {
  if (typeof window === "undefined") {
    return [...drinkTypeOrder];
  }
  try {
    const raw = window.localStorage.getItem(OPEN_BAR_DRINK_TYPE_ORDER_STORAGE_KEY);
    if (!raw) {
      return [...drinkTypeOrder];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [...drinkTypeOrder];
    }
    const normalized = parsed.filter((value): value is DrinkTypeKey =>
      drinkTypeOrder.includes(value as DrinkTypeKey),
    );
    if (normalized.length === 0) {
      return [...drinkTypeOrder];
    }
    return normalized;
  } catch {
    return [...drinkTypeOrder];
  }
};

const readRecipeOrderFromStorage = (): RecipeOrderByDrinkType => {
  const fallback = buildEmptyRecipeOrderByDrinkType();
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(OPEN_BAR_RECIPE_ORDER_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<Record<DrinkTypeKey, unknown>>;
    const normalized = buildEmptyRecipeOrderByDrinkType();
    drinkTypeOrder.forEach((type) => {
      const value = parsed?.[type];
      if (Array.isArray(value)) {
        normalized[type] = value
          .map((entry) => Number(entry))
          .filter((entry) => Number.isInteger(entry) && entry > 0);
      }
    });
    return normalized;
  } catch {
    return fallback;
  }
};

const readLaunchIssueScopeFromStorage = (): LaunchIssueScope => {
  if (typeof window === "undefined") {
    return "mine";
  }
  try {
    const raw = window.localStorage.getItem(OPEN_BAR_LAUNCH_ISSUE_SCOPE_STORAGE_KEY);
    return raw === "all" ? "all" : "mine";
  } catch {
    return "mine";
  }
};

const sanitizeSyncErrorMessage = (message: string): string => {
  const trimmed = message.trim();
  if (!trimmed) {
    return "Failed to sync drink issue.";
  }

  const noWrappedJson = trimmed.replace(/\s*\(\s*[\[{][\s\S]*$/, "").trim();
  const noInlineJson = noWrappedJson.replace(/\s+[\[{][\s\S]*$/, "").trim();
  return noInlineJson || "Failed to sync drink issue.";
};

const getSessionIssueDetailsMeta = (issue: SessionIssueRow): { text: string; isError: boolean } => {
  const iceLabel = issue.includeIce == null ? null : issue.includeIce ? "With Ice" : "No Ice";
  const staffSuffix = issue.isStaffDrink ? "Staff Drink" : null;

  if (issue.syncError) {
    const base = sanitizeSyncErrorMessage(issue.syncError);
    const details = [base, iceLabel, staffSuffix].filter((value): value is string => Boolean(value)).join(" | ");
    return {
      text: details || "Failed to sync drink issue.",
      isError: true,
    };
  }

  const note = issue.notes?.trim() ?? "";
  const details = [note || null, iceLabel, staffSuffix]
    .filter((value): value is string => Boolean(value))
    .join(" | ");
  return {
    text: details || "No additional details.",
    isError: false,
  };
};

const parseIssueNotesMetadata = (
  notes: string | null | undefined,
): { cleanNote: string | null; strength: BartenderStrength | null; includeIce: boolean | null } => {
  const raw = notes?.trim() ?? "";
  if (!raw) {
    return { cleanNote: null, strength: null, includeIce: null };
  }

  let strength: BartenderStrength | null = null;
  let includeIce: boolean | null = null;
  const cleanSegments: string[] = [];

  raw
    .split("|")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .forEach((segment) => {
      const normalized = segment.toLowerCase();
      if (normalized.startsWith("strength:")) {
        if (normalized.includes("double")) {
          strength = "double";
        } else if (normalized.includes("single")) {
          strength = "single";
        }
        return;
      }
      if (normalized.startsWith("ice:")) {
        if (normalized.includes("yes")) {
          includeIce = true;
        } else if (normalized.includes("no")) {
          includeIce = false;
        }
        return;
      }
      cleanSegments.push(segment);
    });

  return {
    cleanNote: cleanSegments.length > 0 ? cleanSegments.join(" | ") : null,
    strength,
    includeIce,
  };
};

const formatIssueStrengthPrefix = (strength: BartenderStrength | null): string => {
  if (strength === "single") {
    return "Single ";
  }
  if (strength === "double") {
    return "Double ";
  }
  return "";
};

const extractDrinkSyncErrorMessage = (
  error: unknown,
  fallback = "Failed to sync drink issue.",
): string => {
  if (isAxiosError<{ message?: unknown; details?: unknown }>(error)) {
    const payload = error.response?.data;
    const details = payload && typeof payload === "object" ? (payload as { details?: unknown }).details : null;

    if (details && typeof details === "object" && !Array.isArray(details)) {
      const shortages = (details as { shortages?: unknown }).shortages;
      if (Array.isArray(shortages) && shortages.length > 0) {
        const shortageSummary = shortages
          .slice(0, 3)
          .map((entry) => {
            if (!entry || typeof entry !== "object") {
              return null;
            }
            const record = entry as { ingredientName?: unknown; missing?: unknown };
            const ingredientName =
              typeof record.ingredientName === "string" && record.ingredientName.trim().length > 0
                ? record.ingredientName.trim()
                : "Ingredient";
            const missing = Number(record.missing);
            if (Number.isFinite(missing)) {
              return `${ingredientName} (missing ${missing.toFixed(2)})`;
            }
            return ingredientName;
          })
          .filter((value): value is string => Boolean(value));

        if (shortageSummary.length > 0) {
          const remaining = shortages.length - shortageSummary.length;
          return `Insufficient stock: ${shortageSummary.join(", ")}${remaining > 0 ? ` +${remaining} more` : ""}.`;
        }
      }
    }
  }

  return sanitizeSyncErrorMessage(extractApiMessage(error, fallback));
};

const splitBartenderRecipeLabel = (name: string): { primary: string; secondaryLines: string[] } => {
  const trimmed = name.trim();
  if (!trimmed) {
    return { primary: "-", secondaryLines: [] };
  }
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) {
    return { primary: tokens[0], secondaryLines: [] };
  }
  return {
    primary: tokens[0],
    secondaryLines: tokens.slice(1),
  };
};

const bartenderRecipeButtonColorByType: Record<DrinkTypeKey, string> = {
  classic: "orange",
  cocktail: "violet",
  beer: "yellow",
  soft: "teal",
  custom: "gray",
};

const bartenderCategoryOptionColorPalette = [
  "blue",
  "indigo",
  "grape",
  "violet",
  "cyan",
  "teal",
  "orange",
  "pink",
];

const getBartenderCategoryOptionButtonColor = (label: string, categoryKey: string): string => {
  const key = `${categoryKey}|${label}`.trim().toLowerCase();
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = ((hash << 5) - hash + key.charCodeAt(index)) >>> 0;
  }
  return bartenderCategoryOptionColorPalette[hash % bartenderCategoryOptionColorPalette.length];
};

const getBartenderPrimaryFontSize = (label: string, secondaryLineCount = 0): string => {
  if (secondaryLineCount >= 3) {
    return "clamp(0.95rem, 1.4vw, 1.25rem)";
  }
  if (secondaryLineCount === 2) {
    return "clamp(1.05rem, 1.6vw, 1.45rem)";
  }
  const length = label.trim().length;
  if (length >= 12) {
    return "clamp(1rem, 2vw, 1.5rem)";
  }
  if (length >= 9) {
    return "clamp(1.15rem, 2.2vw, 1.8rem)";
  }
  if (length >= 7) {
    return "clamp(1.3rem, 2.6vw, 2.1rem)";
  }
  return "clamp(1.5rem, 3vw, 2.6rem)";
};

const getBartenderSecondaryFontSize = (label: string, secondaryLineCount = 0): string => {
  if (secondaryLineCount >= 3) {
    return "clamp(0.8rem, 1.15vw, 1rem)";
  }
  const length = label.trim().length;
  if (length >= 14) {
    return "clamp(0.8rem, 1.4vw, 1rem)";
  }
  if (length >= 10) {
    return "clamp(0.9rem, 1.6vw, 1.1rem)";
  }
  return "clamp(1rem, 1.9vw, 1.25rem)";
};

const getBartenderCategoryOptionFontSize = (label: string): string => {
  const words = label
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const longestWordLength = words.reduce((max, word) => Math.max(max, word.length), 0);

  if (longestWordLength >= 12) {
    return "clamp(0.8rem, 1.2vw, 1.1rem)";
  }
  if (longestWordLength >= 10) {
    return "clamp(0.9rem, 1.45vw, 1.3rem)";
  }
  if (longestWordLength >= 8) {
    return "clamp(1rem, 1.75vw, 1.5rem)";
  }
  return "clamp(1.1rem, 2.1vw, 1.8rem)";
};

const formatSessionDuration = (minutes: number | null | undefined): string => {
  const safeMinutes = Number.isFinite(minutes) ? Math.max(1, Math.floor(minutes as number)) : 0;
  if (safeMinutes <= 0) {
    return "-";
  }
  if (safeMinutes % 60 === 0) {
    const hours = safeMinutes / 60;
    return `${hours} Hour${hours === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(safeMinutes / 60);
  const rem = safeMinutes % 60;
  if (hours <= 0) {
    return `${rem} min`;
  }
  return `${hours}h ${rem}m`;
};

const normalizeOpenBarRoleSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");

const LaunchHeaderDateTime = ({
  businessDate,
  expectedEndAt,
}: {
  businessDate: string;
  expectedEndAt?: string | null;
}) => {
  const isCompact = useMediaQuery("(max-width: 48em)");
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const countdownLabel = useMemo(() => {
    if (!expectedEndAt) {
      return "--:--:--";
    }
    const endAt = dayjs(expectedEndAt);
    if (!endAt.isValid()) {
      return "--:--:--";
    }
    const diffSeconds = Math.max(endAt.diff(dayjs(now), "second"), 0);
    const hours = Math.floor(diffSeconds / 3600);
    const minutes = Math.floor((diffSeconds % 3600) / 60);
    const seconds = diffSeconds % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [expectedEndAt, now]);

  if (isCompact) {
    return (
      <Group justify="center" gap={6} wrap="nowrap">
        <Text fw={850} ta="center" style={{ fontSize: "clamp(0.92rem, 3.2vw, 1.05rem)", lineHeight: 1.05 }}>
          {`${dayjs(businessDate).format("MMM D, YYYY")} | ${dayjs(now).format("hh:mm A")}`}
        </Text>
        <Text fw={900} ta="center" c="red" style={{ fontSize: "clamp(0.9rem, 3.2vw, 1.02rem)", lineHeight: 1.05 }}>
          {`- ${countdownLabel}`}
        </Text>
      </Group>
    );
  }

  return (
    <Group justify="center" gap="sm" wrap="nowrap" style={{ whiteSpace: "nowrap" }}>
      <Text fw={900} ta="center" style={{ fontSize: "clamp(1.05rem, 2.2vw, 1.75rem)", lineHeight: 1.1, whiteSpace: "nowrap" }}>
        {`${dayjs(businessDate).format("MMMM D, YYYY")} | ${dayjs(now).format("hh:mm A")}`}
      </Text>
      <Text fw={900} ta="center" style={{ fontSize: "clamp(1rem, 2vw, 1.5rem)", lineHeight: 1.1, whiteSpace: "nowrap" }}>
        -
      </Text>
      <Text fw={900} ta="center" c="red" style={{ fontSize: "clamp(1rem, 2vw, 1.5rem)", lineHeight: 1.1, whiteSpace: "nowrap" }}>
        {countdownLabel}
      </Text>
    </Group>
  );
};

const OpenBarControl = ({ title }: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const loggedUserId = useAppSelector((state) => state.session.loggedUserId);
  const loggedUserName = useAppSelector((state) => state.session.user);
  const usersState = useAppSelector((state) => state.users);
  const openBarModeAccess = useAppSelector((state) => state.accessControl.openBarModeAccess);
  const queryClient = useQueryClient();
  const isCompactViewport = useMediaQuery("(max-width: 62em)");
  const isBartenderLaunchCompact = useMediaQuery("(max-width: 48em)");
  const [activeTab, setActiveTab] = useState<string>("service");
  const [operationMode, setOperationMode] = useState<"bartender" | "manager">("bartender");
  const [drinkTypeSectionOrder, setDrinkTypeSectionOrder] = useState<DrinkTypeKey[]>(() =>
    readDrinkTypeOrderFromStorage(),
  );
  const [recipeOrderByDrinkType, setRecipeOrderByDrinkType] = useState<RecipeOrderByDrinkType>(() =>
    readRecipeOrderFromStorage(),
  );
  const [drinkLabelDisplayByType, setDrinkLabelDisplayByType] = useState<DrinkLabelDisplayByType>(() =>
    buildDefaultDrinkLabelDisplayByType(),
  );
  const [businessDate, setBusinessDate] = useState<string>(dayjs().format("YYYY-MM-DD"));
  const [feedback, setFeedback] = useState<{ tone: "red" | "green"; message: string } | null>(null);
  const [bartenderLaunchOpen, setBartenderLaunchOpen] = useState<boolean>(false);
  const [bartenderSessionPanelWidth, setBartenderSessionPanelWidth] = useState<number>(BARTENDER_SESSION_PANEL_DEFAULT_WIDTH);
  const [isResizingBartenderSessionPanel, setIsResizingBartenderSessionPanel] = useState<boolean>(false);
  const [bartenderLaunchStep, setBartenderLaunchStep] = useState<BartenderLaunchStep>("recipe");
  const [bartenderLaunchMobileView, setBartenderLaunchMobileView] = useState<"service" | "session">("service");
  const [showBartenderLaunchTopBar, setShowBartenderLaunchTopBar] = useState<boolean>(true);
  const [showBartenderLaunchSessionPanel, setShowBartenderLaunchSessionPanel] = useState<boolean>(true);
  const [bartenderLaunchQuantity, setBartenderLaunchQuantity] = useState<number>(1);
  const [bartenderLaunchRecipeId, setBartenderLaunchRecipeId] = useState<number | null>(null);
  const [bartenderLaunchCategorySelections, setBartenderLaunchCategorySelections] = useState<Record<number, number>>({});
  const [bartenderLaunchPendingCategoryLineId, setBartenderLaunchPendingCategoryLineId] = useState<number | null>(null);
  const [bartenderLaunchStrength, setBartenderLaunchStrength] = useState<BartenderStrength | null>(null);
  const [bartenderLaunchIncludeIce, setBartenderLaunchIncludeIce] = useState<boolean | null>(null);
  const [bartenderLaunchIsStaffDrink, setBartenderLaunchIsStaffDrink] = useState<boolean>(false);
  const [startingSessionTypeId, setStartingSessionTypeId] = useState<number | null>(null);
  const [joiningSessionId, setJoiningSessionId] = useState<number | null>(null);
  const [leavingSessionId, setLeavingSessionId] = useState<number | null>(null);
  const [launchIssueScope, setLaunchIssueScope] = useState<LaunchIssueScope>(() =>
    readLaunchIssueScopeFromStorage(),
  );
  const [mobileLaunchIssueDetails, setMobileLaunchIssueDetails] = useState<{
    drink: string;
    user: string;
    time: string;
    details: string;
    isError: boolean;
  } | null>(null);
  const [localDrinkIssues, setLocalDrinkIssues] = useState<LocalDrinkIssueQueueEntry[]>(() =>
    readLocalDrinkIssuesFromStorage(),
  );
  const [isSyncingFailedIssues, setIsSyncingFailedIssues] = useState<boolean>(false);
  const [deletingSessionIssueRowKey, setDeletingSessionIssueRowKey] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [networkChipInfoOpen, setNetworkChipInfoOpen] = useState<boolean>(false);
  const [countChipInfoOpen, setCountChipInfoOpen] = useState<boolean>(false);
  const [launchNow, setLaunchNow] = useState<Date>(new Date());
  const [sessionExpiredNoticeOpen, setSessionExpiredNoticeOpen] = useState<boolean>(false);
  const bartenderLaunchQuantityRef = useRef<number>(1);
  const bartenderLaunchQuantityRafRef = useRef<number | null>(null);
  const bartenderLaunchStrengthRef = useRef<BartenderStrength | null>(null);
  const bartenderLaunchIncludeIceRef = useRef<boolean | null>(null);
  const bartenderLaunchCategorySelectionsRef = useRef<Record<number, number>>({});
  const bartenderLaunchIsStaffDrinkRef = useRef<boolean>(false);

  const [sessionName, setSessionName] = useState<string>(`Open Bar ${dayjs().format("YYYY-MM-DD")}`);
  const [sessionVenueId, setSessionVenueId] = useState<string>("");
  const [sessionNotes, setSessionNotes] = useState<string>("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");

  const [ingredientName, setIngredientName] = useState<string>("");
  const [ingredientCategory, setIngredientCategory] = useState<string>("");
  const [ingredientUnit, setIngredientUnit] = useState<string>("ml");
  const [ingredientPar, setIngredientPar] = useState<number>(0);
  const [ingredientReorder, setIngredientReorder] = useState<number>(0);
  const [ingredientCost, setIngredientCost] = useState<number | null>(null);
  const [ingredientIsCup, setIngredientIsCup] = useState<boolean>(false);
  const [ingredientIsIce, setIngredientIsIce] = useState<boolean>(false);
  const [ingredientCupType, setIngredientCupType] = useState<"disposable" | "reusable">("disposable");
  const [ingredientCupCapacityMl, setIngredientCupCapacityMl] = useState<number | null>(null);
  const [createIngredientOpen, setCreateIngredientOpen] = useState<boolean>(false);
  const [createCategoryOpen, setCreateCategoryOpen] = useState<boolean>(false);
  const [adjustmentOpen, setAdjustmentOpen] = useState<boolean>(false);
  const [editingIngredientId, setEditingIngredientId] = useState<number | null>(null);
  const [editingIngredientName, setEditingIngredientName] = useState<string>("");
  const [editingIngredientCategory, setEditingIngredientCategory] = useState<string>("");
  const [editingIngredientOriginalUnit, setEditingIngredientOriginalUnit] = useState<"ml" | "unit">("ml");
  const [editingIngredientUnit, setEditingIngredientUnit] = useState<"ml" | "unit">("ml");
  const [editingIngredientPar, setEditingIngredientPar] = useState<number>(0);
  const [editingIngredientReorder, setEditingIngredientReorder] = useState<number>(0);
  const [editingUnitConversionFactor, setEditingUnitConversionFactor] = useState<number | null>(null);
  const [editingIngredientIsCup, setEditingIngredientIsCup] = useState<boolean>(false);
  const [editingIngredientIsIce, setEditingIngredientIsIce] = useState<boolean>(false);
  const [editingIngredientCupType, setEditingIngredientCupType] = useState<"disposable" | "reusable">("disposable");
  const [editingIngredientCupCapacityMl, setEditingIngredientCupCapacityMl] = useState<number | null>(null);
  const [newCategoryName, setNewCategoryName] = useState<string>("");
  const [newCategorySlug, setNewCategorySlug] = useState<string>("");
  const [newCategorySortOrder, setNewCategorySortOrder] = useState<number>(0);
  const [newCategoryActive, setNewCategoryActive] = useState<boolean>(true);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState<string>("");
  const [editingCategorySlug, setEditingCategorySlug] = useState<string>("");
  const [editingCategorySortOrder, setEditingCategorySortOrder] = useState<number>(0);
  const [editingCategoryActive, setEditingCategoryActive] = useState<boolean>(true);
  const [createSessionTypeOpen, setCreateSessionTypeOpen] = useState<boolean>(false);
  const [newSessionTypeName, setNewSessionTypeName] = useState<string>("");
  const [newSessionTypeSlug, setNewSessionTypeSlug] = useState<string>("");
  const [newSessionTypeDefaultMinutes, setNewSessionTypeDefaultMinutes] = useState<number>(60);
  const [newSessionTypeSortOrder, setNewSessionTypeSortOrder] = useState<number>(0);
  const [newSessionTypeActive, setNewSessionTypeActive] = useState<boolean>(true);
  const [editingSessionTypeId, setEditingSessionTypeId] = useState<number | null>(null);
  const [editingSessionTypeName, setEditingSessionTypeName] = useState<string>("");
  const [editingSessionTypeSlug, setEditingSessionTypeSlug] = useState<string>("");
  const [editingSessionTypeDefaultMinutes, setEditingSessionTypeDefaultMinutes] = useState<number>(60);
  const [editingSessionTypeSortOrder, setEditingSessionTypeSortOrder] = useState<number>(0);
  const [editingSessionTypeActive, setEditingSessionTypeActive] = useState<boolean>(true);
  const [createVariantOpen, setCreateVariantOpen] = useState<boolean>(false);
  const [variantIngredientId, setVariantIngredientId] = useState<string>("");
  const [variantName, setVariantName] = useState<string>("");
  const [variantBrand, setVariantBrand] = useState<string>("");
  const [variantPackageLabel, setVariantPackageLabel] = useState<string>("");
  const [variantBaseQuantity, setVariantBaseQuantity] = useState<number>(1);
  const [variantActive, setVariantActive] = useState<boolean>(true);
  const [editingVariantId, setEditingVariantId] = useState<number | null>(null);
  const [editingVariantIngredientId, setEditingVariantIngredientId] = useState<string>("");
  const [editingVariantName, setEditingVariantName] = useState<string>("");
  const [editingVariantBrand, setEditingVariantBrand] = useState<string>("");
  const [editingVariantPackageLabel, setEditingVariantPackageLabel] = useState<string>("");
  const [editingVariantBaseQuantity, setEditingVariantBaseQuantity] = useState<number>(1);
  const [editingVariantActive, setEditingVariantActive] = useState<boolean>(true);

  const [adjustIngredientId, setAdjustIngredientId] = useState<string>("");
  const [adjustType, setAdjustType] = useState<"adjustment" | "waste" | "correction">("adjustment");
  const [adjustQuantity, setAdjustQuantity] = useState<number>(0);
  const [adjustNote, setAdjustNote] = useState<string>("");

  const [recipeName, setRecipeName] = useState<string>("");
  const [recipeType, setRecipeType] = useState<string>("classic");
  const [recipeInstructions, setRecipeInstructions] = useState<string>("");
  const [recipeAskStrength, setRecipeAskStrength] = useState<boolean>(false);
  const [recipeLabelDisplayMode, setRecipeLabelDisplayMode] = useState<RecipeLabelDisplayModeValue>("");
  const [createRecipePreviewStrength, setCreateRecipePreviewStrength] = useState<RecipePreviewStrength>("single");
  const [recipeHasIce, setRecipeHasIce] = useState<boolean>(false);
  const [recipeIceCubes, setRecipeIceCubes] = useState<number>(DEFAULT_ICE_CUBES_PER_DRINK);
  const [recipeCupIngredientId, setRecipeCupIngredientId] = useState<string>("");
  const [recipeLines, setRecipeLines] = useState<RecipeLineDraft[]>([
    { lineType: "fixed_ingredient", ingredientId: "", categoryId: "", quantity: 0, isOptional: false, affectsStrength: false, isTopUp: false },
  ]);
  const [createRecipeOpen, setCreateRecipeOpen] = useState<boolean>(false);
  const [editingRecipeId, setEditingRecipeId] = useState<number | null>(null);
  const [editingRecipeName, setEditingRecipeName] = useState<string>("");
  const [editingRecipeType, setEditingRecipeType] = useState<string>("classic");
  const [editingRecipeInstructions, setEditingRecipeInstructions] = useState<string>("");
  const [editingRecipeAskStrength, setEditingRecipeAskStrength] = useState<boolean>(false);
  const [editingRecipeLabelDisplayMode, setEditingRecipeLabelDisplayMode] = useState<RecipeLabelDisplayModeValue>("");
  const [editRecipePreviewStrength, setEditRecipePreviewStrength] = useState<RecipePreviewStrength>("single");
  const [editingRecipeHasIce, setEditingRecipeHasIce] = useState<boolean>(false);
  const [editingRecipeIceCubes, setEditingRecipeIceCubes] = useState<number>(DEFAULT_ICE_CUBES_PER_DRINK);
  const [editingRecipeCupIngredientId, setEditingRecipeCupIngredientId] = useState<string>("");
  const [editingRecipeLines, setEditingRecipeLines] = useState<RecipeLineDraft[]>([]);

  const [deliverySupplier, setDeliverySupplier] = useState<string>("");
  const [deliveryInvoice, setDeliveryInvoice] = useState<string>("");
  const [deliveryNotes, setDeliveryNotes] = useState<string>("");
  const [deliveryLines, setDeliveryLines] = useState<DeliveryLineDraft[]>([
    { ingredientId: "", variantId: "", quantity: 0, unitCost: null },
  ]);
  const [createDeliveryOpen, setCreateDeliveryOpen] = useState<boolean>(false);
  const [reconciliationOpen, setReconciliationOpen] = useState<boolean>(false);
  const [reconciliationLines, setReconciliationLines] = useState<ReconciliationLineDraft[]>([]);
  const [reconciliationTargetSession, setReconciliationTargetSession] = useState<ReconciliationTargetSession | null>(null);

  const canUseManagerMode = openBarModeAccess?.canUseManagerMode ?? true;
  const shiftRoleSlugs = useMemo(
    () =>
      new Set(
        (openBarModeAccess?.shiftRoleSlugs ?? [])
          .map((slug) => normalizeOpenBarRoleSlug(slug))
          .filter((slug) => slug.length > 0),
      ),
    [openBarModeAccess?.shiftRoleSlugs],
  );
  const hasManagerShiftRole = shiftRoleSlugs.has("manager");
  const hasBartenderShiftRole = shiftRoleSlugs.has("bartender");
  const lockedOperationMode = useMemo<"bartender" | "manager">(() => {
    if (hasManagerShiftRole) {
      return "manager";
    }
    if (hasBartenderShiftRole) {
      return "bartender";
    }
    return canUseManagerMode ? "manager" : "bartender";
  }, [canUseManagerMode, hasBartenderShiftRole, hasManagerShiftRole]);
  const operationModeOptions = useMemo<Array<{ value: "bartender" | "manager"; label: string }>>(() => {
    return [{ value: lockedOperationMode, label: lockedOperationMode === "manager" ? "Manager" : "Bartender" }];
  }, [lockedOperationMode]);
  const managerMode = operationMode === "manager";
  const createRecipeDrinkTypeKey = resolveDrinkTypeKey(recipeType);
  const editRecipeDrinkTypeKey = resolveDrinkTypeKey(editingRecipeType);

  const getResponsiveModalProps = (desktopSize: string = "md") => ({
    fullScreen: isCompactViewport,
    centered: !isCompactViewport,
    size: isCompactViewport ? "100%" : desktopSize,
  });

  useEffect(() => {
    dispatch(navigateToPage("Open Bar"));
  }, [dispatch, title]);

  useEffect(() => {
    if (!managerMode && activeTab !== "service") {
      setActiveTab("service");
    }
  }, [managerMode, activeTab]);

  useEffect(() => {
    if (operationMode !== lockedOperationMode) {
      setOperationMode(lockedOperationMode);
    }
  }, [lockedOperationMode, operationMode]);

  useEffect(() => {
    bartenderLaunchQuantityRef.current = bartenderLaunchQuantity;
  }, [bartenderLaunchQuantity]);

  useEffect(() => {
    bartenderLaunchStrengthRef.current = bartenderLaunchStrength;
  }, [bartenderLaunchStrength]);

  useEffect(() => {
    bartenderLaunchIncludeIceRef.current = bartenderLaunchIncludeIce;
  }, [bartenderLaunchIncludeIce]);

  useEffect(() => {
    bartenderLaunchCategorySelectionsRef.current = bartenderLaunchCategorySelections;
  }, [bartenderLaunchCategorySelections]);

  useEffect(() => {
    bartenderLaunchIsStaffDrinkRef.current = bartenderLaunchIsStaffDrink;
  }, [bartenderLaunchIsStaffDrink]);

  useEffect(() => {
    return () => {
      if (bartenderLaunchQuantityRafRef.current != null && typeof window !== "undefined") {
        window.cancelAnimationFrame(bartenderLaunchQuantityRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(OPEN_BAR_LOCAL_ISSUES_STORAGE_KEY, JSON.stringify(localDrinkIssues));
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
  }, [localDrinkIssues]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(OPEN_BAR_LAUNCH_ISSUE_SCOPE_STORAGE_KEY, launchIssueScope);
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
  }, [launchIssueScope]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (!isResizingBartenderSessionPanel || isBartenderLaunchCompact || !bartenderLaunchOpen) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const viewportWidth = window.innerWidth;
      const maxPanelWidth = Math.max(
        BARTENDER_SESSION_PANEL_MIN_WIDTH,
        viewportWidth - BARTENDER_SERVICE_PANEL_MIN_WIDTH,
      );
      const nextWidth = Math.max(
        BARTENDER_SESSION_PANEL_MIN_WIDTH,
        Math.min(event.clientX, maxPanelWidth),
      );
      setBartenderSessionPanelWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizingBartenderSessionPanel(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isResizingBartenderSessionPanel, isBartenderLaunchCompact, bartenderLaunchOpen]);

  const invalidateOpenBar = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["open-bar"] });
  }, [queryClient]);

  const bootstrapQuery = useOpenBarBootstrap({
    businessDate,
    sessionLimit: 60,
    deliveryLimit: 100,
    sessionIssueLimit: 300,
  });
  const overviewQuery = { data: bootstrapQuery.data?.overview };
  const ingredientsQuery = { data: { ingredients: bootstrapQuery.data?.ingredients ?? [] } };
  const ingredientCategoriesQuery = { data: { categories: bootstrapQuery.data?.ingredientCategories ?? [] } };
  const ingredientVariantsQuery = { data: { variants: bootstrapQuery.data?.ingredientVariants ?? [] } };
  const recipesQuery = { data: { recipes: bootstrapQuery.data?.recipes ?? [] } };
  const drinkLabelSettingsQuery = { data: { settings: bootstrapQuery.data?.drinkLabelSettings ?? [] } };
  const sessionTypesQuery = {
    data: { sessionTypes: bootstrapQuery.data?.sessionTypes ?? [] },
    isLoading: bootstrapQuery.isLoading,
  };
  const sessionTypesCatalogQuery = { data: { sessionTypes: bootstrapQuery.data?.sessionTypesCatalog ?? [] } };
  const sessionsQuery = { data: { sessions: bootstrapQuery.data?.sessions ?? [] } };
  const joinableSessionsQuery = { data: { sessions: bootstrapQuery.data?.joinableSessions ?? [] } };
  const activeSession = bootstrapQuery.data?.currentUserSession ?? null;
  const canCloseSessionTarget = useCallback(
    (createdBy: number | null | undefined): boolean => {
      if (managerMode) {
        return true;
      }
      if (!Number.isFinite(loggedUserId) || loggedUserId <= 0) {
        return false;
      }
      return createdBy != null && createdBy === loggedUserId;
    },
    [loggedUserId, managerMode],
  );
  const canCloseActiveSession = useMemo(() => {
    if (!activeSession) {
      return false;
    }
    return canCloseSessionTarget(activeSession.createdBy);
  }, [activeSession, canCloseSessionTarget]);
  const isBartenderSessionExpired = useMemo(() => {
    if (!activeSession?.expectedEndAt) {
      return false;
    }
    const endAt = dayjs(activeSession.expectedEndAt);
    if (!endAt.isValid()) {
      return false;
    }
    return dayjs(launchNow).valueOf() >= endAt.valueOf();
  }, [activeSession?.expectedEndAt, launchNow]);
  const venuesQuery = {
    data: { venues: bootstrapQuery.data?.venues ?? [] },
    isLoading: bootstrapQuery.isLoading,
  };
  const sessionIssuesQuery = { data: { issues: bootstrapQuery.data?.sessionIssues ?? [] } };
  const deliveriesQuery = { data: { deliveries: bootstrapQuery.data?.deliveries ?? [] } };

  useEffect(() => {
    if (!bartenderLaunchOpen || launchIssueScope !== "all" || !activeSession?.id) {
      return;
    }
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    const baseUrlRaw = axiosInstance.defaults.baseURL;
    const baseUrl =
      typeof baseUrlRaw === "string" && baseUrlRaw.trim().length > 0
        ? baseUrlRaw.replace(/\/+$/, "")
        : "/api";
    const url = `${baseUrl}/openBar/events?sessionId=${activeSession.id}`;
    const source = new EventSource(url, { withCredentials: true });

    let refreshTimerId: number | null = null;
    const scheduleBootstrapRefresh = () => {
      if (refreshTimerId != null) {
        return;
      }
      refreshTimerId = window.setTimeout(() => {
        refreshTimerId = null;
        void invalidateOpenBar();
      }, 250);
    };

    const handleRealtimeIssueChange = () => {
      scheduleBootstrapRefresh();
    };

    source.addEventListener("drink_issue_created", handleRealtimeIssueChange);
    source.addEventListener("drink_issue_deleted", handleRealtimeIssueChange);

    return () => {
      source.removeEventListener("drink_issue_created", handleRealtimeIssueChange);
      source.removeEventListener("drink_issue_deleted", handleRealtimeIssueChange);
      source.close();
      if (refreshTimerId != null) {
        window.clearTimeout(refreshTimerId);
      }
    };
  }, [activeSession?.id, bartenderLaunchOpen, invalidateOpenBar, launchIssueScope]);

  const userDisplayNameById = useMemo(() => {
    const map = new Map<number, string>();

    const userRecords = (usersState?.[0]?.data?.[0]?.data ?? []) as Partial<User>[];
    userRecords.forEach((user) => {
      if (!Number.isFinite(user.id) || (user.id ?? 0) <= 0) {
        return;
      }
      const fullName = `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim();
      const fallback = user.username?.trim() || user.email?.trim() || "";
      const resolved = fullName || fallback;
      if (resolved) {
        map.set(user.id as number, resolved);
      }
    });

    (bootstrapQuery.data?.sessions ?? []).forEach((session) => {
      if (!Number.isFinite(session.createdBy) || (session.createdBy ?? 0) <= 0) {
        return;
      }
      const name = session.createdByName?.trim();
      if (name) {
        map.set(session.createdBy as number, name);
      }
    });

    (bootstrapQuery.data?.joinableSessions ?? []).forEach((session) => {
      if (!Number.isFinite(session.createdBy) || (session.createdBy ?? 0) <= 0) {
        return;
      }
      const name = session.createdByName?.trim();
      if (name) {
        map.set(session.createdBy as number, name);
      }
    });

    (bootstrapQuery.data?.sessionIssues ?? []).forEach((issue) => {
      if (!Number.isFinite(issue.issuedBy) || (issue.issuedBy ?? 0) <= 0) {
        return;
      }
      const name = issue.issuedByName?.trim();
      if (name) {
        map.set(issue.issuedBy as number, name);
      }
    });

    return map;
  }, [
    bootstrapQuery.data?.joinableSessions,
    bootstrapQuery.data?.sessionIssues,
    bootstrapQuery.data?.sessions,
    usersState,
  ]);

  const resolveUserDisplayName = useCallback(
    (userId: number | null | undefined): string | null => {
      if (!Number.isFinite(userId) || (userId ?? 0) <= 0) {
        return null;
      }
      const name = userDisplayNameById.get(userId as number)?.trim();
      return name && name.length > 0 ? name : null;
    },
    [userDisplayNameById],
  );

  const currentOperatorLabel = useMemo(() => {
    const byId = resolveUserDisplayName(loggedUserId);
    if (byId) {
      return byId;
    }
    const trimmed = loggedUserName?.trim();
    if (trimmed) {
      return trimmed;
    }
    return "You";
  }, [loggedUserId, loggedUserName, resolveUserDisplayName]);

  useEffect(() => {
    if (!bartenderLaunchOpen) {
      return;
    }
    if (activeSession && bartenderLaunchStep === "sessionStart") {
      setBartenderLaunchStep("recipe");
      return;
    }
    if (!activeSession && bartenderLaunchStep !== "sessionStart") {
      setBartenderLaunchStep("sessionStart");
    }
  }, [activeSession, bartenderLaunchOpen, bartenderLaunchStep]);

  useEffect(() => {
    if (!bartenderLaunchOpen) {
      setSessionExpiredNoticeOpen(false);
      return;
    }
    const intervalId = window.setInterval(() => {
      setLaunchNow(new Date());
    }, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [bartenderLaunchOpen]);

  useEffect(() => {
    if (bartenderLaunchOpen && isBartenderSessionExpired) {
      setSessionExpiredNoticeOpen(true);
      return;
    }
    if (!isBartenderSessionExpired) {
      setSessionExpiredNoticeOpen(false);
    }
  }, [bartenderLaunchOpen, isBartenderSessionExpired]);

  const createSessionMutation = useCreateOpenBarSession();
  const joinSessionMutation = useJoinOpenBarSession();
  const leaveSessionMutation = useLeaveOpenBarSession();
  const updateDrinkLabelSettingsMutation = useUpdateOpenBarDrinkLabelSettings();
  const startSessionMutation = useStartOpenBarSession();
  const closeSessionMutation = useCloseOpenBarSession();
  const deleteSessionMutation = useDeleteOpenBarSession();
  const deleteIssueMutation = useDeleteOpenBarDrinkIssue();
  const createIssueMutation = useCreateOpenBarDrinkIssue();
  const createIngredientMutation = useCreateOpenBarIngredient();
  const createIngredientCategoryMutation = useCreateOpenBarIngredientCategory();
  const createSessionTypeMutation = useCreateOpenBarSessionType();
  const createIngredientVariantMutation = useCreateOpenBarIngredientVariant();
  const updateIngredientMutation = useUpdateOpenBarIngredient();
  const updateIngredientCategoryMutation = useUpdateOpenBarIngredientCategory();
  const updateSessionTypeMutation = useUpdateOpenBarSessionType();
  const updateIngredientVariantMutation = useUpdateOpenBarIngredientVariant();
  const createAdjustmentMutation = useCreateOpenBarInventoryAdjustment();
  const createRecipeMutation = useCreateOpenBarRecipe();
  const updateRecipeMutation = useUpdateOpenBarRecipe();
  const replaceRecipeIngredientsMutation = useReplaceOpenBarRecipeIngredients();
  const createDeliveryMutation = useCreateOpenBarDelivery();

  const allRecipes = useMemo(() => recipesQuery.data?.recipes ?? [], [recipesQuery.data?.recipes]);

  useEffect(() => {
    setDrinkTypeSectionOrder((current) => {
      const uniqueCurrent = current.filter((type, index) => current.indexOf(type) === index);
      const normalized = [
        ...uniqueCurrent.filter((type) => drinkTypeOrder.includes(type)),
        ...drinkTypeOrder.filter((type) => !uniqueCurrent.includes(type)),
      ];
      return arraysEqual(current, normalized) ? current : normalized;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(OPEN_BAR_DRINK_TYPE_ORDER_STORAGE_KEY, JSON.stringify(drinkTypeSectionOrder));
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
  }, [drinkTypeSectionOrder]);

  useEffect(() => {
    setRecipeOrderByDrinkType((current) => {
      const next = buildEmptyRecipeOrderByDrinkType();
      let changed = false;

      drinkTypeOrder.forEach((type) => {
        const availableRecipeIds = allRecipes
          .filter((recipe) => recipe.drinkType === type)
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id)
          .map((recipe) => recipe.id);
        const currentOrder = current[type] ?? [];
        const merged = [
          ...currentOrder.filter((recipeId) => availableRecipeIds.includes(recipeId)),
          ...availableRecipeIds.filter((recipeId) => !currentOrder.includes(recipeId)),
        ];
        next[type] = merged;
        if (!arraysEqual(currentOrder, merged)) {
          changed = true;
        }
      });

      return changed ? next : current;
    });
  }, [allRecipes]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(OPEN_BAR_RECIPE_ORDER_STORAGE_KEY, JSON.stringify(recipeOrderByDrinkType));
    } catch {
      // Ignore storage failures (private mode, quota, etc.).
    }
  }, [recipeOrderByDrinkType]);

  useEffect(() => {
    const settings = drinkLabelSettingsQuery.data?.settings ?? [];
    if (settings.length === 0) {
      return;
    }
    setDrinkLabelDisplayByType((current) => {
      const next = buildDefaultDrinkLabelDisplayByType();
      settings.forEach((setting) => {
        next[setting.drinkType as DrinkTypeKey] = setting.displayMode;
      });
      return JSON.stringify(current) === JSON.stringify(next) ? current : next;
    });
  }, [drinkLabelSettingsQuery.data?.settings]);

  const orderRecipesForType = useCallback(
    function <T extends { id: number; name: string }>(recipes: T[], type: DrinkTypeKey): T[] {
      const order = recipeOrderByDrinkType[type] ?? [];
      const orderIndex = new Map<number, number>();
      order.forEach((recipeId, index) => {
        orderIndex.set(recipeId, index);
      });
      return [...recipes].sort((left, right) => {
        const leftIndex = orderIndex.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = orderIndex.get(right.id) ?? Number.MAX_SAFE_INTEGER;
        if (leftIndex !== rightIndex) {
          return leftIndex - rightIndex;
        }
        return left.name.localeCompare(right.name) || left.id - right.id;
      });
    },
    [recipeOrderByDrinkType],
  );

  const recipeGroups = useMemo(() => {
    const recipes = allRecipes.filter((recipe) => recipe.isActive);
    return drinkTypeSectionOrder
      .map((type) => ({
        type,
        title: drinkTypeLabel[type],
        recipes: orderRecipesForType(
          recipes.filter((recipe) => recipe.drinkType === type),
          type,
        ),
      }))
      .filter((group) => group.recipes.length > 0);
  }, [allRecipes, drinkTypeSectionOrder, orderRecipesForType]);

  const recipeCatalogGroups = useMemo(
    () =>
      drinkTypeSectionOrder
        .map((type) => ({
          type,
          title: drinkTypeLabel[type],
          recipes: orderRecipesForType(
            allRecipes.filter((recipe) => recipe.drinkType === type),
            type,
          ),
        }))
        .filter((group) => group.recipes.length > 0),
    [allRecipes, drinkTypeSectionOrder, orderRecipesForType],
  );

  const ingredientOptions = useMemo(
    () =>
      (ingredientsQuery.data?.ingredients ?? [])
        .filter((ingredient) => ingredient.isActive)
        .map((ingredient) => ({
          value: String(ingredient.id),
          label: `${ingredient.name} (${ingredient.currentStock.toFixed(1)} ${ingredient.baseUnit})`,
        })),
    [ingredientsQuery.data?.ingredients],
  );

  const recipeIngredientOptions = useMemo(
    () =>
      (ingredientsQuery.data?.ingredients ?? [])
        .filter((ingredient) => ingredient.isActive && !ingredient.isCup && !ingredient.isIce)
        .map((ingredient) => ({
          value: String(ingredient.id),
          label: `${ingredient.name} (${ingredient.currentStock.toFixed(1)} ${ingredient.baseUnit})`,
        })),
    [ingredientsQuery.data?.ingredients],
  );

  const ingredientSimpleOptions = useMemo(
    () =>
      (ingredientsQuery.data?.ingredients ?? [])
        .filter((ingredient) => ingredient.isActive)
        .map((ingredient) => ({
          value: String(ingredient.id),
          label: ingredient.name,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [ingredientsQuery.data?.ingredients],
  );

  const cupIngredientOptions = useMemo(
    () =>
      (ingredientsQuery.data?.ingredients ?? [])
        .filter((ingredient) => ingredient.isActive && ingredient.isCup)
        .map((ingredient) => ({
          value: String(ingredient.id),
          label: `${ingredient.name}${ingredient.cupCapacityMl != null ? ` - ${ingredient.cupCapacityMl.toFixed(0)} ml` : ""} (${ingredient.cupType ?? "cup"})`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [ingredientsQuery.data?.ingredients],
  );

  const ingredientSimpleLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    ingredientSimpleOptions.forEach((option) => {
      map.set(option.value, option.label);
    });
    return map;
  }, [ingredientSimpleOptions]);

  const ingredientBaseUnitMap = useMemo(() => {
    const map = new Map<number, "ml" | "unit">();
    (ingredientsQuery.data?.ingredients ?? []).forEach((ingredient) => {
      map.set(ingredient.id, ingredient.baseUnit);
    });
    return map;
  }, [ingredientsQuery.data?.ingredients]);

  const ingredientVariantOptionsByIngredient = useMemo(() => {
    const grouped = new Map<string, Array<{ value: string; label: string; isActive: boolean }>>();
    (ingredientVariantsQuery.data?.variants ?? []).forEach((variant) => {
      const key = String(variant.ingredientId);
      const baseUnit = variant.ingredientBaseUnit ?? ingredientBaseUnitMap.get(variant.ingredientId) ?? "ml";
      const label = `${variant.name} (${variant.baseQuantity.toFixed(2)} ${baseUnit})`;
      const current = grouped.get(key) ?? [];
      current.push({
        value: String(variant.id),
        label: variant.isActive ? label : `${label} (inactive)`,
        isActive: variant.isActive,
      });
      grouped.set(key, current);
    });
    grouped.forEach((options, key) => {
      grouped.set(
        key,
        options.sort((a, b) => a.label.localeCompare(b.label)),
      );
    });
    return grouped;
  }, [ingredientVariantsQuery.data?.variants, ingredientBaseUnitMap]);

  const sessionOptions = useMemo(
    () =>
      (sessionsQuery.data?.sessions ?? []).map((session) => ({
        value: String(session.id),
        label: `${session.sessionName}${session.sessionTypeName ? ` (${session.sessionTypeName})` : ""} - ${session.status}`,
      })),
    [sessionsQuery.data?.sessions],
  );

  const joinableSessionOptions = useMemo(
    () =>
      (joinableSessionsQuery.data?.sessions ?? [])
        .filter((session) => session.status === "active")
        .slice()
        .sort((left, right) => left.sessionName.localeCompare(right.sessionName) || left.id - right.id),
    [joinableSessionsQuery.data?.sessions],
  );

  const sessionNameById = useMemo(() => {
    const map = new Map<number, string>();
    (sessionsQuery.data?.sessions ?? []).forEach((session) => {
      map.set(session.id, session.sessionName);
    });
    (joinableSessionsQuery.data?.sessions ?? []).forEach((session) => {
      map.set(session.id, session.sessionName);
    });
    return map;
  }, [joinableSessionsQuery.data?.sessions, sessionsQuery.data?.sessions]);

  useEffect(() => {
    if (!bootstrapQuery.data) {
      return;
    }

    const visibleSessionIds = new Set<number>();
    (sessionsQuery.data?.sessions ?? []).forEach((session) => {
      visibleSessionIds.add(session.id);
    });
    (joinableSessionsQuery.data?.sessions ?? []).forEach((session) => {
      visibleSessionIds.add(session.id);
    });
    if (activeSession?.id != null) {
      visibleSessionIds.add(activeSession.id);
    }

    setLocalDrinkIssues((current) => {
      const next = current.filter((entry) => visibleSessionIds.has(entry.payload.sessionId));
      return next.length === current.length ? current : next;
    });
  }, [
    activeSession?.id,
    bootstrapQuery.data,
    joinableSessionsQuery.data?.sessions,
    sessionsQuery.data?.sessions,
  ]);

  const selectedSession = useMemo(() => {
    const sessions = sessionsQuery.data?.sessions ?? [];
    if (selectedSessionId) {
      return sessions.find((session) => String(session.id) === selectedSessionId) ?? null;
    }
    return activeSession ?? sessions[0] ?? null;
  }, [activeSession, selectedSessionId, sessionsQuery.data?.sessions]);

  useEffect(() => {
    const sessions = sessionsQuery.data?.sessions ?? [];
    if (sessions.length === 0) {
      if (selectedSessionId !== "") {
        setSelectedSessionId("");
      }
      return;
    }
    if (selectedSessionId && sessions.some((session) => String(session.id) === selectedSessionId)) {
      return;
    }
    if (activeSession) {
      setSelectedSessionId(String(activeSession.id));
      return;
    }
    setSelectedSessionId(String(sessions[0].id));
  }, [activeSession, selectedSessionId, sessionsQuery.data?.sessions]);

  const sessionTypeOptions = useMemo(
    () =>
      (sessionTypesQuery.data?.sessionTypes ?? [])
        .filter((sessionType) => sessionType.isActive)
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)),
    [sessionTypesQuery.data?.sessionTypes],
  );

  const sessionTypeCatalog = useMemo(
    () =>
      (sessionTypesCatalogQuery.data?.sessionTypes ?? [])
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)),
    [sessionTypesCatalogQuery.data?.sessionTypes],
  );

  const venueOptions = useMemo(() => {
    return (venuesQuery.data?.venues ?? [])
      .map((venue) => ({ value: String(venue.id), label: venue.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [venuesQuery.data?.venues]);

  const allIngredientCategoryOptions = useMemo(
    () =>
      (ingredientCategoriesQuery.data?.categories ?? [])
        .map((category) => ({
          value: String(category.id),
          label: category.isActive ? category.name : `${category.name} (inactive)`,
          isActive: category.isActive,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [ingredientCategoriesQuery.data?.categories],
  );

  const activeIngredientCategoryOptions = useMemo(
    () => allIngredientCategoryOptions.filter((category) => category.isActive).map(({ value, label }) => ({ value, label })),
    [allIngredientCategoryOptions],
  );

  const ingredientCategoryLabelMap = useMemo(() => {
    const labelMap = new Map<string, string>();
    allIngredientCategoryOptions.forEach((category) => {
      labelMap.set(category.value, category.label.replace(" (inactive)", ""));
    });
    return labelMap;
  }, [allIngredientCategoryOptions]);

  const isRecipeLineLiquid = (line: RecipeLineDraft): boolean => {
    if (line.isTopUp) {
      return false;
    }
    if (line.lineType === "category_selector") {
      return Number.isFinite(Number(line.categoryId)) && Number(line.categoryId) > 0;
    }
    const ingredientId = Number(line.ingredientId);
    if (!Number.isFinite(ingredientId) || ingredientId <= 0) {
      return false;
    }
    return ingredientBaseUnitMap.get(ingredientId) === "ml";
  };

  const getRecipeLinesLiquidTotal = (lines: RecipeLineDraft[]): number =>
    lines.reduce((sum, line) => {
      if (!isRecipeLineLiquid(line)) {
        return sum;
      }
      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return sum;
      }
      return sum + quantity;
    }, 0);

  const getRequiredTopUpCount = (lines: RecipeLineDraft[]): number =>
    lines.filter(
      (line) =>
        line.isTopUp &&
        !line.isOptional &&
        line.lineType === "category_selector" &&
        Number.isFinite(Number(line.categoryId)) &&
        Number(line.categoryId) > 0,
    ).length;

  const getRecipeLineMaxQuantity = (
    lines: RecipeLineDraft[],
    index: number,
    liquidCapacityMl: number | null,
  ): number | undefined => {
    if (liquidCapacityMl == null || liquidCapacityMl <= 0) {
      return undefined;
    }
    const currentLine = lines[index];
    if (!currentLine || currentLine.isTopUp || !isRecipeLineLiquid(currentLine)) {
      return undefined;
    }
    const otherLiquidTotal = lines.reduce((sum, line, lineIndex) => {
      if (lineIndex === index || !isRecipeLineLiquid(line)) {
        return sum;
      }
      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return sum;
      }
      return sum + quantity;
    }, 0);
    const currentQuantity = Number(currentLine.quantity);
    const safeCurrentQuantity = Number.isFinite(currentQuantity) && currentQuantity > 0 ? currentQuantity : 0;
    return Math.max(liquidCapacityMl - otherLiquidTotal, safeCurrentQuantity, 0);
  };

  const getStablePreviewColor = (line: RecipeLineDraft): string => {
    const key =
      line.lineType === "category_selector"
        ? `category:${line.categoryId}`
        : `ingredient:${line.ingredientId}`;
    let hash = 0;
    for (let i = 0; i < key.length; i += 1) {
      hash = ((hash << 5) - hash + key.charCodeAt(i)) >>> 0;
    }
    const hue = hash % 360;
    const saturation = 62 + (hash % 18);
    const lightness = 48 + ((hash >>> 5) % 10);
    return `hsl(${hue} ${saturation}% ${lightness}%)`;
  };

  const toRecipePreviewSegments = (
    lines: RecipeLineDraft[],
    liquidCapacityMl: number | null,
    options?: {
      askStrength?: boolean;
      previewStrength?: RecipePreviewStrength;
    },
  ): RecipePreviewSegment[] => {
    const fixedSegments = lines
      .map((line, index) => {
        if (line.isTopUp) {
          return null;
        }
        const rawQuantity = Number(line.quantity);
        const strengthMultiplier =
          options?.askStrength && options?.previewStrength === "double" && line.affectsStrength ? 2 : 1;
        const quantity = rawQuantity * strengthMultiplier;
        if (!Number.isFinite(quantity) || quantity <= 0) {
          return null;
        }
        const hasValidSelector =
          line.lineType === "category_selector"
            ? Number.isFinite(Number(line.categoryId)) && Number(line.categoryId) > 0
            : Number.isFinite(Number(line.ingredientId)) && Number(line.ingredientId) > 0;
        if (!hasValidSelector) {
          return null;
        }
        if (!isRecipeLineLiquid(line)) {
          return null;
        }
        const label =
          line.lineType === "category_selector"
            ? `Category: ${ingredientCategoryLabelMap.get(line.categoryId) ?? (line.categoryId || "-")}`
            : ingredientSimpleLabelMap.get(line.ingredientId) ?? (line.ingredientId || "-");
        return {
          key: `segment-${index}`,
          label,
          quantity,
          color: getStablePreviewColor(line),
        } satisfies RecipePreviewSegment;
      })
      .filter((segment): segment is RecipePreviewSegment => segment !== null);

    const topUpLines = lines
      .map((line, index) => ({ line, index }))
      .filter(
        ({ line }) =>
          line.isTopUp &&
          line.lineType === "category_selector" &&
          Number.isFinite(Number(line.categoryId)) &&
          Number(line.categoryId) > 0,
      );
    if (topUpLines.length === 0 || liquidCapacityMl == null) {
      return fixedSegments;
    }
    const fixedLiquidMl = fixedSegments.reduce((sum, segment) => sum + segment.quantity, 0);
    const remainingMl = Math.max(liquidCapacityMl - fixedLiquidMl, 0);
    if (remainingMl <= 0) {
      return fixedSegments;
    }
    const perTopUpMl = remainingMl / topUpLines.length;
    const topUpSegments = topUpLines.map(({ line, index }) => ({
      key: `segment-topup-${index}`,
      label: `Top Up: ${ingredientCategoryLabelMap.get(line.categoryId) ?? (line.categoryId || "-")}`,
      quantity: perTopUpMl,
      color: getStablePreviewColor(line),
    }));
    return [...fixedSegments, ...topUpSegments];
  };
  const selectedCreateCupCapacityMl = useMemo(() => {
    if (!recipeCupIngredientId) {
      return null;
    }
    const selected = (ingredientsQuery.data?.ingredients ?? []).find(
      (ingredient) => ingredient.isCup && String(ingredient.id) === recipeCupIngredientId,
    );
    return selected?.cupCapacityMl ?? null;
  }, [ingredientsQuery.data?.ingredients, recipeCupIngredientId]);

  const selectedEditCupCapacityMl = useMemo(() => {
    if (!editingRecipeCupIngredientId) {
      return null;
    }
    const selected = (ingredientsQuery.data?.ingredients ?? []).find(
      (ingredient) => ingredient.isCup && String(ingredient.id) === editingRecipeCupIngredientId,
    );
    return selected?.cupCapacityMl ?? null;
  }, [editingRecipeCupIngredientId, ingredientsQuery.data?.ingredients]);
  const selectedCreateAvailableLiquidCapacityMl = useMemo(
    () => getAvailableLiquidCapacityMl(selectedCreateCupCapacityMl, recipeHasIce, recipeIceCubes),
    [selectedCreateCupCapacityMl, recipeHasIce, recipeIceCubes],
  );
  const selectedEditAvailableLiquidCapacityMl = useMemo(
    () => getAvailableLiquidCapacityMl(selectedEditCupCapacityMl, editingRecipeHasIce, editingRecipeIceCubes),
    [selectedEditCupCapacityMl, editingRecipeHasIce, editingRecipeIceCubes],
  );
  const createRecipePreviewSegments = toRecipePreviewSegments(recipeLines, selectedCreateAvailableLiquidCapacityMl, {
    askStrength: recipeAskStrength,
    previewStrength: createRecipePreviewStrength,
  });
  const editRecipePreviewSegments = toRecipePreviewSegments(editingRecipeLines, selectedEditAvailableLiquidCapacityMl, {
    askStrength: editingRecipeAskStrength,
    previewStrength: editRecipePreviewStrength,
  });

  const editingIngredientCategoryOptions = useMemo(() => {
    const options = [...activeIngredientCategoryOptions];
    if (
      editingIngredientCategory &&
      !options.some((option) => option.value === editingIngredientCategory)
    ) {
      const fallbackLabel =
        ingredientCategoryLabelMap.get(editingIngredientCategory) ??
        `Category #${editingIngredientCategory}`;
      options.push({ value: editingIngredientCategory, label: `${fallbackLabel} (inactive)` });
    }
    return options;
  }, [activeIngredientCategoryOptions, editingIngredientCategory, ingredientCategoryLabelMap]);

  const bartenderIngredientsByCategory = useMemo(() => {
    const map = new Map<number, Array<{ value: number; label: string }>>();
    (ingredientsQuery.data?.ingredients ?? [])
      .filter((ingredient) => ingredient.isActive && !ingredient.isCup && !ingredient.isIce)
      .forEach((ingredient) => {
        const current = map.get(ingredient.categoryId) ?? [];
        current.push({ value: ingredient.id, label: ingredient.name });
        map.set(ingredient.categoryId, current);
      });

    map.forEach((options, categoryId) => {
      map.set(
        categoryId,
        options.sort((a, b) => a.label.localeCompare(b.label)),
      );
    });
    return map;
  }, [ingredientsQuery.data?.ingredients]);

  const activeRecipes = useMemo(
    () => (recipesQuery.data?.recipes ?? []).filter((recipe) => recipe.isActive),
    [recipesQuery.data?.recipes],
  );

  const allRecipesById = useMemo(() => {
    const map = new Map<number, (typeof allRecipes)[number]>();
    allRecipes.forEach((recipe) => {
      map.set(recipe.id, recipe);
    });
    return map;
  }, [allRecipes]);

  const ingredientNameById = useMemo(() => {
    const map = new Map<number, string>();
    (ingredientsQuery.data?.ingredients ?? []).forEach((ingredient) => {
      map.set(ingredient.id, ingredient.name);
    });
    return map;
  }, [ingredientsQuery.data?.ingredients]);

  const activeRecipeById = useMemo(() => {
    const map = new Map<number, (typeof activeRecipes)[number]>();
    activeRecipes.forEach((recipe) => {
      map.set(recipe.id, recipe);
    });
    return map;
  }, [activeRecipes]);

  const selectedBartenderRecipe = useMemo(() => {
    if (bartenderLaunchRecipeId == null) {
      return null;
    }
    return activeRecipeById.get(bartenderLaunchRecipeId) ?? null;
  }, [activeRecipeById, bartenderLaunchRecipeId]);

  const selectedBartenderCategoryLine = useMemo(() => {
    if (!selectedBartenderRecipe || bartenderLaunchPendingCategoryLineId == null) {
      return null;
    }
    return selectedBartenderRecipe.ingredients.find((line) => line.id === bartenderLaunchPendingCategoryLineId) ?? null;
  }, [selectedBartenderRecipe, bartenderLaunchPendingCategoryLineId]);

  const selectedBartenderCategoryOptions = useMemo(() => {
    if (!selectedBartenderCategoryLine?.categoryId) {
      return [];
    }
    return bartenderIngredientsByCategory.get(selectedBartenderCategoryLine.categoryId) ?? [];
  }, [bartenderIngredientsByCategory, selectedBartenderCategoryLine]);

  const selectedBartenderLaunchDrinkLabel = useMemo(() => {
    if (!selectedBartenderRecipe) {
      return null;
    }

    const ingredientParts = selectedBartenderRecipe.ingredients
      .slice()
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((line) => {
        if (line.lineType === "fixed_ingredient") {
          const fixedIngredientName =
            line.ingredientName?.trim() ??
            (line.ingredientId != null ? ingredientNameById.get(line.ingredientId)?.trim() ?? null : null);
          return fixedIngredientName;
        }

        const selectedIngredientId = bartenderLaunchCategorySelections[line.id];
        if (selectedIngredientId != null) {
          return ingredientNameById.get(selectedIngredientId)?.trim() ?? line.categoryName?.trim() ?? null;
        }
        return null;
      })
      .filter((name): name is string => Boolean(name))
      .filter((name) => name.length > 0);

    if (ingredientParts.length === 0) {
      return selectedBartenderRecipe.name;
    }

    return ingredientParts.join(" + ");
  }, [bartenderLaunchCategorySelections, ingredientNameById, selectedBartenderRecipe]);

  const formatSessionIssueDrinkName = useCallback(
    (options: {
      recipeId: number | null;
      recipeName: string | null;
      drinkType: DrinkTypeKey | null;
      categorySelections?: Array<{ recipeLineId: number; ingredientId: number }>;
    }): string => {
      const baseName = options.recipeName ?? "-";
      const recipe = options.recipeId == null ? null : allRecipesById.get(options.recipeId) ?? null;
      const fallbackDrinkType = (recipe?.drinkType ?? options.drinkType ?? null) as DrinkTypeKey | null;
      if (!fallbackDrinkType) {
        return baseName;
      }
      const displayMode = (recipe?.labelDisplayMode as DrinkLabelDisplayMode | null) ?? drinkLabelDisplayByType[fallbackDrinkType] ?? "recipe_name";
      if (displayMode === "recipe_name") {
        return baseName;
      }
      if (!recipe) {
        return baseName;
      }

      const categorySelectionByLineId = new Map<number, number>();
      (options.categorySelections ?? []).forEach((selection) => {
        categorySelectionByLineId.set(selection.recipeLineId, selection.ingredientId);
      });

      const ingredientParts = recipe.ingredients
        .slice()
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((line) => {
          if (line.lineType === "fixed_ingredient") {
            return line.ingredientName ?? null;
          }
          const selectedIngredientId = categorySelectionByLineId.get(line.id);
          if (selectedIngredientId != null) {
            return ingredientNameById.get(selectedIngredientId) ?? line.categoryName ?? null;
          }
          if (line.isOptional) {
            return null;
          }
          return line.categoryName ?? null;
        })
        .filter((name): name is string => Boolean(name))
        .map((name) => name.trim())
        .filter((name) => name.length > 0);

      if (ingredientParts.length === 0) {
        return baseName;
      }

      if (displayMode === "ingredients_only") {
        return ingredientParts.join(" + ");
      }

      return `${baseName} (${ingredientParts.join(" + ")})`;
    },
    [allRecipesById, drinkLabelDisplayByType, ingredientNameById],
  );

  const currentSessionIssues = useMemo<SessionIssueRow[]>(() => {
    if (!activeSession) {
      return [];
    }

    const serverIssues = sessionIssuesQuery.data?.issues ?? [];
    const serverIssueIds = new Set(serverIssues.map((issue) => issue.id));
    const serverRows: SessionIssueRow[] = serverIssues.map((issue) => {
      const parsedMeta = parseIssueNotesMetadata(issue.notes ?? null);
      return {
        rowKey: `server-${issue.id}`,
        issueId: issue.id,
        localId: null,
        remoteIssueId: issue.id,
        issuedAt: issue.issuedAt,
        issuedById: issue.issuedBy ?? null,
        issuedByName:
          issue.issuedByName?.trim() ||
          resolveUserDisplayName(issue.issuedBy) ||
          (issue.issuedBy != null && issue.issuedBy === loggedUserId ? currentOperatorLabel : null),
        recipeId: issue.recipeId ?? null,
        drinkType: issue.drinkType as DrinkTypeKey | null,
        recipeName: issue.recipeName ?? null,
        drinkDisplayName:
          issue.displayName ??
          formatSessionIssueDrinkName({
            recipeId: issue.recipeId ?? null,
            drinkType: issue.drinkType as DrinkTypeKey | null,
            recipeName: issue.recipeName ?? null,
          }),
        servings: issue.servings,
        strength: parsedMeta.strength,
        includeIce: parsedMeta.includeIce,
        notes: parsedMeta.cleanNote,
        isStaffDrink: Boolean(issue.isStaffDrink),
        syncState: "synced",
        syncError: null,
        source: "server",
      };
    });

    const localRows: SessionIssueRow[] = localDrinkIssues
      .filter((entry) => entry.payload.sessionId === activeSession.id)
      .filter((entry) => !(entry.status === "synced" && entry.remoteIssueId != null && serverIssueIds.has(entry.remoteIssueId)))
      .map((entry) => {
        const recipe = allRecipesById.get(entry.payload.recipeId);
        const drinkType = (recipe?.drinkType ?? null) as DrinkTypeKey | null;
        const recipeName = entry.recipeName ?? recipe?.name ?? null;
        const parsedMeta = parseIssueNotesMetadata(entry.payload.notes ?? null);
        return {
          rowKey: `local-${entry.localId}`,
          issueId: entry.remoteIssueId ?? null,
          localId: entry.localId,
          remoteIssueId: entry.remoteIssueId,
          issuedAt: entry.payload.issuedAt ?? entry.createdAt,
          issuedById: Number.isFinite(loggedUserId) && loggedUserId > 0 ? loggedUserId : null,
          issuedByName: currentOperatorLabel,
          recipeId: entry.payload.recipeId ?? null,
          drinkType,
          recipeName,
          drinkDisplayName: formatSessionIssueDrinkName({
            recipeId: entry.payload.recipeId ?? null,
            drinkType,
            recipeName,
            categorySelections: entry.payload.categorySelections,
          }),
          servings: entry.payload.servings,
          strength: entry.payload.strength ?? parsedMeta.strength ?? null,
          includeIce: entry.payload.includeIce ?? parsedMeta.includeIce ?? null,
          notes: parsedMeta.cleanNote,
          isStaffDrink: Boolean(entry.payload.isStaffDrink),
          syncState: entry.status,
          syncError: entry.errorMessage,
          source: "local",
        } satisfies SessionIssueRow;
      });

    return [...localRows, ...serverRows].sort((left, right) => dayjs(right.issuedAt).valueOf() - dayjs(left.issuedAt).valueOf());
  }, [
    activeSession,
    allRecipesById,
    currentOperatorLabel,
    formatSessionIssueDrinkName,
    localDrinkIssues,
    loggedUserId,
    resolveUserDisplayName,
    sessionIssuesQuery.data?.issues,
  ]);

  const visibleCurrentSessionIssues = useMemo<SessionIssueRow[]>(() => {
    if (launchIssueScope === "all") {
      return currentSessionIssues;
    }
    if (!Number.isFinite(loggedUserId) || loggedUserId <= 0) {
      return currentSessionIssues.filter((issue) => issue.source === "local");
    }
    return currentSessionIssues.filter((issue) => {
      if (issue.issuedById != null) {
        return issue.issuedById === loggedUserId;
      }
      return issue.source === "local";
    });
  }, [currentSessionIssues, launchIssueScope, loggedUserId]);

  const failedSessionIssueCount = useMemo(
    () => visibleCurrentSessionIssues.filter((issue) => issue.syncState === "failed").length,
    [visibleCurrentSessionIssues],
  );
  const failedIssueCountTotal = useMemo(
    () => localDrinkIssues.filter((entry) => entry.status === "failed").length,
    [localDrinkIssues],
  );
  const hasFailedRequests = failedIssueCountTotal > 0;
  const showLaunchIssueTimeColumn = !isBartenderLaunchCompact;
  const showLaunchIssueUserColumn = launchIssueScope === "all" && !isBartenderLaunchCompact;
  const showLaunchIssueDetailsColumn = !isBartenderLaunchCompact;
  const launchIssueTableColumnCount =
    4 + (showLaunchIssueTimeColumn ? 1 : 0) + (showLaunchIssueUserColumn ? 1 : 0) + (showLaunchIssueDetailsColumn ? 1 : 0);
  const pendingDrinksToSyncRows = useMemo(() => {
    const entries = localDrinkIssues
      .filter((entry) => entry.status !== "synced")
      .filter((entry) => (selectedSession ? entry.payload.sessionId === selectedSession.id : true))
      .sort((left, right) => dayjs(right.createdAt).valueOf() - dayjs(left.createdAt).valueOf());

    return entries.map((entry) => {
      const recipe = allRecipesById.get(entry.payload.recipeId);
      const drinkType = (recipe?.drinkType ?? null) as DrinkTypeKey | null;
      const recipeName = entry.recipeName ?? recipe?.name ?? null;
      return {
        localId: entry.localId,
        sessionId: entry.payload.sessionId,
        sessionName: sessionNameById.get(entry.payload.sessionId) ?? `Session #${entry.payload.sessionId}`,
        issuedAt: entry.payload.issuedAt ?? entry.createdAt,
        drinkDisplayName: formatSessionIssueDrinkName({
          recipeId: entry.payload.recipeId ?? null,
          drinkType,
          recipeName,
          categorySelections: entry.payload.categorySelections,
        }),
        servings: entry.payload.servings,
        status: entry.status,
        errorMessage: entry.errorMessage,
      };
    });
  }, [allRecipesById, formatSessionIssueDrinkName, localDrinkIssues, selectedSession, sessionNameById]);

  const pendingDrinksSyncCounts = useMemo(
    () =>
      pendingDrinksToSyncRows.reduce(
        (acc, row) => {
          if (row.status === "pending") {
            acc.pending += 1;
          } else if (row.status === "syncing") {
            acc.syncing += 1;
          } else if (row.status === "failed") {
            acc.failed += 1;
          }
          return acc;
        },
        { pending: 0, syncing: 0, failed: 0 },
      ),
    [pendingDrinksToSyncRows],
  );

  const recipeNeedsCategorySelection = (
    recipe: { ingredients: Array<{ lineType: "fixed_ingredient" | "category_selector"; isOptional?: boolean; categoryId?: number | null }> },
  ): boolean =>
    recipe.ingredients.some((line) => line.lineType === "category_selector" && !line.isOptional && line.categoryId != null);

  const recipeNeedsStrengthSelection = (recipe: { askStrength: boolean }): boolean => recipe.askStrength;
  const recipeNeedsIceSelection = (recipe: { hasIce: boolean }): boolean => recipe.hasIce;

  const procurementPlan = useMemo(() => {
    const activeVariants = (ingredientVariantsQuery.data?.variants ?? []).filter((variant) => variant.isActive);
    const variantsByIngredient = new Map<number, typeof activeVariants>();
    activeVariants.forEach((variant) => {
      const current = variantsByIngredient.get(variant.ingredientId) ?? [];
      current.push(variant);
      variantsByIngredient.set(variant.ingredientId, current);
    });

    return (ingredientsQuery.data?.ingredients ?? [])
      .filter((ingredient) => ingredient.isActive && ingredient.neededToPar > 0.000001)
      .map((ingredient) => {
        const candidates = variantsByIngredient.get(ingredient.id) ?? [];
        const bestVariant = candidates
          .map((variant) => {
            const recommendedUnits = Math.ceil(ingredient.neededToPar / variant.baseQuantity);
            const coverage = recommendedUnits * variant.baseQuantity;
            const overage = coverage - ingredient.neededToPar;
            return {
              variant,
              recommendedUnits,
              coverage,
              overage,
            };
          })
          .sort((a, b) => a.overage - b.overage || a.coverage - b.coverage)[0];

        return {
          ingredientId: ingredient.id,
          ingredientName: ingredient.name,
          baseUnit: ingredient.baseUnit,
          neededToPar: ingredient.neededToPar,
          estimatedValue: ingredient.costPerUnit == null ? null : ingredient.neededToPar * ingredient.costPerUnit,
          recommendation: bestVariant
            ? {
                variantId: bestVariant.variant.id,
                variantLabel: `${bestVariant.variant.name}${bestVariant.variant.brand ? ` (${bestVariant.variant.brand})` : ""}`,
                recommendedUnits: bestVariant.recommendedUnits,
                coverage: bestVariant.coverage,
              }
            : null,
        };
      })
      .sort((a, b) => b.neededToPar - a.neededToPar);
  }, [ingredientVariantsQuery.data?.variants, ingredientsQuery.data?.ingredients]);

  const setSuccess = useCallback((message: string) => {
    setFeedback({ tone: "green", message });
  }, []);

  const setError = useCallback((message: string) => {
    setFeedback({ tone: "red", message });
  }, []);

  const syncLocalDrinkIssue = useCallback(
    async (
      localId: string,
      options?: {
        allowInactiveSession?: boolean;
      },
    ): Promise<boolean> => {
      const issuePayload = localDrinkIssues.find((entry) => entry.localId === localId)?.payload;
      const currentStatus = localDrinkIssues.find((entry) => entry.localId === localId)?.status;
      if (!issuePayload) {
        return false;
      }
      if (currentStatus === "synced" || currentStatus === "syncing") {
        return false;
      }

      setLocalDrinkIssues((current) =>
        current.map((entry) => {
          if (entry.localId !== localId) {
            return entry;
          }
          return {
            ...entry,
            status: "syncing",
            errorMessage: null,
            updatedAt: new Date().toISOString(),
          };
        }),
      );

      const onlineNow = typeof navigator === "undefined" ? true : navigator.onLine;
      setIsOnline(onlineNow);
      if (!onlineNow) {
        setLocalDrinkIssues((current) =>
          current.map((entry) =>
            entry.localId === localId
              ? {
                  ...entry,
                  status: "failed",
                  errorMessage: "No internet connection. Saved locally.",
                  updatedAt: new Date().toISOString(),
                }
              : entry,
          ),
        );
        return false;
      }

      try {
        const requestPayload = options?.allowInactiveSession
          ? { ...issuePayload, allowInactiveSession: true }
          : issuePayload;
        const response = await createIssueMutation.mutateAsync(requestPayload);
        setLocalDrinkIssues((current) =>
          current.map((entry) =>
            entry.localId === localId
              ? {
                  ...entry,
                  status: "synced",
                  errorMessage: null,
                  remoteIssueId: response.issue?.id ?? null,
                  updatedAt: new Date().toISOString(),
                }
              : entry,
          ),
        );
        await invalidateOpenBar();
        return true;
      } catch (error) {
        const onlineAfterError = typeof navigator === "undefined" ? true : navigator.onLine;
        setIsOnline(onlineAfterError);
        const message = onlineAfterError
          ? extractDrinkSyncErrorMessage(error, "Failed to sync drink issue.")
          : "No internet connection. Saved locally.";
        setLocalDrinkIssues((current) =>
          current.map((entry) =>
            entry.localId === localId
              ? {
                  ...entry,
                  status: "failed",
                  errorMessage: message,
                  updatedAt: new Date().toISOString(),
                }
              : entry,
          ),
        );
        return false;
      }
    },
    [createIssueMutation, invalidateOpenBar, localDrinkIssues],
  );

  const queueDrinkIssue = useCallback(
    (payload: LocalDrinkIssuePayload, recipeName: string | null): string => {
      const nowIso = new Date().toISOString();
      const localId = `issue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const onlineNow = typeof navigator === "undefined" ? true : navigator.onLine;
      setIsOnline(onlineNow);

      const entry: LocalDrinkIssueQueueEntry = {
        localId,
        recipeName,
        payload: {
          ...payload,
          issuedAt: payload.issuedAt ?? nowIso,
        },
        status: onlineNow ? "pending" : "failed",
        errorMessage: onlineNow ? null : "No internet connection. Saved locally.",
        remoteIssueId: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      setLocalDrinkIssues((current) => [entry, ...current]);
      if (onlineNow) {
        void syncLocalDrinkIssue(localId);
      }
      return localId;
    },
    [syncLocalDrinkIssue],
  );

  const syncFailedDrinkIssues = useCallback(async () => {
    const failedIds = localDrinkIssues
      .filter((entry) => entry.status === "failed")
      .map((entry) => entry.localId);
    if (failedIds.length === 0) {
      return;
    }

    setIsSyncingFailedIssues(true);
    let syncedCount = 0;
    for (const localId of failedIds) {
      // Sequential retries avoid hammering the API when many requests failed offline.
      // eslint-disable-next-line no-await-in-loop
      const ok = await syncLocalDrinkIssue(localId);
      if (ok) {
        syncedCount += 1;
      }
    }
    setIsSyncingFailedIssues(false);
    if (syncedCount > 0) {
      setSuccess(`${syncedCount} failed request${syncedCount === 1 ? "" : "s"} synced.`);
    }
  }, [localDrinkIssues, setSuccess, syncLocalDrinkIssue]);

  const handleDeleteSessionIssue = useCallback(
    async (issue: SessionIssueRow) => {
      if (deletingSessionIssueRowKey != null) {
        return;
      }
      setDeletingSessionIssueRowKey(issue.rowKey);

      try {
        if (issue.source === "local") {
          if (issue.remoteIssueId != null) {
            await deleteIssueMutation.mutateAsync(issue.remoteIssueId);
          }
          if (issue.localId != null) {
            setLocalDrinkIssues((current) => current.filter((entry) => entry.localId !== issue.localId));
          }
          await invalidateOpenBar();
          setSuccess("Drink removed from current session.");
          return;
        }

        if (issue.issueId == null) {
          setError("Unable to identify this drink entry.");
          return;
        }

        await deleteIssueMutation.mutateAsync(issue.issueId);
        setLocalDrinkIssues((current) =>
          current.filter((entry) => entry.remoteIssueId == null || entry.remoteIssueId !== issue.issueId),
        );
        await invalidateOpenBar();
        setSuccess("Drink removed from current session.");
      } catch (error) {
        setError(extractApiMessage(error, "Failed to delete drink from current session."));
      } finally {
        setDeletingSessionIssueRowKey(null);
      }
    },
    [deleteIssueMutation, deletingSessionIssueRowKey, invalidateOpenBar, setError, setSuccess],
  );

  const launchIssueTableBodyRows = useMemo(() => {
    if (visibleCurrentSessionIssues.length === 0) {
      return (
        <Table.Tr>
          <Table.Td colSpan={launchIssueTableColumnCount} style={{ textAlign: "center" }}>
            <Text size="sm" c="dimmed">
              No drinks logged yet for this session.
            </Text>
          </Table.Td>
        </Table.Tr>
      );
    }

    return visibleCurrentSessionIssues.map((issue) => {
      const detailsMeta = getSessionIssueDetailsMeta(issue);
      const syncIndicator =
        issue.syncState === "synced" ? (
          <Box
            component="span"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              borderRadius: 999,
              background: "var(--mantine-color-green-6)",
            }}
          >
            <IconCheck size={14} color="white" stroke={3} />
          </Box>
        ) : issue.syncState === "failed" ? (
          <Box
            component="span"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              borderRadius: 999,
              background: "var(--mantine-color-red-6)",
            }}
          >
            <IconX size={14} color="white" stroke={3} />
          </Box>
        ) : (
          <Box
            component="span"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              borderRadius: 999,
              background: "var(--mantine-color-gray-6)",
            }}
          >
            <IconClockPlay size={13} color="white" />
          </Box>
        );

      return (
      <Table.Tr key={`bartender-session-issue-${issue.rowKey}`}>
        {showLaunchIssueTimeColumn ? (
          <Table.Td style={{ textAlign: "center" }}>{dayjs(issue.issuedAt).format("HH:mm:ss")}</Table.Td>
        ) : null}
        <Table.Td
          style={{
            textAlign: "center",
            lineHeight: 1.15,
            whiteSpace: "pre-line",
            overflowWrap: isBartenderLaunchCompact ? "anywhere" : "normal",
            wordBreak: isBartenderLaunchCompact ? "break-word" : "keep-all",
          }}
        >
          {(() => {
            const drinkLabel = `${formatIssueStrengthPrefix(issue.strength)}${issue.drinkDisplayName}`
              .replace(/\s+/g, " ")
              .trim();
            const parts = drinkLabel
              .split("+")
              .map((part) => part.trim())
              .filter((part) => part.length > 0);
            if (parts.length <= 1) {
              return drinkLabel;
            }
            if (isBartenderLaunchCompact) {
              return parts.join("\n+\n");
            }
            const nonBreakingParts = parts.map((part) => part.replace(/ /g, "\u00A0"));
            return nonBreakingParts.join("\n+\n");
          })()}
        </Table.Td>
        <Table.Td style={{ textAlign: "center" }}>{issue.servings}</Table.Td>
        {showLaunchIssueUserColumn ? <Table.Td style={{ textAlign: "center" }}>{issue.issuedByName ?? "-"}</Table.Td> : null}
        <Table.Td style={{ textAlign: "center" }}>
          {isBartenderLaunchCompact ? (
            <ActionIcon
              variant="subtle"
              color={detailsMeta.isError ? "red" : "gray"}
              size="sm"
              onClick={() =>
                setMobileLaunchIssueDetails({
                  drink: `${`${formatIssueStrengthPrefix(issue.strength)}${issue.drinkDisplayName}`.replace(/\s+/g, " ").trim()} x ${issue.servings}`,
                  user: issue.issuedByName ?? (issue.issuedById != null ? `User #${issue.issuedById}` : "-"),
                  time: dayjs(issue.issuedAt).format("HH:mm:ss"),
                  details: detailsMeta.text,
                  isError: detailsMeta.isError,
                })
              }
              aria-label="Show drink details"
            >
              {syncIndicator}
            </ActionIcon>
          ) : (
            syncIndicator
          )}
        </Table.Td>
        {showLaunchIssueDetailsColumn ? (
          <Table.Td style={{ textAlign: "left" }}>
            {detailsMeta.isError ? (
              <Text size="sm" c="red">
                {detailsMeta.text}
              </Text>
            ) : (
              detailsMeta.text
            )}
          </Table.Td>
        ) : null}
        <Table.Td style={{ textAlign: "center" }}>
          <ActionIcon
            variant="light"
            color="red"
            onClick={() => void handleDeleteSessionIssue(issue)}
            disabled={deletingSessionIssueRowKey != null}
            aria-label="Delete drink entry"
          >
            {deletingSessionIssueRowKey === issue.rowKey ? (
              <IconClockPlay size={14} />
            ) : (
              <IconTrash size={14} />
            )}
          </ActionIcon>
        </Table.Td>
      </Table.Tr>
    );
    });
  }, [
    deletingSessionIssueRowKey,
    handleDeleteSessionIssue,
    isBartenderLaunchCompact,
    launchIssueTableColumnCount,
    showLaunchIssueDetailsColumn,
    showLaunchIssueTimeColumn,
    showLaunchIssueUserColumn,
    visibleCurrentSessionIssues,
  ]);

  const handleDeleteSession = useCallback(
    async (session: {
      id: number;
      sessionName: string;
      status: "draft" | "active" | "closed";
    }) => {
      if (deletingSessionId != null) {
        return;
      }

      const confirmed = window.confirm(
        `Delete session "${session.sessionName}" (${session.status})?\n\nThis will remove its drink issues and inventory movements.`,
      );
      if (!confirmed) {
        return;
      }

      setDeletingSessionId(session.id);
      try {
        await deleteSessionMutation.mutateAsync(session.id);
        setLocalDrinkIssues((current) =>
          current.filter((entry) => entry.payload.sessionId !== session.id),
        );
        if (selectedSessionId === String(session.id)) {
          setSelectedSessionId("");
        }
        setSuccess("Session deleted.");
        await invalidateOpenBar();
      } catch (error) {
        setError(extractApiMessage(error, "Failed to delete session."));
      } finally {
        setDeletingSessionId(null);
      }
    },
    [deleteSessionMutation, deletingSessionId, invalidateOpenBar, selectedSessionId, setError, setSuccess],
  );

  useEffect(() => {
    if (!isOnline) {
      return;
    }
    const pendingIds = localDrinkIssues
      .filter((entry) => entry.status === "pending")
      .map((entry) => entry.localId);
    if (pendingIds.length === 0) {
      return;
    }
    pendingIds.forEach((localId) => {
      void syncLocalDrinkIssue(localId);
    });
  }, [isOnline, localDrinkIssues, syncLocalDrinkIssue]);

  useEffect(() => {
    const serverIssueIds = new Set((sessionIssuesQuery.data?.issues ?? []).map((issue) => issue.id));
    if (serverIssueIds.size === 0) {
      return;
    }
    setLocalDrinkIssues((current) => {
      const next = current.filter(
        (entry) => !(entry.status === "synced" && entry.remoteIssueId != null && serverIssueIds.has(entry.remoteIssueId)),
      );
      return next.length === current.length ? current : next;
    });
  }, [sessionIssuesQuery.data?.issues]);

  const moveDrinkTypeSection = (type: DrinkTypeKey, direction: -1 | 1) => {
    setDrinkTypeSectionOrder((current) => {
      const index = current.indexOf(type);
      if (index < 0) {
        return current;
      }
      const target = index + direction;
      if (target < 0 || target >= current.length) {
        return current;
      }
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const moveRecipeInDrinkType = (type: DrinkTypeKey, recipeId: number, direction: -1 | 1) => {
    setRecipeOrderByDrinkType((current) => {
      const order = current[type] ?? [];
      const index = order.indexOf(recipeId);
      if (index < 0) {
        return current;
      }
      const target = index + direction;
      if (target < 0 || target >= order.length) {
        return current;
      }
      const nextOrder = [...order];
      const [item] = nextOrder.splice(index, 1);
      nextOrder.splice(target, 0, item);
      return {
        ...current,
        [type]: nextOrder,
      };
    });
  };

  useEffect(() => {
    if (activeIngredientCategoryOptions.length === 0) {
      return;
    }
    if (!activeIngredientCategoryOptions.some((option) => option.value === ingredientCategory)) {
      setIngredientCategory(activeIngredientCategoryOptions[0].value);
    }
  }, [activeIngredientCategoryOptions, ingredientCategory]);

  const openCreateIngredientModal = () => {
    if (!ingredientCategory && activeIngredientCategoryOptions[0]?.value) {
      setIngredientCategory(activeIngredientCategoryOptions[0].value);
    }
    setCreateIngredientOpen(true);
  };

  const closeCreateIngredientModal = () => {
    setCreateIngredientOpen(false);
  };

  const handleCreateSession = async () => {
    try {
      await createSessionMutation.mutateAsync({
        sessionName,
        businessDate,
        venueId: sessionVenueId ? Number(sessionVenueId) : null,
        notes: sessionNotes || null,
      });
      setSuccess("Session created.");
      await invalidateOpenBar();
    } catch (error) {
      setError(extractApiMessage(error, "Failed to create session."));
    }
  };

  const handleStartSession = async (sessionId: number) => {
    try {
      await startSessionMutation.mutateAsync(sessionId);
      setSuccess("Session started.");
      await invalidateOpenBar();
    } catch (error) {
      setError(extractApiMessage(error, "Failed to start session."));
    }
  };

  const handleStartSessionFromType = async (sessionTypeId: number, defaultTimeLimitMinutes: number) => {
    if (startingSessionTypeId != null) {
      return;
    }
    if (activeSession) {
      setBartenderLaunchStep("recipe");
      return;
    }

    const sessionType = sessionTypeOptions.find((entry) => entry.id === sessionTypeId);
    if (!sessionType) {
      setError("Session type is no longer available.");
      return;
    }

    const safeDuration = Math.max(1, Math.floor(defaultTimeLimitMinutes));
    const sessionNameCandidate = `${sessionType.name} ${dayjs(businessDate).format("YYYY-MM-DD")}`;

    try {
      setStartingSessionTypeId(sessionTypeId);
      await createSessionMutation.mutateAsync({
        sessionName: sessionNameCandidate,
        businessDate,
        sessionTypeId: sessionType.id,
        timeLimitMinutes: safeDuration,
        status: "active",
      });
      setSuccess(`Session started: ${sessionType.name} (${formatSessionDuration(safeDuration)}).`);
      await invalidateOpenBar();
      setBartenderLaunchStep("recipe");
    } catch (error) {
      setError(extractApiMessage(error, "Failed to start session from launch."));
    } finally {
      setStartingSessionTypeId(null);
    }
  };

  const handleJoinSession = async (sessionId: number) => {
    if (joiningSessionId != null && joiningSessionId !== sessionId) {
      return;
    }
    try {
      setJoiningSessionId(sessionId);
      await joinSessionMutation.mutateAsync(sessionId);
      await invalidateOpenBar();
      setBartenderLaunchStep("recipe");
      setSuccess("Session joined.");
    } catch (error) {
      setError(extractApiMessage(error, "Failed to join session."));
    } finally {
      setJoiningSessionId(null);
    }
  };

  const handleLeaveSession = async (sessionId: number, successMessage = "Session disconnected.") => {
    if (leavingSessionId != null && leavingSessionId !== sessionId) {
      return;
    }
    try {
      setLeavingSessionId(sessionId);
      await leaveSessionMutation.mutateAsync(sessionId);
      await invalidateOpenBar();
      setBartenderLaunchStep("sessionStart");
      setBartenderLaunchQuantity(1);
      setBartenderLaunchRecipeId(null);
      setBartenderLaunchCategorySelections({});
      setBartenderLaunchPendingCategoryLineId(null);
      setBartenderLaunchStrength(null);
      setBartenderLaunchIncludeIce(null);
      setBartenderLaunchIsStaffDrink(false);
      setSuccess(successMessage);
    } catch (error) {
      setError(extractApiMessage(error, "Failed to disconnect from session."));
    } finally {
      setLeavingSessionId(null);
    }
  };

  const confirmCloseSession = (sessionDisplayName?: string | null): boolean => {
    const label = sessionDisplayName?.trim() || "this session";
    if (typeof window === "undefined") {
      return true;
    }
    return window.confirm(`Close ${label}?\n\nThis will end the session and stop drink service.`);
  };

  const openCloseSessionReconciliation = (session?: { id: number; sessionName: string; createdBy: number | null }) => {
    const targetId = session?.id ?? activeSession?.id ?? null;
    const targetSessionName = session?.sessionName ?? activeSession?.sessionName ?? null;
    const canCloseTarget =
      session != null
        ? canCloseSessionTarget(session.createdBy)
        : canCloseActiveSession;

    if (targetId == null) {
      setSessionExpiredNoticeOpen(false);
      resetBartenderLaunchFlow();
      setSuccess("Session is already finished or closed.");
      return;
    }
    if (!canCloseTarget) {
      setError("Only the session creator or a manager can close this session.");
      return;
    }
    const lines = (ingredientsQuery.data?.ingredients ?? [])
      .filter((ingredient) => ingredient.isActive)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((ingredient) => ({
        ingredientId: String(ingredient.id),
        ingredientName: ingredient.name,
        baseUnit: ingredient.baseUnit,
        systemStock: ingredient.currentStock,
        countedStock: ingredient.currentStock,
      }));
    setReconciliationLines(lines);
    setReconciliationTargetSession({
      id: targetId,
      sessionName: targetSessionName,
      canClose: canCloseTarget,
    });
    setReconciliationOpen(true);
  };

  const handleCloseSessionWithReconciliation = async () => {
    const targetSessionId = reconciliationTargetSession?.id ?? activeSession?.id ?? null;
    const targetSessionName = reconciliationTargetSession?.sessionName ?? activeSession?.sessionName ?? null;
    const canCloseTarget = reconciliationTargetSession?.canClose ?? canCloseActiveSession;
    if (targetSessionId == null) {
      setSessionExpiredNoticeOpen(false);
      resetBartenderLaunchFlow();
      setSuccess("Session is already finished or closed.");
      return;
    }
    if (!canCloseTarget) {
      setError("Only the session creator or a manager can close this session.");
      return;
    }
    if (!confirmCloseSession(targetSessionName)) {
      return;
    }

    const reconciliation = reconciliationLines
      .filter((line) => line.countedStock != null && Number.isFinite(line.countedStock))
      .map((line) => ({
        ingredientId: Number(line.ingredientId),
        countedStock: Number(line.countedStock),
      }));

    try {
      const result = await closeSessionMutation.mutateAsync({
        id: targetSessionId,
        payload: { reconciliation },
      });
      const correctionCount = (result.reconciliation ?? []).filter((line) => Math.abs(line.quantityDelta) > 0.000001).length;
      setReconciliationOpen(false);
      setReconciliationTargetSession(null);
      setSuccess(
        correctionCount > 0
          ? `Session closed with ${correctionCount} correction movement${correctionCount === 1 ? "" : "s"}.`
          : "Session closed.",
      );
      await invalidateOpenBar();
    } catch (error) {
      setError(extractApiMessage(error, "Failed to close session."));
    }
  };

  const handleCloseSessionDirect = async (
    session?: { id: number; sessionName: string; createdBy: number | null },
    successMessage = "Session closed.",
    errorMessage = "Failed to close session.",
  ) => {
    const targetSessionId = session?.id ?? activeSession?.id ?? null;
    const targetSessionName = session?.sessionName ?? activeSession?.sessionName ?? null;
    const canCloseTarget =
      session != null
        ? canCloseSessionTarget(session.createdBy)
        : canCloseActiveSession;

    if (targetSessionId == null) {
      setSessionExpiredNoticeOpen(false);
      resetBartenderLaunchFlow();
      setSuccess("Session is already finished or closed.");
      return;
    }
    if (!canCloseTarget) {
      setError("Only the session creator or a manager can close this session.");
      return;
    }
    if (!confirmCloseSession(targetSessionName)) {
      return;
    }

    try {
      await closeSessionMutation.mutateAsync({ id: targetSessionId });
      await invalidateOpenBar();
      setSessionExpiredNoticeOpen(false);
      setReconciliationOpen(false);
      setReconciliationTargetSession(null);
      setBartenderLaunchStep("sessionStart");
      setBartenderLaunchQuantity(1);
      setBartenderLaunchRecipeId(null);
      setBartenderLaunchCategorySelections({});
      setBartenderLaunchPendingCategoryLineId(null);
      setBartenderLaunchStrength(null);
      setBartenderLaunchIncludeIce(null);
      setBartenderLaunchIsStaffDrink(false);
      setSuccess(successMessage);
    } catch (error) {
      setError(extractApiMessage(error, errorMessage));
    }
  };

  const resetBartenderLaunchFlow = useCallback(() => {
    bartenderLaunchQuantityRef.current = 1;
    setBartenderLaunchStep(activeSession ? "recipe" : "sessionStart");
    setBartenderLaunchQuantity(1);
    setBartenderLaunchRecipeId(null);
    setBartenderLaunchCategorySelections({});
    setBartenderLaunchPendingCategoryLineId(null);
    setBartenderLaunchStrength(null);
    setBartenderLaunchIncludeIce(null);
    setBartenderLaunchIsStaffDrink(false);
  }, [activeSession]);

  const openSessionExpiredNotice = useCallback(() => {
    setSessionExpiredNoticeOpen(true);
  }, []);

  const handleStartNewSessionFromLaunch = async () => {
    if (!activeSession) {
      setBartenderLaunchStep("sessionStart");
      return;
    }
    await handleCloseSessionDirect(undefined, "Previous session closed. Select a session type to start a new session.", "Failed to close current session.");
  };

  const handleCloseSessionFromLaunch = async () => {
    await handleCloseSessionDirect(undefined, "Session closed.", "Failed to close session from launch.");
  };

  const finalizeBartenderLaunchIssue = useCallback(async (options?: {
    recipeId?: number;
    categorySelections?: Record<number, number>;
    strength?: BartenderStrength | null;
    includeIce?: boolean | null;
    servings?: number;
    isStaffDrink?: boolean;
  }) => {
    if (!activeSession) {
      setError("Start a session before issuing drinks.");
      return;
    }
    if (isBartenderSessionExpired) {
      openSessionExpiredNotice();
      return;
    }

    const recipeId = options?.recipeId ?? bartenderLaunchRecipeId;
    if (recipeId == null) {
      setError("Select a recipe first.");
      return;
    }

    const recipe = activeRecipeById.get(recipeId);
    if (!recipe) {
      setError("Recipe not found.");
      resetBartenderLaunchFlow();
      return;
    }

    const selectedStrength = options?.strength ?? bartenderLaunchStrengthRef.current;
    const selectedIncludeIce = options?.includeIce ?? bartenderLaunchIncludeIceRef.current;
    const selectedSelections = options?.categorySelections ?? bartenderLaunchCategorySelectionsRef.current;
    const servings = options?.servings ?? bartenderLaunchQuantityRef.current;
    const isStaffDrink = options?.isStaffDrink ?? bartenderLaunchIsStaffDrinkRef.current;
    const requiredCategoryLines = recipe.ingredients
      .filter((line) => line.lineType === "category_selector" && !line.isOptional)
      .filter((line) => line.categoryId != null);
    const missingLine = requiredCategoryLines.find((line) => selectedSelections[line.id] == null);
    if (missingLine) {
      setError(`Missing selection for ${missingLine.categoryName ?? "category"} in recipe.`);
      return;
    }
    const selectionPayload = Object.entries(selectedSelections)
      .map(([recipeLineId, ingredientId]) => ({
        recipeLineId: Number(recipeLineId),
        ingredientId: Number(ingredientId),
      }))
      .filter(
        (selection) =>
          Number.isFinite(selection.recipeLineId) &&
          selection.recipeLineId > 0 &&
          Number.isFinite(selection.ingredientId) &&
          selection.ingredientId > 0,
      );

    const onlineNow = typeof navigator === "undefined" ? true : navigator.onLine;
    queueDrinkIssue(
      {
        sessionId: activeSession.id,
        recipeId: recipe.id,
        servings,
        strength: recipe.askStrength ? (selectedStrength ?? "single") : undefined,
        includeIce: recipe.hasIce ? (selectedIncludeIce ?? true) : undefined,
        isStaffDrink,
        categorySelections: selectionPayload.length > 0 ? selectionPayload : undefined,
      },
      recipe.name,
    );
    setSuccess(
      onlineNow
        ? `${servings} x ${recipe.name}${isStaffDrink ? " (Staff)" : ""} added to session queue.`
        : `${servings} x ${recipe.name}${isStaffDrink ? " (Staff)" : ""} saved locally (offline).`,
    );
    resetBartenderLaunchFlow();
  }, [
    activeRecipeById,
    activeSession,
    bartenderLaunchRecipeId,
    isBartenderSessionExpired,
    openSessionExpiredNotice,
    queueDrinkIssue,
    resetBartenderLaunchFlow,
    setError,
    setSuccess,
  ]);

  const enqueueFinalizeBartenderLaunchIssue = useCallback((options?: {
    recipeId?: number;
    categorySelections?: Record<number, number>;
    strength?: BartenderStrength | null;
    includeIce?: boolean | null;
    servings?: number;
    isStaffDrink?: boolean;
  }) => {
    if (typeof window === "undefined") {
      void finalizeBartenderLaunchIssue(options);
      return;
    }
    window.setTimeout(() => {
      void finalizeBartenderLaunchIssue(options);
    }, 0);
  }, [finalizeBartenderLaunchIssue]);

  const handleBartenderRecipeTap = useCallback((recipeId: number) => {
    if (!activeSession) {
      setError("Start a session before issuing drinks.");
      return;
    }
    if (isBartenderSessionExpired) {
      openSessionExpiredNotice();
      return;
    }
    const recipe = activeRecipeById.get(recipeId);
    if (!recipe) {
      setError("Recipe not found.");
      return;
    }

    startTransition(() => {
      setBartenderLaunchRecipeId(recipe.id);
      setBartenderLaunchCategorySelections({});
      setBartenderLaunchPendingCategoryLineId(null);
      setBartenderLaunchStrength(null);
    });

    if (recipeNeedsCategorySelection(recipe)) {
      const nextLine = recipe.ingredients.find(
        (line) => line.lineType === "category_selector" && !line.isOptional && line.categoryId != null,
      );
      if (nextLine) {
        startTransition(() => {
          setBartenderLaunchPendingCategoryLineId(nextLine.id);
          setBartenderLaunchStep("categorySelection");
        });
        return;
      }
    }

    if (recipeNeedsStrengthSelection(recipe)) {
      startTransition(() => setBartenderLaunchStep("strength"));
      return;
    }

    if (recipeNeedsIceSelection(recipe)) {
      startTransition(() => setBartenderLaunchStep("ice"));
      return;
    }

    enqueueFinalizeBartenderLaunchIssue({ recipeId: recipe.id, categorySelections: {} });
  }, [
    activeRecipeById,
    activeSession,
    enqueueFinalizeBartenderLaunchIssue,
    isBartenderSessionExpired,
    openSessionExpiredNotice,
    setError,
  ]);

  const handleBartenderCategorySelectionTap = useCallback((ingredientId: number) => {
    if (isBartenderSessionExpired) {
      openSessionExpiredNotice();
      return;
    }
    if (!selectedBartenderRecipe || bartenderLaunchPendingCategoryLineId == null) {
      startTransition(() => setBartenderLaunchStep("recipe"));
      return;
    }

    const nextSelections: Record<number, number> = {
      ...bartenderLaunchCategorySelections,
      [bartenderLaunchPendingCategoryLineId]: ingredientId,
    };
    startTransition(() => setBartenderLaunchCategorySelections(nextSelections));

    const nextPending = selectedBartenderRecipe.ingredients.find(
      (line) =>
        line.lineType === "category_selector" &&
        !line.isOptional &&
        line.categoryId != null &&
        nextSelections[line.id] == null,
    );

    if (nextPending) {
      startTransition(() => {
        setBartenderLaunchPendingCategoryLineId(nextPending.id);
        setBartenderLaunchStep("categorySelection");
      });
      return;
    }

    if (recipeNeedsStrengthSelection(selectedBartenderRecipe)) {
      startTransition(() => {
        setBartenderLaunchPendingCategoryLineId(null);
        setBartenderLaunchStep("strength");
      });
      return;
    }

    if (recipeNeedsIceSelection(selectedBartenderRecipe)) {
      startTransition(() => {
        setBartenderLaunchPendingCategoryLineId(null);
        setBartenderLaunchStep("ice");
      });
      return;
    }

    enqueueFinalizeBartenderLaunchIssue({
      recipeId: selectedBartenderRecipe.id,
      categorySelections: nextSelections,
      strength: null,
    });
  }, [
    bartenderLaunchCategorySelections,
    bartenderLaunchPendingCategoryLineId,
    enqueueFinalizeBartenderLaunchIssue,
    isBartenderSessionExpired,
    openSessionExpiredNotice,
    selectedBartenderRecipe,
  ]);

  const handleBartenderStrengthTap = useCallback((strength: BartenderStrength) => {
    if (isBartenderSessionExpired) {
      openSessionExpiredNotice();
      return;
    }
    if (!selectedBartenderRecipe) {
      startTransition(() => setBartenderLaunchStep("recipe"));
      return;
    }
    startTransition(() => setBartenderLaunchStrength(strength));
    if (recipeNeedsIceSelection(selectedBartenderRecipe)) {
      startTransition(() => setBartenderLaunchStep("ice"));
      return;
    }
    enqueueFinalizeBartenderLaunchIssue({
      recipeId: selectedBartenderRecipe.id,
      categorySelections: bartenderLaunchCategorySelections,
      strength,
    });
  }, [
    bartenderLaunchCategorySelections,
    enqueueFinalizeBartenderLaunchIssue,
    isBartenderSessionExpired,
    openSessionExpiredNotice,
    selectedBartenderRecipe,
  ]);

  const handleBartenderIceTap = useCallback((includeIce: boolean) => {
    if (isBartenderSessionExpired) {
      openSessionExpiredNotice();
      return;
    }
    if (!selectedBartenderRecipe) {
      startTransition(() => setBartenderLaunchStep("recipe"));
      return;
    }
    const selectedRecipeId = selectedBartenderRecipe.id;
    const selectedCategorySelections = bartenderLaunchCategorySelections;
    const selectedStrength = bartenderLaunchStrength;
    const servings = bartenderLaunchQuantityRef.current;
    startTransition(() => {
      setBartenderLaunchIncludeIce(includeIce);
      setBartenderLaunchQuantity(1);
      setBartenderLaunchStep("recipe");
    });
    enqueueFinalizeBartenderLaunchIssue({
      recipeId: selectedRecipeId,
      categorySelections: selectedCategorySelections,
      strength: selectedStrength,
      includeIce,
      servings,
    });
  }, [
    bartenderLaunchCategorySelections,
    bartenderLaunchStrength,
    enqueueFinalizeBartenderLaunchIssue,
    isBartenderSessionExpired,
    openSessionExpiredNotice,
    selectedBartenderRecipe,
  ]);

  const commitBartenderLaunchQuantity = useCallback((next: number) => {
    bartenderLaunchQuantityRef.current = next;
    if (typeof window === "undefined") {
      setBartenderLaunchQuantity(next);
      return;
    }
    if (bartenderLaunchQuantityRafRef.current != null) {
      return;
    }
    bartenderLaunchQuantityRafRef.current = window.requestAnimationFrame(() => {
      bartenderLaunchQuantityRafRef.current = null;
      startTransition(() => {
        setBartenderLaunchQuantity(bartenderLaunchQuantityRef.current);
      });
    });
  }, []);

  const handleBartenderLaunchQuantityDecrement = useCallback(() => {
    const next = Math.max(1, bartenderLaunchQuantityRef.current - 1);
    commitBartenderLaunchQuantity(next);
  }, [commitBartenderLaunchQuantity]);

  const handleBartenderLaunchQuantityIncrement = useCallback(() => {
    const next = Math.min(99, bartenderLaunchQuantityRef.current + 1);
    commitBartenderLaunchQuantity(next);
  }, [commitBartenderLaunchQuantity]);

  const handleBartenderLaunchStaffToggle = useCallback(() => {
    startTransition(() => {
      setBartenderLaunchIsStaffDrink((current) => !current);
    });
  }, []);

  const handleBartenderStrengthSingleTap = useCallback(() => {
    handleBartenderStrengthTap("single");
  }, [handleBartenderStrengthTap]);

  const handleBartenderStrengthDoubleTap = useCallback(() => {
    handleBartenderStrengthTap("double");
  }, [handleBartenderStrengthTap]);

  const handleBartenderWithIceTap = useCallback(() => {
    handleBartenderIceTap(true);
  }, [handleBartenderIceTap]);

  const handleBartenderNoIceTap = useCallback(() => {
    handleBartenderIceTap(false);
  }, [handleBartenderIceTap]);

  const bartenderRecipeGroupCards = useMemo(
    () =>
      recipeGroups.map((group) => (
        <Stack key={`bartender-${group.type}`} gap="xs">
          <Title order={4} ta="center">
            {group.title}
          </Title>
          <Box
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 170px), 1fr))",
              gap: 12,
            }}
          >
            {group.recipes.map((recipe) => {
              const label = splitBartenderRecipeLabel(recipe.name);
              const secondaryLineCount = label.secondaryLines.length;
              return (
                <Button
                  key={`bartender-recipe-${recipe.id}`}
                  size="xl"
                  variant="filled"
                  color={bartenderRecipeButtonColorByType[group.type] ?? "blue"}
                  disabled={!activeSession || isBartenderSessionExpired}
                  onClick={() => handleBartenderRecipeTap(recipe.id)}
                  style={{
                    height: "clamp(110px, 16vh, 138px)",
                    padding: "10px 8px",
                    minWidth: 0,
                    touchAction: "manipulation",
                  }}
                >
                  <Stack
                    gap={secondaryLineCount >= 3 ? 0 : 2}
                    align="center"
                    style={{ width: "100%", minWidth: 0, height: "100%", justifyContent: "center" }}
                  >
                    <Text
                      fw={900}
                      style={{
                        fontSize: getBartenderPrimaryFontSize(label.primary, secondaryLineCount),
                        lineHeight: 1.02,
                        width: "100%",
                        textAlign: "center",
                        whiteSpace: "normal",
                        overflowWrap: "anywhere",
                        wordBreak: "break-word",
                      }}
                    >
                      {label.primary}
                    </Text>
                    {label.secondaryLines.map((line, lineIndex) => (
                      <Text
                        key={`bartender-recipe-label-${recipe.id}-${lineIndex}`}
                        fw={600}
                        style={{
                          fontSize: getBartenderSecondaryFontSize(line, secondaryLineCount),
                          lineHeight: 1.02,
                          width: "100%",
                          textAlign: "center",
                          whiteSpace: "normal",
                          overflowWrap: "anywhere",
                          wordBreak: "break-word",
                        }}
                      >
                        {line}
                      </Text>
                    ))}
                  </Stack>
                </Button>
              );
            })}
          </Box>
        </Stack>
      )),
    [activeSession, handleBartenderRecipeTap, isBartenderSessionExpired, recipeGroups],
  );

  const bartenderCategoryOptionButtons = useMemo(
    () =>
      selectedBartenderCategoryOptions.map((option) => {
        const optionColor = getBartenderCategoryOptionButtonColor(
          option.label,
          selectedBartenderCategoryLine?.categorySlug ??
            selectedBartenderCategoryLine?.categoryName ??
            "category",
        );
        return (
          <Button
            key={`bartender-category-option-${option.value}`}
            size="xl"
            color={optionColor}
            style={{
              height: "clamp(110px, 16vh, 138px)",
              minWidth: 0,
              padding: "10px 8px",
              touchAction: "manipulation",
            }}
            styles={{
              inner: {
                height: "100%",
                width: "100%",
              },
              label: {
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                whiteSpace: "normal",
                overflowWrap: "normal",
                wordBreak: "normal",
                hyphens: "none",
                lineHeight: 1.08,
                textAlign: "center",
                width: "100%",
                height: "100%",
                fontSize: getBartenderCategoryOptionFontSize(option.label),
                fontWeight: 800,
              },
            }}
            disabled={!activeSession || isBartenderSessionExpired}
            onClick={() => handleBartenderCategorySelectionTap(option.value)}
          >
            {option.label}
          </Button>
        );
      }),
    [
      activeSession,
      handleBartenderCategorySelectionTap,
      isBartenderSessionExpired,
      selectedBartenderCategoryLine?.categoryName,
      selectedBartenderCategoryLine?.categorySlug,
      selectedBartenderCategoryOptions,
    ],
  );

  const handleCreateIngredient = async () => {
    if (
      !ingredientCategory ||
      !activeIngredientCategoryOptions.some((option) => option.value === ingredientCategory)
    ) {
      setError("Create at least one active category first.");
      return;
    }
    if (ingredientIsCup && (!Number.isFinite(ingredientCupCapacityMl) || (ingredientCupCapacityMl ?? 0) <= 0)) {
      setError("Cup capacity (ml) is required for cup ingredients.");
      return;
    }
    if (ingredientIsCup && ingredientIsIce) {
      setError("Ingredient cannot be both cup and ice.");
      return;
    }
    try {
      await createIngredientMutation.mutateAsync({
        name: ingredientName,
        categoryId: Number(ingredientCategory),
        baseUnit: (ingredientIsCup ? "unit" : ingredientUnit) as "ml" | "unit",
        parLevel: ingredientPar,
        reorderLevel: ingredientReorder,
        costPerUnit: ingredientCost,
        isCup: ingredientIsCup,
        cupType: ingredientIsCup ? ingredientCupType : null,
        cupCapacityMl: ingredientIsCup ? ingredientCupCapacityMl : null,
        isIce: ingredientIsIce,
      });
      setIngredientName("");
      setIngredientPar(0);
      setIngredientReorder(0);
      setIngredientCost(null);
      setIngredientIsCup(false);
      setIngredientIsIce(false);
      setIngredientCupType("disposable");
      setIngredientCupCapacityMl(null);
      closeCreateIngredientModal();
      setSuccess("Ingredient added.");
      await invalidateOpenBar();
    } catch (error) {
      setError(extractApiMessage(error, "Failed to create ingredient."));
    }
  };

  const openIngredientEditor = (ingredient: {
    id: number;
    name: string;
    categoryId: number;
    baseUnit: "ml" | "unit";
    parLevel: number;
    reorderLevel: number;
    isCup: boolean;
    isIce: boolean;
    cupType: "disposable" | "reusable" | null;
    cupCapacityMl: number | null;
  }) => {
    setEditingIngredientId(ingredient.id);
    setEditingIngredientName(ingredient.name);
    setEditingIngredientCategory(String(ingredient.categoryId));
    setEditingIngredientOriginalUnit(ingredient.baseUnit);
    setEditingIngredientUnit(ingredient.baseUnit);
    setEditingIngredientPar(ingredient.parLevel);
    setEditingIngredientReorder(ingredient.reorderLevel);
    setEditingUnitConversionFactor(null);
    setEditingIngredientIsCup(ingredient.isCup);
    setEditingIngredientIsIce(ingredient.isIce);
    setEditingIngredientCupType(ingredient.cupType ?? "disposable");
    setEditingIngredientCupCapacityMl(ingredient.cupCapacityMl);
  };

  const closeIngredientEditor = () => {
    setEditingIngredientId(null);
    setEditingIngredientName("");
    setEditingIngredientCategory(activeIngredientCategoryOptions[0]?.value ?? "");
    setEditingIngredientOriginalUnit("ml");
    setEditingIngredientUnit("ml");
    setEditingIngredientPar(0);
    setEditingIngredientReorder(0);
    setEditingUnitConversionFactor(null);
    setEditingIngredientIsCup(false);
    setEditingIngredientIsIce(false);
    setEditingIngredientCupType("disposable");
    setEditingIngredientCupCapacityMl(null);
  };

  const handleUpdateIngredient = async () => {
    if (!editingIngredientId) {
      return;
    }
    if (!editingIngredientName.trim()) {
      setError("Ingredient name is required.");
      return;
    }
    if (!editingIngredientCategory) {
      setError("Ingredient category is required.");
      return;
    }
    if (editingIngredientIsCup && (!Number.isFinite(editingIngredientCupCapacityMl) || (editingIngredientCupCapacityMl ?? 0) <= 0)) {
      setError("Cup capacity (ml) is required for cup ingredients.");
      return;
    }
    if (editingIngredientIsCup && editingIngredientIsIce) {
      setError("Ingredient cannot be both cup and ice.");
      return;
    }
    const nextBaseUnit = editingIngredientIsCup ? "unit" : editingIngredientUnit;
    try {
      await updateIngredientMutation.mutateAsync({
        id: editingIngredientId,
        payload: {
          name: editingIngredientName.trim(),
          categoryId: Number(editingIngredientCategory),
          baseUnit: nextBaseUnit,
          parLevel: editingIngredientPar,
          reorderLevel: editingIngredientReorder,
          isCup: editingIngredientIsCup,
          cupType: editingIngredientIsCup ? editingIngredientCupType : null,
          cupCapacityMl: editingIngredientIsCup ? editingIngredientCupCapacityMl : null,
          isIce: editingIngredientIsIce,
          ...(nextBaseUnit !== editingIngredientOriginalUnit &&
          editingUnitConversionFactor != null &&
          editingUnitConversionFactor > 0
            ? { unitConversionFactor: editingUnitConversionFactor }
            : {}),
        },
      });
      closeIngredientEditor();
      setSuccess("Ingredient updated.");
      await invalidateOpenBar();
    } catch (error) {
      setError(extractApiMessage(error, "Failed to update ingredient."));
    }
  };

  const handleCreateIngredientCategory = async () => {
    if (!newCategoryName.trim()) {
      setError("Category name is required.");
      return;
    }
    try {
      await createIngredientCategoryMutation.mutateAsync({
        name: newCategoryName.trim(),
        slug: newCategorySlug.trim() || undefined,
        sortOrder: newCategorySortOrder,
        isActive: newCategoryActive,
      });
      setNewCategoryName("");
      setNewCategorySlug("");
      setNewCategorySortOrder(0);
      setNewCategoryActive(true);
      setCreateCategoryOpen(false);
      setSuccess("Category created.");
      await invalidateOpenBar();
    } catch (error) {
      setError(extractApiMessage(error, "Failed to create category."));
    }
  };

  const openCategoryEditor = (category: {
    id: number;
    name: string;
    slug: string;
    sortOrder: number;
    isActive: boolean;
  }) => {
    setEditingCategoryId(category.id);
    setEditingCategoryName(category.name);
    setEditingCategorySlug(category.slug);
    setEditingCategorySortOrder(category.sortOrder);
    setEditingCategoryActive(category.isActive);
  };

  const closeCategoryEditor = () => {
    setEditingCategoryId(null);
    setEditingCategoryName("");
    setEditingCategorySlug("");
    setEditingCategorySortOrder(0);
    setEditingCategoryActive(true);
  };

  const handleUpdateIngredientCategory = async () => {
    if (!editingCategoryId) {
      return;
    }
    if (!editingCategoryName.trim()) {
      setError("Category name is required.");
      return;
    }
    try {
      await updateIngredientCategoryMutation.mutateAsync({
        id: editingCategoryId,
        payload: {
          name: editingCategoryName.trim(),
          slug: editingCategorySlug.trim(),
          sortOrder: editingCategorySortOrder,
          isActive: editingCategoryActive,
        },
      });
      closeCategoryEditor();
      setSuccess("Category updated.");
      await invalidateOpenBar();
    } catch (error) {
      setError(extractApiMessage(error, "Failed to update category."));
    }
  };

  const openCreateSessionTypeModal = () => {
    setNewSessionTypeName("");
    setNewSessionTypeSlug("");
    setNewSessionTypeDefaultMinutes(60);
    setNewSessionTypeSortOrder(0);
    setNewSessionTypeActive(true);
    setCreateSessionTypeOpen(true);
  };

  const openSessionTypeEditor = (sessionType: {
    id: number;
    name: string;
    slug: string;
    defaultTimeLimitMinutes: number;
    sortOrder: number;
    isActive: boolean;
  }) => {
    setEditingSessionTypeId(sessionType.id);
    setEditingSessionTypeName(sessionType.name);
    setEditingSessionTypeSlug(sessionType.slug);
    setEditingSessionTypeDefaultMinutes(sessionType.defaultTimeLimitMinutes);
    setEditingSessionTypeSortOrder(sessionType.sortOrder);
    setEditingSessionTypeActive(sessionType.isActive);
  };

  const closeSessionTypeEditor = () => {
    setEditingSessionTypeId(null);
    setEditingSessionTypeName("");
    setEditingSessionTypeSlug("");
    setEditingSessionTypeDefaultMinutes(60);
    setEditingSessionTypeSortOrder(0);
    setEditingSessionTypeActive(true);
  };

  const handleCreateSessionType = async () => {
    if (!newSessionTypeName.trim()) {
      setError("Session type name is required.");
      return;
    }
    if (!Number.isFinite(newSessionTypeDefaultMinutes) || newSessionTypeDefaultMinutes <= 0) {
      setError("Default time limit must be greater than zero minutes.");
      return;
    }

    try {
      await createSessionTypeMutation.mutateAsync({
        name: newSessionTypeName.trim(),
        slug: newSessionTypeSlug.trim() || undefined,
        defaultTimeLimitMinutes: newSessionTypeDefaultMinutes,
        sortOrder: newSessionTypeSortOrder,
        isActive: newSessionTypeActive,
      });
      setCreateSessionTypeOpen(false);
      setSuccess("Session type created.");
      await invalidateOpenBar();
    } catch (error) {
      setError(extractApiMessage(error, "Failed to create session type."));
    }
  };

  const handleUpdateSessionType = async () => {
    if (!editingSessionTypeId) {
      return;
    }
    if (!editingSessionTypeName.trim()) {
      setError("Session type name is required.");
      return;
    }
    if (!Number.isFinite(editingSessionTypeDefaultMinutes) || editingSessionTypeDefaultMinutes <= 0) {
      setError("Default time limit must be greater than zero minutes.");
      return;
    }

    try {
      await updateSessionTypeMutation.mutateAsync({
        id: editingSessionTypeId,
        payload: {
          name: editingSessionTypeName.trim(),
          slug: editingSessionTypeSlug.trim(),
          defaultTimeLimitMinutes: editingSessionTypeDefaultMinutes,
          sortOrder: editingSessionTypeSortOrder,
          isActive: editingSessionTypeActive,
        },
      });
      closeSessionTypeEditor();
      setSuccess("Session type updated.");
      await invalidateOpenBar();
    } catch (error) {
      setError(extractApiMessage(error, "Failed to update session type."));
    }
  };

  const handleUpdateDrinkLabelDisplayMode = async (
    drinkType: DrinkTypeKey,
    displayMode: DrinkLabelDisplayMode,
  ) => {
    const previous = drinkLabelDisplayByType;
    const next = {
      ...previous,
      [drinkType]: displayMode,
    };
    setDrinkLabelDisplayByType(next);
    try {
      await updateDrinkLabelSettingsMutation.mutateAsync({
        settings: drinkTypeOrder.map((type) => ({
          drinkType: type,
          displayMode: next[type],
        })),
      });
      await queryClient.invalidateQueries({ queryKey: ["open-bar"] });
      setSuccess("Drink label format updated.");
    } catch (error) {
      setDrinkLabelDisplayByType(previous);
      setError(extractApiMessage(error, "Failed to update drink label format."));
    }
  };

  const openCreateVariantModal = () => {
    if (!variantIngredientId && ingredientSimpleOptions[0]?.value) {
      setVariantIngredientId(ingredientSimpleOptions[0].value);
    }
    setCreateVariantOpen(true);
  };

  const closeCreateVariantModal = () => {
    setCreateVariantOpen(false);
  };

  const handleCreateIngredientVariant = async () => {
    if (!variantIngredientId) {
      setError("Select an ingredient for this product variant.");
      return;
    }
    if (!variantName.trim()) {
      setError("Product variant name is required.");
      return;
    }
    if (!Number.isFinite(variantBaseQuantity) || variantBaseQuantity <= 0) {
      setError("Base quantity must be greater than zero.");
      return;
    }

    try {
      await createIngredientVariantMutation.mutateAsync({
        ingredientId: Number(variantIngredientId),
        name: variantName.trim(),
        brand: variantBrand.trim() || null,
        packageLabel: variantPackageLabel.trim() || null,
        baseQuantity: variantBaseQuantity,
        isActive: variantActive,
      });
      setVariantName("");
      setVariantBrand("");
      setVariantPackageLabel("");
      setVariantBaseQuantity(1);
      setVariantActive(true);
      closeCreateVariantModal();
      setSuccess("Product variant created.");
      await invalidateOpenBar();
    } catch (error) {
      setError(extractApiMessage(error, "Failed to create product variant."));
    }
  };

  const openVariantEditor = (variant: {
    id: number;
    ingredientId: number;
    name: string;
    brand: string | null;
    packageLabel: string | null;
    baseQuantity: number;
    isActive: boolean;
  }) => {
    setEditingVariantId(variant.id);
    setEditingVariantIngredientId(String(variant.ingredientId));
    setEditingVariantName(variant.name);
    setEditingVariantBrand(variant.brand ?? "");
    setEditingVariantPackageLabel(variant.packageLabel ?? "");
    setEditingVariantBaseQuantity(variant.baseQuantity);
    setEditingVariantActive(variant.isActive);
  };

  const closeVariantEditor = () => {
    setEditingVariantId(null);
    setEditingVariantIngredientId("");
    setEditingVariantName("");
    setEditingVariantBrand("");
    setEditingVariantPackageLabel("");
    setEditingVariantBaseQuantity(1);
    setEditingVariantActive(true);
  };

  const handleUpdateIngredientVariant = async () => {
    if (!editingVariantId) {
      return;
    }
    if (!editingVariantIngredientId) {
      setError("Select an ingredient.");
      return;
    }
    if (!editingVariantName.trim()) {
      setError("Product variant name is required.");
      return;
    }
    if (!Number.isFinite(editingVariantBaseQuantity) || editingVariantBaseQuantity <= 0) {
      setError("Base quantity must be greater than zero.");
      return;
    }

    try {
      await updateIngredientVariantMutation.mutateAsync({
        id: editingVariantId,
        payload: {
          ingredientId: Number(editingVariantIngredientId),
          name: editingVariantName.trim(),
          brand: editingVariantBrand.trim() || null,
          packageLabel: editingVariantPackageLabel.trim() || null,
          baseQuantity: editingVariantBaseQuantity,
          isActive: editingVariantActive,
        },
      });
      closeVariantEditor();
      setSuccess("Product variant updated.");
      await invalidateOpenBar();
    } catch (error) {
      setError(extractApiMessage(error, "Failed to update product variant."));
    }
  };

  const handleAdjustment = async () => {
    if (!adjustIngredientId) {
      setError("Select an ingredient for adjustment.");
      return;
    }
    if (!Number.isFinite(adjustQuantity) || adjustQuantity === 0) {
      setError("Adjustment quantity must be non-zero.");
      return;
    }
    try {
      await createAdjustmentMutation.mutateAsync({
        ingredientId: Number(adjustIngredientId),
        movementType: adjustType,
        quantityDelta: adjustQuantity,
        note: adjustNote || null,
      });
      setAdjustQuantity(0);
      setAdjustNote("");
      setAdjustmentOpen(false);
      setSuccess("Inventory adjustment saved.");
      await invalidateOpenBar();
    } catch (error) {
      setError(extractApiMessage(error, "Failed to create adjustment."));
    }
  };

  const openIngredientAdjustment = (ingredientId: number) => {
    setAdjustIngredientId(String(ingredientId));
    setAdjustType("adjustment");
    setAdjustQuantity(0);
    setAdjustNote("");
    setAdjustmentOpen(true);
  };

  const normalizeDraftRecipeLines = (lines: RecipeLineDraft[]): NormalizedRecipeLineInput[] => {
    const normalized: NormalizedRecipeLineInput[] = [];

    lines.forEach((line, index) => {
      const isTopUp = Boolean(line.isTopUp);
      const quantity = isTopUp ? 0 : Number(line.quantity);
      const base = {
        lineType: line.lineType,
        quantity,
        sortOrder: index + 1,
        isOptional: line.isOptional,
        affectsStrength: isTopUp ? false : line.affectsStrength,
        isTopUp,
      } satisfies Omit<NormalizedRecipeLineInput, "ingredientId" | "categoryId">;

      if (line.lineType === "category_selector") {
        normalized.push({
          ...base,
          categoryId: Number(line.categoryId),
        });
        return;
      }

      normalized.push({
        ...base,
        ingredientId: Number(line.ingredientId),
      });
    });

    return normalized.filter((line) => {
      if (!line.isTopUp && (!Number.isFinite(line.quantity) || line.quantity <= 0)) {
        return false;
      }
      if (line.isTopUp && line.lineType !== "category_selector") {
        return false;
      }
      if (line.lineType === "category_selector") {
        const categoryId = line.categoryId ?? Number.NaN;
        return Number.isFinite(categoryId) && categoryId > 0;
      }
      const ingredientId = line.ingredientId ?? Number.NaN;
      return Number.isFinite(ingredientId) && ingredientId > 0;
    });
  };

  const resetCreateRecipeForm = () => {
    setRecipeName("");
    setRecipeType("classic");
    setRecipeLabelDisplayMode("");
    setRecipeInstructions("");
    setRecipeAskStrength(false);
    setCreateRecipePreviewStrength("single");
    setRecipeHasIce(false);
    setRecipeIceCubes(DEFAULT_ICE_CUBES_PER_DRINK);
    setRecipeCupIngredientId("");
    setRecipeLines([
      { lineType: "fixed_ingredient", ingredientId: "", categoryId: "", quantity: 0, isOptional: false, affectsStrength: false, isTopUp: false },
    ]);
    setCreateRecipeOpen(false);
  };

  const openEditRecipeModal = (recipe: {
    id: number;
    name: string;
    drinkType: "classic" | "cocktail" | "beer" | "soft" | "custom";
    labelDisplayMode: DrinkLabelDisplayMode | null;
    instructions: string | null;
    askStrength: boolean;
    hasIce: boolean;
    iceCubes: number;
    cupIngredientId: number | null;
    ingredients: Array<{
      lineType: "fixed_ingredient" | "category_selector";
      ingredientId: number | null;
      categoryId: number | null;
      quantity: number;
      isOptional: boolean;
      affectsStrength: boolean;
      isTopUp: boolean;
    }>;
  }) => {
    setEditingRecipeId(recipe.id);
    setEditingRecipeName(recipe.name);
    setEditingRecipeType(recipe.drinkType);
    setEditingRecipeLabelDisplayMode(recipe.labelDisplayMode ?? "");
    setEditingRecipeInstructions(recipe.instructions ?? "");
    setEditingRecipeAskStrength(recipe.askStrength);
    setEditRecipePreviewStrength("single");
    setEditingRecipeHasIce(recipe.hasIce);
    setEditingRecipeIceCubes(recipe.hasIce ? recipe.iceCubes : DEFAULT_ICE_CUBES_PER_DRINK);
    setEditingRecipeCupIngredientId(recipe.cupIngredientId == null ? "" : String(recipe.cupIngredientId));
    setEditingRecipeLines(
      recipe.ingredients.length > 0
        ? recipe.ingredients.map((line) => ({
            lineType: line.lineType,
            ingredientId: line.ingredientId == null ? "" : String(line.ingredientId),
            categoryId: line.categoryId == null ? "" : String(line.categoryId),
            quantity: line.quantity,
            isOptional: line.isOptional,
            affectsStrength: line.affectsStrength,
            isTopUp: line.isTopUp,
          }))
        : [{ lineType: "fixed_ingredient", ingredientId: "", categoryId: "", quantity: 0, isOptional: false, affectsStrength: false, isTopUp: false }],
    );
  };

  const closeEditRecipeModal = () => {
    setEditingRecipeId(null);
    setEditingRecipeName("");
    setEditingRecipeType("classic");
    setEditingRecipeLabelDisplayMode("");
    setEditingRecipeInstructions("");
    setEditingRecipeAskStrength(false);
    setEditRecipePreviewStrength("single");
    setEditingRecipeHasIce(false);
    setEditingRecipeIceCubes(DEFAULT_ICE_CUBES_PER_DRINK);
    setEditingRecipeCupIngredientId("");
    setEditingRecipeLines([]);
  };

  const handleCreateRecipe = async () => {
    if (!recipeName.trim()) {
      setError("Recipe name is required.");
      return;
    }
    if (!recipeCupIngredientId) {
      setError("Assigned cup is required.");
      return;
    }
    const normalizedLines = normalizeDraftRecipeLines(recipeLines);
    if (normalizedLines.length === 0) {
      setError("Add at least one valid recipe line.");
      return;
    }
    if (normalizedLines.length !== recipeLines.length) {
      setError("Complete every recipe line before saving.");
      return;
    }
    if (recipeHasIce && (!Number.isFinite(recipeIceCubes) || recipeIceCubes <= 0)) {
      setError("Ice cubes must be greater than zero when ice is enabled.");
      return;
    }
    const createLiquidTotal = getRecipeLinesLiquidTotal(recipeLines);
    if (
      selectedCreateAvailableLiquidCapacityMl != null &&
      createLiquidTotal - selectedCreateAvailableLiquidCapacityMl > 0.000001
    ) {
      setError(
        `Recipe liquid total (${createLiquidTotal.toFixed(1)} ml) exceeds available capacity (${selectedCreateAvailableLiquidCapacityMl.toFixed(
          1,
        )} ml).`,
      );
      return;
    }
    if (
      selectedCreateAvailableLiquidCapacityMl != null &&
      getRequiredTopUpCount(recipeLines) > 0 &&
      selectedCreateAvailableLiquidCapacityMl - createLiquidTotal <= 0.000001
    ) {
      setError("Required top-up line has no remaining cup capacity. Reduce fixed liquid quantities or disable ice.");
      return;
    }
    try {
      await createRecipeMutation.mutateAsync({
        name: recipeName.trim(),
        drinkType: recipeType as "classic" | "cocktail" | "beer" | "soft" | "custom",
        defaultServings: 1,
        labelDisplayMode: recipeLabelDisplayMode === "" ? null : recipeLabelDisplayMode,
        instructions: recipeInstructions.trim() || null,
        askStrength: recipeAskStrength,
        hasIce: recipeHasIce,
        iceCubes: recipeHasIce ? Math.floor(recipeIceCubes) : 0,
        cupIngredientId: recipeCupIngredientId ? Number(recipeCupIngredientId) : null,
        ingredients: normalizedLines,
      });
      resetCreateRecipeForm();
      setSuccess("Recipe created.");
      await invalidateOpenBar();
    } catch (error) {
      setError(extractApiMessage(error, "Failed to create recipe."));
    }
  };

  const handleUpdateRecipe = async () => {
    if (!editingRecipeId) {
      return;
    }
    if (!editingRecipeName.trim()) {
      setError("Recipe name is required.");
      return;
    }
    if (!editingRecipeCupIngredientId) {
      setError("Assigned cup is required.");
      return;
    }
    const normalizedLines = normalizeDraftRecipeLines(editingRecipeLines);
    if (normalizedLines.length === 0 || normalizedLines.length !== editingRecipeLines.length) {
      setError("Complete every recipe line before saving.");
      return;
    }
    if (editingRecipeHasIce && (!Number.isFinite(editingRecipeIceCubes) || editingRecipeIceCubes <= 0)) {
      setError("Ice cubes must be greater than zero when ice is enabled.");
      return;
    }
    const editLiquidTotal = getRecipeLinesLiquidTotal(editingRecipeLines);
    if (
      selectedEditAvailableLiquidCapacityMl != null &&
      editLiquidTotal - selectedEditAvailableLiquidCapacityMl > 0.000001
    ) {
      setError(
        `Recipe liquid total (${editLiquidTotal.toFixed(1)} ml) exceeds available capacity (${selectedEditAvailableLiquidCapacityMl.toFixed(
          1,
        )} ml).`,
      );
      return;
    }
    if (
      selectedEditAvailableLiquidCapacityMl != null &&
      getRequiredTopUpCount(editingRecipeLines) > 0 &&
      selectedEditAvailableLiquidCapacityMl - editLiquidTotal <= 0.000001
    ) {
      setError("Required top-up line has no remaining cup capacity. Reduce fixed liquid quantities or disable ice.");
      return;
    }
    try {
      await updateRecipeMutation.mutateAsync({
        id: editingRecipeId,
        payload: {
          name: editingRecipeName.trim(),
          drinkType: editingRecipeType as "classic" | "cocktail" | "beer" | "soft" | "custom",
          labelDisplayMode: editingRecipeLabelDisplayMode === "" ? null : editingRecipeLabelDisplayMode,
          instructions: editingRecipeInstructions.trim() || null,
          askStrength: editingRecipeAskStrength,
          hasIce: editingRecipeHasIce,
          iceCubes: editingRecipeHasIce ? Math.floor(editingRecipeIceCubes) : 0,
          cupIngredientId: editingRecipeCupIngredientId ? Number(editingRecipeCupIngredientId) : null,
        },
      });

      await replaceRecipeIngredientsMutation.mutateAsync({
        id: editingRecipeId,
        ingredients: normalizedLines,
      });

      closeEditRecipeModal();
      setSuccess("Recipe updated.");
      await invalidateOpenBar();
    } catch (error) {
      setError(extractApiMessage(error, "Failed to update recipe."));
    }
  };

  const handleCreateDelivery = async () => {
    const items = deliveryLines
      .map((line) => ({
        ingredientId: Number(line.ingredientId),
        variantId: Number(line.variantId),
        quantity: line.quantity,
        unitCost: line.unitCost,
      }))
      .filter(
        (line) =>
          Number.isFinite(line.ingredientId) &&
          line.ingredientId > 0 &&
          Number.isFinite(line.variantId) &&
          line.variantId > 0 &&
          line.quantity > 0,
      )
      .map((line) => ({
        variantId: line.variantId,
        purchaseUnits: line.quantity,
        purchaseUnitCost: line.unitCost,
      }));

    if (items.length === 0) {
      setError("Add at least one delivery line with ingredient, product variant, and quantity.");
      return;
    }

    try {
      await createDeliveryMutation.mutateAsync({
        supplierName: deliverySupplier || null,
        invoiceRef: deliveryInvoice || null,
        deliveredAt: new Date().toISOString(),
        notes: deliveryNotes || null,
        items,
      });
      setDeliverySupplier("");
      setDeliveryInvoice("");
      setDeliveryNotes("");
      setDeliveryLines([{ ingredientId: "", variantId: "", quantity: 0, unitCost: null }]);
      setCreateDeliveryOpen(false);
      setSuccess("Delivery saved.");
      await invalidateOpenBar();
    } catch (error) {
      setError(extractApiMessage(error, "Failed to create delivery."));
    }
  };

  const openBartenderLaunch = async () => {
    resetBartenderLaunchFlow();
    setBartenderLaunchMobileView("service");
    setShowBartenderLaunchTopBar(true);
    setBartenderLaunchOpen(true);
    if (!document.fullscreenElement) {
      try {
        await document.documentElement.requestFullscreen();
      } catch {
        // Ignore: some browsers block fullscreen; overlay still opens.
      }
    }
  };

  const closeBartenderLaunch = async () => {
    setBartenderLaunchOpen(false);
    setBartenderLaunchMobileView("service");
    setShowBartenderLaunchTopBar(true);
    setMobileLaunchIssueDetails(null);
    resetBartenderLaunchFlow();
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // Ignore fullscreen exit failure.
      }
    }
  };

  return (
    <PageAccessGuard pageSlug={PAGE_SLUG}>
      <Stack gap="md">
        <Group justify="space-between" align="center" wrap={isCompactViewport ? "wrap" : "nowrap"}>
          <Box
            style={{
              flex: isCompactViewport ? "1 1 100%" : 1,
              minWidth: 0,
              display: "grid",
              gridTemplateColumns: isCompactViewport ? "1fr" : "auto 1fr",
              alignItems: "center",
              columnGap: 16,
              rowGap: isCompactViewport ? 8 : 0,
            }}
          >
            <Title order={2}>Open Bar Control</Title>
            <Group
              gap="xs"
              align="center"
              wrap="nowrap"
              style={{
                justifySelf: isCompactViewport ? "start" : "center",
                minWidth: 0,
              }}
            >
              <Text size="sm" fw={600}>
                Business Date
              </Text>
              <DateInput
                value={dayjs(businessDate).toDate()}
                valueFormat="YYYY-MM-DD"
                styles={{ input: { textAlign: "center" } }}
                onChange={(dateValue) => {
                  if (!dateValue) {
                    return;
                  }
                  const next = dayjs(dateValue).format("YYYY-MM-DD");
                  setBusinessDate(next);
                  setSessionName(`Open Bar ${next}`);
                }}
              />
            </Group>
          </Box>
          <Group
            align="center"
            wrap={isCompactViewport ? "wrap" : "nowrap"}
            style={{
              width: isCompactViewport ? "100%" : undefined,
              justifyContent: isCompactViewport ? "flex-start" : undefined,
            }}
          >
            {operationModeOptions.length > 1 ? (
              <SegmentedControl
                value={operationMode}
                onChange={(value) => setOperationMode((value as "bartender" | "manager") ?? "bartender")}
                data={operationModeOptions}
              />
            ) : (
              <Badge variant="light" size="lg">
                {operationMode === "manager" ? "Manager Mode" : "Bartender Mode"}
              </Badge>
            )}
            <Button
              onClick={() => void openBartenderLaunch()}
              leftSection={<IconClockPlay size={16} />}
              fullWidth={isCompactViewport}
            >
              Open Bar Launch
            </Button>
          </Group>
        </Group>

        {feedback?.tone === "green" && (
          <Alert color={feedback.tone} icon={<IconCheck size={16} />}>
            {feedback.message}
          </Alert>
        )}
        {feedback?.tone === "red" && (
          <>
            <Box
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(2, 6, 23, 0.58)",
                backdropFilter: "blur(7px)",
                WebkitBackdropFilter: "blur(7px)",
                zIndex: 1290,
              }}
              onClick={() => setFeedback(null)}
            />
            <Box
              style={{
                position: "fixed",
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
                width: "fit-content",
                maxWidth: "min(96vw, 920px)",
                zIndex: 1300,
              }}
            >
              <Alert
                color="red"
                icon={<IconAlertTriangle size={16} />}
                title={<Text fw={900} size="lg">Open Bar Error</Text>}
                style={{
                  width: "fit-content",
                  maxWidth: "min(96vw, 920px)",
                  background: "var(--mantine-color-white)",
                  opacity: 1,
                  borderWidth: 2,
                  padding: "16px 18px",
                  boxShadow: "0 16px 36px rgba(2, 6, 23, 0.34)",
                }}
              >
                <Group justify="space-between" align="start" wrap="nowrap">
                  <Text size="md" style={{ whiteSpace: "pre-wrap", lineHeight: 1.35 }}>
                    {feedback.message}
                  </Text>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    size="md"
                    onClick={() => setFeedback(null)}
                    aria-label="Close error alert"
                  >
                    <IconX size={16} />
                  </ActionIcon>
                </Group>
              </Alert>
            </Box>
          </>
        )}

        <Modal opened={editingIngredientId !== null} onClose={closeIngredientEditor} title="Edit Ingredient" {...getResponsiveModalProps("md")}>
          <Stack>
            <TextInput
              label="Name"
              value={editingIngredientName}
              onChange={(event) => setEditingIngredientName(event.currentTarget.value)}
            />
            <Select
              label="Category"
              value={editingIngredientCategory}
              onChange={(value) => setEditingIngredientCategory(value ?? editingIngredientCategory)}
              data={editingIngredientCategoryOptions}
            />
            <Select
              label="Base Unit"
              value={editingIngredientIsCup ? "unit" : editingIngredientUnit}
              onChange={(value) => setEditingIngredientUnit((value as "ml" | "unit") ?? editingIngredientUnit)}
              data={[
                { value: "ml", label: "ml" },
                { value: "unit", label: "unit" },
              ]}
              disabled={editingIngredientIsCup}
            />
            <Switch
              label="Cup Ingredient"
              checked={editingIngredientIsCup}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setEditingIngredientIsCup(checked);
                if (checked) {
                  setEditingIngredientIsIce(false);
                  setEditingIngredientUnit("unit");
                }
              }}
            />
            <Switch
              label="Ice Ingredient"
              checked={editingIngredientIsIce}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setEditingIngredientIsIce(checked);
                if (checked) {
                  setEditingIngredientIsCup(false);
                  setEditingIngredientCupCapacityMl(null);
                }
              }}
            />
            {editingIngredientIsCup && (
              <>
                <Select
                  label="Cup Type"
                  value={editingIngredientCupType}
                  onChange={(value) => setEditingIngredientCupType((value as "disposable" | "reusable") ?? "disposable")}
                  data={[
                    { value: "disposable", label: "Disposable" },
                    { value: "reusable", label: "Reusable" },
                  ]}
                />
                <NumberInput
                  label="Cup Capacity (ml)"
                  min={0.001}
                  decimalScale={3}
                  value={editingIngredientCupCapacityMl ?? undefined}
                  onChange={(value) => setEditingIngredientCupCapacityMl(typeof value === "number" ? value : null)}
                />
              </>
            )}
            <NumberInput
              label="Par Level"
              min={0}
              value={editingIngredientPar}
              onChange={(value) => setEditingIngredientPar(typeof value === "number" ? value : 0)}
            />
            <NumberInput
              label="Reorder Level"
              min={0}
              value={editingIngredientReorder}
              onChange={(value) => setEditingIngredientReorder(typeof value === "number" ? value : 0)}
            />
            {(editingIngredientIsCup ? "unit" : editingIngredientUnit) !== editingIngredientOriginalUnit && (
              <NumberInput
                label="Unit Conversion Factor (optional)"
                description={`Use when historical quantities exist. Formula: newQuantity = oldQuantity * factor (${editingIngredientOriginalUnit} -> ${editingIngredientIsCup ? "unit" : editingIngredientUnit}).`}
                min={0.000001}
                decimalScale={6}
                value={editingUnitConversionFactor ?? undefined}
                onChange={(value) => setEditingUnitConversionFactor(typeof value === "number" ? value : null)}
              />
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={closeIngredientEditor}>
                Cancel
              </Button>
              <Button onClick={() => void handleUpdateIngredient()} loading={updateIngredientMutation.isPending}>
                Save Changes
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Modal opened={editingCategoryId !== null} onClose={closeCategoryEditor} title="Edit Category" {...getResponsiveModalProps("md")}>
          <Stack>
            <TextInput
              label="Name"
              value={editingCategoryName}
              onChange={(event) => setEditingCategoryName(event.currentTarget.value)}
            />
            <TextInput
              label="Slug"
              description="Lowercase letters, numbers, and underscore"
              value={editingCategorySlug}
              onChange={(event) => setEditingCategorySlug(event.currentTarget.value)}
            />
            <NumberInput
              label="Sort Order"
              min={0}
              value={editingCategorySortOrder}
              onChange={(value) => setEditingCategorySortOrder(typeof value === "number" ? value : 0)}
            />
            <Switch
              label="Active"
              checked={editingCategoryActive}
              onChange={(event) => setEditingCategoryActive(event.currentTarget.checked)}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeCategoryEditor}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleUpdateIngredientCategory()}
                loading={updateIngredientCategoryMutation.isPending}
              >
                Save Category
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Modal opened={createIngredientOpen} onClose={closeCreateIngredientModal} title="Add Ingredient" {...getResponsiveModalProps("md")}>
          <Stack>
            <TextInput label="Name" value={ingredientName} onChange={(event) => setIngredientName(event.currentTarget.value)} />
            <Select
              label="Category"
              value={ingredientCategory}
              onChange={(value) => setIngredientCategory(value ?? ingredientCategory)}
              data={activeIngredientCategoryOptions}
              placeholder={activeIngredientCategoryOptions.length > 0 ? "Select category" : "Create category first"}
            />
            <Select
              label="Base Unit"
              value={ingredientIsCup ? "unit" : ingredientUnit}
              onChange={(value) => setIngredientUnit(value ?? "ml")}
              data={[
                { value: "ml", label: "ml" },
                { value: "unit", label: "unit" },
              ]}
              disabled={ingredientIsCup}
            />
            <Switch
              label="Cup Ingredient"
              checked={ingredientIsCup}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setIngredientIsCup(checked);
                if (checked) {
                  setIngredientIsIce(false);
                  setIngredientUnit("unit");
                }
              }}
            />
            <Switch
              label="Ice Ingredient"
              checked={ingredientIsIce}
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setIngredientIsIce(checked);
                if (checked) {
                  setIngredientIsCup(false);
                  setIngredientCupCapacityMl(null);
                }
              }}
            />
            {ingredientIsCup && (
              <>
                <Select
                  label="Cup Type"
                  value={ingredientCupType}
                  onChange={(value) => setIngredientCupType((value as "disposable" | "reusable") ?? "disposable")}
                  data={[
                    { value: "disposable", label: "Disposable" },
                    { value: "reusable", label: "Reusable" },
                  ]}
                />
                <NumberInput
                  label="Cup Capacity (ml)"
                  min={0.001}
                  decimalScale={3}
                  value={ingredientCupCapacityMl ?? undefined}
                  onChange={(value) => setIngredientCupCapacityMl(typeof value === "number" ? value : null)}
                />
              </>
            )}
            <NumberInput label="Par Level" value={ingredientPar} min={0} onChange={(value) => setIngredientPar(typeof value === "number" ? value : 0)} />
            <NumberInput label="Reorder Level" value={ingredientReorder} min={0} onChange={(value) => setIngredientReorder(typeof value === "number" ? value : 0)} />
            <NumberInput label="Cost Per Unit" value={ingredientCost ?? undefined} min={0} decimalScale={4} onChange={(value) => setIngredientCost(typeof value === "number" ? value : null)} />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeCreateIngredientModal}>
                Cancel
              </Button>
              <Button onClick={() => void handleCreateIngredient()} loading={createIngredientMutation.isPending}>
                Save Ingredient
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Modal opened={createCategoryOpen} onClose={() => setCreateCategoryOpen(false)} title="Add Category" {...getResponsiveModalProps("md")}>
          <Stack>
            <TextInput
              label="Category Name"
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.currentTarget.value)}
            />
            <TextInput
              label="Slug (optional)"
              description="Auto-generated from name if empty"
              value={newCategorySlug}
              onChange={(event) => setNewCategorySlug(event.currentTarget.value)}
            />
            <NumberInput
              label="Sort Order"
              value={newCategorySortOrder}
              min={0}
              onChange={(value) => setNewCategorySortOrder(typeof value === "number" ? value : 0)}
            />
            <Switch
              label="Active"
              checked={newCategoryActive}
              onChange={(event) => setNewCategoryActive(event.currentTarget.checked)}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setCreateCategoryOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleCreateIngredientCategory()}
                loading={createIngredientCategoryMutation.isPending}
              >
                Add Category
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Modal
          opened={editingSessionTypeId !== null}
          onClose={closeSessionTypeEditor}
          title="Edit Session Type"
          {...getResponsiveModalProps("md")}
        >
          <Stack>
            <TextInput
              label="Name"
              value={editingSessionTypeName}
              onChange={(event) => setEditingSessionTypeName(event.currentTarget.value)}
            />
            <TextInput
              label="Slug"
              description="Lowercase letters, numbers, and underscore"
              value={editingSessionTypeSlug}
              onChange={(event) => setEditingSessionTypeSlug(event.currentTarget.value)}
            />
            <NumberInput
              label="Default Time Limit (minutes)"
              value={editingSessionTypeDefaultMinutes}
              min={1}
              onChange={(value) => setEditingSessionTypeDefaultMinutes(typeof value === "number" ? value : 60)}
            />
            <NumberInput
              label="Sort Order"
              value={editingSessionTypeSortOrder}
              min={0}
              onChange={(value) => setEditingSessionTypeSortOrder(typeof value === "number" ? value : 0)}
            />
            <Switch
              label="Active"
              checked={editingSessionTypeActive}
              onChange={(event) => setEditingSessionTypeActive(event.currentTarget.checked)}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeSessionTypeEditor}>
                Cancel
              </Button>
              <Button onClick={() => void handleUpdateSessionType()} loading={updateSessionTypeMutation.isPending}>
                Save Session Type
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Modal
          opened={createSessionTypeOpen}
          onClose={() => setCreateSessionTypeOpen(false)}
          title="Add Session Type"
          {...getResponsiveModalProps("md")}
        >
          <Stack>
            <TextInput
              label="Session Type Name"
              value={newSessionTypeName}
              onChange={(event) => setNewSessionTypeName(event.currentTarget.value)}
            />
            <TextInput
              label="Slug (optional)"
              description="Auto-generated from name if empty"
              value={newSessionTypeSlug}
              onChange={(event) => setNewSessionTypeSlug(event.currentTarget.value)}
            />
            <NumberInput
              label="Default Time Limit (minutes)"
              value={newSessionTypeDefaultMinutes}
              min={1}
              onChange={(value) => setNewSessionTypeDefaultMinutes(typeof value === "number" ? value : 60)}
            />
            <NumberInput
              label="Sort Order"
              value={newSessionTypeSortOrder}
              min={0}
              onChange={(value) => setNewSessionTypeSortOrder(typeof value === "number" ? value : 0)}
            />
            <Switch
              label="Active"
              checked={newSessionTypeActive}
              onChange={(event) => setNewSessionTypeActive(event.currentTarget.checked)}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setCreateSessionTypeOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleCreateSessionType()} loading={createSessionTypeMutation.isPending}>
                Add Session Type
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Modal opened={createVariantOpen} onClose={closeCreateVariantModal} title="Add Product Variant" {...getResponsiveModalProps("md")}>
          <Stack>
            <Select
              label="Ingredient"
              data={ingredientSimpleOptions}
              value={variantIngredientId}
              onChange={(value) => setVariantIngredientId(value ?? "")}
              searchable
            />
            <TextInput
              label="Variant Name"
              placeholder="e.g. Corona Can 355ml"
              value={variantName}
              onChange={(event) => setVariantName(event.currentTarget.value)}
            />
            <TextInput
              label="Brand (optional)"
              value={variantBrand}
              onChange={(event) => setVariantBrand(event.currentTarget.value)}
            />
            <TextInput
              label="Package Label (optional)"
              placeholder="e.g. 24-pack can case"
              value={variantPackageLabel}
              onChange={(event) => setVariantPackageLabel(event.currentTarget.value)}
            />
            <NumberInput
              label="Base Quantity Per Purchased Unit"
              min={0.001}
              decimalScale={3}
              value={variantBaseQuantity}
              onChange={(value) => setVariantBaseQuantity(typeof value === "number" ? value : 1)}
            />
            <Switch
              label="Active"
              checked={variantActive}
              onChange={(event) => setVariantActive(event.currentTarget.checked)}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeCreateVariantModal}>
                Cancel
              </Button>
              <Button onClick={() => void handleCreateIngredientVariant()} loading={createIngredientVariantMutation.isPending}>
                Add Variant
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Modal opened={editingVariantId !== null} onClose={closeVariantEditor} title="Edit Product Variant" {...getResponsiveModalProps("md")}>
          <Stack>
            <Select
              label="Ingredient"
              data={ingredientSimpleOptions}
              value={editingVariantIngredientId}
              onChange={(value) => setEditingVariantIngredientId(value ?? "")}
              searchable
            />
            <TextInput
              label="Variant Name"
              value={editingVariantName}
              onChange={(event) => setEditingVariantName(event.currentTarget.value)}
            />
            <TextInput
              label="Brand (optional)"
              value={editingVariantBrand}
              onChange={(event) => setEditingVariantBrand(event.currentTarget.value)}
            />
            <TextInput
              label="Package Label (optional)"
              value={editingVariantPackageLabel}
              onChange={(event) => setEditingVariantPackageLabel(event.currentTarget.value)}
            />
            <NumberInput
              label="Base Quantity Per Purchased Unit"
              min={0.001}
              decimalScale={3}
              value={editingVariantBaseQuantity}
              onChange={(value) => setEditingVariantBaseQuantity(typeof value === "number" ? value : 1)}
            />
            <Switch
              label="Active"
              checked={editingVariantActive}
              onChange={(event) => setEditingVariantActive(event.currentTarget.checked)}
            />
            <Group justify="flex-end">
              <Button variant="default" onClick={closeVariantEditor}>
                Cancel
              </Button>
              <Button onClick={() => void handleUpdateIngredientVariant()} loading={updateIngredientVariantMutation.isPending}>
                Save Variant
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Modal opened={adjustmentOpen} onClose={() => setAdjustmentOpen(false)} title="Manual Adjustment" {...getResponsiveModalProps("md")}>
          <Stack>
            <Select label="Ingredient" data={ingredientOptions} value={adjustIngredientId} onChange={(value) => setAdjustIngredientId(value ?? "")} searchable />
            <Select
              label="Movement Type"
              value={adjustType}
              onChange={(value) => setAdjustType((value as "adjustment" | "waste" | "correction") ?? "adjustment")}
              data={[
                { value: "adjustment", label: "Adjustment" },
                { value: "waste", label: "Waste" },
                { value: "correction", label: "Correction" },
              ]}
            />
            <NumberInput label="Quantity Delta" value={adjustQuantity} decimalScale={3} onChange={(value) => setAdjustQuantity(typeof value === "number" ? value : 0)} />
            <Textarea label="Note" value={adjustNote} onChange={(event) => setAdjustNote(event.currentTarget.value)} />
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setAdjustmentOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleAdjustment()} loading={createAdjustmentMutation.isPending}>
                Apply Adjustment
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Modal
          opened={reconciliationOpen}
          onClose={() => {
            setReconciliationOpen(false);
            setReconciliationTargetSession(null);
          }}
          title="Close Session Reconciliation"
          {...getResponsiveModalProps("xl")}
        >
          <Stack>
            <Text size="sm" c="dimmed">
              Enter physical counts. The system will automatically post correction movements for any differences.
            </Text>
            {reconciliationLines.length === 0 ? (
              <Text size="sm" c="dimmed">No active ingredients available for reconciliation.</Text>
            ) : (
              <Box style={{ overflowX: "auto" }}>
                <Table striped withTableBorder withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Ingredient</Table.Th>
                      <Table.Th>System Stock</Table.Th>
                      <Table.Th>Counted Stock</Table.Th>
                      <Table.Th>Delta</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {reconciliationLines.map((line, index) => {
                      const countedValue = line.countedStock ?? line.systemStock;
                      const delta = countedValue - line.systemStock;
                      return (
                        <Table.Tr key={`reconcile-${line.ingredientId}`}>
                          <Table.Td>{line.ingredientName}</Table.Td>
                          <Table.Td>{line.systemStock.toFixed(3)} {line.baseUnit}</Table.Td>
                          <Table.Td>
                            <NumberInput
                              min={0}
                              decimalScale={3}
                              value={line.countedStock ?? undefined}
                              onChange={(value) =>
                                setReconciliationLines((current) =>
                                  current.map((entry, entryIndex) =>
                                    entryIndex === index
                                      ? { ...entry, countedStock: typeof value === "number" ? value : null }
                                      : entry,
                                  ),
                                )
                              }
                            />
                          </Table.Td>
                          <Table.Td>
                            <Text c={Math.abs(delta) <= 0.000001 ? "dimmed" : delta > 0 ? "green" : "red"}>
                              {delta.toFixed(3)} {line.baseUnit}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Box>
            )}
            <Group justify="space-between">
              <Button
                variant="default"
                onClick={() =>
                  setReconciliationLines((current) =>
                    current.map((line) => ({ ...line, countedStock: line.systemStock })),
                  )
                }
              >
                Use System Stock
              </Button>
              <Group>
                <Button
                  variant="default"
                  onClick={() => {
                    setReconciliationOpen(false);
                    setReconciliationTargetSession(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  color="red"
                  onClick={() => void handleCloseSessionWithReconciliation()}
                  loading={closeSessionMutation.isPending}
                  disabled={!reconciliationTargetSession || !reconciliationTargetSession.canClose}
                >
                  Close Session
                </Button>
              </Group>
            </Group>
          </Stack>
        </Modal>

        <Modal opened={createRecipeOpen} onClose={resetCreateRecipeForm} title="Add Recipe" {...getResponsiveModalProps("xl")}>
          <Grid>
            <Grid.Col span={{ base: 12, md: recipeCupIngredientId ? 8 : 12 }}>
              <Stack>
                <TextInput label="Recipe Name" value={recipeName} onChange={(event) => setRecipeName(event.currentTarget.value)} />
                <Select
                  label="Drink Type"
                  value={recipeType}
                  onChange={(value) => setRecipeType(value ?? "classic")}
                  data={drinkTypeOrder.map((value) => ({ value, label: drinkTypeLabel[value] }))}
                />
                <Select
                  label="Current Drinks Label Format"
                  description={`Default for ${drinkTypeLabel[createRecipeDrinkTypeKey]}: ${formatDrinkLabelDisplayMode(
                    drinkLabelDisplayByType[createRecipeDrinkTypeKey],
                  )}`}
                  value={recipeLabelDisplayMode}
                  data={recipeLabelDisplayModeOptions}
                  onChange={(value) =>
                    setRecipeLabelDisplayMode(isDrinkLabelDisplayMode(value) ? value : "")
                  }
                />
                <Textarea label="Instructions" value={recipeInstructions} onChange={(event) => setRecipeInstructions(event.currentTarget.value)} />
                <Switch
                  label="Ask Single / Double During Service"
                  checked={recipeAskStrength}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setRecipeAskStrength(checked);
                    if (!checked) {
                      setCreateRecipePreviewStrength("single");
                    }
                  }}
                />
                <Switch
                  label="Drink Includes Ice"
                  checked={recipeHasIce}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setRecipeHasIce(checked);
                    if (checked && (!Number.isFinite(recipeIceCubes) || recipeIceCubes <= 0)) {
                      setRecipeIceCubes(DEFAULT_ICE_CUBES_PER_DRINK);
                    }
                  }}
                />
                {recipeHasIce && (
                  <NumberInput
                    label="Ice Cubes Per Drink"
                    min={1}
                    step={1}
                    value={recipeIceCubes}
                    onChange={(value) => setRecipeIceCubes(typeof value === "number" ? Math.max(1, Math.floor(value)) : DEFAULT_ICE_CUBES_PER_DRINK)}
                  />
                )}
                <Select
                  label="Assigned Cup"
                  placeholder={cupIngredientOptions.length > 0 ? "Select cup ingredient" : "Create cup ingredients first"}
                  data={cupIngredientOptions}
                  value={recipeCupIngredientId}
                  onChange={(value) => setRecipeCupIngredientId(value ?? "")}
                  searchable
                />
                {selectedCreateCupCapacityMl != null && (
                  <Text size="xs" c="dimmed">
                    Liquid capacity: {(selectedCreateAvailableLiquidCapacityMl ?? selectedCreateCupCapacityMl).toFixed(1)} ml
                    {recipeHasIce
                      ? ` (cup ${selectedCreateCupCapacityMl.toFixed(1)} ml, ice displacement ${getIceDisplacementMl(
                          recipeHasIce,
                          recipeIceCubes,
                        ).toFixed(1)} ml)`
                      : ""}
                  </Text>
                )}
                <Divider label="Recipe Lines" />
                {recipeLines.map((line, index) => (
                  <Paper key={`recipe-modal-line-${index}`} withBorder p="sm">
                    <Stack>
                      <Group justify="space-between" align="end">
                        <Text fw={600}>Line {index + 1}</Text>
                        {recipeLines.length > 1 && (
                          <Button
                            variant="subtle"
                            color="red"
                            size="xs"
                            onClick={() =>
                              setRecipeLines((current) => current.filter((_, entryIndex) => entryIndex !== index))
                            }
                          >
                            Remove
                          </Button>
                        )}
                      </Group>
                      <SegmentedControl
                        value={line.lineType}
                        onChange={(value) =>
                          setRecipeLines((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
                                    lineType: (value as "fixed_ingredient" | "category_selector") ?? "fixed_ingredient",
                                    ingredientId: value === "fixed_ingredient" ? entry.ingredientId : "",
                                    categoryId: value === "category_selector" ? entry.categoryId : "",
                                    isTopUp: value === "fixed_ingredient" ? false : entry.isTopUp,
                                  }
                                : entry,
                            ),
                          )
                        }
                        data={[
                          { label: "Specific Ingredient", value: "fixed_ingredient" },
                          { label: "Select by Category", value: "category_selector" },
                        ]}
                      />
                      {line.lineType === "fixed_ingredient" ? (
                        <Select
                          label="Ingredient"
                          data={recipeIngredientOptions}
                          value={line.ingredientId}
                          onChange={(value) =>
                            setRecipeLines((current) =>
                              current.map((entry, entryIndex) =>
                                entryIndex === index ? { ...entry, ingredientId: value ?? "" } : entry,
                              ),
                            )
                          }
                          searchable
                        />
                      ) : (
                        <Select
                          label="Category"
                          data={activeIngredientCategoryOptions}
                          value={line.categoryId}
                          onChange={(value) =>
                            setRecipeLines((current) =>
                              current.map((entry, entryIndex) =>
                                entryIndex === index ? { ...entry, categoryId: value ?? "" } : entry,
                              ),
                            )
                          }
                          searchable
                        />
                      )}
                      <Stack gap="xs">
                        <NumberInput
                          label={line.isTopUp ? "Qty Per Serving (Auto)" : "Qty Per Serving"}
                          value={line.isTopUp ? 0 : line.quantity}
                          min={0}
                          max={getRecipeLineMaxQuantity(recipeLines, index, selectedCreateAvailableLiquidCapacityMl)}
                          decimalScale={3}
                          disabled={line.isTopUp}
                          description={line.isTopUp ? "Auto-filled from remaining cup capacity at service time." : undefined}
                          onChange={(value) =>
                            setRecipeLines((current) =>
                              current.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? {
                                      ...entry,
                                      quantity: (() => {
                                        const nextValue = typeof value === "number" ? value : entry.quantity;
                                        const maxQuantity = getRecipeLineMaxQuantity(
                                          current,
                                          index,
                                          selectedCreateAvailableLiquidCapacityMl,
                                        );
                                        return maxQuantity == null ? nextValue : Math.min(nextValue, maxQuantity);
                                      })(),
                                    }
                                  : entry,
                              ),
                            )
                          }
                        />
                        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm" verticalSpacing="sm">
                          <Switch
                            label="Top Up to Cup Capacity"
                            checked={line.isTopUp}
                            disabled={line.lineType !== "category_selector"}
                            onChange={(event) =>
                              setRecipeLines((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? {
                                        ...entry,
                                        isTopUp: event.currentTarget.checked,
                                        quantity: event.currentTarget.checked ? 0 : entry.quantity,
                                        affectsStrength: event.currentTarget.checked ? false : entry.affectsStrength,
                                      }
                                    : entry,
                                ),
                              )
                            }
                          />
                          <Switch
                            label="Optional"
                            checked={line.isOptional}
                            onChange={(event) =>
                              setRecipeLines((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index ? { ...entry, isOptional: event.currentTarget.checked } : entry,
                                ),
                              )
                            }
                          />
                          <Switch
                            label="Affected by Single/Double"
                            checked={line.isTopUp ? false : line.affectsStrength}
                            disabled={line.isTopUp}
                            onChange={(event) =>
                              setRecipeLines((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index ? { ...entry, affectsStrength: event.currentTarget.checked } : entry,
                                ),
                              )
                            }
                          />
                        </SimpleGrid>
                      </Stack>
                    </Stack>
                  </Paper>
                ))}
                <Group justify="space-between">
                  <Button
                    variant="light"
                    onClick={() =>
                      setRecipeLines((current) => [
                        ...current,
                        {
                          lineType: "fixed_ingredient",
                          ingredientId: "",
                          categoryId: "",
                          quantity: 0,
                          isOptional: false,
                          affectsStrength: false,
                          isTopUp: false,
                        },
                      ])
                    }
                  >
                    Add Line
                  </Button>
                  <Group>
                    <Button variant="default" onClick={resetCreateRecipeForm}>
                      Cancel
                    </Button>
                    <Button onClick={() => void handleCreateRecipe()} loading={createRecipeMutation.isPending}>
                      Save Recipe
                    </Button>
                  </Group>
                </Group>
              </Stack>
            </Grid.Col>
            {recipeCupIngredientId ? (
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Box style={{ position: "sticky", top: 12 }}>
                  <Stack gap="xs">
                    {recipeAskStrength ? (
                      <SegmentedControl
                        value={createRecipePreviewStrength}
                        onChange={(value) =>
                          setCreateRecipePreviewStrength((value as RecipePreviewStrength) ?? "single")
                        }
                        data={[
                          { label: "Single", value: "single" },
                          { label: "Double", value: "double" },
                        ]}
                        fullWidth
                      />
                    ) : null}
                    <RecipeCupPreview
                      title={
                        recipeAskStrength
                          ? `Cup Preview (${createRecipePreviewStrength === "double" ? "Double" : "Single"})`
                          : "Cup Preview"
                      }
                      segments={createRecipePreviewSegments}
                      totalQuantity={createRecipePreviewSegments.reduce((sum, line) => sum + line.quantity, 0)}
                      cupCapacityMl={selectedCreateCupCapacityMl}
                      hasIce={recipeHasIce}
                      iceCubes={recipeIceCubes}
                    />
                  </Stack>
                </Box>
              </Grid.Col>
            ) : null}
          </Grid>
        </Modal>

        <Modal opened={editingRecipeId !== null} onClose={closeEditRecipeModal} title="Edit Recipe" {...getResponsiveModalProps("xl")}>
          <Grid>
            <Grid.Col span={{ base: 12, md: editingRecipeCupIngredientId ? 8 : 12 }}>
              <Stack>
                <TextInput
                  label="Recipe Name"
                  value={editingRecipeName}
                  onChange={(event) => setEditingRecipeName(event.currentTarget.value)}
                />
                <Select
                  label="Drink Type"
                  value={editingRecipeType}
                  onChange={(value) => setEditingRecipeType(value ?? "classic")}
                  data={drinkTypeOrder.map((value) => ({ value, label: drinkTypeLabel[value] }))}
                />
                <Select
                  label="Current Drinks Label Format"
                  description={`Default for ${drinkTypeLabel[editRecipeDrinkTypeKey]}: ${formatDrinkLabelDisplayMode(
                    drinkLabelDisplayByType[editRecipeDrinkTypeKey],
                  )}`}
                  value={editingRecipeLabelDisplayMode}
                  data={recipeLabelDisplayModeOptions}
                  onChange={(value) =>
                    setEditingRecipeLabelDisplayMode(isDrinkLabelDisplayMode(value) ? value : "")
                  }
                />
                <Textarea
                  label="Instructions"
                  value={editingRecipeInstructions}
                  onChange={(event) => setEditingRecipeInstructions(event.currentTarget.value)}
                />
                <Switch
                  label="Ask Single / Double During Service"
                  checked={editingRecipeAskStrength}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setEditingRecipeAskStrength(checked);
                    if (!checked) {
                      setEditRecipePreviewStrength("single");
                    }
                  }}
                />
                <Switch
                  label="Drink Includes Ice"
                  checked={editingRecipeHasIce}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setEditingRecipeHasIce(checked);
                    if (checked && (!Number.isFinite(editingRecipeIceCubes) || editingRecipeIceCubes <= 0)) {
                      setEditingRecipeIceCubes(DEFAULT_ICE_CUBES_PER_DRINK);
                    }
                  }}
                />
                {editingRecipeHasIce && (
                  <NumberInput
                    label="Ice Cubes Per Drink"
                    min={1}
                    step={1}
                    value={editingRecipeIceCubes}
                    onChange={(value) =>
                      setEditingRecipeIceCubes(
                        typeof value === "number" ? Math.max(1, Math.floor(value)) : DEFAULT_ICE_CUBES_PER_DRINK,
                      )
                    }
                  />
                )}
                <Select
                  label="Assigned Cup"
                  placeholder={cupIngredientOptions.length > 0 ? "Select cup ingredient" : "Create cup ingredients first"}
                  data={cupIngredientOptions}
                  value={editingRecipeCupIngredientId}
                  onChange={(value) => setEditingRecipeCupIngredientId(value ?? "")}
                  searchable
                />
                {selectedEditCupCapacityMl != null && (
                  <Text size="xs" c="dimmed">
                    Liquid capacity: {(selectedEditAvailableLiquidCapacityMl ?? selectedEditCupCapacityMl).toFixed(1)} ml
                    {editingRecipeHasIce
                      ? ` (cup ${selectedEditCupCapacityMl.toFixed(1)} ml, ice displacement ${getIceDisplacementMl(
                          editingRecipeHasIce,
                          editingRecipeIceCubes,
                        ).toFixed(1)} ml)`
                      : ""}
                  </Text>
                )}
                <Divider label="Recipe Lines" />
                {editingRecipeLines.map((line, index) => (
                  <Paper key={`recipe-edit-line-${index}`} withBorder p="sm">
                    <Stack>
                      <Group justify="space-between" align="end">
                        <Text fw={600}>Line {index + 1}</Text>
                        {editingRecipeLines.length > 1 && (
                          <Button
                            variant="subtle"
                            color="red"
                            size="xs"
                            onClick={() =>
                              setEditingRecipeLines((current) => current.filter((_, entryIndex) => entryIndex !== index))
                            }
                          >
                            Remove
                          </Button>
                        )}
                      </Group>
                      <SegmentedControl
                        value={line.lineType}
                        onChange={(value) =>
                          setEditingRecipeLines((current) =>
                            current.map((entry, entryIndex) =>
                              entryIndex === index
                                ? {
                                    ...entry,
                                    lineType: (value as "fixed_ingredient" | "category_selector") ?? "fixed_ingredient",
                                    ingredientId: value === "fixed_ingredient" ? entry.ingredientId : "",
                                    categoryId: value === "category_selector" ? entry.categoryId : "",
                                    isTopUp: value === "fixed_ingredient" ? false : entry.isTopUp,
                                  }
                                : entry,
                            ),
                          )
                        }
                        data={[
                          { label: "Specific Ingredient", value: "fixed_ingredient" },
                          { label: "Select by Category", value: "category_selector" },
                        ]}
                      />
                      {line.lineType === "fixed_ingredient" ? (
                        <Select
                          label="Ingredient"
                          data={recipeIngredientOptions}
                          value={line.ingredientId}
                          onChange={(value) =>
                            setEditingRecipeLines((current) =>
                              current.map((entry, entryIndex) =>
                                entryIndex === index ? { ...entry, ingredientId: value ?? "" } : entry,
                              ),
                            )
                          }
                          searchable
                        />
                      ) : (
                        <Select
                          label="Category"
                          data={activeIngredientCategoryOptions}
                          value={line.categoryId}
                          onChange={(value) =>
                            setEditingRecipeLines((current) =>
                              current.map((entry, entryIndex) =>
                                entryIndex === index ? { ...entry, categoryId: value ?? "" } : entry,
                              ),
                            )
                          }
                          searchable
                        />
                      )}
                      <Stack gap="xs">
                        <NumberInput
                          label={line.isTopUp ? "Qty Per Serving (Auto)" : "Qty Per Serving"}
                          value={line.isTopUp ? 0 : line.quantity}
                          min={0}
                          max={getRecipeLineMaxQuantity(editingRecipeLines, index, selectedEditAvailableLiquidCapacityMl)}
                          decimalScale={3}
                          disabled={line.isTopUp}
                          description={line.isTopUp ? "Auto-filled from remaining cup capacity at service time." : undefined}
                          onChange={(value) =>
                            setEditingRecipeLines((current) =>
                              current.map((entry, entryIndex) =>
                                entryIndex === index
                                  ? {
                                      ...entry,
                                      quantity: (() => {
                                        const nextValue = typeof value === "number" ? value : entry.quantity;
                                        const maxQuantity = getRecipeLineMaxQuantity(
                                          current,
                                          index,
                                          selectedEditAvailableLiquidCapacityMl,
                                        );
                                        return maxQuantity == null ? nextValue : Math.min(nextValue, maxQuantity);
                                      })(),
                                    }
                                  : entry,
                              ),
                            )
                          }
                        />
                        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="sm" verticalSpacing="sm">
                          <Switch
                            label="Top Up to Cup Capacity"
                            checked={line.isTopUp}
                            disabled={line.lineType !== "category_selector"}
                            onChange={(event) =>
                              setEditingRecipeLines((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? {
                                        ...entry,
                                        isTopUp: event.currentTarget.checked,
                                        quantity: event.currentTarget.checked ? 0 : entry.quantity,
                                        affectsStrength: event.currentTarget.checked ? false : entry.affectsStrength,
                                      }
                                    : entry,
                                ),
                              )
                            }
                          />
                          <Switch
                            label="Optional"
                            checked={line.isOptional}
                            onChange={(event) =>
                              setEditingRecipeLines((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index ? { ...entry, isOptional: event.currentTarget.checked } : entry,
                                ),
                              )
                            }
                          />
                          <Switch
                            label="Affected by Single/Double"
                            checked={line.isTopUp ? false : line.affectsStrength}
                            disabled={line.isTopUp}
                            onChange={(event) =>
                              setEditingRecipeLines((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index ? { ...entry, affectsStrength: event.currentTarget.checked } : entry,
                                ),
                              )
                            }
                          />
                        </SimpleGrid>
                      </Stack>
                    </Stack>
                  </Paper>
                ))}
                <Group justify="space-between">
                  <Button
                    variant="light"
                    onClick={() =>
                      setEditingRecipeLines((current) => [
                        ...current,
                        {
                          lineType: "fixed_ingredient",
                          ingredientId: "",
                          categoryId: "",
                          quantity: 0,
                          isOptional: false,
                          affectsStrength: false,
                          isTopUp: false,
                        },
                      ])
                    }
                  >
                    Add Line
                  </Button>
                  <Group>
                    <Button variant="default" onClick={closeEditRecipeModal}>
                      Cancel
                    </Button>
                    <Button
                      onClick={() => void handleUpdateRecipe()}
                      loading={updateRecipeMutation.isPending || replaceRecipeIngredientsMutation.isPending}
                    >
                      Save Changes
                    </Button>
                  </Group>
                </Group>
              </Stack>
            </Grid.Col>
            {editingRecipeCupIngredientId ? (
              <Grid.Col span={{ base: 12, md: 4 }}>
                <Box style={{ position: "sticky", top: 12 }}>
                  <Stack gap="xs">
                    {editingRecipeAskStrength ? (
                      <SegmentedControl
                        value={editRecipePreviewStrength}
                        onChange={(value) =>
                          setEditRecipePreviewStrength((value as RecipePreviewStrength) ?? "single")
                        }
                        data={[
                          { label: "Single", value: "single" },
                          { label: "Double", value: "double" },
                        ]}
                        fullWidth
                      />
                    ) : null}
                    <RecipeCupPreview
                      title={
                        editingRecipeAskStrength
                          ? `Cup Preview (${editRecipePreviewStrength === "double" ? "Double" : "Single"})`
                          : "Cup Preview"
                      }
                      segments={editRecipePreviewSegments}
                      totalQuantity={editRecipePreviewSegments.reduce((sum, line) => sum + line.quantity, 0)}
                      cupCapacityMl={selectedEditCupCapacityMl}
                      hasIce={editingRecipeHasIce}
                      iceCubes={editingRecipeIceCubes}
                    />
                  </Stack>
                </Box>
              </Grid.Col>
            ) : null}
          </Grid>
        </Modal>

        <Modal opened={createDeliveryOpen} onClose={() => setCreateDeliveryOpen(false)} title="Record Delivery" {...getResponsiveModalProps("lg")}>
          <Stack>
            <TextInput label="Supplier" value={deliverySupplier} onChange={(event) => setDeliverySupplier(event.currentTarget.value)} />
            <TextInput label="Invoice Ref" value={deliveryInvoice} onChange={(event) => setDeliveryInvoice(event.currentTarget.value)} />
            <Textarea label="Notes" value={deliveryNotes} onChange={(event) => setDeliveryNotes(event.currentTarget.value)} />
            <Divider label="Items" />
            {deliveryLines.map((line, index) => {
              const allVariantOptions = ingredientVariantOptionsByIngredient.get(line.ingredientId) ?? [];
              const activeVariantOptions = allVariantOptions
                .filter((option) => option.isActive)
                .map(({ value, label }) => ({ value, label }));
              const variantOptions =
                line.variantId && !activeVariantOptions.some((option) => option.value === line.variantId)
                  ? [
                      ...activeVariantOptions,
                      ...(allVariantOptions
                        .filter((option) => option.value === line.variantId)
                        .map(({ value, label }) => ({ value, label })) ?? []),
                    ]
                  : activeVariantOptions;

              return (
                <Stack key={`delivery-modal-line-${index}`} gap="xs">
                  <Select
                    label={`Item ${index + 1} Ingredient`}
                    data={ingredientSimpleOptions}
                    value={line.ingredientId}
                    onChange={(value) =>
                      setDeliveryLines((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, ingredientId: value ?? "", variantId: "" } : entry,
                        ),
                      )
                    }
                    searchable
                  />
                  <Select
                    label="Purchased Product Variant"
                    data={variantOptions}
                    value={line.variantId}
                    onChange={(value) =>
                      setDeliveryLines((current) =>
                        current.map((entry, entryIndex) =>
                          entryIndex === index ? { ...entry, variantId: value ?? "" } : entry,
                        ),
                      )
                    }
                    placeholder={line.ingredientId ? "Select product variant" : "Select ingredient first"}
                    disabled={!line.ingredientId}
                    searchable
                  />
                  <Group grow>
                    <NumberInput
                      label="Purchased Units"
                      value={line.quantity}
                      min={0.001}
                      decimalScale={3}
                      onChange={(value) =>
                        setDeliveryLines((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, quantity: typeof value === "number" ? value : entry.quantity } : entry,
                          ),
                        )
                      }
                    />
                    <NumberInput
                      label="Cost Per Purchased Unit"
                      value={line.unitCost ?? undefined}
                      min={0}
                      decimalScale={4}
                      onChange={(value) =>
                        setDeliveryLines((current) =>
                          current.map((entry, entryIndex) =>
                            entryIndex === index ? { ...entry, unitCost: typeof value === "number" ? value : null } : entry,
                          ),
                        )
                      }
                    />
                  </Group>
                </Stack>
              );
            })}
            <Group justify="space-between">
              <Button
                variant="light"
                onClick={() =>
                  setDeliveryLines((current) => [...current, { ingredientId: "", variantId: "", quantity: 0, unitCost: null }])
                }
              >
                Add Item
              </Button>
              <Group>
                <Button variant="default" onClick={() => setCreateDeliveryOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => void handleCreateDelivery()} loading={createDeliveryMutation.isPending}>
                  Save Delivery
                </Button>
              </Group>
            </Group>
          </Stack>
        </Modal>

        <Modal
          opened={bartenderLaunchOpen}
          onClose={() => void closeBartenderLaunch()}
          withCloseButton={false}
          fullScreen
          padding={0}
          zIndex={400}
        >
          <Modal
            opened={mobileLaunchIssueDetails !== null}
            onClose={() => setMobileLaunchIssueDetails(null)}
            title="Drink Details"
            centered
            size="sm"
            zIndex={500}
          >
            <Stack gap="xs">
              <Text fw={700}>{mobileLaunchIssueDetails?.drink ?? "-"}</Text>
              <Text size="xs" c="dimmed">
                {`User: ${mobileLaunchIssueDetails?.user ?? "-"}`}
              </Text>
              <Text size="xs" c="dimmed">
                {`Time: ${mobileLaunchIssueDetails?.time ?? "-"}`}
              </Text>
              <Text size="sm" c={mobileLaunchIssueDetails?.isError ? "red" : undefined}>
                {mobileLaunchIssueDetails?.details ?? "No additional details."}
              </Text>
            </Stack>
          </Modal>
          <style>
            {`
              .openbar-launch-scroll-surface {
                scrollbar-width: none;
                -ms-overflow-style: none;
              }
              .openbar-launch-scroll-surface::-webkit-scrollbar {
                width: 0;
                height: 0;
                display: none;
              }
            `}
          </style>
          <Stack gap={0} h="100vh" style={{ overflowX: "hidden" }}>
            {showBartenderLaunchTopBar ? (
              <Box p={isBartenderLaunchCompact ? "xs" : "md"} style={{ borderBottom: "1px solid var(--mantine-color-gray-3)" }}>
                {isBartenderLaunchCompact ? (
                  <Box
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <Box
                      style={{
                        position: "relative",
                        minHeight: 28,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        paddingRight: 72,
                      }}
                    >
                      <Title
                        order={4}
                        ta="center"
                        style={{
                          lineHeight: 1.05,
                          margin: 0,
                          width: "100%",
                        }}
                      >
                        OmniLodge Open Bar
                      </Title>
                      <Badge
                        size="xs"
                        color={activeSession && !isBartenderSessionExpired ? "green" : "red"}
                        style={{
                          position: "absolute",
                          right: 0,
                          top: "50%",
                          transform: "translateY(-50%)",
                        }}
                      >
                        {activeSession ? (isBartenderSessionExpired ? "Finished" : "Active") : "Required"}
                      </Badge>
                    </Box>
                    <LaunchHeaderDateTime
                      businessDate={activeSession?.businessDate ?? businessDate}
                      expectedEndAt={activeSession?.expectedEndAt ?? null}
                    />
                    <Stack gap={6} align="stretch">
                      <Group gap="xs" wrap="wrap" justify="center" align="center">
                        {activeSession ? (
                          <Button
                            size="xs"
                            color="orange"
                            variant="light"
                            leftSection={<IconX size={12} />}
                            onClick={() => void handleLeaveSession(activeSession.id, "Disconnected from session.")}
                            loading={leavingSessionId === activeSession.id && leaveSessionMutation.isPending}
                          >
                            Disconnect
                          </Button>
                        ) : null}
                        {activeSession && canCloseActiveSession ? (
                          <Button
                            size="xs"
                            color="red"
                            leftSection={<IconX size={12} />}
                            onClick={() => void handleCloseSessionFromLaunch()}
                            loading={closeSessionMutation.isPending}
                          >
                            Close
                          </Button>
                        ) : null}
                        <Button size="xs" color="dark" leftSection={<IconX size={12} />} onClick={() => void closeBartenderLaunch()}>
                          Exit
                        </Button>
                      </Group>
                    </Stack>
                  </Box>
                ) : (
                  <Stack gap="xs">
                    <Box
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto 1fr auto",
                        alignItems: "center",
                        gap: 16,
                      }}
                    >
                      <Title
                        order={2}
                        style={{
                          lineHeight: 1.05,
                          margin: 0,
                          whiteSpace: "nowrap",
                        }}
                      >
                        OmniLodge Open Bar
                      </Title>
                      <Box style={{ justifySelf: "center", minWidth: 0 }}>
                        <LaunchHeaderDateTime
                          businessDate={activeSession?.businessDate ?? businessDate}
                          expectedEndAt={activeSession?.expectedEndAt ?? null}
                        />
                      </Box>
                      <Badge size="lg" color={activeSession && !isBartenderSessionExpired ? "green" : "red"} style={{ whiteSpace: "nowrap" }}>
                        {activeSession ? (isBartenderSessionExpired ? "Session Finished" : "Session Active") : "Session Required"}
                      </Badge>
                    </Box>
                    <Group justify="flex-end" align="center" gap="sm" wrap="wrap">
                      {activeSession ? (
                        <Badge variant="light" color="blue" size="lg">
                          {currentOperatorLabel}
                        </Badge>
                      ) : null}
                      {activeSession ? (
                        <Button
                          color="orange"
                          variant="light"
                          leftSection={<IconX size={16} />}
                          onClick={() => void handleLeaveSession(activeSession.id, "Disconnected from session.")}
                          loading={leavingSessionId === activeSession.id && leaveSessionMutation.isPending}
                        >
                          Disconnect
                        </Button>
                      ) : null}
                      {activeSession && canCloseActiveSession ? (
                        <Button
                          color="red"
                          leftSection={<IconX size={16} />}
                          onClick={() => void handleCloseSessionFromLaunch()}
                          loading={closeSessionMutation.isPending}
                        >
                          Close Session
                        </Button>
                      ) : null}
                      <Button color="dark" leftSection={<IconX size={16} />} onClick={() => void closeBartenderLaunch()}>
                        Exit
                      </Button>
                    </Group>
                  </Stack>
                )}
              </Box>
            ) : null}
            <Box
              role="button"
              tabIndex={0}
              aria-label={showBartenderLaunchTopBar ? "Hide top bar" : "Show top bar"}
              onClick={() => setShowBartenderLaunchTopBar((current) => !current)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setShowBartenderLaunchTopBar((current) => !current);
                }
              }}
              style={{
                borderBottom: "1px solid var(--mantine-color-gray-3)",
                background: "var(--mantine-color-gray-0)",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                minHeight: 18,
                width: "100%",
                cursor: "pointer",
              }}
            >
              <ActionIcon
                component="span"
                variant="light"
                color="gray"
                size="xs"
                style={{ pointerEvents: "none" }}
              >
                {showBartenderLaunchTopBar ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
              </ActionIcon>
            </Box>

            <Box
              className="openbar-launch-scroll-surface"
              style={{
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: isBartenderLaunchCompact ? "column" : "row",
                position: "relative",
                overflowX: "hidden",
                overflowY: isBartenderLaunchCompact ? "auto" : "hidden",
              }}
            >
              {isBartenderLaunchCompact ? (
                <Box
                  px="xs"
                  py={6}
                  style={{
                    borderBottom: "1px solid var(--mantine-color-gray-3)",
                    background: "var(--mantine-color-gray-0)",
                    flexShrink: 0,
                  }}
                >
                  <SegmentedControl
                    size="xs"
                    fullWidth
                    value={bartenderLaunchMobileView}
                    onChange={(value) => setBartenderLaunchMobileView(value === "session" ? "session" : "service")}
                    data={[
                      { value: "service", label: "Serve" },
                      { value: "session", label: "Session" },
                    ]}
                  />
                </Box>
              ) : null}
              {((!isBartenderLaunchCompact && showBartenderLaunchSessionPanel) ||
                (isBartenderLaunchCompact && bartenderLaunchMobileView === "session")) && (
                <Box
                  className="openbar-launch-scroll-surface"
                  p={isBartenderLaunchCompact ? "sm" : "md"}
                  style={{
                    order: 1,
                    width: isBartenderLaunchCompact ? "100%" : bartenderSessionPanelWidth,
                    flex: undefined,
                    flexShrink: 0,
                    minWidth: isBartenderLaunchCompact ? undefined : BARTENDER_SESSION_PANEL_MIN_WIDTH,
                    maxWidth: isBartenderLaunchCompact ? undefined : `calc(100vw - ${BARTENDER_SERVICE_PANEL_MIN_WIDTH}px)`,
                    borderRight: isBartenderLaunchCompact ? undefined : "1px solid var(--mantine-color-gray-3)",
                    borderTop: undefined,
                    background: "var(--mantine-color-gray-0)",
                    overflowY: isBartenderLaunchCompact ? "visible" : "auto",
                    overflowX: "hidden",
                    minHeight: isBartenderLaunchCompact ? undefined : 0,
                  }}
                >
                <Stack gap="xs">
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={0} style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
                      <Text size="sm" c="dimmed">
                        {activeSession ? activeSession.sessionName : "No active session"}
                      </Text>
                      {activeSession?.timeLimitMinutes != null ? (
                        <Text size="xs" c="dimmed">
                          Duration: {formatSessionDuration(activeSession.timeLimitMinutes)}
                        </Text>
                      ) : null}
                      {activeSession?.expectedEndAt ? (
                        <Text size="xs" c="dimmed">
                          Ends: {dayjs(activeSession.expectedEndAt).format("hh:mm A")}
                        </Text>
                      ) : null}
                      {activeSession ? (
                        <Text size="xs" c="dimmed">
                          {`Created by: ${activeSession.createdByName ?? (activeSession.createdBy != null ? `User #${activeSession.createdBy}` : "-")}`}
                        </Text>
                      ) : null}
                    </Stack>
                    <Group gap="xs" style={{ flexShrink: 0 }}>
                      <Popover
                        width={260}
                        position="bottom-end"
                        withArrow
                        shadow="md"
                        withinPortal
                        zIndex={5000}
                        opened={networkChipInfoOpen}
                        onChange={setNetworkChipInfoOpen}
                      >
                        <Popover.Target>
                          <Box
                            component="button"
                            type="button"
                            style={{
                              background: "transparent",
                              border: 0,
                              padding: 0,
                              margin: 0,
                              cursor: "pointer",
                            }}
                            onMouseEnter={() => {
                              setCountChipInfoOpen(false);
                              setNetworkChipInfoOpen(true);
                            }}
                            onMouseLeave={() => setNetworkChipInfoOpen(false)}
                            onClick={() => {
                              setCountChipInfoOpen(false);
                              setNetworkChipInfoOpen((current) => !current);
                            }}
                          >
                            <Badge color={isOnline ? "green" : "red"}>{isOnline ? "Online" : "Offline"}</Badge>
                          </Box>
                        </Popover.Target>
                        <Popover.Dropdown
                          onMouseEnter={() => setNetworkChipInfoOpen(true)}
                          onMouseLeave={() => setNetworkChipInfoOpen(false)}
                        >
                          <Text size="xs">
                            {isOnline
                              ? "Online means this device can currently reach the network/API."
                              : "Offline means this device currently has no network connection."}
                          </Text>
                        </Popover.Dropdown>
                      </Popover>
                      <Popover
                        width={280}
                        position="bottom-end"
                        withArrow
                        shadow="md"
                        withinPortal
                        zIndex={5000}
                        opened={countChipInfoOpen}
                        onChange={setCountChipInfoOpen}
                      >
                        <Popover.Target>
                          <Box
                            component="button"
                            type="button"
                            style={{
                              background: "transparent",
                              border: 0,
                              padding: 0,
                              margin: 0,
                              cursor: "pointer",
                            }}
                            onMouseEnter={() => {
                              setNetworkChipInfoOpen(false);
                              setCountChipInfoOpen(true);
                            }}
                            onMouseLeave={() => setCountChipInfoOpen(false)}
                            onClick={() => {
                              setNetworkChipInfoOpen(false);
                              setCountChipInfoOpen((current) => !current);
                            }}
                          >
                            <Badge variant="filled">{visibleCurrentSessionIssues.length}</Badge>
                          </Box>
                        </Popover.Target>
                        <Popover.Dropdown
                          onMouseEnter={() => setCountChipInfoOpen(true)}
                          onMouseLeave={() => setCountChipInfoOpen(false)}
                        >
                          <Text size="xs">
                            Number of drinks currently shown in this table. In Mine mode it shows only your drinks; in All mode it shows all visible session drinks.
                          </Text>
                        </Popover.Dropdown>
                      </Popover>
                    </Group>
                  </Group>
                  {isBartenderLaunchCompact ? (
                    <Stack gap="xs">
                      <SegmentedControl
                        size="xs"
                        fullWidth
                        value={launchIssueScope}
                        onChange={(value) => setLaunchIssueScope(value === "all" ? "all" : "mine")}
                        data={[
                          { value: "mine", label: "Mine" },
                          { value: "all", label: "All" },
                        ]}
                      />
                      {hasFailedRequests ? (
                        <Button
                          size="xs"
                          variant="light"
                          leftSection={<IconRefresh size={14} />}
                          onClick={() => void syncFailedDrinkIssues()}
                          disabled={!isOnline}
                          loading={isSyncingFailedIssues}
                          fullWidth
                        >
                          Sync Failed Requests
                        </Button>
                      ) : null}
                    </Stack>
                  ) : (
                    <Box
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr minmax(280px, 520px) 1fr",
                        alignItems: "center",
                        columnGap: 12,
                      }}
                    >
                      <Box />
                      <Box style={{ width: "100%", justifySelf: "center" }}>
                        <SegmentedControl
                          size="xs"
                          fullWidth
                          style={{ width: "100%" }}
                          value={launchIssueScope}
                          onChange={(value) => setLaunchIssueScope(value === "all" ? "all" : "mine")}
                          data={[
                            { value: "mine", label: "Mine" },
                            { value: "all", label: "All" },
                          ]}
                        />
                      </Box>
                      <Box style={{ justifySelf: "end" }}>
                        {hasFailedRequests ? (
                          <Button
                            size="xs"
                            variant="light"
                            leftSection={<IconRefresh size={14} />}
                            onClick={() => void syncFailedDrinkIssues()}
                            disabled={!isOnline}
                            loading={isSyncingFailedIssues}
                          >
                            Sync Failed Requests
                          </Button>
                        ) : null}
                      </Box>
                    </Box>
                  )}
                  {hasFailedRequests ? (
                    <Text size="sm" c="dimmed">
                      Failed: {failedSessionIssueCount} in this session / {failedIssueCountTotal} total
                    </Text>
                  ) : null}
                  <Box style={{ overflowX: isBartenderLaunchCompact ? "hidden" : "auto" }}>
                    <Table
                      striped
                      withTableBorder
                      withColumnBorders
                      style={isBartenderLaunchCompact ? { tableLayout: "fixed", width: "100%" } : undefined}
                    >
                      <Table.Thead>
                        <Table.Tr>
                          {showLaunchIssueTimeColumn ? (
                            <Table.Th style={{ textAlign: "center" }}>Time</Table.Th>
                          ) : null}
                          <Table.Th style={{ textAlign: "center" }}>Drink</Table.Th>
                          <Table.Th style={{ textAlign: "center" }}>Qty</Table.Th>
                          {showLaunchIssueUserColumn ? <Table.Th style={{ textAlign: "center" }}>User</Table.Th> : null}
                          <Table.Th style={{ textAlign: "center" }}>Synced</Table.Th>
                          {showLaunchIssueDetailsColumn ? <Table.Th style={{ textAlign: "center" }}>Details</Table.Th> : null}
                          <Table.Th style={{ textAlign: "center" }}>Action</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>{launchIssueTableBodyRows}</Table.Tbody>
                    </Table>
                  </Box>
                </Stack>
              </Box>
              )}
              {!isBartenderLaunchCompact && (
                <Box
                  onMouseDown={(event) => {
                    if (!showBartenderLaunchSessionPanel) {
                      return;
                    }
                    event.preventDefault();
                    setIsResizingBartenderSessionPanel(true);
                  }}
                  style={{
                    order: 2,
                    width: 18,
                    flexShrink: 0,
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: showBartenderLaunchSessionPanel ? "col-resize" : "default",
                    touchAction: showBartenderLaunchSessionPanel ? "none" : "auto",
                    background: "var(--mantine-color-gray-0)",
                    borderLeft: showBartenderLaunchSessionPanel ? "1px solid var(--mantine-color-gray-3)" : undefined,
                    borderRight: "1px solid var(--mantine-color-gray-3)",
                  }}
                >
                  {showBartenderLaunchSessionPanel ? (
                    <Box
                      style={{
                        position: "absolute",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        width: 10,
                        height: 34,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "col-resize",
                        touchAction: "none",
                        borderRadius: 8,
                      }}
                      aria-label="Resize session drinks panel"
                    >
                      <Stack gap={5} align="center" justify="center">
                        <Box style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--mantine-color-gray-6)" }} />
                        <Box style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--mantine-color-gray-6)" }} />
                        <Box style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--mantine-color-gray-6)" }} />
                      </Stack>
                    </Box>
                  ) : null}
                  <ActionIcon
                    variant="light"
                    color="gray"
                    size="xs"
                    onClick={() => {
                      setIsResizingBartenderSessionPanel(false);
                      setShowBartenderLaunchSessionPanel((current) => !current);
                    }}
                    onMouseDown={(event) => {
                      event.stopPropagation();
                    }}
                    style={{
                      position: "absolute",
                      top: 4,
                      left: "50%",
                      transform: "translateX(-50%)",
                    }}
                    aria-label={showBartenderLaunchSessionPanel ? "Hide session drinks panel" : "Show session drinks panel"}
                  >
                    {showBartenderLaunchSessionPanel ? <IconChevronLeft size={14} /> : <IconChevronRight size={14} />}
                  </ActionIcon>
                </Box>
              )}
              {(!isBartenderLaunchCompact || bartenderLaunchMobileView === "service") && (
                <Box
                  className="openbar-launch-scroll-surface"
                  px={isBartenderLaunchCompact ? "sm" : "md"}
                  pt={0}
                  style={{
                    order: isBartenderLaunchCompact ? 1 : 3,
                    overflowY: isBartenderLaunchCompact ? "visible" : "auto",
                    overflowX: "hidden",
                    flex: isBartenderLaunchCompact ? undefined : 1,
                    minWidth: 0,
                    paddingBottom: 18,
                    scrollPaddingBottom: 18,
                    boxSizing: "border-box",
                  }}
                >
                <Stack gap="md" h="100%" pb="md">
                {bartenderLaunchStep === "recipe" && (
                  <Stack gap="md" pb="sm">
                    <Paper
                      withBorder
                      p={isBartenderLaunchCompact ? "sm" : "md"}
                      style={{
                        position: "sticky",
                        top: -1,
                        marginTop: isBartenderLaunchCompact ? -1 : 0,
                        marginLeft: isBartenderLaunchCompact ? -12 : -16,
                        marginRight: isBartenderLaunchCompact ? -12 : -16,
                        borderRadius: 0,
                        zIndex: 30,
                        background: "var(--mantine-color-gray-0)",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.08)",
                      }}
                    >
                      <Box
                        style={{
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minHeight: isBartenderLaunchCompact ? 62 : 72,
                          paddingRight: isBartenderLaunchCompact ? 96 : 112,
                        }}
                      >
                        <Group justify="center" gap={isBartenderLaunchCompact ? "sm" : "md"} wrap="nowrap" style={{ minWidth: 0 }}>
                          <Button
                            variant="filled"
                            color="red"
                            size={isBartenderLaunchCompact ? "lg" : "xl"}
                            style={{ minWidth: isBartenderLaunchCompact ? 62 : 72, touchAction: "manipulation" }}
                            disabled={!activeSession || isBartenderSessionExpired}
                            onClick={handleBartenderLaunchQuantityDecrement}
                          >
                            -
                          </Button>
                          <Text
                            fw={800}
                            style={{
                              minWidth: isBartenderLaunchCompact ? 74 : 90,
                              textAlign: "center",
                              fontSize: isBartenderLaunchCompact ? 44 : 52,
                              lineHeight: 1,
                            }}
                          >
                            {bartenderLaunchQuantity}
                          </Text>
                          <Button
                            size={isBartenderLaunchCompact ? "lg" : "xl"}
                            style={{ minWidth: isBartenderLaunchCompact ? 62 : 72, touchAction: "manipulation" }}
                            disabled={!activeSession || isBartenderSessionExpired}
                            onClick={handleBartenderLaunchQuantityIncrement}
                          >
                            +
                          </Button>
                        </Group>
                        <Button
                          size={isBartenderLaunchCompact ? "sm" : "md"}
                          variant={bartenderLaunchIsStaffDrink ? "filled" : "light"}
                          color={bartenderLaunchIsStaffDrink ? "dark" : "gray"}
                          style={{
                            position: "absolute",
                            right: 0,
                            top: "50%",
                            transform: "translateY(-50%)",
                            width: isBartenderLaunchCompact ? 82 : 94,
                            minWidth: isBartenderLaunchCompact ? 82 : 94,
                            height: isBartenderLaunchCompact ? 62 : 72,
                            flexShrink: 0,
                            touchAction: "manipulation",
                          }}
                          disabled={!activeSession || isBartenderSessionExpired}
                          onClick={handleBartenderLaunchStaffToggle}
                        >
                          Staff
                        </Button>
                      </Box>
                    </Paper>

                    {bartenderRecipeGroupCards}
                    <Box h={8} />
                  </Stack>
                )}

                {bartenderLaunchStep === "categorySelection" && (
                  <Stack gap="md" h="100%">
                    <Group justify="space-between" align="center" wrap="nowrap">
                      <ActionIcon
                        variant="default"
                        size="xl"
                        aria-label="Back to recipes"
                        onClick={() => setBartenderLaunchStep("recipe")}
                      >
                        <IconArrowLeft size={22} />
                      </ActionIcon>
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text fw={800} ta="center" style={{ fontSize: "clamp(1.1rem, 2.1vw, 1.45rem)" }}>
                          {selectedBartenderLaunchDrinkLabel
                            ? `${selectedBartenderLaunchDrinkLabel} x ${bartenderLaunchQuantity}`
                            : "Pick a recipe first"}
                        </Text>
                      </Box>
                      <Box style={{ width: 44, height: 44, flexShrink: 0 }} />
                    </Group>
                    {selectedBartenderCategoryOptions.length === 0 ? (
                      <Alert color="yellow" icon={<IconAlertTriangle size={16} />}>
                        No ingredients available for this category.
                      </Alert>
                    ) : (
                      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
                        {bartenderCategoryOptionButtons}
                      </SimpleGrid>
                    )}
                  </Stack>
                )}

                {bartenderLaunchStep === "strength" && (
                  <Stack gap="md" h="100%">
                    <Group justify="space-between" align="center" wrap="nowrap">
                      <ActionIcon
                        variant="default"
                        size="xl"
                        aria-label="Back"
                        onClick={() => {
                          if (selectedBartenderRecipe && recipeNeedsCategorySelection(selectedBartenderRecipe)) {
                            const firstCategoryLine = selectedBartenderRecipe.ingredients.find(
                              (line) => line.lineType === "category_selector" && !line.isOptional && line.categoryId != null,
                            );
                            if (firstCategoryLine?.id != null) {
                              setBartenderLaunchCategorySelections((current) => {
                                if (!(firstCategoryLine.id in current)) {
                                  return current;
                                }
                                const next = { ...current };
                                delete next[firstCategoryLine.id];
                                return next;
                              });
                            }
                            setBartenderLaunchPendingCategoryLineId(firstCategoryLine?.id ?? null);
                            setBartenderLaunchStep("categorySelection");
                            return;
                          }
                          setBartenderLaunchStep("recipe");
                        }}
                      >
                        <IconArrowLeft size={22} />
                      </ActionIcon>
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text fw={800} ta="center" style={{ fontSize: "clamp(1.1rem, 2.1vw, 1.45rem)" }}>
                          {selectedBartenderLaunchDrinkLabel
                            ? `${selectedBartenderLaunchDrinkLabel} x ${bartenderLaunchQuantity}`
                            : "Pick a recipe first"}
                        </Text>
                      </Box>
                      <Box style={{ width: 44, height: 44, flexShrink: 0 }} />
                    </Group>
                    <SimpleGrid cols={{ base: 1, sm: 2 }} h="100%">
                      <Button
                        size="xl"
                        variant="filled"
                        color="teal"
                        style={{ minHeight: 200, touchAction: "manipulation" }}
                        disabled={!activeSession || isBartenderSessionExpired}
                        onClick={handleBartenderStrengthSingleTap}
                      >
                        <Stack gap={0} align="center">
                          <Text fw={800} style={{ fontSize: 44 }}>
                            Single
                          </Text>
                        </Stack>
                      </Button>
                      <Button
                        size="xl"
                        variant="filled"
                        color="orange"
                        style={{ minHeight: 200, touchAction: "manipulation" }}
                        disabled={!activeSession || isBartenderSessionExpired}
                        onClick={handleBartenderStrengthDoubleTap}
                      >
                        <Stack gap={0} align="center">
                          <Text fw={800} style={{ fontSize: 44 }}>
                            Double
                          </Text>
                        </Stack>
                      </Button>
                    </SimpleGrid>
                  </Stack>
                )}

                {bartenderLaunchStep === "ice" && (
                  <Stack gap="md" h="100%">
                    <Group justify="space-between" align="center" wrap="nowrap">
                      <ActionIcon
                        variant="default"
                        size="xl"
                        aria-label="Back"
                        onClick={() => {
                          if (selectedBartenderRecipe && recipeNeedsStrengthSelection(selectedBartenderRecipe)) {
                            setBartenderLaunchStep("strength");
                            return;
                          }
                          if (selectedBartenderRecipe && recipeNeedsCategorySelection(selectedBartenderRecipe)) {
                            const firstCategoryLine = selectedBartenderRecipe.ingredients.find(
                              (line) => line.lineType === "category_selector" && !line.isOptional && line.categoryId != null,
                            );
                            setBartenderLaunchPendingCategoryLineId(firstCategoryLine?.id ?? null);
                            setBartenderLaunchStep("categorySelection");
                            return;
                          }
                          setBartenderLaunchStep("recipe");
                        }}
                      >
                        <IconArrowLeft size={22} />
                      </ActionIcon>
                      <Box style={{ flex: 1, minWidth: 0 }}>
                        <Text fw={800} ta="center" style={{ fontSize: "clamp(1.1rem, 2.1vw, 1.45rem)" }}>
                          {selectedBartenderLaunchDrinkLabel
                            ? `${bartenderLaunchStrength ? `${bartenderLaunchStrength === "single" ? "Single" : "Double"} ` : ""}${selectedBartenderLaunchDrinkLabel} x ${bartenderLaunchQuantity}`
                            : "Pick a recipe first"}
                        </Text>
                      </Box>
                      <Box style={{ width: 44, height: 44, flexShrink: 0 }} />
                    </Group>
                    <SimpleGrid cols={{ base: 1, sm: 2 }} h="100%">
                      <Button
                        size="xl"
                        variant="filled"
                        color="blue"
                        style={{ minHeight: 200, touchAction: "manipulation" }}
                        styles={{
                          label: {
                            width: "100%",
                            justifyContent: "center",
                            whiteSpace: "normal",
                            textAlign: "center",
                            lineHeight: 1.05,
                            padding: "0 10px",
                          },
                        }}
                        disabled={!activeSession || isBartenderSessionExpired}
                        onClick={handleBartenderWithIceTap}
                      >
                        <Stack gap={0} align="center">
                          <Text fw={800} ta="center" style={{ fontSize: "clamp(2rem, 4.5vw, 2.8rem)", lineHeight: 1.05 }}>
                            With Ice
                          </Text>
                        </Stack>
                      </Button>
                      <Button
                        size="xl"
                        variant="filled"
                        color="grape"
                        style={{ minHeight: 200, touchAction: "manipulation" }}
                        styles={{
                          label: {
                            width: "100%",
                            justifyContent: "center",
                            whiteSpace: "normal",
                            textAlign: "center",
                            lineHeight: 1.05,
                            padding: "0 10px",
                          },
                        }}
                        disabled={!activeSession || isBartenderSessionExpired}
                        onClick={handleBartenderNoIceTap}
                      >
                        <Stack gap={0} align="center">
                          <Text fw={800} ta="center" style={{ fontSize: "clamp(2rem, 4.5vw, 2.8rem)", lineHeight: 1.05 }}>
                            No Ice
                          </Text>
                        </Stack>
                      </Button>
                    </SimpleGrid>
                  </Stack>
                )}

                </Stack>
              </Box>
              )}
              {bartenderLaunchStep === "sessionStart" && (
                <Box
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "center",
                    padding: isBartenderLaunchCompact ? 16 : 28,
                    overflowY: "auto",
                    background: "rgba(2, 6, 23, 0.62)",
                    backdropFilter: "blur(8px)",
                    WebkitBackdropFilter: "blur(8px)",
                    zIndex: 25,
                  }}
                >
                  <Paper
                    withBorder
                    radius="md"
                    p={isBartenderLaunchCompact ? "md" : "xl"}
                    style={{
                      width: "min(980px, 100%)",
                      maxHeight: "100%",
                      overflowY: "auto",
                    }}
                  >
                    <Stack gap="md">
                      <Stack gap="sm">
                        <Title order={3}>Join Active Session</Title>
                        {joinableSessionOptions.length === 0 ? (
                          <Text size="sm" c="dimmed">
                            No active sessions available to join.
                          </Text>
                        ) : (
                          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                            {joinableSessionOptions.map((session) => (
                              <Card key={`joinable-session-${session.id}`} withBorder>
                                <Stack gap="xs">
                                  <Text fw={800} style={{ fontSize: "clamp(1.1rem, 2.2vw, 1.5rem)" }}>
                                    {session.sessionName}
                                  </Text>
                                  <Text size="sm" c="dimmed">
                                    {session.sessionTypeName ?? "No type"} | {session.venueName ?? "No venue"}
                                  </Text>
                                  <Text size="sm" c="dimmed">
                                    By: {session.createdByName ?? (session.createdBy != null ? `User #${session.createdBy}` : "-")}
                                  </Text>
                                  <Button
                                    size="lg"
                                    color="teal"
                                    loading={joiningSessionId === session.id && joinSessionMutation.isPending}
                                    disabled={startingSessionTypeId != null || (joiningSessionId != null && joiningSessionId !== session.id)}
                                    onClick={() => void handleJoinSession(session.id)}
                                  >
                                    Join Session
                                  </Button>
                                </Stack>
                              </Card>
                            ))}
                          </SimpleGrid>
                        )}
                      </Stack>
                      <Divider />
                      <Stack gap="sm">
                        <Title order={3}>Create New Session</Title>
                        {sessionTypesQuery.isLoading ? (
                          <Alert color="blue">Loading session types...</Alert>
                        ) : sessionTypeOptions.length === 0 ? (
                          <Alert color="red" icon={<IconAlertTriangle size={16} />}>
                            No active session types are configured. Ask a manager to configure session products first.
                          </Alert>
                        ) : (
                          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                            {sessionTypeOptions.map((sessionType) => (
                              <Button
                                key={`session-type-launch-${sessionType.id}`}
                                size="xl"
                                variant="filled"
                                color="indigo"
                                loading={startingSessionTypeId === sessionType.id}
                                disabled={joiningSessionId != null || (startingSessionTypeId != null && startingSessionTypeId !== sessionType.id)}
                                onClick={() =>
                                  void handleStartSessionFromType(
                                    sessionType.id,
                                    sessionType.defaultTimeLimitMinutes,
                                  )
                                }
                                style={{ minHeight: 160 }}
                              >
                                <Stack gap={6} align="center">
                                  <Text fw={900} style={{ fontSize: "clamp(1.5rem, 2.8vw, 2.2rem)", lineHeight: 1.1 }}>
                                    {sessionType.name}
                                  </Text>
                                  <Text size="lg" fw={700}>
                                    {formatSessionDuration(sessionType.defaultTimeLimitMinutes)}
                                  </Text>
                                </Stack>
                              </Button>
                            ))}
                          </SimpleGrid>
                        )}
                      </Stack>
                    </Stack>
                  </Paper>
                </Box>
              )}
              {sessionExpiredNoticeOpen && isBartenderSessionExpired && activeSession && (
                <Box
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: isBartenderLaunchCompact ? 16 : 28,
                    background: "rgba(2, 6, 23, 0.68)",
                    backdropFilter: "blur(8px)",
                    WebkitBackdropFilter: "blur(8px)",
                    zIndex: 40,
                  }}
                >
                  <Paper
                    withBorder
                    radius="md"
                    p={isBartenderLaunchCompact ? "lg" : "xl"}
                    style={{ width: "min(840px, 100%)" }}
                  >
                    <Stack gap="md" align="center">
                      <Title order={1} ta="center" c="red">
                        Open Bar Finished!
                      </Title>
                      <Text fw={700} ta="center" style={{ fontSize: "clamp(1.05rem, 2.3vw, 1.35rem)" }}>
                        Do not serve more drinks.
                      </Text>
                      {activeSession.expectedEndAt ? (
                        <Text size="sm" c="dimmed" ta="center">
                          Session ended at {dayjs(activeSession.expectedEndAt).format("hh:mm A")}
                        </Text>
                      ) : null}
                      {!canCloseActiveSession ? (
                        <Text size="sm" c="dimmed" ta="center">
                          Only the session creator or a manager can close this session.
                        </Text>
                      ) : null}
                      <Group justify="center">
                        {canCloseActiveSession ? (
                          <Button
                            color="blue"
                            size="md"
                            onClick={() => void handleStartNewSessionFromLaunch()}
                            loading={closeSessionMutation.isPending}
                          >
                            Start New Session
                          </Button>
                        ) : null}
                        <Button color="dark" size="md" onClick={() => void closeBartenderLaunch()}>
                          Exit Launch
                        </Button>
                      </Group>
                    </Stack>
                  </Paper>
                </Box>
              )}
            </Box>
          </Stack>
        </Modal>

        {managerMode ? (
          <SimpleGrid cols={{ base: 1, md: 3 }}>
            <Card withBorder>
              <Text size="sm" c="dimmed">Active Session</Text>
              <Text fw={700}>{overviewQuery.data?.activeSession?.sessionName ?? "No active session"}</Text>
              <Text size="sm" c="dimmed">
                {overviewQuery.data?.activeSession?.venueName ?? "No venue"}
              </Text>
            </Card>
            <Card withBorder>
              <Text size="sm" c="dimmed">Drinks Logged</Text>
              <Text fw={700}>{overviewQuery.data?.totals.issuesCount ?? 0}</Text>
              <Text size="sm" c="dimmed">Servings: {overviewQuery.data?.totals.totalServings ?? 0}</Text>
            </Card>
            <Card withBorder>
              <Text size="sm" c="dimmed">Low Stock Alerts</Text>
              <Text fw={700}>{overviewQuery.data?.totals.lowStockCount ?? 0}</Text>
              <Text size="sm" c="dimmed">Deliveries today: {overviewQuery.data?.totals.deliveriesCount ?? 0}</Text>
            </Card>
          </SimpleGrid>
        ) : null}

        <Tabs value={activeTab} onChange={(value) => setActiveTab(value ?? "service")}>
          <Tabs.List>
            <Tabs.Tab value="service" leftSection={<IconClockPlay size={16} />}>Session Control</Tabs.Tab>
            {managerMode && <Tabs.Tab value="categories" leftSection={<IconTags size={16} />}>Categories</Tabs.Tab>}
            {managerMode && <Tabs.Tab value="session-types" leftSection={<IconClockPlay size={16} />}>Session Types</Tabs.Tab>}
            {managerMode && <Tabs.Tab value="settings" leftSection={<IconSettings size={16} />}>Settings</Tabs.Tab>}
            {managerMode && <Tabs.Tab value="ingredients" leftSection={<IconFlask size={16} />}>Ingredients</Tabs.Tab>}
            {managerMode && <Tabs.Tab value="products" leftSection={<IconFlask size={16} />}>Products</Tabs.Tab>}
            {managerMode && <Tabs.Tab value="recipes" leftSection={<IconClipboardList size={16} />}>Recipes</Tabs.Tab>}
            {managerMode && <Tabs.Tab value="deliveries" leftSection={<IconBeer size={16} />}>Deliveries</Tabs.Tab>}
            {managerMode && <Tabs.Tab value="overview" leftSection={<IconChartBar size={16} />}>Overview</Tabs.Tab>}
          </Tabs.List>

          <Tabs.Panel value="service" pt="md">
            <Stack>
              <Paper withBorder p="md">
                <Stack>
                  <Group justify="space-between" align="start">
                    <div>
                      <Title order={4}>Session Control</Title>
                    </div>
                    {managerMode && (
                      <Group>
                        {activeSession && canCloseActiveSession ? (
                          <Button color="red" onClick={() => void handleCloseSessionDirect()} loading={closeSessionMutation.isPending}>
                            Close Active Session
                          </Button>
                        ) : null}
                        {activeSession && canCloseActiveSession ? (
                          <Button variant="light" onClick={() => openCloseSessionReconciliation()} loading={closeSessionMutation.isPending}>
                            Reconcile & Close (Optional)
                          </Button>
                        ) : null}
                      </Group>
                    )}
                  </Group>

                  {activeSession ? (
                    <Group gap="xs">
                      <Badge color="green">Active</Badge>
                      <Text fw={600}>{activeSession.sessionName}</Text>
                      <Text size="sm" c="dimmed">
                        {activeSession.sessionTypeName ?? "No type"} | {activeSession.venueName ?? "No venue"}
                      </Text>
                    </Group>
                  ) : (
                    <Text size="sm" c="dimmed">No active session.</Text>
                  )}

                </Stack>
              </Paper>

              <Paper withBorder p="md">
                <Stack>
                  <Group justify="space-between" align="end">
                  <div>
                    <Title order={5}>Sessions</Title>
                  </div>
                    <Select
                      w={{ base: "100%", sm: 360 }}
                      data={sessionOptions}
                      value={selectedSession ? String(selectedSession.id) : null}
                      onChange={(value) => setSelectedSessionId(value ?? "")}
                      placeholder="Select session"
                      searchable
                      clearable={false}
                    />
                  </Group>
                  <Box style={{ overflowX: "auto" }}>
                    <Table striped withTableBorder withColumnBorders>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Name</Table.Th>
                          <Table.Th>Status</Table.Th>
                          <Table.Th>Type</Table.Th>
                          <Table.Th>Venue</Table.Th>
                          <Table.Th>Created By</Table.Th>
                          <Table.Th>Time Limit</Table.Th>
                          <Table.Th>Opened</Table.Th>
                          <Table.Th>Expected End</Table.Th>
                          <Table.Th>Closed</Table.Th>
                          <Table.Th>Drinks</Table.Th>
                          <Table.Th>Servings</Table.Th>
                          <Table.Th>Actions</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {(sessionsQuery.data?.sessions ?? []).map((session) => {
                          const isSelected = selectedSession != null && selectedSession.id === session.id;
                          const canStart = session.status === "draft" && (!activeSession || activeSession.id === session.id);
                          const canClose = session.status === "active" && canCloseSessionTarget(session.createdBy);
                          const isCurrentUserActiveSession = session.isCurrentUserActiveSession === true;
                          const canJoinSession = session.status === "active" && !isCurrentUserActiveSession;
                          const canDisconnectSession = isCurrentUserActiveSession;
                          return (
                            <Table.Tr
                              key={session.id}
                              onClick={() => setSelectedSessionId(String(session.id))}
                              style={{
                                cursor: "pointer",
                                backgroundColor: isSelected ? "var(--mantine-color-blue-0)" : undefined,
                              }}
                            >
                              <Table.Td>{session.sessionName}</Table.Td>
                              <Table.Td>
                                <Badge color={session.status === "active" ? "green" : session.status === "draft" ? "yellow" : "gray"}>
                                  {session.status}
                                </Badge>
                              </Table.Td>
                              <Table.Td>{session.sessionTypeName ?? "-"}</Table.Td>
                              <Table.Td>{session.venueName ?? "-"}</Table.Td>
                              <Table.Td>{session.createdByName ?? (session.createdBy != null ? `User #${session.createdBy}` : "-")}</Table.Td>
                              <Table.Td>{formatSessionDuration(session.timeLimitMinutes)}</Table.Td>
                              <Table.Td>{session.openedAt ? dayjs(session.openedAt).format("YYYY-MM-DD HH:mm") : "-"}</Table.Td>
                              <Table.Td>{session.expectedEndAt ? dayjs(session.expectedEndAt).format("YYYY-MM-DD HH:mm") : "-"}</Table.Td>
                              <Table.Td>{session.closedAt ? dayjs(session.closedAt).format("YYYY-MM-DD HH:mm") : "-"}</Table.Td>
                              <Table.Td>{session.issuesCount}</Table.Td>
                              <Table.Td>{session.servingsIssued}</Table.Td>
                              <Table.Td>
                                <Group gap="xs" wrap="nowrap">
                                  {canJoinSession ? (
                                    <Button
                                      size="xs"
                                      color="teal"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleJoinSession(session.id);
                                      }}
                                      loading={joiningSessionId === session.id && joinSessionMutation.isPending}
                                      disabled={startingSessionTypeId != null || (joiningSessionId != null && joiningSessionId !== session.id)}
                                    >
                                      Join
                                    </Button>
                                  ) : null}
                                  {canDisconnectSession ? (
                                    <Button
                                      size="xs"
                                      variant="light"
                                      color="orange"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleLeaveSession(session.id);
                                      }}
                                      loading={leavingSessionId === session.id && leaveSessionMutation.isPending}
                                    >
                                      Disconnect
                                    </Button>
                                  ) : null}
                                  {managerMode && canStart ? (
                                    <Button
                                      size="xs"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleStartSession(session.id);
                                      }}
                                      loading={startSessionMutation.isPending}
                                    >
                                      Start
                                    </Button>
                                  ) : null}
                                  {managerMode && canClose ? (
                                    <Button
                                      size="xs"
                                      color="red"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleCloseSessionDirect({
                                          id: session.id,
                                          sessionName: session.sessionName,
                                          createdBy: session.createdBy ?? null,
                                        });
                                      }}
                                      loading={closeSessionMutation.isPending}
                                    >
                                      Close
                                    </Button>
                                  ) : null}
                                  {managerMode ? (
                                    <Button
                                      size="xs"
                                      color="red"
                                      variant="light"
                                      leftSection={<IconTrash size={14} />}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleDeleteSession(session);
                                      }}
                                      loading={deletingSessionId === session.id && deleteSessionMutation.isPending}
                                      disabled={deletingSessionId != null && deletingSessionId !== session.id}
                                    >
                                      Delete
                                    </Button>
                                  ) : null}
                                </Group>
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </Box>
                </Stack>
              </Paper>

              <Paper withBorder p="md">
                <Stack>
                  <Group justify="space-between" align="end">
                    <div>
                      <Title order={5}>Pending Drinks to Sync</Title>
                    </div>
                    <Group gap="xs">
                      <Badge color={isOnline ? "green" : "red"}>{isOnline ? "Online" : "Offline"}</Badge>
                      <Badge variant="light">Pending {pendingDrinksSyncCounts.pending}</Badge>
                      <Badge variant="light" color="yellow">Syncing {pendingDrinksSyncCounts.syncing}</Badge>
                      <Badge variant="light" color="red">Failed {pendingDrinksSyncCounts.failed}</Badge>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconRefresh size={14} />}
                        onClick={() => void syncFailedDrinkIssues()}
                        disabled={failedIssueCountTotal === 0 || !isOnline}
                        loading={isSyncingFailedIssues}
                      >
                        Sync Failed Requests
                      </Button>
                    </Group>
                  </Group>

                  <Box style={{ overflowX: "auto" }}>
                    <Table striped withTableBorder withColumnBorders>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Time</Table.Th>
                          <Table.Th>Session</Table.Th>
                          <Table.Th>Drink</Table.Th>
                          <Table.Th>Qty</Table.Th>
                          <Table.Th>Status</Table.Th>
                          <Table.Th>Error</Table.Th>
                          <Table.Th>Action</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {pendingDrinksToSyncRows.length === 0 ? (
                          <Table.Tr>
                            <Table.Td colSpan={7}>
                              <Text size="sm" c="dimmed">
                                No pending drinks to sync.
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        ) : (
                          pendingDrinksToSyncRows.map((row) => (
                            <Table.Tr key={`pending-sync-${row.localId}`}>
                              <Table.Td>{dayjs(row.issuedAt).format("YYYY-MM-DD HH:mm:ss")}</Table.Td>
                              <Table.Td>{row.sessionName}</Table.Td>
                              <Table.Td>{row.drinkDisplayName}</Table.Td>
                              <Table.Td>{row.servings}</Table.Td>
                              <Table.Td>
                                {row.status === "failed" ? (
                                  <Badge color="red">Failed</Badge>
                                ) : row.status === "syncing" ? (
                                  <Badge color="yellow">Syncing</Badge>
                                ) : (
                                  <Badge color="gray">Pending</Badge>
                                )}
                              </Table.Td>
                              <Table.Td>
                                <Text size="sm" c={row.errorMessage ? "red" : "dimmed"}>
                                  {row.errorMessage ?? "-"}
                                </Text>
                              </Table.Td>
                              <Table.Td>
                                <Group gap="xs" wrap="nowrap">
                                  {row.status === "failed" ? (
                                    <Button
                                      size="xs"
                                      variant="light"
                                      leftSection={<IconRefresh size={14} />}
                                      onClick={() => {
                                        void syncLocalDrinkIssue(row.localId, {
                                          allowInactiveSession: managerMode,
                                        });
                                      }}
                                      disabled={!isOnline}
                                    >
                                      Retry
                                    </Button>
                                  ) : null}
                                  <Button
                                    size="xs"
                                    color="red"
                                    variant="light"
                                    leftSection={<IconTrash size={14} />}
                                    onClick={() => {
                                      setLocalDrinkIssues((current) =>
                                        current.filter((entry) => entry.localId !== row.localId),
                                      );
                                      setSuccess("Pending drink removed from local queue.");
                                    }}
                                    disabled={row.status === "syncing"}
                                  >
                                    Delete
                                  </Button>
                                </Group>
                              </Table.Td>
                            </Table.Tr>
                          ))
                        )}
                      </Table.Tbody>
                    </Table>
                  </Box>
                </Stack>
              </Paper>
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="settings" pt="md">
            <Paper withBorder p="md">
              <Stack>
                <Title order={5}>Current Drinks Label Format</Title>
                <Text size="sm" c="dimmed">
                  Choose how each drink type is displayed in Current Drinks in Session.
                </Text>
                {drinkTypeOrder.map((type) => (
                  <Group key={`drink-label-format-${type}`} justify="space-between" align="center" wrap="nowrap">
                    <Text size="sm">{drinkTypeLabel[type]}</Text>
                    <Select
                      w={240}
                      data={drinkLabelDisplayModeOptions}
                      value={drinkLabelDisplayByType[type]}
                      onChange={(value) => {
                        if (!isDrinkLabelDisplayMode(value)) {
                          return;
                        }
                        void handleUpdateDrinkLabelDisplayMode(type, value);
                      }}
                      disabled={updateDrinkLabelSettingsMutation.isPending}
                    />
                  </Group>
                ))}
              </Stack>
            </Paper>
          </Tabs.Panel>

          <Tabs.Panel value="ingredients" pt="md">
            <Paper withBorder p="md">
              <Stack>
                <Group justify="space-between" align="end">
                  <div>
                    <Title order={5}>Stock Board</Title>
                    <Text size="sm" c="dimmed">
                      Manage ingredient records from a single stock board.
                    </Text>
                  </div>
                  <Button leftSection={<IconPlus size={16} />} onClick={openCreateIngredientModal}>
                    Add Ingredient
                  </Button>
                </Group>
                <Table striped withTableBorder withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Ingredient</Table.Th>
                      <Table.Th>Category</Table.Th>
                      <Table.Th>Type</Table.Th>
                      <Table.Th>Stock</Table.Th>
                      <Table.Th>Par</Table.Th>
                      <Table.Th>Reorder</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Actions</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(ingredientsQuery.data?.ingredients ?? []).map((ingredient) => (
                      <Table.Tr key={ingredient.id}>
                        <Table.Td>{ingredient.name}</Table.Td>
                        <Table.Td>{ingredient.categoryName ?? ingredientCategoryLabelMap.get(String(ingredient.categoryId)) ?? "-"}</Table.Td>
                        <Table.Td>
                          {ingredient.isCup
                            ? `${ingredient.cupType === "reusable" ? "Reusable" : "Disposable"}${ingredient.cupCapacityMl != null ? ` (${ingredient.cupCapacityMl.toFixed(0)} ml)` : ""}`
                            : ingredient.isIce
                            ? "Ice"
                            : "-"}
                        </Table.Td>
                        <Table.Td>{ingredient.currentStock.toFixed(2)} {ingredient.baseUnit}</Table.Td>
                        <Table.Td>{ingredient.parLevel.toFixed(2)}</Table.Td>
                        <Table.Td>{ingredient.reorderLevel.toFixed(2)}</Table.Td>
                        <Table.Td>
                          {ingredient.belowReorder ? (
                            <Badge color="red">Low</Badge>
                          ) : (
                            <Badge color="green">OK</Badge>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Group gap="xs">
                            <Button
                              variant="light"
                              size="xs"
                              onClick={() => openIngredientAdjustment(ingredient.id)}
                            >
                              Adjust
                            </Button>
                            <Button
                              variant="light"
                              size="xs"
                              leftSection={<IconPencil size={14} />}
                              onClick={() =>
                              openIngredientEditor({
                                id: ingredient.id,
                                name: ingredient.name,
                                categoryId: ingredient.categoryId,
                                baseUnit: ingredient.baseUnit,
                                parLevel: ingredient.parLevel,
                                reorderLevel: ingredient.reorderLevel,
                                isCup: ingredient.isCup,
                                isIce: ingredient.isIce,
                                cupType: ingredient.cupType,
                                cupCapacityMl: ingredient.cupCapacityMl,
                              })
                            }
                          >
                              Edit
                            </Button>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Stack>
            </Paper>
          </Tabs.Panel>

          <Tabs.Panel value="categories" pt="md">
            <Paper withBorder p="md">
              <Stack>
                <Group justify="space-between" align="end">
                  <div>
                    <Title order={5}>Category Catalog</Title>
                    <Text size="sm" c="dimmed">
                      Manage ingredient categories from one catalog.
                    </Text>
                  </div>
                  <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateCategoryOpen(true)}>
                    Add Category
                  </Button>
                </Group>
                <Table striped withTableBorder withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Slug</Table.Th>
                      <Table.Th>Sort</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Action</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(ingredientCategoriesQuery.data?.categories ?? []).map((category) => (
                      <Table.Tr key={category.id}>
                        <Table.Td>{category.name}</Table.Td>
                        <Table.Td>{category.slug}</Table.Td>
                        <Table.Td>{category.sortOrder}</Table.Td>
                        <Table.Td>
                          <Badge color={category.isActive ? "green" : "gray"}>
                            {category.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Button
                            size="xs"
                            variant="light"
                            leftSection={<IconPencil size={14} />}
                            onClick={() => openCategoryEditor(category)}
                          >
                            Edit
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Stack>
            </Paper>
          </Tabs.Panel>

          <Tabs.Panel value="session-types" pt="md">
            <Paper withBorder p="md">
              <Stack>
                <Group justify="space-between" align="end">
                  <div>
                    <Title order={5}>Session Type Catalog</Title>
                    <Text size="sm" c="dimmed">
                      Configure launch options and default time limits for bartender sessions.
                    </Text>
                  </div>
                  <Button leftSection={<IconPlus size={16} />} onClick={openCreateSessionTypeModal}>
                    Add Session Type
                  </Button>
                </Group>
                <Table striped withTableBorder withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Name</Table.Th>
                      <Table.Th>Slug</Table.Th>
                      <Table.Th>Default Duration</Table.Th>
                      <Table.Th>Sort</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Action</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {sessionTypeCatalog.map((sessionType) => (
                      <Table.Tr key={sessionType.id}>
                        <Table.Td>{sessionType.name}</Table.Td>
                        <Table.Td>{sessionType.slug}</Table.Td>
                        <Table.Td>{formatSessionDuration(sessionType.defaultTimeLimitMinutes)}</Table.Td>
                        <Table.Td>{sessionType.sortOrder}</Table.Td>
                        <Table.Td>
                          <Badge color={sessionType.isActive ? "green" : "gray"}>
                            {sessionType.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Button
                            size="xs"
                            variant="light"
                            leftSection={<IconPencil size={14} />}
                            onClick={() => openSessionTypeEditor(sessionType)}
                          >
                            Edit
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Stack>
            </Paper>
          </Tabs.Panel>

          <Tabs.Panel value="products" pt="md">
            <Paper withBorder p="md">
              <Stack>
                <Group justify="space-between" align="end">
                  <div>
                    <Title order={5}>Ingredient Product Variants</Title>
                    <Text size="sm" c="dimmed">
                      Manage purchasable products that roll up into ingredient stock.
                    </Text>
                  </div>
                  <Button leftSection={<IconPlus size={16} />} onClick={openCreateVariantModal}>
                    Add Product Variant
                  </Button>
                </Group>
                <Table striped withTableBorder withColumnBorders>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Ingredient</Table.Th>
                      <Table.Th>Variant</Table.Th>
                      <Table.Th>Brand</Table.Th>
                      <Table.Th>Package</Table.Th>
                      <Table.Th>Base Qty</Table.Th>
                      <Table.Th>Status</Table.Th>
                      <Table.Th>Action</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {(ingredientVariantsQuery.data?.variants ?? []).map((variant) => (
                      <Table.Tr key={variant.id}>
                        <Table.Td>{variant.ingredientName ?? `Ingredient #${variant.ingredientId}`}</Table.Td>
                        <Table.Td>{variant.name}</Table.Td>
                        <Table.Td>{variant.brand ?? "-"}</Table.Td>
                        <Table.Td>{variant.packageLabel ?? "-"}</Table.Td>
                        <Table.Td>
                          {variant.baseQuantity.toFixed(3)} {variant.ingredientBaseUnit ?? ""}
                        </Table.Td>
                        <Table.Td>
                          <Badge color={variant.isActive ? "green" : "gray"}>
                            {variant.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          <Button
                            size="xs"
                            variant="light"
                            leftSection={<IconPencil size={14} />}
                            onClick={() =>
                              openVariantEditor({
                                id: variant.id,
                                ingredientId: variant.ingredientId,
                                name: variant.name,
                                brand: variant.brand,
                                packageLabel: variant.packageLabel,
                                baseQuantity: variant.baseQuantity,
                                isActive: variant.isActive,
                              })
                            }
                          >
                            Edit
                          </Button>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Stack>
            </Paper>
          </Tabs.Panel>

          <Tabs.Panel value="recipes" pt="md">
            <Paper withBorder p="md">
              <Stack>
                <Group justify="space-between" align="end">
                  <div>
                    <Title order={5}>Recipe Catalog</Title>
                    <Text size="sm" c="dimmed">
                      Manage classic drinks, cocktails, and custom recipes.
                    </Text>
                  </div>
                  <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateRecipeOpen(true)}>
                    Add Recipe
                  </Button>
                </Group>
                {recipeCatalogGroups.length === 0 ? (
                  <Text size="sm" c="dimmed">No recipes yet.</Text>
                ) : (
                  recipeCatalogGroups.map((group, groupIndex) => (
                    <Card key={`recipe-catalog-group-${group.type}`} withBorder>
                      <Stack>
                        <Group justify="space-between">
                          <Group gap="xs">
                            <Title order={6}>{group.title}</Title>
                            <Badge variant="light">{group.recipes.length}</Badge>
                          </Group>
                          <Group gap="xs">
                            <ActionIcon
                              variant="default"
                              size="sm"
                              onClick={() => moveDrinkTypeSection(group.type, -1)}
                              disabled={groupIndex === 0}
                              aria-label={`Move ${group.title} up`}
                            >
                              <IconChevronUp size={14} />
                            </ActionIcon>
                            <ActionIcon
                              variant="default"
                              size="sm"
                              onClick={() => moveDrinkTypeSection(group.type, 1)}
                              disabled={groupIndex === recipeCatalogGroups.length - 1}
                              aria-label={`Move ${group.title} down`}
                            >
                              <IconChevronDown size={14} />
                            </ActionIcon>
                          </Group>
                        </Group>
                        {group.recipes.map((recipe, recipeIndex) => (
                          <Card key={recipe.id} withBorder>
                            <Group justify="space-between">
                              <div>
                                <Text fw={700}>{recipe.name}</Text>
                                <Text size="sm" c="dimmed">{recipe.drinkType}</Text>
                              </div>
                              <Group>
                                <ActionIcon
                                  variant="default"
                                  size="sm"
                                  onClick={() => moveRecipeInDrinkType(group.type, recipe.id, -1)}
                                  disabled={recipeIndex === 0}
                                  aria-label={`Move ${recipe.name} up`}
                                >
                                  <IconChevronUp size={14} />
                                </ActionIcon>
                                <ActionIcon
                                  variant="default"
                                  size="sm"
                                  onClick={() => moveRecipeInDrinkType(group.type, recipe.id, 1)}
                                  disabled={recipeIndex === group.recipes.length - 1}
                                  aria-label={`Move ${recipe.name} down`}
                                >
                                  <IconChevronDown size={14} />
                                </ActionIcon>
                                <Badge color={recipe.isActive ? "green" : "gray"}>
                                  {recipe.isActive ? "Active" : "Inactive"}
                                </Badge>
                                <Button
                                  size="xs"
                                  variant="light"
                                  leftSection={<IconPencil size={14} />}
                                  onClick={() =>
                                    openEditRecipeModal({
                                      id: recipe.id,
                                      name: recipe.name,
                                      drinkType: recipe.drinkType,
                                      labelDisplayMode: recipe.labelDisplayMode,
                                      instructions: recipe.instructions,
                                      askStrength: recipe.askStrength,
                                      hasIce: recipe.hasIce,
                                      iceCubes: recipe.iceCubes,
                                      cupIngredientId: recipe.cupIngredientId,
                                      ingredients: recipe.ingredients.map((line) => ({
                                        lineType: line.lineType,
                                        ingredientId: line.ingredientId,
                                        categoryId: line.categoryId,
                                        quantity: line.quantity,
                                        isOptional: line.isOptional,
                                        affectsStrength: line.affectsStrength,
                                        isTopUp: line.isTopUp,
                                      })),
                                    })
                                  }
                                >
                                  Edit
                                </Button>
                              </Group>
                            </Group>
                            <Text size="sm" mt="xs">
                              Cost/serving: {recipe.estimatedCostPerServing.toFixed(2)}
                            </Text>
                            <Text size="sm" c="dimmed">
                              Ask single/double: {recipe.askStrength ? "Yes" : "No"}
                            </Text>
                            <Text size="sm" c="dimmed">
                              Label format:{" "}
                              {recipe.labelDisplayMode
                                ? `${formatDrinkLabelDisplayMode(recipe.labelDisplayMode)} (recipe override)`
                                : `Use global default (${formatDrinkLabelDisplayMode(
                                    drinkLabelDisplayByType[recipe.drinkType],
                                  )})`}
                            </Text>
                            <Text size="sm" c="dimmed">
                              Cup: {recipe.cupIngredientName ? `${recipe.cupIngredientName}${recipe.cupCapacityMl != null ? ` - ${recipe.cupCapacityMl.toFixed(0)} ml` : ""}${recipe.cupType ? ` (${recipe.cupType})` : ""}` : "None"}
                            </Text>
                            <Text size="sm" c="dimmed">
                              Ice: {recipe.hasIce ? `${recipe.iceCubes} cubes (~${recipe.iceDisplacementMl.toFixed(1)} ml displacement)` : "No"}
                            </Text>
                            {recipe.availableLiquidCapacityMl != null && (
                              <Text size="sm" c="dimmed">
                                Available liquid capacity: {recipe.availableLiquidCapacityMl.toFixed(1)} ml
                              </Text>
                            )}
                            <Text size="sm" c="dimmed">{recipe.instructions ?? "No instructions"}</Text>
                            <Table mt="sm" withTableBorder>
                              <Table.Thead>
                                <Table.Tr>
                                  <Table.Th>Line</Table.Th>
                                  <Table.Th>Qty</Table.Th>
                                  <Table.Th>Flags</Table.Th>
                                </Table.Tr>
                              </Table.Thead>
                              <Table.Tbody>
                                {recipe.ingredients.map((line) => (
                                  <Table.Tr key={line.id}>
                                    <Table.Td>
                                      {line.lineType === "category_selector"
                                        ? `Category: ${line.categoryName ?? "-"}`
                                        : line.ingredientName ?? "-"}
                                    </Table.Td>
                                    <Table.Td>{line.isTopUp ? "Auto" : `${line.quantity} ${line.baseUnit ?? ""}`}</Table.Td>
                                    <Table.Td>
                                      {line.isTopUp ? "Top Up" : line.affectsStrength ? "Strength" : "-"}
                                      {line.isOptional ? " | Optional" : ""}
                                    </Table.Td>
                                  </Table.Tr>
                                ))}
                              </Table.Tbody>
                            </Table>
                          </Card>
                        ))}
                      </Stack>
                    </Card>
                  ))
                )}
              </Stack>
            </Paper>
          </Tabs.Panel>

          <Tabs.Panel value="deliveries" pt="md">
            <Paper withBorder p="md">
              <Stack>
                <Group justify="space-between" align="end">
                  <div>
                    <Title order={5}>Recent Deliveries</Title>
                    <Text size="sm" c="dimmed">
                      Track supplier deliveries and received stock lines.
                    </Text>
                  </div>
                  <Button leftSection={<IconPlus size={16} />} onClick={() => setCreateDeliveryOpen(true)}>
                    Record Delivery
                  </Button>
                </Group>
                {(deliveriesQuery.data?.deliveries ?? []).map((delivery) => (
                  <Card key={delivery.id} withBorder>
                    <Group justify="space-between">
                      <div>
                        <Text fw={700}>{delivery.supplierName ?? "Unknown Supplier"}</Text>
                        <Text size="sm" c="dimmed">
                          {dayjs(delivery.deliveredAt).format("YYYY-MM-DD HH:mm")} | Invoice: {delivery.invoiceRef ?? "-"}
                        </Text>
                      </div>
                      <Badge>{delivery.totalItems} items</Badge>
                    </Group>
                    <Table mt="sm" withTableBorder>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Ingredient</Table.Th>
                          <Table.Th>Product</Table.Th>
                          <Table.Th>Purchased</Table.Th>
                          <Table.Th>Qty</Table.Th>
                          <Table.Th>Unit Cost</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {delivery.items.map((item) => (
                          <Table.Tr key={item.id}>
                            <Table.Td>{item.ingredientName ?? "-"}</Table.Td>
                            <Table.Td>{item.variantName ?? item.packageLabel ?? "-"}</Table.Td>
                            <Table.Td>{item.purchaseUnits == null ? "-" : item.purchaseUnits.toFixed(3)}</Table.Td>
                            <Table.Td>{item.quantity} {item.baseUnit ?? ""}</Table.Td>
                            <Table.Td>{item.unitCost == null ? "-" : item.unitCost.toFixed(4)}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Card>
                ))}
              </Stack>
            </Paper>
          </Tabs.Panel>

          <Tabs.Panel value="overview" pt="md">
            <Grid>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Paper withBorder p="md">
                  <Stack>
                    <Title order={5}>Top Drinks</Title>
                    <Table withTableBorder withColumnBorders>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Drink</Table.Th>
                          <Table.Th>Servings</Table.Th>
                          <Table.Th>Issues</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {(overviewQuery.data?.topDrinks ?? []).map((drink) => (
                          <Table.Tr key={drink.recipeId}>
                            <Table.Td>{drink.recipeName}</Table.Td>
                            <Table.Td>{drink.servings}</Table.Td>
                            <Table.Td>{drink.issues}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Stack>
                </Paper>
              </Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>
                <Paper withBorder p="md">
                  <Stack>
                    <Title order={5}>Ingredient Consumption</Title>
                    <Table withTableBorder withColumnBorders>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Ingredient</Table.Th>
                          <Table.Th>Used</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {(overviewQuery.data?.ingredientUsage ?? []).map((usage) => (
                          <Table.Tr key={usage.ingredientId}>
                            <Table.Td>{usage.ingredientName}</Table.Td>
                            <Table.Td>{usage.usedQuantity.toFixed(2)} {usage.baseUnit}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Stack>
                </Paper>
              </Grid.Col>
              <Grid.Col span={{ base: 12 }}>
                <Paper withBorder p="md">
                  <Stack>
                    <Title order={5}>Procurement Plan (To Par)</Title>
                    <Table withTableBorder withColumnBorders>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>Ingredient</Table.Th>
                          <Table.Th>Needed To Par</Table.Th>
                          <Table.Th>Recommended Product</Table.Th>
                          <Table.Th>Suggested Units</Table.Th>
                          <Table.Th>Coverage</Table.Th>
                          <Table.Th>Est. Value</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {procurementPlan.length === 0 ? (
                          <Table.Tr>
                            <Table.Td colSpan={6}>
                              <Text size="sm" c="dimmed">No procurement needed. All active ingredients are at/above par.</Text>
                            </Table.Td>
                          </Table.Tr>
                        ) : (
                          procurementPlan.map((line) => (
                            <Table.Tr key={`procurement-${line.ingredientId}`}>
                              <Table.Td>{line.ingredientName}</Table.Td>
                              <Table.Td>{line.neededToPar.toFixed(3)} {line.baseUnit}</Table.Td>
                              <Table.Td>{line.recommendation?.variantLabel ?? "No active product variant"}</Table.Td>
                              <Table.Td>{line.recommendation?.recommendedUnits ?? "-"}</Table.Td>
                              <Table.Td>
                                {line.recommendation ? `${line.recommendation.coverage.toFixed(3)} ${line.baseUnit}` : "-"}
                              </Table.Td>
                              <Table.Td>{line.estimatedValue == null ? "-" : line.estimatedValue.toFixed(2)}</Table.Td>
                            </Table.Tr>
                          ))
                        )}
                      </Table.Tbody>
                    </Table>
                  </Stack>
                </Paper>
              </Grid.Col>
            </Grid>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </PageAccessGuard>
  );
};

export default OpenBarControl;
