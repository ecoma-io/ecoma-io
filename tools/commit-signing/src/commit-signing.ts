/**
 * Chính sách commit signing: ba gate ở ba thời điểm mỗi thời điểm có thể hành động.
 *
 * ## Vì sao không dùng `git log --format=%G?`
 *
 * `%G?` là *trạng thái xác minh*, không phải *sự tồn tại của chữ ký*. GitHub ký
 * merge commit bằng PGP key của chính GitHub, key đó không nằm trong local
 * keyring, nên `%G?` trả `E` (cannot check) cho đa số commit hợp lệ — đo trên
 * lịch sử thật của repository này là 70/79 commit. `git verify-commit` còn tệ
 * hơn: nó exit 1 trên chính những commit đó.
 *
 * Nên gate dựa trên **raw commit object**: `git cat-file commit <sha>` cho ra
 * header của object, và một commit có chữ ký khi và chỉ khi header ấy chứa một
 * dòng bắt đầu bằng `gpgsig `. Cách này offline, deterministic, không phụ thuộc
 * keyring — cùng nguyên tắc "deterministic and offline" mà `pr-check` giữ.
 *
 * Ranh giới mà gate này cố ý không vươn tới: nó chứng minh commit **có** chữ ký,
 * không chứng minh chữ ký ấy hợp lệ hay map tới account GitHub nào. Việc đó là
 * của GitHub (`verification.verified`) và của `gh` sau khi push.
 *
 * ## Vì sao header, không phải cả object
 *
 * Commit *message* được phép chứa một dòng bắt đầu bằng `gpgsig ` — git không
 * cấm, và đã tạo thử để xác nhận. Quét cả object sẽ báo động giả cho một commit
 * không hề có chữ ký. Header kết thúc ở dòng trống đầu tiên; phần body của
 * `gpgsig` là các dòng tiếp nối thụt đầu bằng một space.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { ROOT_DIR, gitEnv } from './utils';

/** `gpg.format` mà git chấp nhận; xem `git help config`. */
const SIGNING_FORMATS = ['openpgp', 'x509', 'ssh'] as const,
  /**
   * SHA-1 đầy đủ của một commit object.
   *
   * `git cat-file --batch` nhận đúng SHA này; chặn ở đây thay vì để git báo lỗi mơ
   * hồ, và để không nối một chuỗi do output của git cung cấp vào command khác.
   */
  COMMIT_ID = /^[0-9a-f]{40}$/u;

/**
 * Header của commit object có dòng chữ ký không.
 *
 * Chỉ phần trước dòng trống đầu tiên được xét — xem `gpgsig` trong JSDoc module.
 * `gpgsig-sha256` cũng là một dòng chữ ký (chữ ký bên cạnh của SHA-256), nên nó
 * được tính như `gpgsig`.
 */
export function headerHasSignature(commitObject: string): boolean {
  const header = commitObject.split('\n\n', 1)[0] ?? '';

  return /^gpgsig(-sha256)? /mu.test(header);
}

export type ConfigProblem = string;

/**
 * Cấu hình ký có đủ để git ký commit không.
 *
 * Đây là gate cho `pre-commit`, nơi commit **chưa** tồn tại: lúc hook chạy,
 * `HEAD` vẫn là commit trước đó, nên không có object nào để kiểm. Thứ duy nhất
 * pre-commit kiểm được là cấu hình — và cấu hình chính là nguyên nhân gốc của
 * việc mất chữ ký: `git rebase`/`amend` tái tạo commit bằng `commit.gpgsign`
 * hiện hành, nên một lần drift cấu hình âm thầm bỏ chữ ký đi mà không báo lỗi.
 *
 * `user.signingkey` chỉ được kiểm tồn tại khi `gpg.format=ssh`: ở `openpgp`/`x509`
 * nó là key ID hoặc tên, không phải đường dẫn file, nên `existsSync` sẽ báo sai.
 *
 * `readConfig` tiêm vào để test không cần git thật; mặc định đọc `git config`.
 */
