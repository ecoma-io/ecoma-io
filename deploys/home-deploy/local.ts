/**
 * Entry lifecycle local của `home-deploy` — `up`/`down` trên stack Pulumi của
 * CHÍNH project này; thứ tự toàn cục do Nx suy từ `dependsOn` của package.json
 * (home chạy ngay sau platform — node đầu tiên đọc outputs platform qua
 * StackReference).
 *
 * Chạy qua target Nx: `nx run home-deploy:local-up -c local` → `npx tsx
 * local.ts up`. Entry KHÔNG lấy khóa lane: lifecycle không còn khóa toàn cục (xem quyết định kiến trúc PR #424).
 *
 * Home KHÔNG có bảng secret riêng: image build từ repo (Dockerfile COPY
 * `apps/home/`), container đọc `namespace:platformStackRef` từ config do
 * `pulumiUpForEntry` truyền, không secret nào khác cần set.
 */
// oxlint-disable no-console -- entry CLI chạy trên Node; console là kênh
// output DUY NHẤT của lifecycle gate (nx:run-commands gộp stdout/stderr).

// Import **nguồn** `tools/dx` — cùng quy ước với `index.ts` của project này
// (specifier extensionless, disable module-boundary từng dòng; xem comment
// block import của `index.ts`).
// oxlint-disable-next-line @nx/enforce-module-boundaries -- xem giải thích ngay trên
import {
  pulumiDestroyForEntry,
  pulumiUpForEntry,
  resolveEntryFoundation,
  waitForOwnContainerHealthy,
} from '../../tools/dx/src/deployment/local-platform/local-entry';

async function main(command: string): Promise<number> {
  if (command === 'up') {
    const foundation = resolveEntryFoundation(true);
    if (foundation === undefined) {
      return 1;
    }
    try {
      pulumiUpForEntry('home-deploy', foundation);
    } catch (error) {
      console.error(
        `[home-deploy] up failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
    // Health gate container CỦA CHÍNH unit — home (server container).
    return waitForOwnContainerHealthy(foundation.ctx, 'home');
  }
  if (command === 'down') {
    const foundation = resolveEntryFoundation(false);
    if (foundation === undefined) {
      console.log(
        '[home-deploy] this worktree has never deployed (no .pulumi-local-state) — down is a no-op.',
      );
      return 0;
    }
    try {
      pulumiDestroyForEntry('home-deploy', foundation);
      return 0;
    } catch (error) {
      console.error(
        `[home-deploy] down failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 1;
    }
  }
  console.error(`[home-deploy] unknown command: ${command} (expected: up | down)`);
  return 1;
}

const args = process.argv.slice(2);
const command = args[0] ?? '';
void main(command).then((code) => {
  process.exit(code);
});
