import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkHeadCommitSignature,
  checkPushedCommitSignatures,
  checkSigningConfig,
  defaultConfigReader,
  headerHasSignature,
  listUnpushedCommits,
  parseCatFileBatch,
  readHeadFromGit,
} from './commit-signing.js';
import { gitEnv } from './utils';

const tempDirs: string[] = [];

/**
 * Env cho git chạy trên repo tạm: `gitEnv()` từ utils scrub mọi biến `GIT_*`.
 *
 * Cùng lý do `pr-check` làm vậy — git export `GIT_DIR` cho hooks, và giá trị
 * đó thắng `cwd`, nên không scrub thì fixture ghim vào repo thật của workspace.
 */
function git(repo: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: gitEnv() });
}

/** Repo git thật trong thư mục tạm, không remote và không ký. */
function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dx-signing-repo-'));
  tempDirs.push(dir);

  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'dx@example.com');
  git(dir, 'config', 'user.name', 'dx');
  // Tắt signing: máy dev có thể bật signing toàn cục, còn fixture không có key.
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'gpg.format', 'openpgp');

  return dir;
}

function commit(repo: string, message: string, args: string[] = []): string {
  git(repo, 'commit', '--allow-empty', '-q', '-m', message, ...args);

  return git(repo, 'rev-parse', 'HEAD').trim();
}

