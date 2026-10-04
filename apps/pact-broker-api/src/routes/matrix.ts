/**
 * Matrix + can-i-deploy routes — port từ upstream `src/routes/matrix.ts`
 * (ADAPT: DO → PG repo). Semantics query param giữ nguyên: reference client
 * gửi `q[][pacticipant]`, `q[][version]`, `q[][environment]` (hoặc `tag`) —
 * cả hai format array và đơn đều nhận.
 */
import { Hono, type MiddlewareHandler } from 'hono';
import type { AppEnv } from '../domain/types';
import { currentTenantId } from '../middleware/tenant-context';
import { HalBuilder, getBaseUrl } from '../domain/hal';
import { summarizeMatrix, toSummaryRows } from '../domain/matrix-summary';
import { decorateMatrixRow } from '../domain/matrix-row';
import { nameSchema, versionSchema, branchSchema } from '../domain/validation';
import { validateParam, validateOptionalQuery } from '../middleware/validate';
import { PgMatrixRepo } from '../repo/matrix-repo';

export function matrixRoutes(readAuth: () => MiddlewareHandler<AppEnv>): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  // Query the matrix
  app.get('/matrix', readAuth(), async (c) => {
    const pacticipantRaw = c.req.query('q[][pacticipant]') ?? c.req.query('pacticipant');
    const versionRaw = c.req.query('q[][version]') ?? c.req.query('version');
    // Reference client gửi `environment=` cho --to-environment và `tag=` cho
    // --to (matrix/query.rb#query_options). Cả hai narrow phía provider, cùng
    // feed target resolution.
    const environmentRaw = c.req.query('q[][environment]') ?? c.req.query('environment');
    const targetRaw = environmentRaw ?? c.req.query('q[][tag]') ?? c.req.query('tag');
    // Nhớ param nào gửi: nếu resolve không ra gì vẫn phải mô tả đúng — gọi
    // environment rỗng là "missing tag" khiến người đọc tìm sai chỗ.
    const targetKind = environmentRaw ? ('environment' as const) : ('tag' as const);

    if (!pacticipantRaw) {
      return c.json(
        { error: 'Bad Request', message: 'pacticipant query parameter is required' },
        400,
      );
    }

    const pacticipantResult = validateParam(c, nameSchema, pacticipantRaw, 'pacticipant');
    if (!pacticipantResult.valid) return pacticipantResult.errorResponse;

    const versionResult = validateOptionalQuery(c, versionSchema, versionRaw, 'version');
    if (!versionResult.valid) return versionResult.errorResponse;

    const targetResult = validateOptionalQuery(c, branchSchema, targetRaw, 'tag');
    if (!targetResult.valid) return targetResult.errorResponse;

    const repo = new PgMatrixRepo(c.get('pool'));
    const { rows } = await repo.getMatrix(
      currentTenantId(c),
      pacticipantResult.value,
      versionResult.value,
      targetResult.value,
      targetKind,
    );
    const { summary, notices } = summarizeMatrix(toSummaryRows(rows));

    const hal = new HalBuilder(getBaseUrl(c.req.raw));
    return c.json({
      summary,
      notices,
      matrix: rows.map((row) => decorateMatrixRow(hal, row)),
      _links: hal.matrix(),
    });
  });

  // Can I Deploy — fail-closed tri-state qua summarizeMatrix (deployable
  // false khi có failed, null khi có unknown, true chỉ khi mọi cái pass).
  app.get('/can-i-deploy', readAuth(), async (c) => {
    const pacticipantRaw = c.req.query('pacticipant');
    const versionRaw = c.req.query('version');
    const toRaw = c.req.query('to') ?? c.req.query('toTag');

    if (!pacticipantRaw || !versionRaw) {
      return c.json(
        { error: 'Bad Request', message: 'pacticipant and version query parameters are required' },
        400,
      );
    }

    const pacticipantResult = validateParam(c, nameSchema, pacticipantRaw, 'pacticipant');
    if (!pacticipantResult.valid) return pacticipantResult.errorResponse;

    const versionResult = validateParam(c, versionSchema, versionRaw, 'version');
    if (!versionResult.valid) return versionResult.errorResponse;

    // 'to' là environment, tag hoặc branch — không biết cái nào cho tới khi
    // resolve, nên validate theo schema nới nhất trong ba. environmentNameSchema
    // sẽ từ chối thẳng `release/1.2` và `1.0.0-rc`.
    const toResult = validateOptionalQuery(c, branchSchema, toRaw, 'to');
    if (!toResult.valid) return toResult.errorResponse;

    const repo = new PgMatrixRepo(c.get('pool'));
    const { rows, consumerVersionExists } = await repo.canIDeploy(
      currentTenantId(c),
      pacticipantResult.value,
      versionResult.value,
      toResult.value,
    );

    // Fail-closed bổ sung so với upstream: upstream để matrix rỗng đi qua
    // summarizeMatrix([]) → deployable true ("no missing dependencies"). Hai
    // tình huống rỗng đều fail-OPEN theo §6 (unknown không bao giờ là safe):
    //  * selector không khớp version/pacticipant nào — version gõ sai thấy xanh;
    //  * version tồn tại nhưng chưa publish pact nào — version chưa từng được
    //    contract-test vẫn thấy xanh.
    // Cả hai ép deployable null kèm reason nói rõ tình huống.
    const noVerifications =
      rows.length === 0
        ? consumerVersionExists
          ? `Version ${versionResult.value} of ${pacticipantResult.value} exists but has no ` +
            `pacts published — no verification can exist, deployability is unknown`
          : `There is no version ${versionResult.value} of ${pacticipantResult.value} ` +
            `(or no pact published for it) — cannot determine deployability`
        : null;
    const { summary, notices } =
      noVerifications !== null
        ? {
            summary: {
              deployable: null,
              reason: noVerifications,
              success: 0,
              failed: 0,
              unknown: 1,
            },
            notices: [{ type: 'error' as const, text: noVerifications }],
          }
        : summarizeMatrix(toSummaryRows(rows));

    const hal = new HalBuilder(getBaseUrl(c.req.raw));
    return c.json({
      summary,
      notices,
      matrix: rows.map((row) => decorateMatrixRow(hal, row)),
      _links: hal.canIDeploy(),
    });
  });

  return app;
}
