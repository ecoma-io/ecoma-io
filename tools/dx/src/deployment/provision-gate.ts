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
 * Đọc marker `ecoma.deployment.status` trong `package.json` của deploy project
 * (marker do arch-check đảm bảo khớp với `DEPLOYMENT_MAP`): project `scaffold`
 * in thêm một dòng tường minh — nó là placeholder, chưa quản lý resource nào,
 * nên "provision xong" ở đây là KHÔNG có gì để provision. Vẫn exit 0: cổng
 * này là cổng hiển thị kế hoạch, không phải gate cấm scaffold chạy provision.
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
 * Đọc marker `ecoma.deployment.status` từ `package.json` cạnh manifest.
 * Trả `undefined` khi file không tồn tại, không parse được, hoặc thiếu marker:
 * marker là dữ liệu arch-check đảm bảo, còn provision-gate chỉ ĐỌC để in
 * cảnh báo — thiếu marker không được biến cổng dry-run thành fail.
 */
export function readDeploymentStatus(
  packageJsonPath: string,
): 'implemented' | 'scaffold' | undefined {
  try {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      ecoma?: { deployment?: { status?: string } };
    };
    const status = pkg.ecoma?.deployment?.status;
    return status === 'implemented' || status === 'scaffold' ? status : undefined;
  } catch {
    return undefined;
  }
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
  const status = readDeploymentStatus(join(projectRoot, 'package.json'));
  if (status === 'scaffold') {
    console.log(
      `[provision] ${result.name} is a scaffold — no managed resources; nothing to provision.`,
    );
  }
  console.log(`[provision] ${result.name} — dry-run, không provision gì.`);
  return 0;
}
