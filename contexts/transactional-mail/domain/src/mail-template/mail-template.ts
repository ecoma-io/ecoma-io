/**
 * Aggregate `MailTemplate` — mẫu email versioned.
 *
 * Template là versioned theo `(name, locale, version)`; mỗi version có
 * `variables_schema_json` riêng. Chọn template là deterministic: nhiều version
 * active cùng `(name, locale)` → version cao nhất thắng (§6.2).
 *
 * Replay bất biến (§6.1): replay của request đã tạo thành công không bao giờ gặp
 * kết quả "không tìm thấy" dù template đã bị disable/delete sau đó — việc giữ
 * nguyên tính chọn được của row cũ thuộc persistence (không xoá row template đã
 * từng render); domain chỉ mô hình hoá trạng thái `active`/`disabled`.
 *
 * `variablesSchemaJson` là **metadata** khai báo biến theo FR-003 — không phải bản
 * sao giá trị biến. Lệnh cấm persist raw `variables` (FR-007) áp cho message,
 * không áp cho cột này. Validate variables theo schema thuộc tầng application
 * (cần JSON Schema runtime); domain chỉ ghim hình dạng và trạng thái.
 */

import { AggregateRoot } from '@ecoma-io/domain-primitives';
import type { Brand } from '@ecoma-io/domain-primitives';

/** Định danh hàng template (`mail_templates.id`). */
export type MailTemplateId = Brand<string, 'MailTemplateId'>;

/** Tên logical của template — khóa nghiệp vụ cùng locale. */
export type TemplateName = Brand<string, 'TemplateName'>;

/** Trạng thái template. */
export type MailTemplateStatus = 'active' | 'disabled';

export interface MailTemplateSnapshot {
  readonly id: MailTemplateId;
  readonly name: TemplateName;
  readonly locale: string;
  readonly version: number;
  readonly subjectTemplate: string;
  readonly bodyTemplate: string;
  readonly variablesSchemaJson: string;
  readonly status: MailTemplateStatus;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export class MailTemplate extends AggregateRoot<MailTemplateId> {
  readonly #name: TemplateName;
  readonly #locale: string;
  readonly #version: number;
  readonly #subjectTemplate: string;
  readonly #bodyTemplate: string;
  readonly #variablesSchemaJson: string;
  #status: MailTemplateStatus;
  readonly #createdAtMs: number;
  #updatedAtMs: number;

  private constructor(snapshot: MailTemplateSnapshot) {
    super(snapshot.id);
    this.#name = snapshot.name;
    this.#locale = snapshot.locale;
    this.#version = snapshot.version;
    this.#subjectTemplate = snapshot.subjectTemplate;
    this.#bodyTemplate = snapshot.bodyTemplate;
    this.#variablesSchemaJson = snapshot.variablesSchemaJson;
    this.#status = snapshot.status;
    this.#createdAtMs = snapshot.createdAtMs;
    this.#updatedAtMs = snapshot.updatedAtMs;
  }

  /**
   * Tạo version mới của template.
   * Validation ở entry point: template name/locale/schema JSON không được rỗng;
   * version là safe integer dương.
   */
  public static issue(args: {
    id: MailTemplateId;
    name: TemplateName;
    locale: string;
    version: number;
    subjectTemplate: string;
    bodyTemplate: string;
    variablesSchemaJson: string;
    nowMs: number;
  }): MailTemplate {
    if (!Number.isFinite(args.nowMs)) {
      throw new TypeError('MailTemplate issue: nowMs phải là số hữu hạn.');
    }
    if (
      args.id.length === 0 ||
      args.name.length === 0 ||
      args.locale.length === 0 ||
      args.variablesSchemaJson.length === 0 ||
      args.subjectTemplate.length === 0 ||
      args.bodyTemplate.length === 0
    ) {
      throw new TypeError('MailTemplate issue: giá trị không được rỗng.');
    }
    if (!Number.isSafeInteger(args.version) || args.version < 1) {
      throw new TypeError('MailTemplate issue: version phải là safe integer dương.');
    }
    return new MailTemplate({
      bodyTemplate: args.bodyTemplate,
      createdAtMs: args.nowMs,
      id: args.id,
      locale: args.locale,
      name: args.name,
      status: 'active',
      subjectTemplate: args.subjectTemplate,
      updatedAtMs: args.nowMs,
      variablesSchemaJson: args.variablesSchemaJson,
      version: args.version,
    });
  }

  /** Tái tạo từ persistence. */
  public static reconstitute(snapshot: MailTemplateSnapshot): MailTemplate {
    if (
      snapshot.id.length === 0 ||
      snapshot.name.length === 0 ||
      snapshot.locale.length === 0 ||
      snapshot.variablesSchemaJson.length === 0 ||
      !Number.isSafeInteger(snapshot.version) ||
      snapshot.version < 1 ||
      !Number.isFinite(snapshot.createdAtMs) ||
      !Number.isFinite(snapshot.updatedAtMs) ||
      (snapshot.status !== 'active' && snapshot.status !== 'disabled')
    ) {
      throw new TypeError('MailTemplate snapshot không hợp lệ.');
    }
    return new MailTemplate(snapshot);
  }

  /** Định danh aggregate (`mail_templates.id`). */
  public override get id(): MailTemplateId {
    return super.id;
  }

  public name(): TemplateName {
    return this.#name;
  }

  public locale(): string {
    return this.#locale;
  }

  public version(): number {
    return this.#version;
  }

  public status(): MailTemplateStatus {
    return this.#status;
  }

  /** Business key — chọn template theo `(name, locale)`, version cao nhất thắng. */
  public businessKey(): { name: TemplateName; locale: string } {
    return { locale: this.#locale, name: this.#name };
  }

  public isActive(): boolean {
    return this.#status === 'active';
  }

  public snapshot(): MailTemplateSnapshot {
    return {
      bodyTemplate: this.#bodyTemplate,
      createdAtMs: this.#createdAtMs,
      id: this.id,
      locale: this.#locale,
      name: this.#name,
      status: this.#status,
      subjectTemplate: this.#subjectTemplate,
      updatedAtMs: this.#updatedAtMs,
      variablesSchemaJson: this.#variablesSchemaJson,
      version: this.#version,
    };
  }

  /** Disable — v1 chỉ có đường này (template seed, chưa có admin surface §10). */
  public disable(nowMs: number): void {
    if (!Number.isFinite(nowMs)) {
      throw new TypeError('MailTemplate disable: nowMs phải là số hữu hạn.');
    }
    this.#status = 'disabled';
    this.#updatedAtMs = Math.max(nowMs, this.#updatedAtMs);
  }
}
