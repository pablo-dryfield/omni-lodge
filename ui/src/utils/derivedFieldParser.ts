import type { DerivedFieldExpressionAst } from "../api/reports";

type LiteralValueType = "number" | "string" | "boolean";

type ParseResult = {
  ast: DerivedFieldExpressionAst;
  referencedModels: string[];
  referencedFields: Record<string, string[]>;
};

const FUNCTION_NAMES = new Set(["abs", "ceil", "coalesce", "floor", "greatest", "least", "round"]);

class ExpressionParser {
  private index = 0;
  constructor(private readonly source: string) {}

  parse(): DerivedFieldExpressionAst {
    const ast = this.parseExpression();
    this.skipWhitespace();
    if (this.index < this.source.length) {
      throw new Error(`Unexpected token "${this.source[this.index]}"`);
    }
    return ast;
  }

  private parseExpression(): DerivedFieldExpressionAst {
    let node = this.parseTerm();
    while (true) {
      this.skipWhitespace();
      const operator = this.peek();
      if (operator === "+" || operator === "-") {
        this.index += 1;
        const right = this.parseTerm();
        node = { type: "binary", operator, left: node, right };
        continue;
      }
      break;
    }
    return node;
  }

  private parseTerm(): DerivedFieldExpressionAst {
    let node = this.parseFactor();
    while (true) {
      this.skipWhitespace();
      const operator = this.peek();
      if (operator === "*" || operator === "/") {
        this.index += 1;
        const right = this.parseFactor();
        node = { type: "binary", operator, left: node, right };
        continue;
      }
      break;
    }
    return node;
  }

  private parseFactor(): DerivedFieldExpressionAst {
    this.skipWhitespace();
    const operator = this.peek();
    if (operator === "+" || operator === "-") {
      this.index += 1;
      const argument = this.parseFactor();
      return { type: "unary", operator, argument };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): DerivedFieldExpressionAst {
    this.skipWhitespace();
    const char = this.peek();
    if (char === "(") {
      this.index += 1;
      const expr = this.parseExpression();
      this.skipWhitespace();
      this.expect(")");
      return expr;
    }
    if (char === "'" || char === '"') {
      return this.parseStringLiteral();
    }
    if (this.isDigit(char) || char === ".") {
      return this.parseNumberLiteral();
    }
    if (this.isIdentifierStart(char)) {
      return this.parseIdentifierOrFunction();
    }
    throw new Error(`Unexpected token "${char ?? "EOF"}"`);
  }

  private parseIdentifierOrFunction(): DerivedFieldExpressionAst {
    const start = this.index;
    while (this.isIdentifierPart(this.peek())) {
      this.index += 1;
    }
    const identifier = this.source.slice(start, this.index);
    this.skipWhitespace();
    const next = this.peek();
    if (next === ".") {
      this.index += 1;
      const fieldStart = this.index;
      if (!this.isIdentifierStart(this.peek())) {
        throw new Error("Expected field identifier after dot");
      }
      while (this.isIdentifierPart(this.peek())) {
        this.index += 1;
      }
      const fieldId = this.source.slice(fieldStart, this.index);
      return {
        type: "column",
        modelId: identifier,
        fieldId,
      };
    }
    if (next === "(") {
      this.index += 1;
      const args: DerivedFieldExpressionAst[] = [];
      this.skipWhitespace();
      if (this.peek() !== ")") {
        while (true) {
          args.push(this.parseExpression());
          this.skipWhitespace();
          if (this.peek() === ",") {
            this.index += 1;
            continue;
          }
          break;
        }
      }
      this.expect(")");
      return {
        type: "function",
        name: identifier.toLowerCase(),
        args,
      };
    }
    if (identifier.toLowerCase() === "true" || identifier.toLowerCase() === "false") {
      return {
        type: "literal",
        valueType: "boolean",
        value: identifier.toLowerCase() === "true",
      };
    }
    throw new Error(`Unexpected identifier "${identifier}"`);
  }

  private parseNumberLiteral(): DerivedFieldExpressionAst {
    const start = this.index;
    if (this.peek() === "+") {
      this.index += 1;
    }
    while (this.isDigit(this.peek())) {
      this.index += 1;
    }
    if (this.peek() === ".") {
      this.index += 1;
      while (this.isDigit(this.peek())) {
        this.index += 1;
      }
    }
    const value = Number(this.source.slice(start, this.index));
    if (!Number.isFinite(value)) {
      throw new Error("Invalid numeric literal");
    }
    return {
      type: "literal",
      valueType: "number",
      value,
    };
  }

  private parseStringLiteral(): DerivedFieldExpressionAst {
    const quote = this.peek();
    this.index += 1;
    const start = this.index;
    while (this.peek() && this.peek() !== quote) {
      if (this.peek() === "\\") {
        this.index += 2;
      } else {
        this.index += 1;
      }
    }
    if (this.peek() !== quote) {
      throw new Error("Unterminated string literal");
    }
    const raw = this.source.slice(start, this.index);
    this.index += 1;
    return {
      type: "literal",
      valueType: "string",
      value: raw.replace(/\\'/g, "'").replace(/\\"/g, '"'),
    };
  }

  private skipWhitespace() {
    while (this.index < this.source.length && /\s/.test(this.source[this.index]!)) {
      this.index += 1;
    }
  }

  private expect(token: string) {
    if (this.peek() !== token) {
      throw new Error(`Expected "${token}"`);
    }
    this.index += token.length;
  }

  private peek(): string | null {
    if (this.index >= this.source.length) {
      return null;
    }
    return this.source[this.index]!;
  }

  private isDigit(value: string | null): boolean {
    return value !== null && /[0-9]/.test(value);
  }

  private isIdentifierStart(value: string | null): boolean {
    return value !== null && /[A-Za-z_]/.test(value);
  }

  private isIdentifierPart(value: string | null): boolean {
    return value !== null && /[A-Za-z0-9_]/.test(value);
  }
}

const collectMetadata = (
  node: DerivedFieldExpressionAst,
  models: Set<string>,
  fields: Map<string, Set<string>>,
) => {
  switch (node.type) {
    case "column": {
      models.add(node.modelId);
      if (!fields.has(node.modelId)) {
        fields.set(node.modelId, new Set());
      }
      fields.get(node.modelId)!.add(node.fieldId);
      return;
    }
    case "binary":
      collectMetadata(node.left, models, fields);
      collectMetadata(node.right, models, fields);
      return;
    case "unary":
      collectMetadata(node.argument, models, fields);
      return;
    case "function":
      node.args.forEach((arg) => collectMetadata(arg, models, fields));
      return;
    case "literal":
    default:
      return;
  }
};

export const parseDerivedFieldExpression = (expression: string): ParseResult => {
  const parser = new ExpressionParser(expression);
  const ast = parser.parse();
  const modelSet = new Set<string>();
  const fieldMap = new Map<string, Set<string>>();
  collectMetadata(ast, modelSet, fieldMap);
  const referencedFields: Record<string, string[]> = {};
  fieldMap.forEach((value, key) => {
    referencedFields[key] = Array.from(value).sort();
  });
  return {
    ast,
    referencedModels: Array.from(modelSet),
    referencedFields,
  };
};
