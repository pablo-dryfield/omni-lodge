export type TableActions = {
    [actionName: string]: (...args: any[]) => void;
}