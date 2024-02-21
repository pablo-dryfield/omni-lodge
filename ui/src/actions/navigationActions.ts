import { setCurrentPage } from '../reducers/navigationReducer';

export const navigateToPage = (page: string) => setCurrentPage(page);