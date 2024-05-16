export type SessionState = {
    user: string;
    authenticated: boolean;
    checkingSession: boolean;
    loggedUserId: number;
};