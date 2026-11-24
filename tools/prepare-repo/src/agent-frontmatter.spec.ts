import {
  AGENT_MODES,
  parseAgentSource,
  renderClaudeAgent,
  renderOpencodeAgent,
} from './agent-frontmatter';

/**
 * Test thuần cho parse + render agent; phần dính tới hệ thống file và git nằm ở
 * `sync-agent-config.spec.ts`.
 */

const LABEL = '.agents/agents/reviewer.md';

function parseFrontmatterOnly(frontmatter: string): ReturnType<typeof parseAgentSource> {
  return parseAgentSource(['---', frontmatter, '---', 'Prompt.', ''].join('\n'), LABEL);
}

describe('parseAgentSource parsing', () => {
  it('returns every declared field and the verbatim body', () => {
    expect.hasAssertions();
    const contents = [
      '---',
      'name: reviewer',
      'description: Reviews code',
      'tools: Read, Bash',
      'model: claude-sonnet-5-5',
      'mode: primary',
      '---',
      'You are a reviewer.',
      '',
    ].join('\n');

    expect(parseAgentSource(contents, LABEL)).toStrictEqual({
      body: 'You are a reviewer.\n',
      description: 'Reviews code',
      mode: 'primary',
      model: 'claude-sonnet-5-5',
      name: 'reviewer',
      tools: ['Read', 'Bash'],
    });
  });

  it('keeps the body verbatim including blank lines and trailing newline', () => {
    expect.hasAssertions();
    const contents = '---\nname: a\ndescription: b\n---\nLine one.\n\nLine two.\n';

    expect(parseAgentSource(contents, LABEL).body).toBe('Line one.\n\nLine two.\n');
  });

  it('rejects missing frontmatter and names the file', () => {
    expect.hasAssertions();
    expect(() => parseAgentSource('no frontmatter\n', LABEL)).toThrow(
      /^\.agents\/agents\/reviewer\.md: missing YAML frontmatter$/u,
    );
  });

  it('rejects invalid YAML and names the file and the underlying cause', () => {
    expect.hasAssertions();
    // Phải giống parseSkillSource: lỗi YAML của thư viện được bọc lại kèm label
    // File, thay vì ném thẳng một message không biết lỗi ở đâu.
    const error = (() => {
      try {
        parseAgentSource(['---', 'name: [unclosed', '---', 'Prompt.'].join('\n'), LABEL);

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
    expect(() =>
      parseAgentSource(['---', 'just a scalar', '---', 'Prompt.'].join('\n'), LABEL),
    ).toThrow(/^\.agents\/agents\/reviewer\.md: frontmatter must be a YAML mapping$/u);
  });

  it('rejects an unknown frontmatter key and names the allowed set', () => {
    expect.hasAssertions();
    expect(() => parseFrontmatterOnly('name: a\ndescription: b\ntemperature: 0.2')).toThrow(
      /^\.agents\/agents\/reviewer\.md: unsupported frontmatter key "temperature"/u,
    );
  });
});

describe('parseAgentSource scalar fields', () => {
  it('rejects a missing name and a missing description', () => {
    expect.hasAssertions();
    expect(() => parseFrontmatterOnly('description: b')).toThrow(
      /^\.agents\/agents\/reviewer\.md: frontmatter requires a non-empty "name"$/u,
    );
    expect(() => parseFrontmatterOnly('name: a')).toThrow(
      /^\.agents\/agents\/reviewer\.md: frontmatter requires a non-empty "description"$/u,
    );
  });

  it('rejects a bare name key, which YAML reads as null', () => {
    expect.hasAssertions();
    expect(() => parseFrontmatterOnly('name:\ndescription: b')).toThrow(
      /requires a non-empty "name"/u,
    );
  });

  it('rejects a name that is not a string', () => {
    expect.hasAssertions();
    expect(() => parseFrontmatterOnly('name: 42\ndescription: b')).toThrow(
      /^\.agents\/agents\/reviewer\.md: frontmatter requires a non-empty "name"$/u,
    );
  });

  it('rejects a whitespace-only description', () => {
    expect.hasAssertions();
    expect(() => parseFrontmatterOnly('name: a\ndescription: "   "')).toThrow(
      /requires a non-empty "description"/u,
    );
  });

  it('rejects an empty model and a non-string model', () => {
    expect.hasAssertions();
    expect(() => parseFrontmatterOnly('name: a\ndescription: b\nmodel: ""')).toThrow(
      /^\.agents\/agents\/reviewer\.md: "model" must be a non-empty string$/u,
    );
    expect(() => parseFrontmatterOnly('name: a\ndescription: b\nmodel: 42')).toThrow(
      /^\.agents\/agents\/reviewer\.md: "model" must be a non-empty string$/u,
    );
  });
});

describe('parseAgentSource tools', () => {
  it('accepts tools as a comma-separated string, a YAML list, or a single non-string scalar', () => {
    expect.hasAssertions();
    // Dạng thứ ba là hành vi hiện tại của parseTools: một scalar rời rạc bị bọc
    // Thành list một phần tử — được khoá lại đây để tránh đổi ngầm ý nghĩa.
    expect(parseFrontmatterOnly('name: a\ndescription: b\ntools: Read, Glob')?.tools).toStrictEqual(
      ['Read', 'Glob'],
    );
    expect(
      parseFrontmatterOnly('name: a\ndescription: b\ntools:\n  - Read\n  - Glob')?.tools,
    ).toStrictEqual(['Read', 'Glob']);
    expect(parseFrontmatterOnly('name: a\ndescription: b\ntools: Read')?.tools).toStrictEqual([
      'Read',
    ]);
  });

  it('rejects a tools list containing a non-string item', () => {
    expect.hasAssertions();
    expect(() => parseFrontmatterOnly('name: a\ndescription: b\ntools:\n  - 42')).toThrow(
      /^\.agents\/agents\/reviewer\.md: tools must be a comma-separated string or a list of strings$/u,
    );
  });

  it('rejects an empty tools value in every shape instead of reading it as an omission', () => {
    expect.hasAssertions();
    // Chuỗi rỗng và list rỗng phải chết: bỏ hẳn key là cách duy nhất để nói "giữ
    // Bộ tool mặc định". Key bare (`tools:`) là null trong YAML — rơi vào lỗi
    // Kiểu trước, cũng chết chứ không bị đọc là vắng mặt.
    expect(() => parseFrontmatterOnly('name: a\ndescription: b\ntools: ""')).toThrow(
      /names no tool/u,
    );
    expect(() => parseFrontmatterOnly('name: a\ndescription: b\ntools: []')).toThrow(
      /names no tool/u,
    );
    expect(() => parseFrontmatterOnly('name: a\ndescription: b\ntools:')).toThrow(
      /tools must be a comma-separated string/u,
    );
  });

  it('rejects a tools value that is a mapping', () => {
    expect.hasAssertions();
    // `{a: 1}` rơi vào nhánh `[value]` của parseTools rồi chết ở phép kiểm type —
    // Phải nêu đúng thông báo kiểu thay vì thành một tool tên "[object Object]".
    expect(() => parseFrontmatterOnly('name: a\ndescription: b\ntools:\n  a: 1')).toThrow(
      /tools must be a comma-separated string/u,
    );
  });

  it('rejects an unknown tool and names the known set', () => {
    expect.hasAssertions();
    expect(() => parseFrontmatterOnly('name: a\ndescription: b\ntools: Read, Bashe')).toThrow(
      /^\.agents\/agents\/reviewer\.md: unknown tool "Bashe" \(known: Agent, AskUserQuestion, Bash/u,
    );
  });
});

describe('parseAgentSource mode', () => {
  it('accepts every declared mode and rejects every other value', () => {
    expect.hasAssertions();
    for (const mode of AGENT_MODES) {
      expect(parseFrontmatterOnly(`name: a\ndescription: b\nmode: ${mode}`)?.mode).toBe(mode);
    }

    // `" primary"` không được chấp nhận nguyên trạng: YAML bỏ dấu nháy, trim
    // Biến nó thành giá trị hợp lệ — khác hẳn `" primary "` có space trong nháy
    // Kép (test trim ở dưới) và `"PRIMARY"` giữ hoa.
    for (const invalid of ['sometimes', '"PRIMARY"', '42', '[]']) {
      expect(() => parseFrontmatterOnly(`name: a\ndescription: b\nmode: ${invalid}`)).toThrow(
        /"mode" must be one of/u,
      );
    }
  });

  it('trims whitespace around a valid mode instead of rejecting it', () => {
    expect.hasAssertions();
    expect(parseFrontmatterOnly('name: a\ndescription: b\nmode: " primary "')?.mode).toBe(
      'primary',
    );
  });

  it('rejects a bare mode key, which YAML reads as null', () => {
    expect.hasAssertions();
    expect(() => parseFrontmatterOnly('name: a\ndescription: b\nmode:')).toThrow(
      /"mode" must be one of/u,
    );
  });
});

describe('renderClaudeAgent', () => {
  it('quotes every string value so YAML metacharacters survive', () => {
    expect.hasAssertions();
    // JSON.stringify là một YAML double-quoted scalar hợp lệ: dấu nháy, hai chấm
    // Và ký tự đặc biệt khác phải đi qua nguyên trạng.
    const agent = parseAgentSource(
        '---\nname: "q: \\"v\\""\ndescription: "line one\\nline two"\n---\nBody.',
        LABEL,
      ),
      rendered = renderClaudeAgent(agent);

    expect(rendered).toContain(String.raw`name: "q: \"v\""`);
    expect(rendered).toContain(String.raw`description: "line one\nline two"`);
  });

  it('omits tools and model when undeclared and never emits mode', () => {
    expect.hasAssertions();
    const agent = parseAgentSource('---\nname: a\ndescription: b\n---\nBody.', LABEL),
      rendered = renderClaudeAgent(agent);

    expect(rendered).not.toContain('tools:');
    expect(rendered).not.toContain('model:');
    expect(rendered).not.toContain('mode:');
  });

  it('normalizes a YAML list of tools back into a comma-separated string', () => {
    expect.hasAssertions();
    const agent = parseAgentSource(
      '---\nname: a\ndescription: b\ntools:\n  - Read\n  - Bash\n---\nB.',
      LABEL,
    );

    expect(renderClaudeAgent(agent)).toContain('tools: "Read, Bash"');
  });
});

describe('renderOpencodeAgent model', () => {
  it('passes a provider/model form through unchanged', () => {
    expect.hasAssertions();
    // Chỉ có test case âm (alias bị cảnh báo) ở integration; dạng đúng phải được
    // Khoá ở đây để không ai vô tình bỏ nó theo.
    const agent = parseAgentSource(
        '---\nname: a\ndescription: b\nmodel: anthropic/claude-sonnet-5-5\n---\nBody.',
        LABEL,
      ),
      rendered = renderOpencodeAgent(agent);

    expect(rendered.contents).toContain('model: "anthropic/claude-sonnet-5-5"');
    expect(rendered.warnings).toStrictEqual([]);
  });

  it('warns and omits a bare model alias', () => {
    expect.hasAssertions();
    const agent = parseAgentSource(
        '---\nname: a\ndescription: b\nmodel: sonnet\n---\nBody.',
        LABEL,
      ),
      rendered = renderOpencodeAgent(agent);

    expect(rendered.contents).not.toContain('model:');
    expect(rendered.warnings).toHaveLength(1);
    expect(rendered.warnings[0]).toContain('sonnet');
  });
});

describe('renderOpencodeAgent permissions', () => {
  it('defaults to subagent mode when the source omits it', () => {
    expect.hasAssertions();
    const agent = parseAgentSource('---\nname: a\ndescription: b\n---\nBody.', LABEL);

    expect(renderOpencodeAgent(agent).contents).toContain('mode: subagent');
  });

  it('deduplicates tools that map to the same OpenCode action', () => {
    expect.hasAssertions();
    // Read, Grep, Glob đều là action khác nhau; Edit và MultiEdit cùng trỏ về
    // "edit" — nguồn được phép liệt kê cả hai, đích chỉ được phép có một rule.
    const agent = parseAgentSource(
        '---\nname: a\ndescription: b\ntools: Edit, MultiEdit, Write, Read\n---\nBody.',
        LABEL,
      ),
      { contents } = renderOpencodeAgent(agent);

    expect(contents.match(/action: "edit"/gu)).toHaveLength(1);
    expect(contents).toContain('action: "read"');
  });

  it('emits the catch-all deny before every allow rule', () => {
    expect.hasAssertions();
    const agent = parseAgentSource('---\nname: a\ndescription: b\ntools: Read\n---\nBody.', LABEL),
      { contents } = renderOpencodeAgent(agent),
      deny = contents.indexOf('effect: deny'),
      allow = contents.indexOf('effect: allow');

    expect(deny).toBeGreaterThan(-1);
    expect(deny).toBeLessThan(allow);
  });

  it('leaves permissions out when the source declares no tools', () => {
    expect.hasAssertions();
    const agent = parseAgentSource('---\nname: a\ndescription: b\n---\nBody.', LABEL);

    expect(renderOpencodeAgent(agent).contents).not.toContain('permissions:');
  });
});
