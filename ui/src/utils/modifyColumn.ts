import { MRT_ColumnDef } from "mantine-react-table";
import { ResponseModifications } from "../types/general/ResponseModifications";

/**
 * Modifies columns definitions for a table based on provided modifications.
 * 
 * This function iterates over the array of column definitions and applies modifications
 * to the columns whose accessor keys match those in the `modifications` array. If a match
 * is found, the modifications are applied; otherwise, the column definition remains unchanged.
 *
 * @template T - The expected record type for the data used in the table columns.
 * @param {MRT_ColumnDef<T>[]} columns - The original array of columns definitions.
 * @param {ResponseModifications<T>[]} modifications - An array of modifications to apply to the columns.
 * @returns {MRT_ColumnDef<T>[]} A new array of column definitions with the modifications applied.
 */

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