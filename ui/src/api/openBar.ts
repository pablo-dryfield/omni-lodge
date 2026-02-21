import { useMutation, useQuery } from "@tanstack/react-query";
import type { AxiosError } from "axios";
import axiosInstance from "../utils/axiosInstance";

export type OpenBarDrinkLabelDisplayMode = "recipe_name" | "recipe_with_ingredients" | "ingredients_only";

export type OpenBarIngredient = {
  id: number;
  name: string;
  categoryId: number;
  categorySlug: string | null;
  categoryName: string | null;
  baseUnit: "ml" | "unit";
  parLevel: number;
  reorderLevel: number;
  costPerUnit: number | null;
  currentStock: number;
  neededToPar: number;
  belowReorder: boolean;
  isActive: boolean;
  isCup: boolean;
  cupType: "disposable" | "reusable" | null;
  cupCapacityMl: number | null;
  isIce: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OpenBarIngredientCategory = {
  id: number;
  name: string;
  slug: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
};

export type OpenBarIngredientVariant = {
  id: number;
  ingredientId: number;
  ingredientName: string | null;
  ingredientBaseUnit: "ml" | "unit" | null;
  name: string;
  brand: string | null;
  packageLabel: string | null;
  baseQuantity: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
};

export type OpenBarRecipeIngredientLine = {
  id: number;
  lineType: "fixed_ingredient" | "category_selector";
  ingredientId: number | null;
  ingredientName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  categorySlug: string | null;
  baseUnit: "ml" | "unit" | null;
  quantity: number;
  sortOrder: number;
  isOptional: boolean;
  affectsStrength: boolean;
  isTopUp: boolean;
  unitCost: number | null;
  estimatedCost: number;
};

export type OpenBarRecipe = {
  id: number;
  name: string;
  drinkType: "classic" | "cocktail" | "beer" | "soft" | "custom";
  labelDisplayMode: OpenBarDrinkLabelDisplayMode | null;
  defaultServings: number;
  instructions: string | null;
  isActive: boolean;
  askStrength: boolean;
  hasIce: boolean;
  iceCubes: number;
  iceDisplacementMl: number;
  availableLiquidCapacityMl: number | null;
  cupIngredientId: number | null;
  cupIngredientName: string | null;
  cupType: "disposable" | "reusable" | null;
  cupCapacityMl: number | null;
  estimatedCostPerServing: number;
  ingredients: OpenBarRecipeIngredientLine[];
  createdAt: string;
  updatedAt: string;
};

export type OpenBarSession = {
  id: number;
  sessionName: string;
  businessDate: string;
  venueId: number | null;
  venueName: string | null;
  nightReportId: number | null;
  sessionTypeId: number | null;
  sessionTypeName: string | null;
  sessionTypeSlug: string | null;
  timeLimitMinutes: number | null;
  expectedEndAt: string | null;
  status: "draft" | "active" | "closed";
  openedAt: string | null;
  closedAt: string | null;
  notes: string | null;
  createdBy: number | null;
  createdByName: string | null;
  issuesCount: number;
  servingsIssued: number;
  lastIssuedAt: string | null;
  isOwnedByCurrentUser?: boolean;
  isJoinedByCurrentUser?: boolean;
  isCurrentUserActiveSession?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type OpenBarSessionReconciliation = {
  ingredientId: number;
  ingredientName: string | null;
  baseUnit: "ml" | "unit" | null;
  systemStock: number;
  countedStock: number;
  quantityDelta: number;
};

export type OpenBarVenue = {
  id: number;
  name: string;
  isActive?: boolean;
  allowsOpenBar?: boolean;
  sortOrder?: number;
};

export type OpenBarSessionType = {
  id: number;
  name: string;
  slug: string;
  defaultTimeLimitMinutes: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string | null;
};

export type OpenBarIssue = {
  id: number;
  sessionId: number;
  recipeId: number;
  recipeName: string | null;
  displayName: string | null;
  drinkType: "classic" | "cocktail" | "beer" | "soft" | "custom" | null;
  servings: number;
  issuedAt: string;
  orderRef: string | null;
  notes: string | null;
  isStaffDrink: boolean;
  issuedBy: number | null;
  issuedByName: string | null;
  sessionName?: string | null;
  businessDate?: string | null;
};

export type OpenBarDeliveryItem = {
  id: number;
  ingredientId: number;
  ingredientName: string | null;
  baseUnit: "ml" | "unit" | null;
  variantId: number | null;
  variantName: string | null;
  variantBrand: string | null;
  packageLabel: string | null;
  purchaseUnits: number | null;
  purchaseUnitCost: number | null;
  quantity: number;
  unitCost: number | null;
};

export type OpenBarDelivery = {
  id: number;
  supplierName: string | null;
  invoiceRef: string | null;
  deliveredAt: string;
  notes: string | null;
  receivedBy: number | null;
  receivedByName: string | null;
  totalItems: number;
  totalQuantity: number;
  items: OpenBarDeliveryItem[];
};

export type OpenBarOverview = {
  businessDate: string;
  activeSession: {
    id: number;
    sessionName: string;
    status: "draft" | "active" | "closed";
    venueId: number | null;
    venueName: string | null;
    openedAt: string | null;
    sessionTypeId: number | null;
    sessionTypeName: string | null;
    sessionTypeSlug: string | null;
    timeLimitMinutes: number | null;
  } | null;
  totals: {
    sessions: number;
    issuesCount: number;
    totalServings: number;
    deliveriesCount: number;
    activeIngredients: number;
    lowStockCount: number;
    estimatedCost: number;
  };
  topDrinks: Array<{
    recipeId: number;
    recipeName: string;
    drinkType: string;
    servings: number;
    issues: number;
  }>;
  ingredientUsage: Array<{
    ingredientId: number;
    ingredientName: string;
    baseUnit: string;
    usedQuantity: number;
  }>;
  lowStock: OpenBarIngredient[];
  recentIssues: OpenBarIssue[];
};

export type OpenBarDrinkLabelSetting = {
  drinkType: OpenBarRecipe["drinkType"];
  displayMode: OpenBarDrinkLabelDisplayMode;
};

export type OpenBarBootstrap = {
  businessDate: string;
  overview: OpenBarOverview;
  ingredients: OpenBarIngredient[];
  ingredientCategories: OpenBarIngredientCategory[];
  ingredientVariants: OpenBarIngredientVariant[];
  recipes: OpenBarRecipe[];
  drinkLabelSettings: OpenBarDrinkLabelSetting[];
  sessionTypes: OpenBarSessionType[];
  sessionTypesCatalog: OpenBarSessionType[];
  sessions: OpenBarSession[];
  joinableSessions: OpenBarSession[];
  currentUserSession: OpenBarSession | null;
  venues: OpenBarVenue[];
  sessionIssues: OpenBarIssue[];
  deliveries: OpenBarDelivery[];
};

export const useOpenBarBootstrap = (params: { businessDate: string; sessionLimit?: number; deliveryLimit?: number; sessionIssueLimit?: number }) =>
  useQuery<OpenBarBootstrap>({
    queryKey: [
      "open-bar",
      "bootstrap",
      params.businessDate,
      params.sessionLimit ?? 60,
      params.deliveryLimit ?? 100,
      params.sessionIssueLimit ?? 300,
    ],
    queryFn: async () => {
      const response = await axiosInstance.get("/openBar/bootstrap", { params });
      return response.data as OpenBarBootstrap;
    },
  });

export const useOpenBarOverview = (businessDate: string) =>
  useQuery<OpenBarOverview>({
    queryKey: ["open-bar", "overview", businessDate],
    queryFn: async () => {
      const response = await axiosInstance.get("/openBar/overview", {
        params: { businessDate },
      });
      return response.data as OpenBarOverview;
    },
  });

export const useOpenBarIngredients = (includeInactive = false) =>
  useQuery<{ ingredients: OpenBarIngredient[] }>({
    queryKey: ["open-bar", "ingredients", includeInactive ? "all" : "active"],
    queryFn: async () => {
      const response = await axiosInstance.get("/openBar/ingredients", {
        params: includeInactive ? { includeInactive: true } : undefined,
      });
      return response.data as { ingredients: OpenBarIngredient[] };
    },
  });

export const useCreateOpenBarIngredient = () =>
  useMutation<
    { ingredient: OpenBarIngredient },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      name: string;
      categoryId?: number;
      baseUnit?: OpenBarIngredient["baseUnit"];
      parLevel?: number;
      reorderLevel?: number;
      costPerUnit?: number | null;
      isCup?: boolean;
      cupType?: "disposable" | "reusable" | null;
      cupCapacityMl?: number | null;
      isIce?: boolean;
      isActive?: boolean;
    }
  >({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post("/openBar/ingredients", payload);
      return response.data as { ingredient: OpenBarIngredient };
    },
  });

