import { setCurrentPage, setPages } from "../reducers/navigationReducer";
import { NavigationPage } from "../types/general/NavigationState";

export const navigateToPage = (page: string) => setCurrentPage(page);
export const changePages = (pages: NavigationPage[]) => setPages(pages);
