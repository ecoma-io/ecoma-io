/**
 * Cổng `provision` — in kế hoạch, KHÔNG provision.
 *
 * `nx run <project>:provision` cố ý là lệnh AN TOÀN: nó không gọi `pulumi up`,
 * không chạm cloud, không đọc credential. Nó chỉ in ra stack mà operator sẽ
 * chạy tay. Nhờ vậy CI và người đọc có thể chạy target này để kiểm tra hợp
 * đồng thứ tự của task graph mà không sinh thay đổi hạ tầng nào.
 *
 * `projectRoot` lấy từ cwd của target (mỗi project đặt `cwd` của nó), nên một
 * bản cho toàn bộ `deploys/*` là đủ — không nhân bản 11 file.
 *
 * Việc provision thật là `pulumi up` do operator chạy có chủ đích, ngoài đường
 * release của application — xem `docs/overview/02-delivery.md` §7.4.1.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Tên Pulumi project khai trong manifest, hoặc lý do không dùng được. */
export function readPulumiProjectName(manifest: string): { name: string } | { error: string } {
  if (!existsSync(manifest)) {
    return { error: `không tìm thấy Pulumi.yaml tại ${manifest}` };
  }
  const name = readFileSync(manifest, 'utf8')
    .match(/^name:\s*(.+)$/mu)?.[1]
    ?.trim();
  if (!name) {
    return { error: `${manifest} không khai báo trường name:` };
  }
  return { name };
}

/**
 * Fail-closed: thiếu manifest hoặc thiếu `name:` đều exit 1.
 *
 * Target im lặng exit 0 trên project hỏng là hợp đồng thứ tự trông xanh trong
 * khi không kiểm được gì — nên lỗi phải nổi lên chứ không nuốt.
 */
export function provisionGate(projectRoot: string = process.cwd()): number {
  const result = readPulumiProjectName(join(projectRoot, 'Pulumi.yaml'));
  if ('error' in result) {
    console.error(`[provision] ${result.error}`);
    return 1;
  }
  console.log(`[provision] ${result.name} — dry-run, không provision gì.`);
  return 0;
}
