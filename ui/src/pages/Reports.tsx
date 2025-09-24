import { useEffect, type ReactNode } from "react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { navigateToPage } from "../actions/navigationActions";
import { GenericPageProps } from "../types/general/GenericPageProps";
import Overview from "../components/reports/Overview";
import GoogleReviews from "../components/reports/GoogleReviews";
import { PageAccessGuard } from "../components/access/PageAccessGuard";
import { PAGE_SLUGS } from "../constants/pageSlugs";

const PAGE_SLUG = PAGE_SLUGS.reports;

const Reports = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const activeKey = useAppSelector((state) => state.reportsNavBarActiveKey);

  useEffect(() => {
    dispatch(navigateToPage("Reports"));
  }, [dispatch, props.title]);

  let content: ReactNode;
  if (activeKey === "Overview") {
    content = <Overview />;
  } else if (activeKey === "GoogleReviews") {
    content = <GoogleReviews />;
  } else {
    content = <div>Nothing here yet, in Development!</div>;
  }

  return <PageAccessGuard pageSlug={PAGE_SLUG}>{content}</PageAccessGuard>;
};

export default Reports;