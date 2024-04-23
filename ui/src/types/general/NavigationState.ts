export type NavigationState = {
    currentPage: string;
    pages: { name: string; path: string; icon: JSX.Element }[]
};