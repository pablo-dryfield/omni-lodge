export type SessionState = {
    user: string;
    password: string;
    authenticated: boolean;
    checkingSession: boolean;
};