// Run the Axle gateway locally: `node scripts/local-gateway.mjs`.
//
// Uses an in-memory credits store and a stubbed upstream, so you can point the
// desktop app or the `axle` binary at it and watch credits move without a
// Cloudflare account, a database, or an upstream API key.
import { startGateway } from "./lib/gateway-server.mjs";

const port = Number(process.env.PORT || 8791);
const gateway = await startGateway({ port });
const base = gateway.url;

console.log(`Axle gateway listening on ${base}`);
console.log("");
console.log("Try it with curl:");
console.log(`  curl -s ${base}/v1/models`);
console.log(`  curl -s -H 'Authorization: Bearer demo_key' ${base}/v1/credits`);
console.log(
  `  curl -s -H 'Authorization: Bearer demo_key' -H 'Content-Type: application/json' \\\n` +
    `    -d '{"model":"glm-5.3","messages":[{"role":"user","content":"hi"}]}' \\\n` +
    `    ${base}/v1/chat/completions`,
);
console.log("");
console.log("Point the engine at it:");
console.log(
  `  AXLE_BASE_URL=${base}/v1 AXLE_API_KEY=demo_key \\\n` +
    `    ./target/release/axle --provider axle --model gemma-4 --text-only -p "say hi"`,
);
console.log("");
console.log("Point the desktop app at it:");
console.log(`  Settings > Models > Axle: paste any key, set the base URL to ${base}/v1`);
console.log("");
console.log("Ctrl-C to stop.");

process.on("SIGINT", () => {
  void gateway.close().then(() => process.exit(0));
});
