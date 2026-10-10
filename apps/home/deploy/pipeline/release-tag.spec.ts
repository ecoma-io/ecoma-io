import { describe, expect, it } from 'vitest';

import {
  buildReleaseTag,
  isReleaseCommitSubject,
  parseReleaseTag,
  readHomeVersion,
  releaseVersionFromSubject,
} from './release-tag';

const VALID_MANIFEST = JSON.stringify({ name: '@ecoma-io/home', version: '0.0.2' });

describe('readHomeVersion', () => {
  it('reads the version from a manifest with the right project name', () => {
    expect(readHomeVersion(VALID_MANIFEST)).toBe('0.0.2');
  });

  it('rejects a manifest of another project — fail closed', () => {
    const wrong = JSON.stringify({ name: '@ecoma-io/docs', version: '9.9.9' });
    expect(() => readHomeVersion(wrong)).toThrow(`not a valid manifest for @ecoma-io/home`);
  });

  it('rejects a manifest without a version', () => {
    expect(() => readHomeVersion('{"name":"@ecoma-io/home"}')).toThrow(
      'not a valid manifest for @ecoma-io/home',
    );
  });

  it('rejects a non-JSON payload', () => {
    expect(() => readHomeVersion('not-json')).toThrow(SyntaxError);
  });
});

describe('parseReleaseTag', () => {
  it('parses the home release tag', () => {
    expect(parseReleaseTag('@ecoma-io/home@0.0.2')).toEqual({
      projectName: '@ecoma-io/home',
      version: '0.0.2',
    });
  });

  it('accepts prerelease semver', () => {
    expect(parseReleaseTag('@ecoma-io/home@1.0.0-rc.1')).toEqual({
      projectName: '@ecoma-io/home',
      version: '1.0.0-rc.1',
    });
  });

  it('rejects tags of other projects', () => {
    expect(parseReleaseTag('@ecoma-io/docs@0.0.2')).toBeUndefined();
  });

  it('rejects the v{version} pattern of other workspaces', () => {
    expect(parseReleaseTag('v0.0.2')).toBeUndefined();
  });

  it('rejects non-strict-semver versions', () => {
    expect(parseReleaseTag('@ecoma-io/home@01.2.3')).toBeUndefined();
    expect(parseReleaseTag('@ecoma-io/home@1.2')).toBeUndefined();
    expect(parseReleaseTag('@ecoma-io/home@not-a-version')).toBeUndefined();
    expect(parseReleaseTag('@ecoma-io/home@')).toBeUndefined();
  });

  it('rejects empty strings and odd inputs', () => {
    expect(parseReleaseTag('')).toBeUndefined();
    expect(parseReleaseTag('@ecoma-io/home@@1.0.0')).toBeUndefined();
  });
});

describe('buildReleaseTag', () => {
  it('builds a tag from a valid version', () => {
    expect(buildReleaseTag('0.0.2')).toBe('@ecoma-io/home@0.0.2');
  });

  it('throws on an invalid version — never produces a malformed tag', () => {
    expect(() => buildReleaseTag('main')).toThrow('does not produce a valid release tag');
  });
});

describe('isReleaseCommitSubject', () => {
  it('accepts the Nx Release commit message', () => {
    expect(isReleaseCommitSubject('chore(home): release @ecoma-io/home 0.0.2')).toBe(true);
  });

  it('accepts the message after squash merge (GitHub appends " (#N)")', () => {
    expect(isReleaseCommitSubject('chore(home): release @ecoma-io/home 0.0.2 (#79)')).toBe(true);
  });

  it('rejects regular commits with the same scope', () => {
    expect(isReleaseCommitSubject('feat(home): add page')).toBe(false);
    expect(isReleaseCommitSubject('chore(home): bump deps')).toBe(false);
  });

  it('rejects other projects releases and manipulated messages', () => {
    expect(isReleaseCommitSubject('chore(docs): release @ecoma-io/docs 1.0.0')).toBe(false);
    expect(isReleaseCommitSubject('chore(home): release ../evil 1.0.0')).toBe(false);
    expect(isReleaseCommitSubject('chore(home): release anything')).toBe(false);
  });

  it('rejects non-semver versions — evidence cannot be forged with text', () => {
    expect(isReleaseCommitSubject('chore(home): release @ecoma-io/home latest')).toBe(false);
  });
});

describe('releaseVersionFromSubject', () => {
  it('extracts the version from a valid subject, including the squash suffix', () => {
    expect(releaseVersionFromSubject('chore(home): release @ecoma-io/home 1.2.3')).toBe('1.2.3');
    expect(releaseVersionFromSubject('chore(home): release @ecoma-io/home 1.2.3 (#88)')).toBe(
      '1.2.3',
    );
  });

  it('returns undefined for a non-release subject', () => {
    expect(releaseVersionFromSubject('feat(home): x')).toBeUndefined();
  });
});
