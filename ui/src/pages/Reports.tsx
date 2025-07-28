import { useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { navigateToPage } from "../actions/navigationActions";
import { GenericPageProps } from "../types/general/GenericPageProps";
import Overview from "../components/reports/Overview";
import GoogleReviews from "../components/reports/GoogleReviews";

const Reports = (props: GenericPageProps) => {
  const dispatch = useAppDispatch();
  const activeKey = useAppSelector((state) => state.reportsNavBarActiveKey);
  
  useEffect(() => {
    dispatch(navigateToPage("Reports"));
  }, [dispatch, props.title]);
  
  if (activeKey === "Overview") {
    return <Overview />
  }else if (activeKey === "GoogleReviews") {
    return <GoogleReviews />
  }else {
    return <div>Nothing here yet, in Development!</div>
  }
};

export default Reports;