export const useUpdateOpenBarIngredient = () =>
  useMutation<
    { ingredient: OpenBarIngredient } | { message: string },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      id: number;
      payload: Partial<{
        name: string;
        categoryId: number;
        baseUnit: OpenBarIngredient["baseUnit"];
        parLevel: number;
        reorderLevel: number;
        costPerUnit: number | null;
        unitConversionFactor: number;
        isCup: boolean;
        cupType: "disposable" | "reusable" | null;
        cupCapacityMl: number | null;
        isIce: boolean;
        isActive: boolean;
      }>;
    }
  >({
    mutationFn: async ({ id, payload }) => {
      const response = await axiosInstance.patch(`/openBar/ingredients/${id}`, payload);
      return response.data as { ingredient: OpenBarIngredient } | { message: string };
    },
  });

export const useOpenBarIngredientCategories = (includeInactive = false) =>
  useQuery<{ categories: OpenBarIngredientCategory[] }>({
    queryKey: ["open-bar", "ingredient-categories", includeInactive ? "all" : "active"],
    queryFn: async () => {
      const response = await axiosInstance.get("/openBar/ingredient-categories", {
        params: includeInactive ? { includeInactive: true } : undefined,
      });
      return response.data as { categories: OpenBarIngredientCategory[] };
    },
  });

