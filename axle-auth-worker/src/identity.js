/**
 * Axle-owned session identity.
 *
 * Access tokens are ES256 JWTs signed with a P-256 key generated on first use
 * and sealed into PLUGIN_STORE with the existing stateless-token key. Publishing
 * the public half at /.well-known/jwks.json lets the account API verify sessions
 * with `createRemoteJWKSet` and no shared secret.
 */

import { bytesToBase64Url, base64UrlToBytes, openStateless, requireStore, sealStateless } from "./shared.js";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const ACCESS_TOKEN_AUDIENCE = "axle-desktop";
const SIGNING_KEY_ID = "auth:signing-key:v1";
const ALGORITHM = "ES256";

let cachedSigningKey = null;

function requireAccountsDb(env) {
  if (!env?.ACCOUNTS_DB || typeof env.ACCOUNTS_DB.prepare !== "function") {
    throw new Error("ACCOUNTS_DB D1 binding is not configured.");
  }
  return env.ACCOUNTS_DB;
}

export function accountsDb(env) {
  return requireAccountsDb(env);
}

export function issuerFor(env) {
  const configured = env?.AUTH_ISSUER?.trim();
  if (configured) return configured.replace(/\/$/u, "");
  const base = env?.PUBLIC_BASE_URL?.trim();
  if (base) return base.replace(/\/$/u, "");
  throw new Error("AUTH_ISSUER or PUBLIC_BASE_URL must be configured.");
}

async function publicThumbprint(jwk) {
  // Stable key id from the public point, so a rotated key yields a new `kid`.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${jwk.crv}.${jwk.x}.${jwk.y}`),
  );
  return bytesToBase64Url(new Uint8Array(digest)).slice(0, 16);
}

function publicJwk(jwk) {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, kid: jwk.kid, use: "sig", alg: ALGORITHM };
}

async function generateSigningKey() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { ...jwk, kid: await publicThumbprint(jwk), use: "sig", alg: ALGORITHM };
}

async function readSealedSigningKey(env) {
  const sealed = await requireStore(env).get(SIGNING_KEY_ID);
  if (!sealed) return null;
  const value = await openStateless(sealed, env);
  const jwk = value?.jwk;
  return jwk && typeof jwk.x === "string" && typeof jwk.d === "string" ? jwk : null;
}

export async function signingKey(env) {
  if (cachedSigningKey?.env === env) return cachedSigningKey.jwk;
  const existing = await readSealedSigningKey(env);
  if (existing) {
    cachedSigningKey = { env, jwk: existing };
    return existing;
  }
  const generated = await generateSigningKey();
  await requireStore(env).put(SIGNING_KEY_ID, await sealStateless({ jwk: generated }, env));
  // A concurrent isolate may have won the race; prefer whatever is now stored
  // so every isolate signs with the same key.
  const settled = (await readSealedSigningKey(env)) ?? generated;
  cachedSigningKey = { env, jwk: settled };
  return settled;
}

async function signingCryptoKey(env) {
  const jwk = await signingKey(env);
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

async function verifyCryptoKey(env, kid) {
  const jwk = await signingKey(env);
  if (kid && jwk.kid !== kid) throw new Error("Session token signing key is unknown.");
  return crypto.subtle.importKey(
    "jwk",
    publicJwk(jwk),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

export async function jwksDocument(env) {
  return { keys: [publicJwk(await signingKey(env))] };
}

export async function issueAccessToken(env, { userId, sessionId, email }) {
  const now = Math.floor(Date.now() / 1000);
  const jwk = await signingKey(env);
  const header = { alg: ALGORITHM, kid: jwk.kid, typ: "JWT" };
  const payload = {
    iss: issuerFor(env),
    aud: ACCESS_TOKEN_AUDIENCE,
    sub: userId,
    sid: sessionId,
    ...(email ? { email } : {}),
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
  };
  const signingInput = `${bytesToBase64Url(new TextEncoder().encode(JSON.stringify(header)))}.${bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)))}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await signingCryptoKey(env),
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifyAccessToken(env, token) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3) throw new Error("Invalid Axle session token.");
  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
  } catch {
    throw new Error("Invalid Axle session token.");
  }
  if (header.alg !== ALGORITHM) throw new Error("Unsupported Axle session algorithm.");
  const issuer = issuerFor(env);
  if (payload.iss !== issuer) throw new Error("Axle session issuer does not match this deployment.");
  if (payload.aud !== ACCESS_TOKEN_AUDIENCE) throw new Error("Axle session audience is invalid.");
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp <= now - 30) throw new Error("Axle session expired.");
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("Axle session is missing a subject.");
  }
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    await verifyCryptoKey(env, header.kid),
    base64UrlToBytes(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) throw new Error("Axle session signature is invalid.");
  return {
    userId: payload.sub,
    email: typeof payload.email === "string" ? payload.email : null,
    sessionId: typeof payload.sid === "string" ? payload.sid : null,
  };
}

export function resetSigningKeyCache() {
  cachedSigningKey = null;
}
