import { MRT_RowData, MRT_Row, useMantineReactTable } from "mantine-react-table";

export type ModalContentProps<T extends MRT_RowData> = {
    internalEditComponents: React.ReactNode[];
    row: MRT_Row<T>;
    table: ReturnType<typeof useMantineReactTable<T>>;
    opened: boolean;
    setOpened: (opened: boolean) => void;
    title: string;
    action: string;
    custom: boolean;
}