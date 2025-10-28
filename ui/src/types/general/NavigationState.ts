export type NavigationIconKey =
  | 'eventAvailable'
  | 'assignmentTurnedIn'
  | 'person'
  | 'settings'
  | 'calendarMonth'
  | 'accountBalance'
  | 'formatListNumbered';

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


