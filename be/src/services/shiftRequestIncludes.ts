import ShiftAssignment from '../models/ShiftAssignment.js';
import ShiftInstance from '../models/ShiftInstance.js';
import ShiftRole from '../models/ShiftRole.js';
import ShiftType from '../models/ShiftType.js';
import User from '../models/User.js';

const assignmentUserAttributes: string[] = [
  'id',
  'firstName',
  'lastName',
  'profilePhotoPath',
  'profilePhotoUrl',
  'updatedAt',
];

const participantUserAttributes: string[] = [
  'id',
  'firstName',
  'lastName',
  'username',
];

export const buildAssignmentInclude = () => [
  { model: User, as: 'assignee', attributes: assignmentUserAttributes },
  { model: ShiftRole, as: 'shiftRole' },
  {
    model: ShiftInstance,
    as: 'shiftInstance',
    include: [
      { model: ShiftType, as: 'shiftType' },
    ],
  },
];

/**
 * Sequelize annotates nested include objects with their parent alias while it
 * builds a query. Keep both branches and every query reference-independent so
 * a `toAssignment` annotation can never leak into the `fromAssignment` join.
 */
export const buildRequestInclude = () => [
  { model: ShiftAssignment, as: 'fromAssignment', include: buildAssignmentInclude() },
  { model: ShiftAssignment, as: 'toAssignment', include: buildAssignmentInclude() },
  { model: User, as: 'requester', attributes: participantUserAttributes },
  { model: User, as: 'partner', attributes: participantUserAttributes },
  { model: User, as: 'manager', attributes: participantUserAttributes },
];
