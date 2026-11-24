/**
 * Port đọc template — chỉ trả template `active`; version selection là quyết định
 * của usecase (§6.2: version cao nhất thắng).
 */
export interface MailTemplateRepositoryPort {
  findActiveByNameAndLocale(
    name: string,
    locale: string,
  ): Promise<
    ReadonlyArray<{
      readonly id: string;
      readonly name: string;
      readonly locale: string;
      readonly version: number;
      readonly subjectTemplate: string;
      readonly bodyTemplate: string;
      readonly variablesSchemaJson: string;
    }>
  >;
}
