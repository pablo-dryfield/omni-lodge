import type { AssistantManagerTaskEvidenceItem } from '../../types/assistantManagerTasks/AssistantManagerTask';
import { canManuallyManageTask, getSubjectImageEvidenceItems, isCleaningManagedTask } from './cleaningTaskPlannerState';

describe('Cleaning planner workflow state', () => {
  it('locks generic evidence and status changes as soon as the template opts in', () => {
    expect(isCleaningManagedTask({ meta: {} }, { scheduleConfig: { cleaningPhotoApprovalEnabled: true } })).toBe(true);
  });
  it('keeps a saved managed workflow locked after the template is changed or unavailable', () => {
    const log = { meta: { cleaningPhotoWorkflow: { managed: true } } };
    expect(isCleaningManagedTask(log, { scheduleConfig: { cleaningPhotoApprovalEnabled: false } })).toBe(true);
    expect(isCleaningManagedTask(log, undefined)).toBe(true);
  });
  it('does not lock ordinary tasks or mistake malformed metadata for an opt-in', () => {
    expect(isCleaningManagedTask(null, { scheduleConfig: { cleaningPhotoApprovalEnabled: true } })).toBe(false);
    expect(isCleaningManagedTask({ meta: {} }, { scheduleConfig: {} })).toBe(false);
    expect(isCleaningManagedTask({ meta: { cleaningPhotoWorkflow: { managed: 'true' } } })).toBe(false);
    expect(isCleaningManagedTask({ meta: { cleaningPhotoWorkflow: [] } })).toBe(false);
  });
  it('hides scheduled-task editing and deletion for managed logs even from managers, preserving ordinary access', () => {
    expect(canManuallyManageTask(true, { meta: { cleaningPhotoWorkflow: { managed: true } } }, { scheduleConfig: {} })).toBe(false);
    expect(canManuallyManageTask(true, { meta: {} }, { scheduleConfig: { cleaningPhotoApprovalEnabled: true } })).toBe(false);
    expect(canManuallyManageTask(true, { meta: {} }, { scheduleConfig: {} })).toBe(true);
    expect(canManuallyManageTask(false, { meta: {} }, { scheduleConfig: {} })).toBe(false);
    expect(canManuallyManageTask(true, null)).toBe(false);
  });
  it('renders every approved photo for the expected subject and rule, without crossing subjects or rule types', () => {
    const items: AssistantManagerTaskEvidenceItem[] = [
      { id: 'bathroom-1', ruleKey: 'bathroom', type: 'image', subjectUserId: 4 },
      { id: 'bathroom-2', ruleKey: 'bathroom', type: 'image', subjectUserId: 4 },
      { id: 'other-subject', ruleKey: 'bathroom', type: 'image', subjectUserId: 5 },
      { id: 'other-room', ruleKey: 'kitchen', type: 'image', subjectUserId: 4 },
      { id: 'link', ruleKey: 'bathroom', type: 'link', subjectUserId: 4 },
    ];
    expect(getSubjectImageEvidenceItems(items, 'bathroom', 4)).toEqual(items.slice(0, 2));
    expect(getSubjectImageEvidenceItems(items, 'bathroom', 6)).toEqual([undefined]);
  });
});
