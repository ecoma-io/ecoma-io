import nxScopes from '@commitlint/config-nx-scopes';

export default {
  extends: ['@commitlint/config-conventional', '@commitlint/config-nx-scopes'],
  plugins: [
    {
      rules: {
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
      [...(await nxScopes.utils.getProjects(ctx)), 'release', 'deps'],
    ],
    'ascii-only-message': [2, 'always'],
  },
};
