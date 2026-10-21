import { describe, expect, it } from 'vitest';

import { createBackofficeAdapter } from '../app/backoffice-data/adapter';
import { resolveBackofficeDataMode } from '../app/backoffice-data/data-mode';
import { BACKOFFICE_BACKEND_UNAVAILABLE_CODE } from '../app/backoffice-data/unavailable-adapter';
import { PROTOTYPE_DATA } from '../app/backoffice-data/prototype-fixture';

/**
 * Hành vi của điểm chọn adapter.
 *
 * Hai chế độ phải khác nhau **có thể quan sát được**, và chế độ unavailable không
 * được trả bất kỳ dữ liệu nào — kể cả mảng rỗng — vì `[]` từ một trang staff
 * đọc như "không có nhân sự nào" thay vì "backend chưa khả dụng".
 */
describe('createBackofficeAdapter', () => {
  const READ_METHODS = ['listStaff', 'listRoles', 'listPermissions'] as const;

  it('prototype mode returns the mock adapter with fixture data and isPreview true', async () => {
    const adapter = createBackofficeAdapter('prototype');

    expect(adapter.isPreview).toBe(true);
    await expect(adapter.listStaff()).resolves.toEqual(PROTOTYPE_DATA.staff);
    await expect(adapter.listRoles()).resolves.toEqual(PROTOTYPE_DATA.roles);
    await expect(adapter.listPermissions()).resolves.toEqual(PROTOTYPE_DATA.permissions);
  });

  it('unavailable mode is not marked as preview', () => {
    expect(createBackofficeAdapter('unavailable').isPreview).toBe(false);
  });

  it.each(READ_METHODS)('%s reject với mã lỗi ổn định, không trả dữ liệu', async (method) => {
    const adapter = createBackofficeAdapter('unavailable');

    await expect(adapter[method]()).rejects.toMatchObject({
      code: BACKOFFICE_BACKEND_UNAVAILABLE_CODE,
    });
  });

  it.each(READ_METHODS)('%s không bao giờ trả mảng rỗng như một kết quả hợp lệ', async (method) => {
    const adapter = createBackofficeAdapter('unavailable');

    const outcome = await adapter[method]().then(
      (value) => ({ settled: 'fulfilled' as const, value }),
      (error: unknown) => ({ settled: 'rejected' as const, error }),
    );

    expect(outcome.settled).toBe('rejected');
  });

  it('no fixture data passes through the unavailable adapter', async () => {
    const adapter = createBackofficeAdapter('unavailable');

    for (const method of READ_METHODS) {
      const error = await adapter[method]().catch((caught: unknown) => caught);
      const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));

      expect(serialized).not.toContain(PROTOTYPE_DATA.staff[0]?.accountId ?? '__none__');
    }
  });

  it('factory is call-order independent: the two modes produce distinct instances', () => {
    expect(createBackofficeAdapter('prototype')).not.toBe(createBackofficeAdapter('prototype'));
    expect(createBackofficeAdapter('unavailable').isPreview).toBe(false);
    expect(createBackofficeAdapter('prototype').isPreview).toBe(true);
  });

  it('maps every declared mode to exactly one factory and keeps the fail-closed fallback', async () => {
    // Bảng ánh xạ mode → factory là nguồn duy nhất của seam này: mỗi mode của
    // `BackofficeDataMode` phải có đúng một factory tương ứng — thêm một mode
    // mới mà không khai factory cho nó là lỗi type, vì `Record` yêu cầu đúng
    // một factory cho mỗi khoá; khai thừa khoá ngoài union cũng là lỗi type.
    // Hành vi runtime luôn fail-closed:
    // mọi mode không có entry — hôm nay là mọi mode ngoài `'prototype'` — rơi về
    // `createUnavailableBackofficeAdapter()`.
    const available = createBackofficeAdapter(resolveBackofficeDataMode('prototype'));
    expect(available.isPreview).toBe(true);

    // Giá trị cấu hình không được hỗ trợ (`'disabled'`) tham chiếu như một
    // `BackofficeDataMode` tùy ý để vượt qua vòng kiểm tra này — vẫn fail-closed.
    const disabledAsMode = resolveBackofficeDataMode('disabled') as Parameters<
      typeof createBackofficeAdapter
    >[0];

    const unavailable = createBackofficeAdapter(disabledAsMode);
    expect(unavailable.isPreview).toBe(false);
    await expect(unavailable.listStaff()).rejects.toMatchObject({
      code: BACKOFFICE_BACKEND_UNAVAILABLE_CODE,
    });
  });
});