export const useCreateOpenBarIngredientCategory = () =>
  useMutation<
    { category: OpenBarIngredientCategory },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      name: string;
      slug?: string;
      sortOrder?: number;
      isActive?: boolean;
    }
  >({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post("/openBar/ingredient-categories", payload);
      return response.data as { category: OpenBarIngredientCategory };
    },
  });

export const useUpdateOpenBarIngredientCategory = () =>
  useMutation<
    { category: OpenBarIngredientCategory } | { message: string },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      id: number;
      payload: Partial<{
        name: string;
        slug: string;
        sortOrder: number;
        isActive: boolean;
      }>;
    }
  >({
    mutationFn: async ({ id, payload }) => {
      const response = await axiosInstance.patch(`/openBar/ingredient-categories/${id}`, payload);
      return response.data as { category: OpenBarIngredientCategory } | { message: string };
    },
  });

export const useOpenBarIngredientVariants = (params?: { includeInactive?: boolean; ingredientId?: number }) =>
  useQuery<{ variants: OpenBarIngredientVariant[] }>({
    queryKey: [
      "open-bar",
      "ingredient-variants",
      params?.includeInactive ? "all" : "active",
      params?.ingredientId ?? "all-ingredients",
    ],
    queryFn: async () => {
      const response = await axiosInstance.get("/openBar/ingredient-variants", {
        params: {
          ...(params?.includeInactive ? { includeInactive: true } : {}),
          ...(params?.ingredientId ? { ingredientId: params.ingredientId } : {}),
        },
      });
      return response.data as { variants: OpenBarIngredientVariant[] };
    },
  });

export const useCreateOpenBarIngredientVariant = () =>
  useMutation<
    { variant: OpenBarIngredientVariant },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      ingredientId: number;
      name: string;
      brand?: string | null;
      packageLabel?: string | null;
      baseQuantity: number;
      isActive?: boolean;
    }
  >({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post("/openBar/ingredient-variants", payload);
      return response.data as { variant: OpenBarIngredientVariant };
    },
  });

export const useUpdateOpenBarIngredientVariant = () =>
  useMutation<
    { variant: OpenBarIngredientVariant } | { message: string },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      id: number;
      payload: Partial<{
        ingredientId: number;
        name: string;
        brand: string | null;
        packageLabel: string | null;
        baseQuantity: number;
        isActive: boolean;
      }>;
    }
  >({
    mutationFn: async ({ id, payload }) => {
      const response = await axiosInstance.patch(`/openBar/ingredient-variants/${id}`, payload);
      return response.data as { variant: OpenBarIngredientVariant } | { message: string };
    },
  });

