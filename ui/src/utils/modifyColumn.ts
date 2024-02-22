import { MRT_ColumnDef } from "mantine-react-table";
import { ResponseModifications } from "../types/general/ResponseModifications";

export const modifyColumn = <T extends Record<string, any>>(
    columns: MRT_ColumnDef<T>[],
    modifications: ResponseModifications<T>[]
): MRT_ColumnDef<T>[] => {
    return columns.map((column) => {
        const modification = modifications.find(m => m.accessorKey === column.accessorKey);
        if (modification) {
            return { ...column, ...modification.modifications };
        }
        return column;
    });
}