/** Đặt `HEAD` hiện tại làm gốc đã đẩy, để `rev-list --not --remotes` rỗng. */
function markAsPushed(repo: string): void {
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe('headerHasSignature', () => {
  it('detects a gpgsig header', () => {
    expect.hasAssertions();
    const object = [
      'tree 35dd59a5ff087f95771648f651da6c42a463c1c',
      'parent 2d3f5d09699c9125c62fe2cc8806ee6875b7279e',
      'author dx <dx@example.com> 1791825252 +0700',
      'committer dx <dx@example.com> 1791825252 +0700',
      'gpgsig -----BEGIN PGP SIGNATURE-----',
      ' ',
      ' iQEzBAABCgAdFiEE0000',
      ' -----END PGP SIGNATURE-----',
      '',
      'the message',
    ].join('\n');

    expect(headerHasSignature(object)).toBe(true);
  });

  it('detects a gpgsig-sha256 header, the companion of the SHA-1 signature', () => {
    expect.hasAssertions();
    const object = [
      'committer dx <dx@example.com> 1791825252 +0700',
      'gpgsig-sha256 -----BEGIN SIGNATURE-----',
      '',
    ].join('\n');

    expect(headerHasSignature(object)).toBe(true);
  });

  it('reports no signature for a plain commit', () => {
    expect.hasAssertions();
    const object = ['committer dx <dx@example.com> 1791825252 +0700', '', 'the message'].join('\n');

    expect(headerHasSignature(object)).toBeFalsy();
  });

  // Commit message được git cho phép chứa bất kỳ dòng nào, kể cả dòng trông
  // Giống hệt header chữ ký. Quét cả object thay vì chỉ header sẽ coi commit
  // Không hề có chữ ký là đã ký — một bypass không cần khoá gì cả.
  it('ignores a gpgsig line inside the commit message', () => {
    expect.hasAssertions();
    const object = [
      'committer dx <dx@example.com> 1791825252 +0700',
      '',
      'spoof attempt',
      '',
      'gpgsig FAKE not a real signature',
    ].join('\n');

    expect(headerHasSignature(object)).toBeFalsy();
  });

  it('ignores a gpgsig mention that is not at the start of a line', () => {
    expect.hasAssertions();
    const object = [
      'committer dx <dx@example.com> 1791825252 +0700',
      '',
      'see gpgsig for details',
    ].join('\n');

    expect(headerHasSignature(object)).toBeFalsy();
  });
});

/**
 * Reader giả ném lỗi, để chứng minh nó **không** được gọi.
 *
 * Ở đây chính là điều kiện quan trọng: fast path của gate không được phát sinh
 * lệnh git nào.
 */
/** Dựng đúng format git cam kết: descriptor `<sha> commit <size>`, `size` byte object, một newline phân cách. */
function batchEntry(sha: string, object: string): Buffer {
  return Buffer.concat([
    Buffer.from(`${sha} commit ${Buffer.byteLength(object)}\n`),
    Buffer.from(object),
    Buffer.from('\n'),
  ]);
}

describe('parseCatFileBatch', () => {
  const signedObject = ['tree a', 'gpgsig -----BEGIN PGP SIGNATURE-----', '', 'msg'].join('\n'),
    unsignedObject = ['tree a', '', 'msg'].join('\n');

  it('splits a batch of one signed and one unsigned commit', () => {
    expect.hasAssertions();
    const sha1 = 'a'.repeat(40),
      sha2 = 'b'.repeat(40),
      output = Buffer.concat([batchEntry(sha1, signedObject), batchEntry(sha2, unsignedObject)]);

    expect(parseCatFileBatch([sha1, sha2], output)).toStrictEqual({ ok: true, unsigned: [sha2] });
  });

  it('keeps byte boundaries when the message contains multi-byte characters', () => {
    expect.hasAssertions();
    const sha = 'a'.repeat(40),
      // Thân message chứa ký tự nhiều byte: cắt theo ký tự thay vì byte sẽ lệch
      // Ranh giới của object kế tiếp (hoặc cuối batch).
      object = `tree a\n\nhéllo — ${'ě'.repeat(5)}`,
      output = Buffer.concat([batchEntry(sha, object), batchEntry(sha, object)]);

    expect(parseCatFileBatch([sha, sha], output)).toStrictEqual({ ok: true, unsigned: [sha, sha] });
  });

  it('fails closed when the output ends before describing every commit', () => {
    expect.hasAssertions();
    const sha = 'a'.repeat(40),
      result = parseCatFileBatch([sha], Buffer.from(''));

    expect(result.ok).toBeFalsy();
    expect(result.ok ? '' : result.reason).toContain(`ended before describing ${sha}`);
  });

  it('fails closed when the descriptor is not "<sha> commit <size>"', () => {
    expect.hasAssertions();
    const sha = 'a'.repeat(40),
      // `cat-file --batch` trả "<id> missing" cho id không tồn tại.
      output = Buffer.from(`${sha} missing\n`),
      result = parseCatFileBatch([sha], output);

    expect(result.ok).toBeFalsy();
    expect(result.ok ? '' : result.reason).toContain('did not return the commit object');
  });

  it('fails closed when the descriptor names a different commit', () => {
    expect.hasAssertions();
    const output = Buffer.concat([batchEntry('b'.repeat(40), unsignedObject)]),
      result = parseCatFileBatch(['a'.repeat(40)], output);

    expect(result.ok).toBeFalsy();
    expect(result.ok ? '' : result.reason).toContain('did not return the commit object');
  });

  it('fails closed when the object is truncated against the declared size', () => {
    expect.hasAssertions();
    const sha = 'a'.repeat(40),
      // Descriptor cam kết size lớn hơn số byte thực có: không đọc đủ object thì
      // Không được phán quyết chữ ký.
      output = Buffer.from(`${sha} commit 1000\nshort\n`),
      result = parseCatFileBatch([sha], output);

    expect(result.ok).toBeFalsy();
    expect(result.ok ? '' : result.reason).toContain('truncated');
  });
});

describe('defaultConfigReader', () => {
  it('reads a set key from a real repository', () => {
    expect.hasAssertions();
    const repo = initRepo();
    git(repo, 'config', 'commit.gpgsign', 'true');

    expect(defaultConfigReader(repo)('commit.gpgsign')).toBe('true');
  });

  it('returns undefined when the key is not set anywhere', () => {
    expect.hasAssertions();
    // Fixture set `commit.gpgsign=false`, và global config của máy chạy test có
    // Thể set thêm gì đó; dùng key không ai set để chứng minh nhánh "exit 1 là
    // Kết quả hợp lệ, không phải lỗi".
    expect(defaultConfigReader(initRepo())('dx.nosuchkey.anywhere')).toBeUndefined();
  });
});

describe('checkSigningConfig', () => {
  // Đường dẫn không tồn tại: rule "ssh thì user.signingkey phải là file có thật"
  // Là thứ duy nhất ở đây bắt được, và nó phải bắt đúng một lỗi.
  const missingKey = join(tmpdir(), 'dx-signing-no-such-key.pub');

  it('reports a missing signing key file for ssh signing', () => {
    expect.hasAssertions();
    const problems = checkSigningConfig((key) => {
      const config: Record<string, string> = {
        'commit.gpgsign': 'true',
        'gpg.format': 'ssh',
        'user.signingkey': missingKey,
      };

      return config[key];
    });

    expect(problems).toStrictEqual([`user.signingkey points at a missing file: ${missingKey}`]);
  });

  it('reports an unset signing key for ssh signing', () => {
    expect.hasAssertions();
    const problems = checkSigningConfig((key) => {
      const config: Record<string, string> = { 'commit.gpgsign': 'true', 'gpg.format': 'ssh' };

      return config[key];
    });

    expect(problems).toStrictEqual(['gpg.format is "ssh" but user.signingkey is not set.']);
  });

  it('requires commit.gpgsign to be true', () => {
    expect.hasAssertions();
    const problems = checkSigningConfig((key) => (key === 'commit.gpgsign' ? 'false' : undefined));

    expect(problems).toStrictEqual([
      'commit.gpgsign must be "true" (current: "false"); git would create unsigned commits.',
    ]);
  });

  it('treats an unset commit.gpgsign as missing, since git then does not sign', () => {
    expect.hasAssertions();
    const problems = checkSigningConfig(() => {
      /* Empty */
    });

    expect(problems[0]).toContain('(current: unset)');
  });

  // Lọc theo tiền tố của câu chữ định dạng hợp lệ; ở `ssh`, gate còn một rule
  // Riêng về `user.signingkey`, và rule đó không thuộc phạm vi case này.
  const FORMAT_RULE = 'gpg.format must be one of';

  it('accepts the signing formats git supports', () => {
    expect.hasAssertions();
    for (const format of ['openpgp', 'x509', 'ssh']) {
      const problems = checkSigningConfig((key) => {
        const config: Record<string, string> = { 'commit.gpgsign': 'true', 'gpg.format': format };

        return config[key];
      });

      expect(problems.filter((problem) => problem.startsWith(FORMAT_RULE))).toStrictEqual([]);
    }
  });

  it('rejects an unknown gpg.format', () => {
    expect.hasAssertions();
    const problems = checkSigningConfig((key) => {
      const config: Record<string, string> = { 'commit.gpgsign': 'true', 'gpg.format': 'bogus' };

      return config[key];
    });

    expect(problems).toStrictEqual([
      'gpg.format must be one of openpgp, x509, ssh (current: "bogus").',
    ]);
  });

  it('accepts an unset gpg.format, because git defaults it to openpgp', () => {
    expect.hasAssertions();
    const problems = checkSigningConfig((key) => (key === 'commit.gpgsign' ? 'true' : undefined));

    expect(problems).toStrictEqual([]);
  });

  // `user.signingkey` chỉ là đường dẫn file ở format ssh; ở openpgp/x509 nó là
  // Key ID, nên kiểm "file có tồn tại không" ở hai format đó sẽ báo nhầm.
  it('does not require user.signingkey to exist for a non-ssh format', () => {
    expect.hasAssertions();
    const problems = checkSigningConfig((key) => {
      const config: Record<string, string> = {
        'commit.gpgsign': 'true',
        'gpg.format': 'openpgp',
        'user.signingkey': 'ABC1234567',
      };

      return config[key];
    });

    expect(problems).toStrictEqual([]);
  });

  it('reports every problem at once, so one run names all of them', () => {
    expect.hasAssertions();
    const problems = checkSigningConfig((key) => {
      const config: Record<string, string> = { 'commit.gpgsign': 'false', 'gpg.format': 'nope' };

      return config[key];
    });

    expect(problems).toHaveLength(2);
  });
});

describe('listUnpushedCommits', () => {
  it('lists nothing for a branch already pushed', () => {
    expect.hasAssertions();
    const repo = initRepo();
    commit(repo, 'chore: pushed already');
    markAsPushed(repo);

    expect(listUnpushedCommits(repo)).toStrictEqual({ commits: [], ok: true });
  });

  it('lists only the commits missing from the remote', () => {
    expect.hasAssertions();
    const repo = initRepo(),
      first = commit(repo, 'chore: first');
    markAsPushed(repo);
    const second = commit(repo, 'chore: second');

    // Đây là phần tối ưu tốc độ: một nhánh dài không bị quét lại toàn bộ.
    expect(listUnpushedCommits(repo)).toStrictEqual({ commits: [second], ok: true });
    expect(first).not.toStrictEqual(second);
  });

  it('treats a repository with no remote as having everything unpushed', () => {
    expect.hasAssertions();
    const repo = initRepo();
    commit(repo, 'chore: local only');

    const listed = listUnpushedCommits(repo);

    expect(listed.ok).toBe(true);
    expect(listed.ok && listed.commits).toHaveLength(1);
  });

  it('fails closed outside a git repository', () => {
    expect.hasAssertions();
    const dir = mkdtempSync(join(tmpdir(), 'dx-signing-norepo-'));
    tempDirs.push(dir);

    const listed = listUnpushedCommits(dir);

    expect(listed.ok).toBeFalsy();
  });
});

describe('checkPushedCommitSignatures', () => {
  // Ký thật bằng khoá SSH có sẵn trên máy: chữ ký là thứ đang được kiểm, nên
  // Fixture phải tạo ra chữ ký thật chứ không giả lập object. Khoá là điều kiện
  // Của máy chạy test, không phải thứ repo kiểm soát — không có thì bỏ qua
  // Thay vì báo xanh giả.
  const signingKey = process.env.SSH_SIGNING_KEY;

  it('accepts a signed commit that is not on any remote yet', () => {
    if (signingKey === undefined) {
      // Máy không có khoá để ký: không thể tạo ra chữ ký thật, và một fixture
      // Giả lập thì chỉ chứng minh chính nó. Bỏ case, không báo xanh.
      return;
    }

    expect.hasAssertions();

    const repo = initRepo();
    git(repo, 'config', 'gpg.format', 'ssh');
    git(repo, 'config', 'user.signingkey', signingKey);
    git(repo, 'config', 'commit.gpgsign', 'true');

    const signed = commit(repo, 'chore: signed');

    expect(checkPushedCommitSignatures({ cwd: repo })).toStrictEqual({ checked: 1, ok: true });
    expect(git(repo, 'cat-file', 'commit', signed)).toContain('gpgsig ');
  });

  it('rejects an unsigned commit and names its id', () => {
    expect.hasAssertions();
    const repo = initRepo(),
      unsigned = commit(repo, 'chore: unsigned'),
      result = checkPushedCommitSignatures({ cwd: repo });

    expect(result.ok).toBeFalsy();
    expect(result.ok === false && result.problems.join('\n')).toContain(unsigned);
  });

  // Commit đã lên remote không thuộc phạm vi của lần push này, nên không được
  // Kéo vào kiểm — đó là ý nghĩa của việc chỉ xét commit chưa đẩy.
  it('ignores an unsigned commit that is already on the remote', () => {
    expect.hasAssertions();
    const repo = initRepo();
    commit(repo, 'chore: old unsigned');
    markAsPushed(repo);

    expect(checkPushedCommitSignatures({ cwd: repo })).toStrictEqual({ checked: 0, ok: true });
  });

  it('reports the single unsigned commit among several signed ones', () => {
    expect.hasAssertions();
    const repo = initRepo();
    commit(repo, 'chore: unsigned one');
    markAsPushed(repo);
    const alsoUnsigned = commit(repo, 'chore: unsigned two'),
      result = checkPushedCommitSignatures({ cwd: repo });

    expect(result.ok).toBeFalsy();
    expect(result.ok === false && result.problems[0]).toBe(
      '1 of 1 unpushed commit(s) are not signed:',
    );
    expect(result.ok === false && result.problems).toContain(`- ${alsoUnsigned}`);
  });

  it('checks nothing and passes on a branch already in sync', () => {
    expect.hasAssertions();
    const repo = initRepo();
    commit(repo, 'chore: pushed');
    markAsPushed(repo);

    expect(checkPushedCommitSignatures({ cwd: repo })).toStrictEqual({ checked: 0, ok: true });
  });

  it('fails closed when the commits cannot be listed', () => {
    expect.hasAssertions();
    const result = checkPushedCommitSignatures({
      listCommits: () => ({ ok: false, reason: 'git broke' }),
    });

    expect(result).toStrictEqual({ ok: false, problems: ['git broke'] });
  });

  it('fails closed when git cannot read the objects from disk', () => {
    expect.hasAssertions();
    // Spawn lỗi (repo không tồn tại) là một nhánh khác với output lệch format:
    // Catch của readCommitObjectsFromGit phải fail closed riêng.
    const result = checkPushedCommitSignatures({
      cwd: join(tmpdir(), 'does-not-exist'),
      listCommits: () => ({ commits: ['a'.repeat(40)], ok: true }),
    });

    expect(result.ok).toBeFalsy();
    expect(result.ok ? '' : result.problems[0]).toContain('could not read the commits');
  });

  it('fails closed when the commit objects cannot be read', () => {
    expect.hasAssertions();
    const result = checkPushedCommitSignatures({
      listCommits: () => ({ commits: ['a'.repeat(40)], ok: true }),
      readObjects: () => ({ ok: false, reason: 'cat-file broke' }),
    });

    expect(result).toStrictEqual({ ok: false, problems: ['cat-file broke'] });
  });

  it('fails closed when git returns an object that is not a commit', () => {
    expect.hasAssertions();
    // Một id không tồn tại khiến `cat-file --batch` trả dòng "<id> missing"; nếu
    // Parser chấp nhận nó thì gate sẽ báo "không có chữ ký" cho một thứ không
    // Phải commit, tức im lặng thay vì fail closed.
    const repo = initRepo();
    commit(repo, 'chore: real');

    const result = checkPushedCommitSignatures({
      cwd: repo,
      listCommits: () => ({ commits: ['0'.repeat(40)], ok: true }),
    });

    expect(result.ok).toBeFalsy();
  });
});

/**
 * Root của repository đang chạy test.
 *
 * Test trên lịch sử thật cần một repo có commit đã ký; checkout hiện tại là ứng
 * viên duy nhất không phụ thuộc mạng. `gitEnv()` scrub `GIT_DIR` để không bị
 * hook ghim nhầm vào repo khác (xem `pr-check.spec`).
 */
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
  env: gitEnv(),
}).trim();

