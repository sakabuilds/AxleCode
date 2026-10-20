import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const bundleRoot = path.resolve(process.cwd(), "apps/desktop/dist-electron");
const webBundleRoot = path.resolve(process.cwd(), "apps/web/dist");
const accountApiUrl = (
  process.env.VITE_ACCOUNT_API_URL ??
  process.env.T3CODE_ACCOUNT_API_URL ??
  ""
).trim();
const textExtensions = new Set([".cjs", ".js", ".mjs", ".map"]);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
    } else if (entry.isFile() && textExtensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

try {
  const bundleFiles = await collectFiles(bundleRoot);
  const bundleText = await Promise.all(bundleFiles.map((file) => readFile(file, "utf8")));
  const hasOAuthRepositoryEndpoint = bundleText.some((text) => text.includes("/user/repos?"));
  const hasLegacyInstallationsEndpoint = bundleText.some((text) =>
    text.includes("/user/installations"),
  );

  if (!hasOAuthRepositoryEndpoint || hasLegacyInstallationsEndpoint) {
    throw new Error(
      `GitHub OAuth bundle check failed: expected /user/repos? and no /user/installations in ${bundleRoot}.`,
    );
  }

  console.log(`GitHub OAuth bundle check passed (${bundleFiles.length} text files scanned).`);
} catch (error) {
  if (error?.code === "ENOENT") {
    throw new Error(`GitHub OAuth bundle check could not find ${bundleRoot}.`, { cause: error });
  }
  throw error;
}

if (accountApiUrl) {
  try {
    const webBundleFiles = await collectFiles(webBundleRoot);
    const webBundleText = await Promise.all(webBundleFiles.map((file) => readFile(file, "utf8")));
    const hasAccountApiUrl = webBundleText.some((text) => text.includes(accountApiUrl));

    if (!hasAccountApiUrl) {
      throw new Error(
        `Account API bundle check failed: expected ${accountApiUrl} in ${webBundleRoot}. The release would ship without a working billing/plan backend.`,
      );
    }

    console.log(`Account API bundle check passed (${webBundleFiles.length} text files scanned).`);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Account API bundle check could not find ${webBundleRoot}.`, {
        cause: error,
      });
    }
    throw error;
  }
}