export const useOpenBarRecipes = () =>
  useQuery<{ recipes: OpenBarRecipe[] }>({
    queryKey: ["open-bar", "recipes"],
    queryFn: async () => {
      const response = await axiosInstance.get("/openBar/recipes");
      return response.data as { recipes: OpenBarRecipe[] };
    },
  });

export const useCreateOpenBarRecipe = () =>
  useMutation<
    { recipe: OpenBarRecipe | null },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      name: string;
      drinkType?: OpenBarRecipe["drinkType"];
      defaultServings?: number;
      labelDisplayMode?: OpenBarDrinkLabelDisplayMode | null;
      instructions?: string | null;
      isActive?: boolean;
      askStrength?: boolean;
      hasIce?: boolean;
      iceCubes?: number;
      cupIngredientId?: number | null;
      ingredients?: Array<{
        lineType?: OpenBarRecipeIngredientLine["lineType"];
        ingredientId?: number;
        categoryId?: number;
        quantity: number;
        sortOrder?: number;
        isOptional?: boolean;
        affectsStrength?: boolean;
        isTopUp?: boolean;
      }>;
    }
  >({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post("/openBar/recipes", payload);
      return response.data as { recipe: OpenBarRecipe | null };
    },
  });

export const useUpdateOpenBarRecipe = () =>
  useMutation<
    { recipe: OpenBarRecipe | null } | { message: string },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      id: number;
      payload: Partial<{
        name: string;
        drinkType: OpenBarRecipe["drinkType"];
        defaultServings: number;
        labelDisplayMode: OpenBarDrinkLabelDisplayMode | null;
        instructions: string | null;
        isActive: boolean;
        askStrength: boolean;
        hasIce: boolean;
        iceCubes: number;
        cupIngredientId: number | null;
      }>;
    }
  >({
    mutationFn: async ({ id, payload }) => {
      const response = await axiosInstance.patch(`/openBar/recipes/${id}`, payload);
      return response.data as { recipe: OpenBarRecipe | null } | { message: string };
    },
  });

export const useReplaceOpenBarRecipeIngredients = () =>
  useMutation<
    { recipe: OpenBarRecipe | null },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      id: number;
      ingredients: Array<{
        lineType?: OpenBarRecipeIngredientLine["lineType"];
        ingredientId?: number;
        categoryId?: number;
        quantity: number;
        sortOrder?: number;
        isOptional?: boolean;
        affectsStrength?: boolean;
        isTopUp?: boolean;
      }>;
    }
  >({
    mutationFn: async ({ id, ingredients }) => {
      const response = await axiosInstance.put(`/openBar/recipes/${id}/ingredients`, { ingredients });
      return response.data as { recipe: OpenBarRecipe | null };
    },
  });

export const useOpenBarSessions = (params?: {
  businessDate?: string;
  status?: OpenBarSession["status"];
  limit?: number;
}) =>
  useQuery<{ sessions: OpenBarSession[]; joinableSessions?: OpenBarSession[]; currentUserSessionId?: number | null }>({
    queryKey: ["open-bar", "sessions", params?.businessDate ?? "all", params?.status ?? "all", params?.limit ?? 30],
    queryFn: async () => {
      const response = await axiosInstance.get("/openBar/sessions", { params });
      return response.data as { sessions: OpenBarSession[]; joinableSessions?: OpenBarSession[]; currentUserSessionId?: number | null };
    },
  });

export const useOpenBarSessionTypes = (includeInactive = false) =>
  useQuery<{ sessionTypes: OpenBarSessionType[] }>({
    queryKey: ["open-bar", "session-types", includeInactive ? "all" : "active"],
    queryFn: async () => {
      const response = await axiosInstance.get("/openBar/session-types", {
        params: includeInactive ? { includeInactive: true } : undefined,
      });
      return response.data as { sessionTypes: OpenBarSessionType[] };
    },
  });

export const useCreateOpenBarSessionType = () =>
  useMutation<
    { sessionType: OpenBarSessionType },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      name: string;
      slug?: string;
      defaultTimeLimitMinutes?: number;
      sortOrder?: number;
      isActive?: boolean;
    }
  >({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post("/openBar/session-types", payload);
      return response.data as { sessionType: OpenBarSessionType };
    },
  });

