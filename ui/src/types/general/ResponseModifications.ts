import { MRT_ColumnDef } from "mantine-react-table"

export type ResponseModifications<T extends Record<string, any>> = {
    accessorKey: string,
    modifications: Partial<MRT_ColumnDef<T>>
}