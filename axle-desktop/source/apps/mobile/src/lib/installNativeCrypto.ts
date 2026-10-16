import { getRandomValues, randomUUID } from "expo-crypto";

type NativeCrypto = {
  getRandomValues?: typeof getRandomValues;
  randomUUID?: typeof randomUUID;
};

// Hermes does not provide Web Crypto. Neon Auth calls crypto.randomUUID()
// while its modules load, so this must run before importing the app.
const runtime = globalThis as unknown as { crypto?: NativeCrypto };
const crypto = (runtime.crypto ??= {});

// Preserve any APIs already supplied by the runtime or another native library.
crypto.getRandomValues ??= getRandomValues;
crypto.randomUUID ??= randomUUID;
