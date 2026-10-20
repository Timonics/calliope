/**
 * Domain error base class.
 *
 * Domain errors are *expected* failure modes that a use-case can decide how
 * to handle (return a friendly HTTP 4xx, retry, escalate). They are *not*
 * exceptional — do not throw them from infrastructural code (e.g. a database
 * timeout is a system error, not a domain error).
 *
 * Every domain error carries a stable, machine-readable `code` so that HTTP
 * adapters and SDKs can map it to a typed response without parsing strings.
 * `DomainErrorFilter` maps the code (exact match first, then prefix table)
 * to an HTTP status and renders `{code, message}` JSON.
 */
export type DomainErrorCode =
  // Authentication / authorization (cerberus-issued tokens)
  | 'authentication.token.missing'
  | 'authorization.token.invalid'
  | 'authorization.token.expired'
  | 'authorization.scope.insufficient'
  | 'authorization.principal.missing'
  // HTTP input validation
  | 'http.validation.failed'
  // Generic
  | 'domain.invariant_violation'
  | 'domain.illegal_state'
  // Blogging domain — `DomainErrorFilter` maps these by code suffix
  // (`.not_found` → 404, `.conflict` → 409, `.validation` → 400,
  // `.forbidden` → 403); the exact codes are listed here so the union
  // stays exhaustive and typo-prone string casts surface at compile time.
  | 'blog.not_found'
  | 'blog.conflict'
  | 'blog.forbidden'
  | 'author.not_found'
  | 'author.conflict'
  | 'category.not_found'
  | 'category.conflict'
  | 'tag.not_found'
  | 'tag.conflict'
  | 'article.not_found'
  | 'article.conflict'
  | 'article.validation';

export class DomainError extends Error {
  /** Stable, machine-readable error code. UI/SDKs should branch on this. */
  public readonly code: DomainErrorCode;

  /**
   * Optional structured detail that callers may attach (e.g. which constraint
   * failed, which field). Never include PII or secrets — this is logged.
   */
  public readonly detail?: Readonly<Record<string, unknown>>;

  public constructor(
    code: DomainErrorCode,
    message: string,
    detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.detail = detail;

    // Restore prototype chain after super() — required when targeting ES5/ES2015
    // transpilation. Safe under ES2023 too.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Render to a JSON-safe shape for HTTP responses. PII fields (email, IPs)
   * are intentionally NOT included here — those belong in audit logs, not in
   * the public error payload.
   */
  public toJSON(): {
    code: DomainErrorCode;
    message: string;
    meta?: Readonly<Record<string, unknown>>;
  } {
    return {
      code: this.code,
      message: this.message,
      ...(this.detail === undefined ? {} : { meta: this.detail }),
    };
  }
}
