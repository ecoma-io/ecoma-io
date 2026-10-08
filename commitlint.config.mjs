import nxScopes from '@commitlint/config-nx-scopes';

export default {
  extends: ['@commitlint/config-conventional', '@commitlint/config-nx-scopes'],
  plugins: [
    {
      rules: {
        'breaking-change-allowed-types': (parsed) => {
          const { type, notes, header } = parsed;

          const isBreakingChange =
            notes.some((note) => note.title === 'BREAKING CHANGE') ||
            /^[\w-]+(?:\([\w-]+\))?!:/u.test(header);

          const allowedTypes = ['feat', 'fix'];

          if (isBreakingChange && !allowedTypes.includes(type)) {
            return [
              false,
              `Breaking changes are only allowed for types: ${allowedTypes.join(', ')} (current type is '${type}').`,
            ];
          }

          return [true];
        },
        // Repo song ngữ nên AI agent dễ dán tiếng Việt vào message.
        // Thay vì whitelist ký tự cho phép (phải maintain corpus đặc biệt),
        // chặn tập con gây lỗi thực tế: mọi ký tự ngoài ASCII — bao gồm
        // toàn bộ tiếng Việt có dấu. Mục đích là chặn AI commit bằng ngôn ngữ
        // khác, không phải kiểm tra grammar tiếng Anh.
        'ascii-only-message': (parsed) => {
          const text = [parsed.header, parsed.body, parsed.footer].filter(Boolean).join('\n');
          const bad = [...text].find((ch) => ch.codePointAt(0) > 0x7f);

          if (bad) {
            return [
              false,
              `Non-ASCII character '${bad}' found; commit messages must contain only ASCII characters.`,
            ];
          }

          return [true];
        },
      },
    },
  ],
  rules: {
    'scope-enum': async (ctx) => [
      2,
      'always',
      [...(await nxScopes.utils.getProjects(ctx)) /* nhận thêm scope tại đây! */],
    ],
    'breaking-change-allowed-types': [2, 'always'],
    'ascii-only-message': [2, 'always'],
  },
};
