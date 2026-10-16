import { axleWorkerBaseUrl, readClerkAccountToken } from "./clerkRuntime";

export interface AccountProfile {
  readonly id: string;
  readonly email: string | null;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
  readonly createdAt: string | null;
}

export interface AccountIdentity {
  readonly provider: string;
  readonly login: string | null;
  readonly email: string | null;
  readonly linkedAt: string | null;
}

export interface AccountSession {
  readonly sessionId: string;
  readonly method: string;
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly lastSeenAt: string | null;
  readonly revokedAt: string | null;
  readonly current: boolean;
}

export interface SignInProvider {
  readonly id: string;
  readonly label: string;
}

export interface AccountApiKey {
  readonly id: string;
  readonly name: string | null;
  readonly prefix: string;
  readonly createdAt: string | null;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

export interface AccountSnapshot {
  readonly user: AccountProfile;
  readonly identities: ReadonlyArray<AccountIdentity>;
  readonly sessions: ReadonlyArray<AccountSession>;
  readonly signInProviders: ReadonlyArray<SignInProvider>;
}

export class AccountRequestError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "AccountRequestError";
    this.status = status;
    this.code = code;
  }
}

async function accountRequest<T>(
  path: string,
  options: { readonly method?: string; readonly body?: unknown } = {},
): Promise<T> {
  const token = await readClerkAccountToken();
  if (!token) {
    throw new AccountRequestError("Sign in to Axle to manage your account.", 401, "unauthorized");
  }
  const hasBody = options.body !== undefined;
  const response = await fetch(`${axleWorkerBaseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
    credentials: "omit",
  });
  const value = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new AccountRequestError(
      typeof value?.error === "string"
        ? value.error
        : `Axle account request failed (${response.status}).`,
      response.status,
      typeof value?.code === "string" ? value.code : null,
    );
  }
  return value as T;
}

export function fetchAccountSnapshot(): Promise<AccountSnapshot> {
  return accountRequest<AccountSnapshot>("/v1/auth/me");
}

export function updateAccountProfile(
  displayName: string | null,
): Promise<{ readonly user: AccountProfile }> {
  return accountRequest("/v1/auth/profile", { method: "PATCH", body: { displayName } });
}

export function revokeAccountSession(
  sessionId: string,
): Promise<{ readonly ok: boolean; readonly current: boolean }> {
  return accountRequest(`/v1/auth/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });
}

export function unlinkAccountIdentity(provider: string): Promise<{ readonly ok: boolean }> {
  return accountRequest(`/v1/auth/identities/${encodeURIComponent(provider)}`, {
    method: "DELETE",
  });
}

export function signOutAccount(): Promise<{ readonly ok: boolean }> {
  return accountRequest("/v1/auth/signout", { method: "POST", body: {} });
}

export function fetchAccountApiKeys(): Promise<{ readonly keys: ReadonlyArray<AccountApiKey> }> {
  return accountRequest("/v1/auth/api-keys");
}

/**
 * Mints a key for the Axle hosted provider. The plaintext comes back once and
 * is never recoverable, so the caller must show it to the user immediately.
 */
export function createAccountApiKey(
  name: string | null,
): Promise<{ readonly key: AccountApiKey; readonly secret: string }> {
  return accountRequest("/v1/auth/api-keys", { method: "POST", body: { name } });
}

export function revokeAccountApiKey(
  keyId: string,
): Promise<{ readonly ok: boolean; readonly id: string }> {
  return accountRequest(`/v1/auth/api-keys/${encodeURIComponent(keyId)}`, { method: "DELETE" });
}
