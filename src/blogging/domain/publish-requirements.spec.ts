import { DomainError } from '../../shared/kernel/domain-error';
import {
  assertPublishable,
  coverImageProblems,
  PublishRequirementsInput,
} from './publish-requirements';

const VALID_COVER = {
  url: 'https://example.com/cover.png',
  alt: 'A descriptive alt text',
  width: 1600,
  height: 900,
};

/** Capture the thrown DomainError (fails the test if none is thrown). */
const gateError = (input: PublishRequirementsInput): DomainError => {
  try {
    assertPublishable(input);
  } catch (error) {
    return error as DomainError;
  }
  throw new Error('expected assertPublishable to throw');
};

describe('assertPublishable', () => {
  it('passes with an excerpt and a complete coverImage', () => {
    expect(() =>
      assertPublishable({
        excerpt: 'A takeaway.',
        coverImage: VALID_COVER,
      }),
    ).not.toThrow();
  });

  it('accepts optional caption/credit keys', () => {
    expect(() =>
      assertPublishable({
        excerpt: 'A takeaway.',
        coverImage: { ...VALID_COVER, caption: 'Cap', credit: 'Cred' },
      }),
    ).not.toThrow();
  });

  it('rejects when both requirements are missing (stable code + meta.missing)', () => {
    const error = gateError({ excerpt: null, coverImage: null });
    expect(error).toBeInstanceOf(DomainError);
    expect(error.code).toBe('article.publish.incomplete');
    expect(error.clientMeta?.missing).toEqual(['excerpt', 'coverImage']);
  });

  it('rejects a blank excerpt', () => {
    expect(gateError({ excerpt: '   ', coverImage: VALID_COVER }).code).toBe(
      'article.publish.incomplete',
    );
  });

  it.each<[string, unknown]>([
    ['missing entirely', null],
    ['not an object', 'https://example.com/cover.png'],
    ['an array', [VALID_COVER]],
    ['missing url', { ...VALID_COVER, url: '' }],
    ['missing alt', { ...VALID_COVER, alt: ' ' }],
    ['missing width', { ...VALID_COVER, width: 0 }],
    ['missing height', { ...VALID_COVER, height: -1 }],
    ['non-integer dimensions', { ...VALID_COVER, width: 1.5 }],
  ])('rejects a coverImage that is %s', (_label, coverImage) => {
    const error = gateError({ excerpt: 'A takeaway.', coverImage });
    expect(error.code).toBe('article.publish.incomplete');
    expect(error.clientMeta?.missing).toEqual(['coverImage']);
  });
});

describe('coverImageProblems', () => {
  it('returns an empty list for a valid coverImage', () => {
    expect(coverImageProblems(VALID_COVER)).toEqual([]);
  });

  it('reports every problem it finds', () => {
    expect(
      coverImageProblems({ url: '', alt: ' ', width: 0, height: -2 }),
    ).toEqual([
      'coverImage.url is required',
      'coverImage.alt is required',
      'coverImage.width must be a positive integer',
      'coverImage.height must be a positive integer',
    ]);
  });
});
