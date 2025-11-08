import type { DerivedFieldExpressionAst, BinaryOperator, UnaryOperator } from "../types/DerivedFieldExpressionAst.js";

type ParsedAst = {
  ast: DerivedFieldExpressionAst;
  referencedModels: string[];
  referencedFields: Record<string, string[]>;
  joinDependencies: Array<[string, string]>;
};

export const BINARY_OPERATORS: ReadonlySet<BinaryOperator> = new Set(["+", "-", "*", "/"]);
export const UNARY_OPERATORS: ReadonlySet<UnaryOperator> = new Set(["+", "-"]);
export const ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  "abs",
  "ceil",
  "coalesce",
  "floor",
  "greatest",
  "least",
  "round",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const toTrimmed = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export const normalizeDerivedFieldExpressionAst = (value: unknown): ParsedAst | null => {
  const ast = parseNode(value);
  if (!ast) {
    return null;
  }
  const referencedModels = new Set<string>();
  const referencedFieldsMap = new Map<string, Set<string>>();
  collectExpressionMetadata(ast, referencedModels, referencedFieldsMap);
  return {
    ast,
    referencedModels: Array.from(referencedModels),
    referencedFields: serializeReferencedFields(referencedFieldsMap),
    joinDependencies: buildJoinDependencies(referencedModels),
  };
};

const parseNode = (value: unknown): DerivedFieldExpressionAst | null => {
  if (!isRecord(value)) {
    return null;
  }

  const type = value.type;
  switch (type) {
    case "column": {
      const modelId = toTrimmed(value.modelId);
      const fieldId = toTrimmed(value.fieldId);
      if (!modelId || !fieldId) {
        return null;
      }
      return {
        type: "column",
        modelId,
        fieldId,
      };
    }
    case "literal": {
      const literalValue = value.value;
      const literalType = value.valueType;
      if (literalType === "number" && typeof literalValue === "number" && Number.isFinite(literalValue)) {
        return { type: "literal", value: literalValue, valueType: "number" };
      }
      if (literalType === "string" && typeof literalValue === "string") {
        return { type: "literal", value: literalValue, valueType: "string" };
      }
      if (literalType === "boolean" && typeof literalValue === "boolean") {
        return { type: "literal", value: literalValue, valueType: "boolean" };
      }
      return null;
    }
    case "binary": {
      const operator = value.operator;
      if (typeof operator !== "string" || !BINARY_OPERATORS.has(operator as BinaryOperator)) {
        return null;
      }
      const left = parseNode(value.left);
      const right = parseNode(value.right);
      if (!left || !right) {
        return null;
      }
      return {
        type: "binary",
        operator: operator as BinaryOperator,
        left,
        right,
      };
    }
    case "unary": {
      const operator = value.operator;
      if (typeof operator !== "string" || !UNARY_OPERATORS.has(operator as UnaryOperator)) {
        return null;
      }
      const argument = parseNode(value.argument);
      if (!argument) {
        return null;
      }
      return {
        type: "unary",
        operator: operator as UnaryOperator,
        argument,
      };
    }
    case "function": {
      const name = toTrimmed(value.name).toLowerCase();
      if (!name || !ALLOWED_FUNCTIONS.has(name)) {
        return null;
      }
      const argsRaw = Array.isArray(value.args) ? value.args : [];
      const args: DerivedFieldExpressionAst[] = [];
      for (const entry of argsRaw) {
        const parsed = parseNode(entry);
        if (!parsed) {
          return null;
        }
        args.push(parsed);
      }
      return {
        type: "function",
        name,
        args,
      };
    }
    default:
      return null;
  }
};

const collectExpressionMetadata = (
  node: DerivedFieldExpressionAst,
  modelAccumulator: Set<string>,
  fieldMap: Map<string, Set<string>>,
) => {
  switch (node.type) {
    case "column": {
      modelAccumulator.add(node.modelId);
      if (!fieldMap.has(node.modelId)) {
        fieldMap.set(node.modelId, new Set<string>());
      }
      fieldMap.get(node.modelId)!.add(node.fieldId);
      return;
    }
    case "binary":
      collectExpressionMetadata(node.left, modelAccumulator, fieldMap);
      collectExpressionMetadata(node.right, modelAccumulator, fieldMap);
      return;
    case "unary":
      collectExpressionMetadata(node.argument, modelAccumulator, fieldMap);
      return;
    case "function":
      node.args.forEach((arg) => collectExpressionMetadata(arg, modelAccumulator, fieldMap));
      return;
    case "literal":
    default:
      return;
  }
};

const serializeReferencedFields = (
  fieldMap: Map<string, Set<string>>,
): Record<string, string[]> => {
  const entries: Array<[string, string[]]> = Array.from(fieldMap.entries()).map(
    ([modelId, fields]): [string, string[]] => {
      const sortedFields = Array.from(fields).sort((left, right) => left.localeCompare(right));
      return [modelId, sortedFields];
    },
  );
  entries.sort((left, right) => left[0].localeCompare(right[0]));
  return entries.reduce<Record<string, string[]>>((accumulator, [modelId, fields]) => {
    accumulator[modelId] = fields;
    return accumulator;
  }, {});
};

const buildJoinDependencies = (models: Set<string>): Array<[string, string]> => {
  if (models.size < 2) {
    return [];
  }
  const sortedModels = Array.from(models).sort();
  const dependencies: Array<[string, string]> = [];
  for (let leftIndex = 0; leftIndex < sortedModels.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sortedModels.length; rightIndex += 1) {
      dependencies.push([sortedModels[leftIndex], sortedModels[rightIndex]]);
    }
  }
  return dependencies;
};
