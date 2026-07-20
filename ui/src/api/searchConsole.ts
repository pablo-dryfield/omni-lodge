import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";

export type SearchConsoleSite = {
  siteUrl: string;
  permissionLevel: string;
};

export type SearchConsolePerformanceRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export type SearchConsolePerformanceResult = {
  rows: SearchConsolePerformanceRow[];
  startDate: string;
  endDate: string;
  dimensions: string[];
};

export type SearchConsoleUrlInspectionResult = {
  inspectionUrl: string;
  siteUrl: string;
  verdict: string | null;
  coverageState: string | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  lastCrawlTime: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  sitemap: string[];
  referringUrls: string[];
};

export type SeoActionLog = {
  id: number;
  siteUrl: string;
  actionType: string;
  title: string;
  details: string | null;
  targetQuery: string | null;
  targetPage: string | null;
  createdBy: number | null;
  createdAt: string;
};

export type SerpResultItem = {
  position: number | null;
  title: string | null;
  link: string | null;
  displayedLink: string | null;
  snippet: string | null;
  source: string | null;
  rating: number | null;
  reviews: number | null;
  type: string | null;
  isTargetDomain: boolean;
};

export type SerpAnalysisResult = {
  provider: "serpapi";
  keyword: string;
  targetDomain: string;
  location: string;
  country: string;
  language: string;
  googleDomain: string;
  searchedAt: string;
  searchUrl: string | null;
  ads: SerpResultItem[];
  localResults: SerpResultItem[];
  organicResults: SerpResultItem[];
  targetResults: SerpResultItem[];
  features: {
    hasAds: boolean;
    hasLocalPack: boolean;
    hasPlacesSites: boolean;
    hasKnowledgeGraph: boolean;
    hasRelatedQuestions: boolean;
    organicResultCount: number;
  };
  summary: {
    topOrganicPosition: number | null;
    topLocalPosition: number | null;
    topAdPosition: number | null;
    aboveTheFoldPressure: "High" | "Medium" | "Low";
    diagnosis: string[];
  };
};

export const useSearchConsoleSites = () =>
  useQuery<SearchConsoleSite[], unknown>({
    queryKey: ["search-console", "sites"],
    queryFn: async () => {
      const response = await axiosInstance.get("/search-console/sites");
      return (response.data?.sites ?? []) as SearchConsoleSite[];
    },
  });

export const useSearchConsolePerformance = (params: {
  siteUrl: string | null;
  startDate: string;
  endDate: string;
  dimensions: string[];
}) =>
  useQuery<SearchConsolePerformanceResult, unknown>({
    queryKey: ["search-console", "performance", params],
    queryFn: async () => {
      const response = await axiosInstance.get("/search-console/performance", {
        params: {
          siteUrl: params.siteUrl,
          startDate: params.startDate,
          endDate: params.endDate,
          dimensions: params.dimensions.join(","),
          rowLimit: 100,
        },
      });
      return response.data as SearchConsolePerformanceResult;
    },
    enabled: Boolean(params.siteUrl),
  });

export const useInspectSearchConsoleUrl = () =>
  useMutation<SearchConsoleUrlInspectionResult, unknown, { siteUrl: string; inspectionUrl: string }>({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post("/search-console/inspect-url", payload);
      return response.data.result as SearchConsoleUrlInspectionResult;
    },
  });

export const useSeoActionLogs = (siteUrl: string | null) =>
  useQuery<SeoActionLog[], unknown>({
    queryKey: ["search-console", "actions", siteUrl],
    queryFn: async () => {
      const response = await axiosInstance.get("/search-console/actions", {
        params: { siteUrl, limit: 25 },
      });
      return (response.data?.actions ?? []) as SeoActionLog[];
    },
    enabled: Boolean(siteUrl),
  });

export const useCreateSeoActionLog = () => {
  const queryClient = useQueryClient();
  return useMutation<
    SeoActionLog,
    unknown,
    {
      siteUrl: string;
      actionType: string;
      title: string;
      details?: string | null;
      targetQuery?: string | null;
      targetPage?: string | null;
    }
  >({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post("/search-console/actions", payload);
      return response.data.action as SeoActionLog;
    },
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({ queryKey: ["search-console", "actions", variables.siteUrl] });
    },
  });
};

export const useAnalyzeGoogleSerp = () =>
  useMutation<
    SerpAnalysisResult,
    unknown,
    {
      keyword: string;
      targetDomain?: string;
      location?: string;
      country?: string;
      language?: string;
      googleDomain?: string;
    }
  >({
    mutationFn: async (payload) => {
      const response = await axiosInstance.post("/search-console/serp-analysis", payload);
      return response.data.result as SerpAnalysisResult;
    },
  });
