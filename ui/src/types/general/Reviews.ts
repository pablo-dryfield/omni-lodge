import { Reviewer } from "./Reviewer";

export type Review = {
  comment: string;
  updateTime: string;
  createTime: string;
  reviewId: string;
  starRating: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE";
  reviewer: Reviewer;
}