// @effect-diagnostics nodeBuiltinImport:off
import { MongoMemoryReplSet, MongoMemoryServer } from "mongodb-memory-server";

// MongoDB does not publish generic "debian" builds, and this project's host
// distro detection does not map Parrot's VERSION_ID. Pin a published
// Debian 12 build for every test process before a server is started.
process.env.MONGOMS_VERSION ??= "8.0.12";
process.env.MONGOMS_DISTRO ??= "Debian-12";

export function startMongoMemoryServer() {
  return MongoMemoryServer.create();
}

export function startMongoMemoryReplSet() {
  return MongoMemoryReplSet.create({ replSet: { count: 1 } });
}
