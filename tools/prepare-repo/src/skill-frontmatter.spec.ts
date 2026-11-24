import { SKILL_NAME_PATTERN, parseSkillSource } from './skill-frontmatter';

/**
 * Test thuần cho parse + validate frontmatter của một `SKILL.md`; phần dính tới
 * hệ thống file và git (gitignore, symlink, mirror) nằm ở `sync-agent-config.spec.ts`.
 */

const LABEL = '.agents/skills/demo/SKILL.md';

function sourceWith(frontmatter: string, body = 'Body.'): string {
  return `---\n${frontmatter}\n---\n${body}`;
}

const VALID = sourceWith('name: demo\ndescription: Demo skill');

describe('parseSkillSource valid metadata', () => {
  it('returns the required metadata for a valid skill', () => {
    expect.hasAssertions();
    expect(parseSkillSource(VALID, LABEL)).toStrictEqual({
      description: 'Demo skill',
      name: 'demo',
    });
  });

  it('accepts a name of exactly 64 characters and a description of exactly 1024', () => {
    expect.hasAssertions();
    // Hai biên trên đúng giới hạn của Agent Skills spec phải đi qua, không chỉ
    // Các giá trị cách xa giới hạn.
    const description = 'd'.repeat(1024),
      name = 'a'.repeat(64);

    expect(
      parseSkillSource(sourceWith(`name: ${name}\ndescription: ${description}`), LABEL),
    ).toStrictEqual({ description, name });
  });

  it('tolerates unknown extra frontmatter keys such as allowed-tools', () => {
    expect.hasAssertions();
    // Các key tuỳ chọn của Agent Skills spec (`allowed-tools`, `license`,
    // `metadata`...) phải được giữ nguyên trạng thái: cây skill vendored dùng
    // Chúng, và validation chỉ canh contract bắt buộc.
    const contents = sourceWith(
      'name: demo\ndescription: Demo skill\nallowed-tools: Read(.*), Bash(lio/*)\nlicense: MIT',
    );

    expect(parseSkillSource(contents, LABEL)).toStrictEqual({
      description: 'Demo skill',
      name: 'demo',
    });
  });
});

describe('parseSkillSource malformed frontmatter', () => {
  it('rejects missing frontmatter and names the file', () => {
    expect.hasAssertions();
    expect(() => parseSkillSource('# demo\n', LABEL)).toThrow(
      /^\.agents\/skills\/demo\/SKILL\.md: missing YAML frontmatter$/u,
    );
  });

  it('rejects invalid YAML and names the file and the underlying cause', () => {
    expect.hasAssertions();
    const contents = sourceWith('name: [unclosed'),
      error = (() => {
        try {
          parseSkillSource(contents, LABEL);

          return;
        } catch (error_) {
          return error_ as Error;
        }
      })();

    expect(error).not.toBeNull();
    expect(error?.message).toContain(`${LABEL}: invalid YAML frontmatter:`);
    expect(error?.cause).toBeInstanceOf(Error);
  });

  it('rejects frontmatter that is not a mapping', () => {
    expect.hasAssertions();
    expect(() => parseSkillSource(sourceWith('just a scalar'), LABEL)).toThrow(
      /^\.agents\/skills\/demo\/SKILL\.md: frontmatter must be a YAML mapping$/u,
    );
  });

  it('rejects frontmatter that is a list', () => {
    expect.hasAssertions();
    expect(() => parseSkillSource(sourceWith('- demo'), LABEL)).toThrow(
      /frontmatter must be a YAML mapping/u,
    );
  });
});

describe('parseSkillSource name validation', () => {
  it('rejects a missing name', () => {
    expect.hasAssertions();
    expect(() => parseSkillSource(sourceWith('description: Demo skill'), LABEL)).toThrow(
      /^\.agents\/skills\/demo\/SKILL\.md: frontmatter requires a non-empty "name"$/u,
    );
  });

  it('rejects an empty name', () => {
    expect.hasAssertions();
    expect(() => parseSkillSource(sourceWith('name: ""\ndescription: Demo skill'), LABEL)).toThrow(
      /requires a non-empty "name"/u,
    );
  });

  it('rejects a name with uppercase letters', () => {
    expect.hasAssertions();
    expect(() =>
      parseSkillSource(sourceWith('name: Demo\ndescription: Demo skill'), LABEL),
    ).toThrow(/"name" must match /u);
  });

  it('rejects a name with an underscore', () => {
    expect.hasAssertions();
    expect(() =>
      parseSkillSource(sourceWith('name: demo_skill\ndescription: Demo skill'), LABEL),
    ).toThrow(/"name" must match /u);
  });

  it('rejects a name with a leading hyphen', () => {
    expect.hasAssertions();
    expect(() =>
      parseSkillSource(sourceWith('name: "-demo"\ndescription: Demo skill'), LABEL),
    ).toThrow(/"name" must match /u);
  });

  it('rejects a name with a trailing hyphen', () => {
    expect.hasAssertions();
    expect(() =>
      parseSkillSource(sourceWith('name: demo-\ndescription: Demo skill'), LABEL),
    ).toThrow(/"name" must match /u);
  });

  it('rejects a name longer than 64 characters', () => {
    expect.hasAssertions();
    const name = 'a'.repeat(65);

    expect(() =>
      parseSkillSource(sourceWith(`name: ${name}\ndescription: Demo skill`), LABEL),
    ).toThrow(/^\.agents\/skills\/demo\/SKILL\.md: "name" must be at most 64 characters, got 65$/u);
  });

  it('rejects a name that is not a string', () => {
    expect.hasAssertions();
    expect(() => parseSkillSource(sourceWith('name: 42\ndescription: Demo skill'), LABEL)).toThrow(
      /^\.agents\/skills\/demo\/SKILL\.md: frontmatter "name" must be a string, got number$/u,
    );
  });
});

