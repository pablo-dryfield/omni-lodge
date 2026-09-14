import { readFileSync } from 'fs';
import path from 'path';

const plannerSourcePath = path.join(__dirname, 'AssistantManagerTaskPlanner.tsx');

describe('AssistantManagerTaskPlanner operational shift condition copy', () => {
  it('defines the condition as an active assignment gate without changing the task assignee', () => {
    const sourceText = readFileSync(plannerSourcePath, 'utf8');

    expect(sourceText).toContain(
      'At least one active person must be assigned to one selected operational shift on the task date.',
    );
    expect(sourceText).toContain(
      'This condition only decides whether the task is created; it does not choose or change the task assignee.',
    );
    expect(sourceText).not.toContain(
      'At least one selected shift template must exist on that date.',
    );
    expect(sourceText).not.toContain(
      'At least one of these operational shifts must exist on the task date.',
    );
  });
});
