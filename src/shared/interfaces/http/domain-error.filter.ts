import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthGuardError } from '@timonics/auth-guard';
import { DomainError } from '../../kernel/domain-error';

/**
 * Global filter mapping thrown errors to `{code, message}` JSON.
 *
 * For `DomainError`s the HTTP status is derived from the error code —
 * exact match first, then a code-suffix table, then a code-prefix table
 * (extend the tables as new domains land; unknown codes fall back to 500
 * so they stay loud):
 *
 *   * `authentication.token.missing`,
 *     `authorization.token.invalid`,
 *     `authorization.token.expired`,
 *     `authorization.scope.insufficient`,
 *     `authorization.principal.missing` → 401
 *   * `http.validation.failed` → 400
 *   * `domain.invariant_violation`,
 *     `domain.illegal_state` → 409
 *
 * Suffix rules (blogging domain and anything following the
 * `<resource>.<reason>` convention — checked before the prefix table):
 *
 *   * `*.not_found` → 404
 *   * `*.conflict` → 409
 *   * `*.validation` → 400
 *   * `*.forbidden` → 403
 *
 * Framework `HttpException`s (e.g. Nest's NotFoundException for unmatched
 * routes) keep their own status and are rendered as
 * `{code: "http.<snake_case_status>", message}`.
 *
 * Anything else (truly unexpected — a bug, a down dependency) is logged
 * with its stack and rendered as a generic 500 `{code: "internal.error"}`
 * so error shapes stay uniform for SDKs.
 *
 * 401 responses carry `WWW-Authenticate: Bearer` per RFC 6750.
 */
@Catch()
export class DomainErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainErrorFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType<string>() !== 'http') {
      throw exception;
    }
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      this.logger.debug(
        `[${status}] ${request.method} ${request.url} -> HttpException: ${exception.message}`,
      );
      response.status(status).json({
        code: DomainErrorFilter.codeForHttpStatus(status),
        message: exception.message,
      });
      return;
    }

    if (exception instanceof AuthGuardError) {
      // Auth errors thrown by @timonics/auth-guard guards. Rendered here
      // (not by the package's own catch-all filter) because this filter is
      // registered first — one place owns the {code, message} wire shape.
      const status = exception.status;
      // 401, not HttpStatus.UNAUTHORIZED: the package types `status` as a
      // plain number, and comparing it to the enum trips
      // @typescript-eslint/no-unsafe-enum-comparison.
      if (status === 401) {
        response.setHeader('WWW-Authenticate', 'Bearer realm="calliope"');
      }
      response.status(status).json({
        code: exception.code,
        message: exception.message,
      });
      return;
    }

    if (!(exception instanceof DomainError)) {
      this.logger.error(
        `Unexpected error at ${request.method} ${request.url}: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
        exception instanceof Error ? exception.stack : undefined,
      );
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        code: 'internal.error',
        message: 'Internal server error',
      });
      return;
    }

    const status = DomainErrorFilter.statusFor(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // Expected-but-unmapped domain error — log loudly, return generic 500.
      this.logger.error(
        `Unhandled domain error [${exception.code}] at ${request.method} ${request.url}: ${exception.message}`,
        exception.stack,
      );
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        code: 'internal.error',
        message: 'Internal server error',
      });
      return;
    }

    // Expected — log at debug, return clean JSON. `detail` is server-only
    // context: it goes to the log line, never into the response body
    // (`toJSON` renders `clientMeta` as `meta`).
    this.logger.debug(
      `[${status}] ${request.method} ${request.url} -> ${exception.code}: ${exception.message}${
        exception.detail === undefined
          ? ''
          : ` | detail: ${JSON.stringify(exception.detail)}`
      }`,
    );
    if (status === HttpStatus.UNAUTHORIZED) {
      response.setHeader('WWW-Authenticate', 'Bearer realm="calliope"');
    }
    response.status(status).json(exception.toJSON());
  }

  private static codeForHttpStatus(status: HttpStatus): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'http.bad_request';
      case HttpStatus.UNAUTHORIZED:
        return 'http.unauthorized';
      case HttpStatus.FORBIDDEN:
        return 'http.forbidden';
      case HttpStatus.NOT_FOUND:
        return 'http.not_found';
      case HttpStatus.METHOD_NOT_ALLOWED:
        return 'http.method_not_allowed';
      case HttpStatus.CONFLICT:
        return 'http.conflict';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'http.unprocessable_entity';
      default:
        return 'http.error';
    }
  }

  private static statusFor(error: DomainError): HttpStatus {
    switch (error.code) {
      // 401 — unauthenticated / bad credentials / insufficient scope
      case 'authentication.token.missing':
      case 'authorization.token.invalid':
      case 'authorization.token.expired':
      case 'authorization.scope.insufficient':
      case 'authorization.principal.missing':
        return HttpStatus.UNAUTHORIZED;

      // 400 — bad request (input validation)
      case 'http.validation.failed':
        return HttpStatus.BAD_REQUEST;

      // 409 — conflict / domain invariant
      case 'domain.invariant_violation':
      case 'domain.illegal_state':
        return HttpStatus.CONFLICT;

      default:
        // Suffix table (`<resource>.<reason>` convention) first, then
        // the legacy prefix table — covers codes added to the union
        // before this switch is updated (`error.code` is `never` here
        // only because the switch is currently exhaustive).
        return (
          DomainErrorFilter.statusForSuffix(error.code) ??
          DomainErrorFilter.statusForPrefix(error.code)
        );
    }
  }

  private static statusForSuffix(code: string): HttpStatus | undefined {
    if (code.endsWith('.not_found')) {
      return HttpStatus.NOT_FOUND;
    }
    if (code.endsWith('.conflict')) {
      return HttpStatus.CONFLICT;
    }
    if (code.endsWith('.validation')) {
      return HttpStatus.BAD_REQUEST;
    }
    if (code.endsWith('.forbidden')) {
      return HttpStatus.FORBIDDEN;
    }
    return undefined;
  }

  private static statusForPrefix(code: string): HttpStatus {
    if (
      code.startsWith('authentication.') ||
      code.startsWith('authorization.')
    ) {
      return HttpStatus.UNAUTHORIZED;
    }
    if (code.startsWith('http.')) {
      return HttpStatus.BAD_REQUEST;
    }
    if (code.startsWith('domain.')) {
      return HttpStatus.CONFLICT;
    }
    return HttpStatus.INTERNAL_SERVER_ERROR;
  }
}
