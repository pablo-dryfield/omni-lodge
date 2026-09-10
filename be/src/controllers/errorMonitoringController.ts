import type { Response } from 'express';

import {
  addErrorMonitoringNote,
  cleanupErrorMonitoringOccurrences,
  deleteErrorMonitoringNote,
  getErrorMonitoringIssue,
  getErrorMonitoringQueueStats,
  getErrorMonitoringSummary,
  listErrorMonitoringIssues,
  updateErrorMonitoringIssue,
} from '../services/errorMonitoringService.js';
import type { AuthenticatedRequest } from '../types/AuthenticatedRequest.js';

const positiveId = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};

const sendError = (res: Response, error: unknown, fallback: string): void => {
  const rawMessage = error instanceof Error ? error.message : '';
  const isValidation = /^(?:Invalid |No supported changes|Note body is required|Assignee not found)/.test(rawMessage);
  res.status(isValidation ? 400 : 500).json({ message: isValidation ? rawMessage : fallback });
};

export const listIssues = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await listErrorMonitoringIssues(req.query);
    res.json({ ...result, items: result.issues });
  } catch (error) {
    sendError(res, error, 'Unable to list error-monitoring issues.');
  }
};

export const getIssue = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const issueId = positiveId(req.params.id);
  if (!issueId) {
    res.status(400).json({ message: 'Invalid issue id.' });
    return;
  }
  try {
    const result = await getErrorMonitoringIssue(issueId, req.query);
    if (!result) {
      res.status(404).json({ message: 'Issue not found.' });
      return;
    }
    res.json({ ...result, occurrencePagination: result.pagination });
  } catch (error) {
    sendError(res, error, 'Unable to load the error-monitoring issue.');
  }
};

export const patchIssue = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const issueId = positiveId(req.params.id);
  const actorUserId = req.authContext?.id;
  if (!issueId || !actorUserId) {
    res.status(400).json({ message: 'Invalid issue or user id.' });
    return;
  }
  try {
    const issue = await updateErrorMonitoringIssue(issueId, req.body ?? {}, actorUserId);
    if (!issue) {
      res.status(404).json({ message: 'Issue not found.' });
      return;
    }
    res.json({ issue });
  } catch (error) {
    sendError(res, error, 'Unable to update the error-monitoring issue.');
  }
};

export const addIssueNote = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const issueId = positiveId(req.params.id);
  const actorUserId = req.authContext?.id;
  if (!issueId || !actorUserId) {
    res.status(400).json({ message: 'Invalid issue or user id.' });
    return;
  }
  try {
    const note = await addErrorMonitoringNote(issueId, req.body?.body, actorUserId);
    if (!note) {
      res.status(404).json({ message: 'Issue not found.' });
      return;
    }
    res.status(201).json({ note });
  } catch (error) {
    sendError(res, error, 'Unable to add the note.');
  }
};

export const deleteIssueNote = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const issueId = positiveId(req.params.id);
  const noteId = positiveId(req.params.noteId);
  if (!issueId || !noteId) {
    res.status(400).json({ message: 'Invalid issue or note id.' });
    return;
  }
  try {
    if (!(await deleteErrorMonitoringNote(issueId, noteId))) {
      res.status(404).json({ message: 'Note not found.' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    sendError(res, error, 'Unable to delete the note.');
  }
};

export const getSummary = async (_req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const summary = await getErrorMonitoringSummary();
    res.json({ ...summary, queue: getErrorMonitoringQueueStats() });
  } catch (error) {
    sendError(res, error, 'Unable to load the error-monitoring summary.');
  }
};

export const runCleanup = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const result = await cleanupErrorMonitoringOccurrences(Number(req.body?.retentionDays));
    res.json(result);
  } catch (error) {
    sendError(res, error, 'Unable to clean up error-monitoring occurrences.');
  }
};
