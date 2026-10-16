/**
 * Base64url, hashing, and AES-GCM sealing helpers shared by the router, the
 * session-identity module, and the sign-in module. Extracted so those modules
 * can depend on it instead of importing the router and creating an import cycle.
 */

export function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function base64UrlToBytes(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64Url(value);
}

export async function sha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function requireStore(env) {
  if (!env.PLUGIN_STORE || typeof env.PLUGIN_STORE.get !== "function") {
    throw new Error("PLUGIN_STORE KV binding is not configured.");
  }
  return env.PLUGIN_STORE;
}

export async function bestEffortDelete(store, key) {
  // KV deletion is cleanup only. A daily delete quota failure must not make
  // status reads, OAuth callbacks, or a newly authorized connection fail.
  await store.delete(key).catch(() => undefined);
}

export function requireEncryptionSecret(env) {
  const secret = env.PLUGIN_TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret) throw new Error("PLUGIN_TOKEN_ENCRYPTION_KEY is not configured.");
  return secret;
}

export async function encryptionKey(env) {
  const raw = requireEncryptionSecret(env);
  const bytes = base64UrlToBytes(raw);
  if (bytes.byteLength !== 32) {
    throw new Error("PLUGIN_TOKEN_ENCRYPTION_KEY must be a base64url-encoded 32-byte key.");
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sealStateless(value, env) {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(env),
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return `s1.${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(ciphertext))}`;
}

export async function openStateless(token, env) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3 || parts[0] !== "s1") return null;
  try {
    const cleartext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64UrlToBytes(parts[1]) },
      await encryptionKey(env),
      base64UrlToBytes(parts[2]),
    );
    const value = JSON.parse(new TextDecoder().decode(cleartext));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}
