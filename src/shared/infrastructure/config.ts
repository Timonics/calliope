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

/** HTTP port the API listens on. */
export const port = (): number => Number(process.env.PORT ?? 3002);

/** Cerberus JWKS endpoint. No default — point it at the real cerberus. */
export const cerberusJwksUrl = (): string => required('CERBERUS_JWKS_URL');

/** Expected `iss` claim on cerberus-issued tokens. */
export const cerberusIssuer = (): string =>
  process.env.CERBERUS_ISSUER ?? 'cerberus';

/** Expected `aud` claim on cerberus-issued tokens. */
export const cerberusAudience = (): string =>
  process.env.CERBERUS_AUDIENCE ?? 'cerberus-clients';
