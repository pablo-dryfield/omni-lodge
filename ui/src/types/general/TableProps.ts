import { MRT_ColumnDef, MRT_TableState } from "mantine-react-table";
import { TableActions } from "./TableActions";

export type TableProps<T extends Record<string, any>> = {
    pageTitle: string
    data: T[];
    loading: boolean;
    error: string | null;
    columns: MRT_ColumnDef<T>[];
    actions: TableActions;
    initialState: Partial<MRT_TableState<T>>;
}