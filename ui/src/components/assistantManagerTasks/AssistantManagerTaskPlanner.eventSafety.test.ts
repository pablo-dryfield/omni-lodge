import { readFileSync } from 'fs';
import path from 'path';
import ts from 'typescript';

const plannerSourcePath = path.join(__dirname, 'AssistantManagerTaskPlanner.tsx');

const getStateSetterName = (expression: ts.LeftHandSideExpression): string | null => {
  if (!ts.isIdentifier(expression) || !/^set[A-Z]/.test(expression.text)) {
    return null;
  }

  return expression.text;
};

const containsDomEventTargetReference = (node: ts.Node): boolean => {
  let foundReference = false;

  const visit = (child: ts.Node) => {
    if (
      ts.isPropertyAccessExpression(child) &&
      ts.isIdentifier(child.expression) &&
      /(?:^e$|event$)/i.test(child.expression.text) &&
      (child.name.text === 'currentTarget' || child.name.text === 'target')
    ) {
      foundReference = true;
      return;
    }

    if (!foundReference) {
      ts.forEachChild(child, visit);
    }
  };

  visit(node);
  return foundReference;
};

describe('AssistantManagerTaskPlanner event handling', () => {
  it('captures DOM values before invoking functional state updaters', () => {
    const sourceText = readFileSync(plannerSourcePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      plannerSourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const unsafeUpdaters: string[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const setterName = getStateSetterName(node.expression);
        const updater = node.arguments[0];

        if (
          setterName &&
          updater &&
          (ts.isArrowFunction(updater) || ts.isFunctionExpression(updater)) &&
          containsDomEventTargetReference(updater)
        ) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(updater.getStart(sourceFile));
          unsafeUpdaters.push(`${setterName} at line ${line + 1}`);
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);

    expect(unsafeUpdaters).toEqual([]);
  });
});
