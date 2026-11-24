import type { InvitationId, OtpChallengeId, SessionRef } from '@ecoma-io/account-domain';

import type { IdGenerator } from '../ports/id-generator.js';

/**
 * IdGenerator giả — sinh id tuần tự có tính định danh (dễ assert trong tests).
 * Không dùng trong production: entropy thật là trách nhiệm của implementation
 * CSPRNG ở composition root.
 */
export class SequentialIdGenerator implements IdGenerator {
  #counter = 0;

  #next(label: string): string {
    this.#counter += 1;
    return `${label}-${this.#counter}`;
  }

  public newInvitationId(): InvitationId {
    return this.#next('inv') as InvitationId;
  }

  public newOtpChallengeId(): OtpChallengeId {
    return this.#next('ch') as OtpChallengeId;
  }

  public newSubjectEntropy(): string {
    this.#counter += 1;
    // 32 ký tự base32 viết thường (alphabet không có 0/1/8/9) — entropy shape
    // Của Subject; counter.encode sang base36 rồi thay digit ngoài alphabet.
    const encoded = this.#counter.toString(36).replace(/[0-9]/u, 'z');
    return (encoded + 'a'.repeat(40)).slice(0, 32);
  }

  public newSessionRef(): SessionRef {
    return this.#next('sess') as SessionRef;
  }
}
