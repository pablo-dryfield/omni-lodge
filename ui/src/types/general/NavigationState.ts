export type NavigationIconKey =
  | 'eventAvailable'
  | 'assignmentTurnedIn'
  | 'person'
  | 'settings'
  | 'calendarMonth'
  | 'accountBalance'
  | 'formatListNumbered'
  | 'barChart'
  | 'errorOutline'
  | 'star';

export type NavigationPage = {
  name: string;
  path: string;
  icon: NavigationIconKey;
  slug: string;
};

export type NavigationState = {
  currentPage: string;
  pages: NavigationPage[];
};


