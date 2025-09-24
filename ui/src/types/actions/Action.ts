export type Action = {
  id: number;
  key: string;
  name: string;
  description?: string | null;
  isAssignable: boolean;
  status: boolean;
  createdAt: string;
  updatedAt: string;
};
