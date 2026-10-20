import { ArgumentsHost, Logger, NotFoundException } from '@nestjs/common';
import { AuthGuardError } from '@timonics/auth-guard';
import { DomainError } from '../../kernel/domain-error';
import { DomainErrorFilter } from './domain-error.filter';

const makeHost = (): {
  host: ArgumentsHost;
  response: {
    status: jest.Mock;
    setHeader: jest.Mock;
    json: jest.Mock;
  };
} => {
  const response = {
    status: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
    json: jest.fn(),
  };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'GET', url: '/v1/test', path: '/v1/test' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
};

describe('DomainErrorFilter', () => {
  const filter = new DomainErrorFilter();

  it('maps AuthGuardError (from @timonics/auth-guard) to its status + {code, message}', () => {
    const { host, response } = makeHost();
    filter.catch(
      new AuthGuardError('authorization.token.invalid', 401, 'Invalid token'),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining('Bearer'),
    );
    expect(response.json).toHaveBeenCalledWith({
      code: 'authorization.token.invalid',
      message: 'Invalid token',
    });
  });

  it('maps a 403 AuthGuardError (missing scope) without WWW-Authenticate', () => {
    const { host, response } = makeHost();
    filter.catch(
      new AuthGuardError('authorization.scope.missing', 403, 'Missing scope'),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(response.json).toHaveBeenCalledWith({
      code: 'authorization.scope.missing',
      message: 'Missing scope',
    });
  });

  it('maps authorization.token.invalid to 401 {code, message} + WWW-Authenticate', () => {
    const { host, response } = makeHost();
    filter.catch(
      new DomainError(
        'authorization.token.invalid',
        'Token verification failed',
      ),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.setHeader).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining('Bearer'),
    );
    expect(response.json).toHaveBeenCalledWith({
      code: 'authorization.token.invalid',
      message: 'Token verification failed',
    });
  });

  it('maps authentication.token.missing to 401', () => {
    const { host, response } = makeHost();
    filter.catch(
      new DomainError('authentication.token.missing', 'bearer header required'),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({
      code: 'authentication.token.missing',
      message: 'bearer header required',
    });
  });

  it('maps http.validation.failed to 400', () => {
    const { host, response } = makeHost();
    filter.catch(
      new DomainError('http.validation.failed', 'Request validation failed'),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      code: 'http.validation.failed',
      message: 'Request validation failed',
    });
  });

  it('maps domain.invariant_violation to 409', () => {
    const { host, response } = makeHost();
    filter.catch(
      new DomainError(
        'domain.invariant_violation',
        'related article in another blog',
      ),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      code: 'domain.invariant_violation',
      message: 'related article in another blog',
    });
  });

  it('prefix table: an unlisted authorization.* code still maps to 401', () => {
    const { host, response } = makeHost();
    // Not in the exact switch — exercises the prefix fallback.
    filter.catch(
      new DomainError(
        'authorization.scope.insufficient',
        'Missing required scope(s): content:write',
      ),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({
      code: 'authorization.scope.insufficient',
      message: 'Missing required scope(s): content:write',
    });
  });

  it('maps an unlisted domain.* code to 409 via the prefix table', () => {
    const { host, response } = makeHost();
    filter.catch(
      new DomainError(
        'domain.illegal_state',
        'cannot publish archived article',
      ),
      host,
    );
    // domain.* → 409 via prefix table
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({
      code: 'domain.illegal_state',
      message: 'cannot publish archived article',
    });
  });

  it('maps a totally unknown domain code to 500 internal.error', () => {
    const { host, response } = makeHost();
    filter.catch(
      new DomainError('content.blog.bogus' as never, 'unknown code'),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      code: 'internal.error',
      message: 'Internal server error',
    });
  });

  it('maps unexpected (non-domain) errors to 500 internal.error', () => {
    const { host, response } = makeHost();
    filter.catch(new Error('database connection lost'), host);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      code: 'internal.error',
      message: 'Internal server error',
    });
  });

  it('maps framework HttpExceptions to their status with a stable code', () => {
    const { host, response } = makeHost();
    filter.catch(new NotFoundException('Cannot GET /v1/nope'), host);
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({
      code: 'http.not_found',
      message: 'Cannot GET /v1/nope',
    });
  });

  describe('suffix table (<resource>.<reason> blogging codes)', () => {
    it('maps *.not_found to 404', () => {
      const { host, response } = makeHost();
      filter.catch(new DomainError('blog.not_found', 'blog not found'), host);
      expect(response.status).toHaveBeenCalledWith(404);
      expect(response.json).toHaveBeenCalledWith({
        code: 'blog.not_found',
        message: 'blog not found',
      });
    });

    it('maps *.conflict to 409', () => {
      const { host, response } = makeHost();
      filter.catch(
        new DomainError('article.conflict', 'archived is terminal'),
        host,
      );
      expect(response.status).toHaveBeenCalledWith(409);
      expect(response.json).toHaveBeenCalledWith({
        code: 'article.conflict',
        message: 'archived is terminal',
      });
    });

    it('maps *.validation to 400', () => {
      const { host, response } = makeHost();
      filter.catch(
        new DomainError('article.validation', 'duplicate related id'),
        host,
      );
      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith({
        code: 'article.validation',
        message: 'duplicate related id',
      });
    });

    it('maps *.forbidden to 403', () => {
      const { host, response } = makeHost();
      filter.catch(
        new DomainError('blog.forbidden', 'blog belongs to another tenant'),
        host,
      );
      expect(response.status).toHaveBeenCalledWith(403);
      expect(response.json).toHaveBeenCalledWith({
        code: 'blog.forbidden',
        message: 'blog belongs to another tenant',
      });
    });

    it('keeps existing exact codes working alongside the suffix table', () => {
      const { host, response } = makeHost();
      filter.catch(
        new DomainError('http.validation.failed', 'Request validation failed'),
        host,
      );
      expect(response.status).toHaveBeenCalledWith(400);
      expect(response.json).toHaveBeenCalledWith({
        code: 'http.validation.failed',
        message: 'Request validation failed',
      });
    });

    it('includes meta detail in the rendered body when present', () => {
      const { host, response } = makeHost();
      filter.catch(
        new DomainError('article.validation', 'bad related ids', {
          relatedArticleIds: ['a'],
        }),
        host,
      );
      expect(response.json).toHaveBeenCalledWith({
        code: 'article.validation',
        message: 'bad related ids',
        meta: { relatedArticleIds: ['a'] },
      });
    });

    it('ships clientMeta but never the server-only detail', () => {
      const debugSpy = jest
        .spyOn(Logger.prototype, 'debug')
        .mockImplementation(() => undefined);
      const { host, response } = makeHost();
      filter.catch(
        new DomainError(
          'article.conflict',
          'stale version',
          { expectedVersion: 1 },
          { articleId: 'secret-internal-id' },
        ),
        host,
      );
      expect(response.json).toHaveBeenCalledWith({
        code: 'article.conflict',
        message: 'stale version',
        meta: { expectedVersion: 1 },
      });
      expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('secret-internal-id'),
      );
      debugSpy.mockRestore();
    });
  });
});
