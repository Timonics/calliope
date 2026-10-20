import { DomainError } from '../../shared/kernel/domain-error';
import { resolveStatusTransition } from './article-status';

const NOW = new Date('2026-01-01T00:00:00Z');
const EARLIER = new Date('2025-06-01T00:00:00Z');

describe('resolveStatusTransition', () => {
  it('leaves status and publishedAt untouched when the field is absent', () => {
    expect(resolveStatusTransition('DRAFT', undefined, null, NOW)).toEqual({
      status: 'DRAFT',
      publishedAt: null,
    });
  });

  it('no-ops when the requested status equals the current one', () => {
    expect(
      resolveStatusTransition('PUBLISHED', 'PUBLISHED', EARLIER, NOW),
    ).toEqual({ status: 'PUBLISHED', publishedAt: EARLIER });
  });

  it('sets publishedAt on the first DRAFT → PUBLISHED', () => {
    expect(resolveStatusTransition('DRAFT', 'PUBLISHED', null, NOW)).toEqual({
      status: 'PUBLISHED',
      publishedAt: NOW,
    });
  });

  it('keeps the first-publish date when unpublished and re-published', () => {
    const unpublished = resolveStatusTransition(
      'PUBLISHED',
      'DRAFT',
      EARLIER,
      NOW,
    );
    expect(unpublished).toEqual({ status: 'DRAFT', publishedAt: EARLIER });

    const republished = resolveStatusTransition(
      'DRAFT',
      'PUBLISHED',
      EARLIER,
      NOW,
    );
    expect(republished.publishedAt).toBe(EARLIER);
  });

  it('allows archiving from DRAFT or PUBLISHED', () => {
    expect(resolveStatusTransition('DRAFT', 'ARCHIVED', null, NOW).status).toBe(
      'ARCHIVED',
    );
    expect(
      resolveStatusTransition('PUBLISHED', 'ARCHIVED', EARLIER, NOW).status,
    ).toBe('ARCHIVED');
  });

  it('treats ARCHIVED as terminal', () => {
    const attempt = (target: 'DRAFT' | 'PUBLISHED'): unknown => {
      try {
        resolveStatusTransition('ARCHIVED', target, null, NOW);
      } catch (error) {
        return error;
      }
      throw new Error(`expected ARCHIVED → ${target} to throw`);
    };
    for (const target of ['DRAFT', 'PUBLISHED'] as const) {
      const error = attempt(target);
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({ code: 'article.conflict' });
    }
  });
});
