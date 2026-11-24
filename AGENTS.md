# Repository Instructions

## Language

**English is the default for everything, with one closed list of exceptions: Vietnamese is used only for human-facing prose.**

Write **Vietnamese** in these human-facing prose surfaces, and nowhere else:

- Markdown documentation: every `.md` file except files named `AGENTS.md` and `**/skills/**/*.md` .
- Code comments and JSDoc.
- Issue bodies and issue comments.
- Pull request bodies and review comments.

Write **English** for everything else, with no exceptions. Non-exhaustive list:

- Every file named `AGENTS.md` (agent instructions, in any directory).
- Identifiers: variables, functions, types, configuration keys.
- Test titles (`it` / `describe` / `test`), which describe behaviour rather than prose.
- Every string a program emits at runtime: console output, log lines, error messages, CLI output, spinner and help text — regardless of mechanism (`console.*`, a logger library, `process.stderr`, ...). Vietnamese without diacritics still counts as Vietnamese.
- The `message` fields of the Semgrep rules in `.github/semgrep/`.
- Commit messages, pull request titles, branch names.
- Database migration comments: `COMMENT ON` text in migrations is English, including when editing an existing comment. The product has not shipped, so rewriting a comment in place is allowed; a forward-fix migration is not needed for a comment-only change.

Additional rules:

- Keep proper nouns, technical and domain terminology, product and service names, framework and library names, protocol names, architecture patterns, and API names in English even when writing Vietnamese. Do not translate a term when translating it would reduce technical precision.
- Do not translate existing content just because this policy is new. Apply it when writing or editing.
- In an issue or pull request body written in Vietnamese, keep issue titles, branch names, pull request titles, file paths, and error codes unchanged.

## Language exemptions

The English rule applies to developer-authored content. The following are exempt and may be Vietnamese in any locale:

- **Product i18n content**: strings in locale files and registries (`apps/*/app/i18n/locales/*`, `vi:` content keys, locale display labels such as `Tiếng Việt`) are product data shown to the end user in their own locale, not developer-authored runtime strings.
- **Test fixtures and sample data**: test data that simulates user content — names, titles, sample bodies, example inputs — may be Vietnamese. This does not extend to test titles, assertions on developer-authored output, or any `Error`/`throw` a developer writes.
- **Human-facing repo metadata**: `.github/ISSUE_TEMPLATE` fields shown to a person (name/description of issue forms) are Vietnamese prose.