describe('checkHeadCommitSignature', () => {
  it('reports an unsigned HEAD with the command that fixes it', () => {
    expect.hasAssertions();
    const repo = initRepo(),
      sha = commit(repo, 'chore(dx): unsigned head');

    expect(sha).not.toBe('');
    // Chạy git thật trên fixture thay vì stub reader: git chính là thứ đang
    // Được kiểm, mock nó thì test chỉ chứng minh chính nó.
    const result = checkHeadCommitSignature({ cwd: repo });

    expect(result.ok).toBeFalsy();
    expect(result.ok ? '' : result.problems.join('\n')).toContain(sha);
    expect(result.ok ? '' : result.problems.join('\n')).toContain('--amend --no-edit -S');
    expect(result.ok ? '' : result.problems.join('\n')).toContain('pre-push');
  });

  // Repo chưa có commit là hợp lệ: gate `git commit` đầu tiên sẽ tạo ra HEAD.
  it('passes on an empty repository with nothing to check', () => {
    expect.hasAssertions();
    expect(checkHeadCommitSignature({ cwd: initRepo() })).toStrictEqual({ checked: 0, ok: true });
  });

  it('reads HEAD as undefined in an empty repository', () => {
    expect.hasAssertions();
    expect(readHeadFromGit(initRepo())).toStrictEqual({ ok: true, sha: undefined });
  });

  it('fails closed when git cannot run at all', () => {
    expect.hasAssertions();
    const looked = readHeadFromGit(join(tmpdir(), 'does-not-exist'));

    expect(looked.ok).toBeFalsy();
    expect(looked.ok ? '' : looked.reason).toContain('could not read HEAD');
  });

  it('fails closed when HEAD points at an object that is not a commit', () => {
    expect.hasAssertions();
    // `rev-parse --verify HEAD` chỉ chứng minh object tồn tại, không chứng minh
    // Nó là commit. Không thể trỏ HEAD vào blob bằng git thường (update-ref từ
    // Chối), nên ghi thẳng file HEAD ở detached mode.
    const repo = initRepo(),
      blob = git(repo, 'hash-object', '-w', '--stdin').trim();
    writeFileSync(join(repo, '.git', 'HEAD'), `${blob}\n`);

    const looked = readHeadFromGit(repo);

    expect(looked.ok).toBe(true);
    expect(looked.ok && looked.sha).toBe(blob);

    const result = checkHeadCommitSignature({ cwd: repo });

    expect(result.ok).toBeFalsy();
    expect(result.ok ? '' : result.problems.join('\n')).toContain(
      'did not return the commit object',
    );
  });

  it('fails closed when git errors before returning a commit id', () => {
    expect.hasAssertions();
    const result = checkHeadCommitSignature({
      head: () => ({ ok: false, reason: 'git died' }),
    });

    expect(result).toStrictEqual({ ok: false, problems: ['git died'] });
  });

  it('fails closed when HEAD cannot be read', () => {
    expect.hasAssertions();
    const result = checkHeadCommitSignature({
      head: () => ({ ok: false, reason: 'no HEAD for you' }),
    });

    expect(result).toStrictEqual({ ok: false, problems: ['no HEAD for you'] });
  });

  it('fails closed when the commit object cannot be read', () => {
    expect.hasAssertions();
    const result = checkHeadCommitSignature({
      head: () => ({ ok: true, sha: 'a'.repeat(40) }),
      readObjects: () => ({ ok: false, reason: 'cat-file exploded' }),
    });

    expect(result).toStrictEqual({ ok: false, problems: ['cat-file exploded'] });
  });

  it('counts one checked commit when HEAD is signed', () => {
    expect.hasAssertions();
    const result = checkHeadCommitSignature({
      head: () => ({ ok: true, sha: 'b'.repeat(40) }),
      readObjects: () => ({ ok: true, unsigned: [] }),
    });

    expect(result).toStrictEqual({ checked: 1, ok: true });
  });
});

describe('checkPushedCommitSignatures on this repository', () => {
  // Lịch sử thật được GitHub squash-merge nên commit ký bằng PGP key của
  // GitHub, key đó không có trong local keyring: `%G?` trả `E` cho phần lớn
  // Commit và `git verify-commit` fail. Gate này phải vẫn nhận ra chúng là đã
  // Ký — đó chính là lý do nó đọc header thay vì xác minh.
  it('recognises the real signed history of this repository', () => {
    expect.hasAssertions();
    const listed = listUnpushedCommits(REPO_ROOT);

    expect(listed.ok).toBe(true);

    // Nhánh đã đồng bộ với remote thì không có commit nào để kiểm — đó là kết
    // Quả đúng chứ không phải trường hợp bị bỏ qua. Còn khi có commit, gate
    // Phải nhận ra chúng là đã ký.
    const result = checkPushedCommitSignatures({ cwd: REPO_ROOT });

    expect(result.ok).toBe(true);
    expect(result.ok && result.checked).toBe(listed.ok ? listed.commits.length : 0);
  });
});
