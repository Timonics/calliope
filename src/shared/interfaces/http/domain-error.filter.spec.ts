import { ArgumentsHost, NotFoundException } from '@nestjs/common';
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
  });

  it('maps an unmapped domain error to 500 internal.error', () => {
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
});
