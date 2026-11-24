/**
 * Các kiểu định danh branded của bounded context `llm-usage`.
 */

import type { Brand } from '@ecoma-io/domain-primitives';

/** Định danh logical request (cấp request-level usage). */
export type RequestId = Brand<string, 'RequestId'>;

/** Định danh một provider attempt trong logical request. */
export type AttemptId = Brand<string, 'AttemptId'>;

/** Định danh reservation — khóa idempotency của request-level usage/correction. */
export type ReservationId = Brand<string, 'ReservationId'>;

/** Định danh correction — thành phần khóa idempotency của correction. */
export type CorrectionId = Brand<string, 'CorrectionId'>;
