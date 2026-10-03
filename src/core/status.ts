import { IllegalTransition } from './errors.js';
import type { RunStatus } from './types.js';

export const RUN_STATUSES: readonly RunStatus[] = [
  'PLANNING', 'POLICY', 'AWAITING_APPROVAL', 'EXECUTING', 'DONE',
  'REJECTED_BY_POLICY', 'REJECTED_BY_HUMAN', 'EXPIRED', 'FAILED',
];

export const TERMINAL: readonly RunStatus[] = ['DONE', 'REJECTED_BY_POLICY', 'REJECTED_BY_HUMAN', 'EXPIRED', 'FAILED'];

export const TRANSITIONS: Record<RunStatus, readonly RunStatus[]> = {
  PLANNING: ['POLICY', 'FAILED'],
  POLICY: ['AWAITING_APPROVAL', 'REJECTED_BY_POLICY', 'FAILED'],
  AWAITING_APPROVAL: ['EXECUTING', 'REJECTED_BY_HUMAN', 'EXPIRED', 'FAILED'],
  EXECUTING: ['DONE', 'FAILED'],
  DONE: [],
  REJECTED_BY_POLICY: [],
  REJECTED_BY_HUMAN: [],
  EXPIRED: [],
  FAILED: [],
};

export const isTerminal = (s: RunStatus): boolean => TERMINAL.includes(s);
export const canTransition = (from: RunStatus, to: RunStatus): boolean => TRANSITIONS[from].includes(to);

export function assertTransition(from: RunStatus, to: RunStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransition(`${from} -> ${to}`);
}
