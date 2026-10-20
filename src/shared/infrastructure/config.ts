/**
 * Typed accessors over `process.env`.
 *
 * Convention (charon): read the environment at the point of use and fail
 * loudly when a required variable is missing — never fall back to a silent
 * default that connects to the wrong database. Variables that genuinely
 * have a workspace-wide default (PORT, cerberus claim values) declare it
 * here explicitly instead.
 */

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable: ${name}. See .env.example.`,
    );
  }
  return value;
}

/** Postgres connection string (from docker-compose: postgres://postgres:postgres@localhost:5435/calliope). */
export const databaseUrl = (): string => required('DATABASE_URL');

/**
 * HTTP port the API listens on. Validated: a non-numeric PORT fails
 * loudly at bootstrap instead of NaN-ing into `listen()`.
 */
export const port = (): number => {
  const raw = process.env.PORT ?? '3002';
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65_535) {
    throw new Error(
      `PORT must be an integer between 0 and 65535, got "${raw}"`,
    );
  }
  return parsed;
};

/**
 * Cerberus JWKS endpoint. No default — point it at the real cerberus.
 */
export const cerberusJwksUrl = (): string => required('CERBERUS_JWKS_URL');

/**
 * Expected `iss` claim on cerberus-issued tokens.
 *
 * Documented deviation from the strict "no defaults" rule: issuer and
 * audience default to the cerberus convention values (charon
 * convention — the cerberus deployment always issues these unless
 * explicitly overridden). The JWKS endpoint, which genuinely varies
 * per environment, has NO default above.
 */
export const cerberusIssuer = (): string =>
  process.env.CERBERUS_ISSUER ?? 'cerberus';

/** Expected `aud` claim on cerberus-issued tokens. */
export const cerberusAudience = (): string =>
  process.env.CERBERUS_AUDIENCE ?? 'cerberus-clients';
