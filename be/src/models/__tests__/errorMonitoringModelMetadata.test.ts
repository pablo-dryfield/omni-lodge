import { execFileSync } from 'node:child_process';
import path from 'node:path';

type ModelMetadata = {
  attributes: Record<string, { field?: string }>;
  associations: Record<string, string>;
};

const inspectRuntimeMetadata = (): Record<string, ModelMetadata> => {
  const tsxCli = path.join(process.cwd(), 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const script = `
    import { getAttributes } from 'sequelize-typescript/dist/model/column/attribute-service.js';
    import { getAssociations } from 'sequelize-typescript/dist/associations/shared/association-service.js';
    import Issue from './src/models/ErrorMonitoringIssue.ts';
    import Occurrence from './src/models/ErrorMonitoringOccurrence.ts';
    import Note from './src/models/ErrorMonitoringNote.ts';
    const inspect = (model) => ({
      attributes: getAttributes(model.prototype),
      associations: Object.fromEntries((getAssociations(model.prototype) || []).map((association) => {
        const options = association.getSequelizeOptions(model, undefined);
        return [String(options.as), typeof options.foreignKey === 'string'
          ? options.foreignKey
          : options.foreignKey?.name];
      })),
    });
    console.log(JSON.stringify({
      issue: inspect(Issue),
      occurrence: inspect(Occurrence),
      note: inspect(Note),
    }));
  `;
  return JSON.parse(execFileSync(process.execPath, [tsxCli, '--eval', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })) as Record<string, ModelMetadata>;
};

describe('error-monitoring ORM metadata', () => {
  const metadata = inspectRuntimeMetadata();

  it.each([
    ['issue', {
      lastUserId: 'last_user_id',
      assignedToUserId: 'assigned_to_user_id',
      statusChangedByUserId: 'status_changed_by_user_id',
    }],
    ['occurrence', {
      issueId: 'issue_id',
      userId: 'user_id',
      clientEventId: 'client_event_id',
    }],
    ['note', {
      issueId: 'issue_id',
      authorUserId: 'author_user_id',
    }],
  ] as const)('%s maps camelCase attributes to one physical column each', (model, expected) => {
    const attributes = metadata[model].attributes;
    for (const [attribute, field] of Object.entries(expected)) {
      expect(attributes[attribute]?.field).toBe(field);
      expect(attributes).not.toHaveProperty(field);
    }
  });

  it('binds associations to model attribute names, not physical column names', () => {
    expect(metadata.issue.associations).toEqual({
      lastUser: 'lastUserId',
      assignedTo: 'assignedToUserId',
      statusChangedBy: 'statusChangedByUserId',
      occurrences: 'issueId',
      notes: 'issueId',
    });
    expect(metadata.occurrence.associations).toEqual({ issue: 'issueId', user: 'userId' });
    expect(metadata.note.associations).toEqual({ issue: 'issueId', author: 'authorUserId' });
  });
});
