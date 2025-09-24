export type User = {
  id: number;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  userTypeId?: number;
  createdAt: Date;
  updatedAt: Date;
  createdBy: number;
  updatedBy: number;
  status: boolean;
};