export function checkSigningConfig(
  readConfig: (key: string) => string | undefined = defaultConfigReader(),
): ConfigProblem[] {
  const problems: ConfigProblem[] = [],
    gpgSign = readConfig('commit.gpgsign');
  if (gpgSign !== 'true') {
    problems.push(
      `commit.gpgsign must be "true" (current: ${describe(gpgSign)}); git would create unsigned commits.`,
    );
  }

  const format = readConfig('gpg.format');
  if (
    format !== undefined &&
    !SIGNING_FORMATS.includes(format as (typeof SIGNING_FORMATS)[number])
  ) {
    problems.push(
      `gpg.format must be one of ${SIGNING_FORMATS.join(', ')} (current: ${describe(format)}).`,
    );
  }

  // Chỉ `ssh` mới trỏ user.signingkey tới một file trên đĩa.
  if (format === 'ssh') {
    const key = readConfig('user.signingkey');
    if (key === undefined || key === '') {
      problems.push('gpg.format is "ssh" but user.signingkey is not set.');
    } else if (!existsSync(key)) {
      problems.push(`user.signingkey points at a missing file: ${key}`);
    }
  }

  return problems;
}

/**
 * Reader mặc định: `git config --get`, trả `undefined` khi key không được set.
 *
 * Export để test đọc được config từ một repository thật; mặc định là repository
 * này.
 */