export const useUpdateOpenBarSessionType = () =>
  useMutation<
    { sessionType: OpenBarSessionType } | { message: string },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      id: number;
      payload: Partial<{
        name: string;
        slug: string;
        defaultTimeLimitMinutes: number;
        sortOrder: number;
        isActive: boolean;
      }>;
    }
  >({
    mutationFn: async ({ id, payload }) => {
      const response = await axiosInstance.patch(`/openBar/session-types/${id}`, payload);
      return response.data as { sessionType: OpenBarSessionType } | { message: string };
    },
  });

export const useOpenBarVenues = (params?: { activeOnly?: boolean; openBarOnly?: boolean }) =>
  useQuery<{ venues: OpenBarVenue[] }>({
    queryKey: [
      "open-bar",
      "venues",
      params?.activeOnly ? "active" : "all",
      params?.openBarOnly ? "open-bar-only" : "all-venues",
    ],
    queryFn: async () => {
      const response = await axiosInstance.get("/venues", {
        params: {
          ...(params?.activeOnly ? { active: true } : {}),
          ...(params?.openBarOnly ? { openBar: true } : {}),
        },
      });

      const payload = response.data as unknown;
      const venuesRaw =
        Array.isArray(payload) &&
        payload.length > 0 &&
        typeof payload[0] === "object" &&
        payload[0] !== null &&
        Array.isArray((payload[0] as { data?: unknown[] }).data)
          ? ((payload[0] as { data: unknown[] }).data ?? [])
          : Array.isArray(payload)
          ? payload
          : Array.isArray((payload as { data?: unknown[] })?.data)
          ? ((payload as { data: unknown[] }).data ?? [])
          : [];

      const venues = (venuesRaw as OpenBarVenue[]).filter(
        (venue) =>
          venue &&
          typeof venue.id === "number" &&
          Number.isFinite(venue.id) &&
          typeof venue.name === "string" &&
          venue.name.trim().length > 0 &&
          (!params?.openBarOnly || venue.allowsOpenBar === true),
      );

      return { venues };
    },
  });

export const useCreateOpenBarSession = () =>
  useMutation<
    { session: OpenBarSession },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      sessionName: string;
      businessDate?: string;
      venueId?: number | null;
      nightReportId?: number | null;
      sessionTypeId?: number | null;
      timeLimitMinutes?: number | null;
      status?: OpenBarSession["status"];
      notes?: string | null;
    }
  >({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post("/openBar/sessions", payload);
      return response.data as { session: OpenBarSession };
    },
  });

export const useStartOpenBarSession = () =>
  useMutation<
    { session: OpenBarSession },
    AxiosError<{ message?: string; details?: unknown }>,
    number
  >({
    mutationFn: async (id) => {
      const response = await axiosInstance.post(`/openBar/sessions/${id}/start`, {});
      return response.data as { session: OpenBarSession };
    },
  });

export const useJoinOpenBarSession = () =>
  useMutation<
    { session: OpenBarSession; joined: boolean },
    AxiosError<{ message?: string; details?: unknown }>,
    number
  >({
    mutationFn: async (id) => {
      const response = await axiosInstance.post(`/openBar/sessions/${id}/join`, {});
      return response.data as { session: OpenBarSession; joined: boolean };
    },
  });

export const useLeaveOpenBarSession = () =>
  useMutation<
    { session: OpenBarSession; left: boolean },
    AxiosError<{ message?: string; details?: unknown }>,
    number
  >({
    mutationFn: async (id) => {
      const response = await axiosInstance.post(`/openBar/sessions/${id}/leave`, {});
      return response.data as { session: OpenBarSession; left: boolean };
    },
  });

export const useCloseOpenBarSession = () =>
  useMutation<
    { session: OpenBarSession; reconciliation?: OpenBarSessionReconciliation[] },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      id: number;
      payload?: {
        reconciliation?: Array<{
          ingredientId: number;
          countedStock: number;
        }>;
      };
    }
  >({
    mutationFn: async ({ id, payload }) => {
      const response = await axiosInstance.post(`/openBar/sessions/${id}/close`, payload ?? {});
      return response.data as { session: OpenBarSession; reconciliation?: OpenBarSessionReconciliation[] };
    },
  });

