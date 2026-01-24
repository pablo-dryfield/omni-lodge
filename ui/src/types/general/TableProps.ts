import { MRT_ColumnDef, MRT_Row, MRT_TableInstance, MRT_TableState } from "mantine-react-table";
import { TableActions } from "./TableActions";
import { TablePermissions } from "./TablePermissions";

export type TableProps<T extends object> = {
  pageTitle: string;
  data: T[];
  loading: boolean;
  error: string | null;
  columns: MRT_ColumnDef<T>[];
  actions: TableActions;
  initialState: Partial<MRT_TableState<T>>;
  renderDetailPanel?: (row: MRT_Row<T>) => React.ReactNode;
  renderToolbarActions?: (table: MRT_TableInstance<T>) => React.ReactNode;
  moduleSlug?: string;
  permissionsOverride?: TablePermissions;
};
