export type ServerResponse<T extends Record<string, any>> = [{
    data: T[];
    columns: any;
}];