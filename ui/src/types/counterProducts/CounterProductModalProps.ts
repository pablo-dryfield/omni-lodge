import { MRT_TableInstance, MRT_Row, MRT_Cell } from "mantine-react-table";
import { Counter } from "../counters/Counter";

export type CounterProductModalProps = {
    table: MRT_TableInstance<Partial<Counter>>;
    row: MRT_Row<Partial<Counter>>;
    cell?: MRT_Cell<Partial<Counter>>;
}