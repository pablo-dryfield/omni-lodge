import { useQuery } from "@tanstack/react-query";
import axiosInstance from "../utils/axiosInstance";

export type CerebroSection = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  sortOrder: number;
  status: boolean;
};

export type CerebroMediaItem = {
  type: "image" | "gif";
  url: string;
  caption?: string | null;
  alt?: string | null;
};

export type CerebroEntry = {
  id: number;
  sectionId: number;
  slug: string;
  title: string;
  category: string | null;
  kind: "faq" | "tutorial" | "playbook" | "policy";
  summary: string | null;
  body: string;
  media: CerebroMediaItem[];
  checklistItems: string[];
  targetUserTypeIds: number[];
  requiresAcknowledgement: boolean;
  policyVersion: string | null;
  estimatedReadMinutes: number | null;
  sortOrder: number;
  status: boolean;
  createdAt: string;
  updatedAt: string | null;
};

export type CerebroQuizQuestionOption = {
  id: string;
  label: string;
};

export type CerebroQuizQuestion = {
  id: string;
  prompt: string;
  options: CerebroQuizQuestionOption[];
  correctOptionId: string;
  explanation?: string | null;
};

export type CerebroQuiz = {
  id: number;
  entryId: number | null;
  slug: string;
  title: string;
  description: string | null;
  targetUserTypeIds: number[];
  passingScore: number;
  questions: CerebroQuizQuestion[];
  sortOrder: number;
  status: boolean;
  createdAt: string;
  updatedAt: string | null;
};

export type CerebroAcknowledgement = {
  id: number;
  entryId: number;
  userId: number;
  acceptedAt: string;
  versionAccepted: string;
};

export type CerebroQuizAttempt = {
  id: number;
  quizId: number;
  userId: number;
  scorePercent: number;
  passed: boolean;
  answers: Record<string, string>;
  resultDetails: Array<Record<string, unknown>>;
  submittedAt: string;
};

export type CerebroUserType = {
  id: number;
  slug: string;
  name: string;
};

export type CerebroBootstrap = {
  canManage: boolean;
  currentUserTypeId: number | null;
  sections: CerebroSection[];
  entries: CerebroEntry[];
  quizzes: CerebroQuiz[];
  acknowledgements: CerebroAcknowledgement[];
  attempts: CerebroQuizAttempt[];
  userTypes: CerebroUserType[];
};

export const useCerebroBootstrap = () =>
  useQuery<CerebroBootstrap>({
    queryKey: ["cerebro", "bootstrap"],
    queryFn: async () => {
      const response = await axiosInstance.get<CerebroBootstrap>("/cerebro/bootstrap", {
        withCredentials: true,
      });
      return response.data;
    },
    staleTime: 30 * 1000,
  });

export const createCerebroSection = async (payload: Record<string, unknown>) => {
  const response = await axiosInstance.post("/cerebro/sections", payload, {
    withCredentials: true,
  });
  return response.data;
};

export const updateCerebroSection = async (sectionId: number, payload: Record<string, unknown>) => {
  const response = await axiosInstance.put(`/cerebro/sections/${sectionId}`, payload, {
    withCredentials: true,
  });
  return response.data;
};

export const createCerebroEntry = async (payload: Record<string, unknown>) => {
  const response = await axiosInstance.post("/cerebro/entries", payload, {
    withCredentials: true,
  });
  return response.data;
};

export const updateCerebroEntry = async (entryId: number, payload: Record<string, unknown>) => {
  const response = await axiosInstance.put(`/cerebro/entries/${entryId}`, payload, {
    withCredentials: true,
  });
  return response.data;
};

export const createCerebroQuiz = async (payload: Record<string, unknown>) => {
  const response = await axiosInstance.post("/cerebro/quizzes", payload, {
    withCredentials: true,
  });
  return response.data;
};

export const updateCerebroQuiz = async (quizId: number, payload: Record<string, unknown>) => {
  const response = await axiosInstance.put(`/cerebro/quizzes/${quizId}`, payload, {
    withCredentials: true,
  });
  return response.data;
};

export const acknowledgeCerebroPolicy = async (entryId: number) => {
  const response = await axiosInstance.post(`/cerebro/entries/${entryId}/acknowledge`, undefined, {
    withCredentials: true,
  });
  return response.data as CerebroAcknowledgement;
};

export const submitCerebroQuiz = async (quizId: number, answers: Record<string, string>) => {
  const response = await axiosInstance.post(
    `/cerebro/quizzes/${quizId}/submit`,
    { answers },
    { withCredentials: true },
  );
  return response.data as {
    id: number;
    quizId: number;
    scorePercent: number;
    passed: boolean;
    correctCount: number;
    totalQuestions: number;
    resultDetails: Array<Record<string, unknown>>;
    submittedAt: string;
  };
};
