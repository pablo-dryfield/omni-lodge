export type DerivedFieldExpressionAst =
  | DerivedFieldColumnNode
  | DerivedFieldLiteralNode
  | DerivedFieldBinaryNode
  | DerivedFieldFunctionNode
  | DerivedFieldUnaryNode;

export type DerivedFieldColumnNode = {
  type: "column";
  modelId: string;
  fieldId: string;
};

export type DerivedFieldLiteralNode = {
  type: "literal";
  valueType: "number" | "string" | "boolean";
  value: number | string | boolean;
};

export type DerivedFieldBinaryNode = {
  type: "binary";
  operator: BinaryOperator;
  left: DerivedFieldExpressionAst;
  right: DerivedFieldExpressionAst;
};

export type DerivedFieldUnaryNode = {
  type: "unary";
  operator: UnaryOperator;
  argument: DerivedFieldExpressionAst;
};

export type DerivedFieldFunctionNode = {
  type: "function";
  name: string;
  args: DerivedFieldExpressionAst[];
};

export type BinaryOperator = "+" | "-" | "*" | "/";
export type UnaryOperator = "+" | "-";
