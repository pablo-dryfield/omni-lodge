import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import TaskAttendanceCheck from './TaskAttendanceCheck';
import * as api from '../../api/volunteerAttendanceChecks';
import { useModuleAccess } from '../../hooks/useModuleAccess';

jest.mock('../../api/volunteerAttendanceChecks', () => ({ useAttendanceCheck: jest.fn(), useSaveAttendanceCheck: jest.fn(), attendanceCheckError: () => 'Attendance changed. Refresh.' }));
jest.mock('../../hooks/useModuleAccess', () => ({ useModuleAccess: jest.fn() }));
const assignment = { assignmentId: 20, userId: 7, name: 'Vera Volunteer', role: 'Guide', shiftName: 'Pub Crawl',
  startTime: '20:45', endTime: '00:00', status: 'on_time' as const, revision: 2, evidenceTaskLogId: null,
  evidenceFileId: null, lateMinutes: null, notes: null, recordedAt: null, self: false };
const check = { taskLogId: 10, taskDate: '2026-09-06', checkKind: 'meeting_point' as const, expectedTime: '20:45', evidenceRuleKey: 'meeting', shiftTypeIds: [1], serverTime: '2026-09-06T19:00:00Z',
  evidence: [{ id: 'photo-1', fileName: 'Meeting photo.jpg', subjectUserId: null, uploadedAt: '2026-09-06T18:50:00Z' }], assignments: [assignment] };
const mutate = jest.fn();
const view = () => render(<MantineProvider><TaskAttendanceCheck taskLogId={10} evidenceVersion="photo-1" /></MantineProvider>);
describe('Task attendance photo check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', { writable: true, value: jest.fn().mockImplementation((media: string) => ({ matches: false, media, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {} })) });
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: class { observe() {} unobserve() {} disconnect() {} } });
    (useModuleAccess as jest.Mock).mockReturnValue({ ready: true, canView: true, canUpdate: true });
    (api.useAttendanceCheck as jest.Mock).mockReturnValue({ data: check, isLoading: false, isFetching: false, refetch: jest.fn() });
    (api.useSaveAttendanceCheck as jest.Mock).mockReturnValue({ mutate, isPending: false });
  });
  it('shows roster and submits the selected evidence with an expected revision', () => {
    view();
    expect(screen.getByText('Vera Volunteer')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save attendance' }));
    expect(mutate).toHaveBeenCalledWith({ assignmentId: 20, input: { status: 'on_time', evidenceFileId: 'photo-1', expectedRevision: 2, notes: null, lateMinutes: null } });
  });
  it('prevents self-confirmation', () => {
    (api.useAttendanceCheck as jest.Mock).mockReturnValue({ data: { ...check, assignments: [{ ...assignment, self: true }] }, refetch: jest.fn() });
    view();
    expect(screen.getByRole('button', { name: 'Save attendance' })).toBeDisabled();
    expect(screen.getByText('Another manager must confirm your attendance.')).toBeInTheDocument();
  });
  it('requires an uploaded matching photo', () => {
    (api.useAttendanceCheck as jest.Mock).mockReturnValue({ data: { ...check, evidence: [] }, refetch: jest.fn() });
    view();
    expect(screen.getByRole('button', { name: 'Save attendance' })).toBeDisabled();
    expect(screen.getByText(/Upload the required task photo below/)).toBeInTheDocument();
  });
  it('disables the query instead of making forbidden requests', () => {
    (useModuleAccess as jest.Mock).mockReturnValue({ ready: true, canView: false, canUpdate: false });
    (api.useAttendanceCheck as jest.Mock).mockReturnValue({ refetch: jest.fn() });
    view();
    expect(api.useAttendanceCheck).toHaveBeenCalledWith(10, 'photo-1', false);
    expect(screen.getByText(/Attendance access is required/)).toBeInTheDocument();
  });
  it('does not offer another person’s individual photo', () => {
    (api.useAttendanceCheck as jest.Mock).mockReturnValue({ data: { ...check, evidence: [{ ...check.evidence[0], subjectUserId: 8 }] }, refetch: jest.fn() });
    view();
    expect(screen.getByRole('button', { name: 'Save attendance' })).toBeDisabled();
  });
});
