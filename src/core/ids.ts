import { ulid } from 'ulid';

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
export const newRunId = (): string => ulid();
export const newApprovalId = (): string => ulid();
export const isUlid = (s: unknown): s is string => typeof s === 'string' && ULID_PATTERN.test(s);
