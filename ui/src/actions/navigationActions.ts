import { setCurrentPage, setPages } from '../reducers/navigationReducer';

export const navigateToPage = (page: string) => setCurrentPage(page);
export const changePages = (page: { name: string; path: string; }[]) => setPages(page);