describe('parseSkillSource description validation', () => {
  it('rejects an empty description', () => {
    expect.hasAssertions();
    expect(() => parseSkillSource(sourceWith('name: demo\ndescription: ""'), LABEL)).toThrow(
      /^\.agents\/skills\/demo\/SKILL\.md: frontmatter requires a non-empty "description"$/u,
    );
  });

  it('rejects a description that is only whitespace', () => {
    expect.hasAssertions();
    expect(() => parseSkillSource(sourceWith('name: demo\ndescription: "   "'), LABEL)).toThrow(
      /requires a non-empty "description"/u,
    );
  });

  it('rejects a missing description', () => {
    expect.hasAssertions();
    expect(() => parseSkillSource(sourceWith('name: demo'), LABEL)).toThrow(
      /requires a non-empty "description"/u,
    );
  });

  it('rejects a description longer than 1024 characters', () => {
    expect.hasAssertions();
    const description = 'd'.repeat(1025);

    expect(() =>
      parseSkillSource(sourceWith(`name: demo\ndescription: ${description}`), LABEL),
    ).toThrow(
      /^\.agents\/skills\/demo\/SKILL\.md: "description" must be at most 1024 characters, got 1025$/u,
    );
  });

  it('rejects a description that is not a string', () => {
    expect.hasAssertions();
    expect(() => parseSkillSource(sourceWith('name: demo\ndescription: 42'), LABEL)).toThrow(
      /^\.agents\/skills\/demo\/SKILL\.md: frontmatter "description" must be a string, got number$/u,
    );
  });
});

describe('parseSkillSource frontmatter format edge cases', () => {
  it('accepts CRLF line endings throughout the frontmatter', () => {
    expect.hasAssertions();
    // Pattern chấp nhận `\r?\n` ở cả hai đầu: file viết trên Windows phải đi qua
    // Y như file LF, kể cả dòng đóng.
    const contents = '---\r\nname: demo\r\ndescription: Demo skill\r\n---\r\nBody.';

    expect(parseSkillSource(contents, LABEL)).toStrictEqual({
      description: 'Demo skill',
      name: 'demo',
    });
  });

  it('tolerates trailing whitespace on the closing frontmatter line', () => {
    expect.hasAssertions();
    const contents = '---\nname: demo\ndescription: Demo skill\n---  \nBody.';

    expect(parseSkillSource(contents, LABEL)).toStrictEqual({
      description: 'Demo skill',
      name: 'demo',
    });
  });

  it('rejects frontmatter that is never closed', () => {
    expect.hasAssertions();
    expect(() => parseSkillSource('---\nname: demo\n', LABEL)).toThrow(/missing YAML frontmatter/u);
  });

  it('rejects a UTF-8 BOM before the frontmatter instead of matching through it', () => {
    expect.hasAssertions();
    // Editor hay thêm BOM; pattern neo `^` nên BOM làm file bị đọc là không có
    // Frontmatter. Khoá hành vi từ chối (thay vì im lặng match lệch) để lỗi lộ rõ.
    expect(() =>
      parseSkillSource('﻿---\nname: demo\ndescription: Demo skill\n---\nBody.', LABEL),
    ).toThrow(/^\.agents\/skills\/demo\/SKILL\.md: missing YAML frontmatter$/u);
  });

  it('rejects a name with non-ASCII letters, including Vietnamese diacritics', () => {
    expect.hasAssertions();
    // Pattern giới hạn `[a-z0-9]`: tên có dấu bị từ chối chứ không được chuẩn hoá.
    expect(() =>
      parseSkillSource(sourceWith('name: tieng-việt\ndescription: Demo skill'), LABEL),
    ).toThrow(/"name" must match /u);
  });

  it('measures the description limit in UTF-16 code units, not bytes', () => {
    expect.hasAssertions();
    // 512 emoji = 1024 UTF-16 code units nhưng 4096 byte: phải đi qua, để chốt
    // Rõ ngữ nghĩa của phép đo độ dài hiện tại.
    const description = '🙂'.repeat(512);

    expect(
      parseSkillSource(sourceWith(`name: demo\ndescription: ${description}`), LABEL),
    ).toStrictEqual({
      description,
      name: 'demo',
    });
  });

  it('exposes the Agent Skills naming pattern it enforces', () => {
    expect.hasAssertions();
    // Pattern xuất ra phải trùng với luật được test ở trên, để nơi khác dùng lại
    // Không lệch với validation thật.
    expect(SKILL_NAME_PATTERN.test('demo')).toBe(true);
    expect(SKILL_NAME_PATTERN.test('demo-skill-2')).toBe(true);
    expect(SKILL_NAME_PATTERN.test('Demo')).toBeFalsy();
    expect(SKILL_NAME_PATTERN.test('-demo')).toBeFalsy();
  });
});
