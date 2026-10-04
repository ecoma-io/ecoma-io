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
        // Rule này CHẶN KÝ TỰ, không phát hiện ngôn ngữ: nó không thể bắt
        // tiếng Việt không dấu (mọi ký tự đều ASCII). Vì vậy error message phải
        // tự mang lệnh sửa — nói rõ viết bằng tiếng Anh và cấm lách rule bằng
        // cách bỏ dấu — vì đó chính là cách lách phổ biến nhất.
        'ascii-only-message': (parsed) => {
          const text = [parsed.header, parsed.body, parsed.footer].filter(Boolean).join('\n');
          const bad = [...text].find((ch) => ch.codePointAt(0) > 0x7f);

          if (bad) {
            return [
              false,
              `Non-ASCII character '${bad}' found. Commit messages must be written in English. Do not work around this rule by removing accents or using Vietnamese without diacritics. Rewrite the entire commit message in English.`,
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
      [
        // Scope của một commit **release**: Release PR gộp mọi deploy unit của
        // batch vào một commit, nên scope gắn với từng project sẽ sai khi batch
        // có hai project (đó là lý do `RELEASE_COMMIT_PREFIX` bỏ scope theo
        // project). Nhưng nó vẫn phải qua commitlint, vì tiêu đề Release PR
        // **chính là** subject của release commit và `pr-check` chấm
        // commitlint thật trên mọi `pull_request`. Không khai ở đây thì mọi lần
        // release đỏ ở "Check PR title" và không bao giờ merge được.
        //
        // Nó là scope cố định, không phải tên Nx project — và đó là ý nghĩa
        // của nó: commit release thuộc về **lane delivery** chứ không thuộc về
        // deploy unit nào.
        'release',
        ...(await nxScopes.utils.getProjects(ctx)),
      ],
    ],
    'breaking-change-allowed-types': [2, 'always'],
    'ascii-only-message': [2, 'always'],
  },
};