export function defaultConfigReader(cwd: string = ROOT_DIR): (key: string) => string | undefined {
  return (key) => {
    try {
      const value = execFileSync('git', ['config', '--get', key], {
        cwd,
        encoding: 'utf8',
        env: gitEnv(),
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      return value.trim() === '' ? undefined : value.trim();
    } catch {
      return;
    }
  };
}

function describe(value: string | undefined): string {
  return value === undefined ? 'unset' : `"${value}"`;
}

export type CommitListing = { ok: true; commits: string[] } | { ok: false; reason: string };

/**
 * Commit đang trỏ tới bởi `HEAD`, hoặc `undefined` khi repository chưa có commit.
 *
 * Repo rỗng là một trường hợp hợp lệ, không phải lỗi: `git commit` đầu tiên sẽ tạo
 * ra `HEAD`, và lúc đó chính hook mới kiểm. Nên nó phân biệt với `ok: false` — một
 * repo không đọc được `HEAD` thì gate fail closed.
 */
export type HeadLookup = { ok: true; sha: string | undefined } | { ok: false; reason: string };

/**
 * `HEAD` hiện tại.
 *
 * `git rev-parse --verify HEAD` tự fail khi chưa có commit, nên phân biệt "repo
 * chưa có commit" với "git không chạy được" bằng exit code rồi mới quyết định —
 * stderr của git không phải hợp đồng ổn định để dự vào.
 */
export function readHeadFromGit(cwd: string = ROOT_DIR): HeadLookup {
  try {
    const output = execFileSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {
        cwd,
        encoding: 'utf8',
        env: gitEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      sha = output.trim();

    if (!COMMIT_ID.test(sha)) {
      return { ok: false, reason: `git rev-parse did not return a commit id: "${sha}".` };
    }

    return { ok: true, sha };
  } catch (error) {
    const code = (error as { status?: number } | null)?.status;

    if (code === 1) {
      return { ok: true, sha: undefined };
    }

    return {
      ok: false,
      reason: `git could not read HEAD: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Các commit chưa có trên bất kỳ remote nào.
 *
 * Đây là phần tối ưu tốc độ: gate chỉ xét commit **sắp được đẩy lên**, không
 * đi qua toàn bộ lịch sử. Nhánh đã đồng bộ với remote trả về danh sách rỗng và
 * gate thoát ngay, thay vì phải đọc lại mọi commit từng tồn tại.
 *
 * Dùng `--not --remotes` chứ không phải `--not --remotes=origin` vì lefthook đã
 * nuốt mất stdin của pre-push (đo được 0 byte, kể cả với
 * `LEFTHOOK_LEGACY_STDIN=1`) và không expose biến nào cho ref đang đẩy — không
 * có cách nào biết tên remote. `--not --remotes` không cần tên remote và bảo thủ
 * hơn: một commit đã có trên remote nào đó không bị coi là cần kiểm.
 *
 * Ranh giới đã biết: range lấy từ `HEAD`, nên đẩy một nhánh cục bộ **khác**
 * không thấy commit nào và gate pass. `--branches` đóng được lỗ hổng đó nhưng
 * lại quét cả nhánh không liên quan, tức không còn là "đúng cái đang đẩy".
 *
 * Repo không có remote nào thì mọi commit đều chưa từng được đẩy và xuất hiện
 * trong danh sách — đúng như tên gọi, và an toàn hơn là bỏ qua.
 */
export function listUnpushedCommits(cwd: string = ROOT_DIR): CommitListing {
  try {
    const output = execFileSync('git', ['rev-list', 'HEAD', '--not', '--remotes'], {
        cwd,
        encoding: 'utf8',
        env: gitEnv(),
        maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
      commits = output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
      malformed = commits.find((commit) => !COMMIT_ID.test(commit));
    if (malformed !== undefined) {
      return {
        ok: false,
        reason: `git rev-list returned something that is not a commit id: "${malformed}".`,
      };
    }

    return { commits, ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: `git could not list the unpushed commits: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export type SignatureCheck = { ok: true; unsigned: string[] } | { ok: false; reason: string };

/**
 * Parse đầu ra raw của `git cat-file --batch` thành danh sách commit chưa ký.
 *
 * Tách khỏi spawn git để test tái tạo được chính các trường hợp lệch format mà
 * parser phải fail closed: output đứt giữa chừng, descriptor lệch id, object
 * thiếu, type không phải `commit`.
 *
 * `--batch` trả về, với mỗi SHA trên stdin: một dòng `<sha> <type> <size>` theo
 * sau bởi đúng `size` byte nội dung object rồi một newline. Dùng `size` để cắt
 * thay vì dò tìm dòng trống: kích thước là thứ git cam kết, còn dòng trống thì
 * message của commit tự do chứa.
 */
export function parseCatFileBatch(
  commits: string[],
  output: Buffer,
): { ok: true; unsigned: string[] } | { ok: false; reason: string } {
  const unsigned: string[] = [];
  let cursor = 0;

  for (const commit of commits) {
    const newline = output.indexOf(NEWLINE, cursor);
    if (newline === -1) {
      return { ok: false, reason: `git cat-file output ended before describing ${commit}.` };
    }

    // `git rev-list` chỉ trả SHA của commit, nên type phải là `commit`; nếu
    // Không phải thì output đã lệch với danh sách và không còn tin được.
    const descriptor = output.toString('utf8', cursor, newline),
      match = /^([0-9a-f]{40}) commit (\d+)$/u.exec(descriptor);
    if (match === null || match[1] !== commit) {
      return {
        ok: false,
        reason: `git cat-file did not return the commit object for ${commit}: "${descriptor}".`,
      };
    }

    const start = newline + 1,
      end = start + Number(match[2]);
    if (end > output.length) {
      return { ok: false, reason: `git cat-file truncated the object for ${commit}.` };
    }

    if (!headerHasSignature(output.toString('utf8', start, end))) {
      unsigned.push(commit);
    }

    // `end` trỏ vào newline phân cách mà git thêm sau object; dòng descriptor
    // Kế tiếp bắt đầu ngay sau nó. Bỏ qua newline này, nếu không dòng descriptor
    // Kế tiếp sẽ là chuỗi rỗng.
    cursor = end + 1;
  }

  return { ok: true, unsigned };
}

function readCommitObjectsFromGit(commits: string[], cwd: string = ROOT_DIR): SignatureCheck {
  try {
    const output = execFileSync('git', ['cat-file', '--batch'], {
      cwd,
      // `null` để nhận Buffer: cần cắt theo **byte** để đọc đúng `size` mà git
      // Cam kết, và chuyển sang string sẽ phá vỡ ranh giới đó khi commit message
      // Chứa ký tự nhiều byte.
      encoding: undefined,
      env: gitEnv(),
      input: `${commits.join('\n')}\n`,
      maxBuffer: 64 * 1024 * 1024,
    });

    return parseCatFileBatch(commits, output);
  } catch (error) {
    return {
      ok: false,
      reason: `git could not read the commits to check: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

const NEWLINE = 0x0a;

export interface SigningCheckDeps {
  /**
   * Repo cần kiểm; bỏ trống thì là repository này.
   *
   * `cwd` có mặt như ở `pr-check` để test chạy git thật trên một fixture tạm
   * thay vì phải stub ra hai lớp reader — git là thứ đang được kiểm, mock nó
   * thì test chỉ chứng minh chính nó.
   */
  cwd?: string;
  /** Bỏ trống thì đọc `git config` thật; test truyền reader giả. */
  readConfig?: (key: string) => string | undefined;
  /** Bỏ trống thì liệt kê bằng git thật; test truyền danh sách giả. */
  listCommits?: () => CommitListing;
  /** Bỏ trống thì đọc object bằng git thật; test truyền nguồn giả. */
  readObjects?: (commits: string[]) => SignatureCheck;
  /** Bỏ trống thì đọc `HEAD` bằng git thật; test truyền nguồn giả. */
  head?: () => HeadLookup;
}

export type SigningCheckResult = { ok: true; checked: number } | { ok: false; problems: string[] };

/**
 * Gate `pre-push`: chữ ký thật của các commit chưa có trên remote.
 *
 * Trả về `checked` là số commit đã xét để hook báo cáo minh bạch — 0 nghĩa là
 * không có gì để kiểm, tức gate chạy xong mà không đọc object nào.
 */
export function checkPushedCommitSignatures(deps: SigningCheckDeps = {}): SigningCheckResult {
  const listCommits = deps.listCommits ?? ((): CommitListing => listUnpushedCommits(deps.cwd)),
    readObjects =
      deps.readObjects ??
      ((commits: string[]): SignatureCheck => readCommitObjectsFromGit(commits, deps.cwd)),
    listed = listCommits();

  if (!listed.ok) {
    return { ok: false, problems: [listed.reason] };
  }

  if (listed.commits.length === 0) {
    return { checked: 0, ok: true };
  }

  const checked = readObjects(listed.commits);

  if (!checked.ok) {
    return { ok: false, problems: [checked.reason] };
  }

  if (checked.unsigned.length > 0) {
    return {
      ok: false,
      problems: [
        `${checked.unsigned.length} of ${listed.commits.length} unpushed commit(s) are not signed:`,
        ...checked.unsigned.map((commit) => `- ${commit}`),
        'Sign them with `git rebase --exec "git commit --amend --no-edit -S"`, or push with --no-verify.',
      ],
    };
  }

  return { checked: listed.commits.length, ok: true };
}

/**
 * Gate `post-commit`: commit **vừa** tạo có chữ ký không.
 *
 * Vì sao cần gate thứ ba: `pre-commit` không thấy commit sắp tạo, nên nó chỉ kiểm
 * được cấu hình. `pre-push` thì kiểm được, nhưng lefthook **bỏ qua mọi command
 * pre-push khi lần push không đổi file nào** — đo được trên chính repo này: một
 * commit `--allow-empty` làm cả `lint`/`test` sẵn có bị skip, và khai báo `files`
 * với một glob toàn phần cũng không cứu được. Đúng lúc đó một commit unsigned lọt
 * thẳng lên remote. `post-commit` không có giới hạn đó: lefthook chạy nó sau mỗi
 * `git commit`, kể cả dưới `--no-verify`.
 *
 * Ranh giới phải nói rõ: `post-commit` **không** chặn được. Commit đã được tạo, exit
 * 1 vẫn để nó tồn tại và `git commit` vẫn trả 0. Hook này chỉ để báo ngay tại chỗ, kèm
 * lệnh sửa cụ thể; `pre-push` mới là chốt chặn thật. Nói rõ điều đó trong chính message
 * thay vì để ai đó tin là hook đã ngăn được commit.
 */
export function checkHeadCommitSignature(deps: SigningCheckDeps = {}): SigningCheckResult {
  const head = deps.head ?? ((): HeadLookup => readHeadFromGit(deps.cwd)),
    listed = head();

  if (!listed.ok) {
    return { ok: false, problems: [listed.reason] };
  }

  if (listed.sha === undefined) {
    return { checked: 0, ok: true };
  }

  const readObjects =
      deps.readObjects ??
      ((commits: string[]): SignatureCheck => readCommitObjectsFromGit(commits, deps.cwd)),
    checked = readObjects([listed.sha]);

  if (!checked.ok) {
    return { ok: false, problems: [checked.reason] };
  }

  if (checked.unsigned.includes(listed.sha)) {
    return {
      ok: false,
      problems: [
        `The commit just created is not signed: ${listed.sha}`,
        'Sign it with `git commit --amend --no-edit -S`.',
        'This hook cannot undo the commit; pre-push will refuse to push it.',
      ],
    };
  }

  return { checked: 1, ok: true };
}