export const useDeleteOpenBarSession = () =>
  useMutation<
    { id: number; deleted: true; deletedIssues?: number; deletedMovements?: number },
    AxiosError<{ message?: string; details?: unknown }>,
    number
  >({
    mutationFn: async (id) => {
      const response = await axiosInstance.delete(`/openBar/sessions/${id}`);
      return response.data as { id: number; deleted: true; deletedIssues?: number; deletedMovements?: number };
    },
  });

export const useOpenBarDrinkIssues = (params?: {
  sessionId?: number;
  businessDate?: string;
  limit?: number;
}) =>
  useQuery<{ issues: OpenBarIssue[] }>({
    queryKey: ["open-bar", "issues", params?.sessionId ?? "all", params?.businessDate ?? "all", params?.limit ?? 200],
    queryFn: async () => {
      const response = await axiosInstance.get("/openBar/drink-issues", { params });
      return response.data as { issues: OpenBarIssue[] };
    },
  });

export const useOpenBarDrinkLabelSettings = () =>
  useQuery<{ settings: OpenBarDrinkLabelSetting[] }>({
    queryKey: ["open-bar", "drink-label-settings"],
    queryFn: async () => {
      const response = await axiosInstance.get("/openBar/drink-label-settings");
      return response.data as { settings: OpenBarDrinkLabelSetting[] };
    },
  });

export const useUpdateOpenBarDrinkLabelSettings = () =>
  useMutation<
    { settings: OpenBarDrinkLabelSetting[] },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      settings: OpenBarDrinkLabelSetting[];
    }
  >({
    mutationFn: async (payload) => {
      const response = await axiosInstance.put("/openBar/drink-label-settings", payload);
      return response.data as { settings: OpenBarDrinkLabelSetting[] };
    },
  });

export const useCreateOpenBarDrinkIssue = () =>
  useMutation<
    { issue: OpenBarIssue | null },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      sessionId: number;
      recipeId: number;
      servings?: number;
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
    }
  >({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post("/openBar/drink-issues", payload);
      return response.data as { issue: OpenBarIssue | null };
    },
  });

export const useDeleteOpenBarDrinkIssue = () =>
  useMutation<
    { id: number; deleted: true },
    AxiosError<{ message?: string; details?: unknown }>,
    number
  >({
    mutationFn: async (id) => {
      const response = await axiosInstance.delete(`/openBar/drink-issues/${id}`);
      return response.data as { id: number; deleted: true };
    },
  });

export const useOpenBarDeliveries = (params?: { businessDate?: string; limit?: number }) =>
  useQuery<{ deliveries: OpenBarDelivery[] }>({
    queryKey: ["open-bar", "deliveries", params?.businessDate ?? "all", params?.limit ?? 100],
    queryFn: async () => {
      const response = await axiosInstance.get("/openBar/deliveries", { params });
      return response.data as { deliveries: OpenBarDelivery[] };
    },
  });

export const useCreateOpenBarDelivery = () =>
  useMutation<
    { delivery: OpenBarDelivery | null },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      supplierName?: string | null;
      invoiceRef?: string | null;
      deliveredAt?: string;
      notes?: string | null;
      receivedBy?: number | null;
      items: Array<{
        ingredientId?: number;
        quantity?: number;
        unitCost?: number | null;
        variantId?: number;
        purchaseUnits?: number;
        purchaseUnitCost?: number | null;
      }>;
    }
  >({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post("/openBar/deliveries", payload);
      return response.data as { delivery: OpenBarDelivery | null };
    },
  });

export const useCreateOpenBarInventoryAdjustment = () =>
  useMutation<
    {
      movement: {
        id: number;
        ingredientId: number;
        ingredientName: string;
        movementType: "adjustment" | "waste" | "correction";
        quantityDelta: number;
        occurredAt: string;
        note: string | null;
      };
      stock: { currentStock: number };
    },
    AxiosError<{ message?: string; details?: unknown }>,
    {
      ingredientId: number;
      movementType: "adjustment" | "waste" | "correction";
      quantityDelta: number;
      occurredAt?: string;
      note?: string | null;
    }
  >({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post("/openBar/inventory-adjustments", payload);
      return response.data as {
        movement: {
          id: number;
          ingredientId: number;
          ingredientName: string;
          movementType: "adjustment" | "waste" | "correction";
          quantityDelta: number;
          occurredAt: string;
          note: string | null;
        };
        stock: { currentStock: number };
      };
    },
  });
