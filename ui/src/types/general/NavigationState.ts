export type NavigationPage = {
  name: string;
  path: string;
  icon: JSX.Element;
  slug: string;
};

export type NavigationState = {
  currentPage: string;
  pages: NavigationPage[];
};
