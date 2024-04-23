import { Product } from "./Product";

export type ProductCounterModalProps = {
    value: Product;
    onChange: (newValue: Product) => void;
}