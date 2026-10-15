import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import worker, { handleRequest, releaseConfig, requestedPlatform, updateRequest, validateManifest } from "./index.js";

const env = {
  AWS_RELEASE_BASE_URL: "https://downloads.example.test/releases/0.0.28/",
  AWS_WINDOWS_BASE_URL: "https://downloads.example.test/releases/0.0.28/windows/",
  AWS_MAC_ARM64_BASE_URL: "https://downloads.example.test/releases/0.0.28/macos/arm64/",
  AWS_MAC_X64_BASE_URL: "https://downloads.example.test/releases/0.0.28/macos/x64/",
  AWS_LINUX_BASE_URL: "https://downloads.example.test/releases/0.0.28/linux/",
  RELEASE_VERSION: "0.0.28",
  RELEASE_PUBLISHED_AT: "2026-07-28T10:57:02.310Z",
  RELEASE_CHANGELOG: "Launch build",
  RELEASE_WINDOWS_SIZE: "342384168",
  RELEASE_WINDOWS_SHA256: "C308C3C15654976B65E239D8820A603488193E547A653A7121DC639F516C276A",
  RELEASE_MAC_ARM64_SIZE: "211000000",
  RELEASE_MAC_ARM64_SHA256: "ARM64HASH",
  RELEASE_MAC_X64_SIZE: "214000000",
  RELEASE_MAC_X64_SHA256: "X64HASH",
  RELEASE_LINUX_SIZE: "220000000",
  RELEASE_LINUX_ASC_SIZE: "1024",
  RELEASE_LINUX_ASC_SHA256: "LINUXHASH",
  RELEASE_LINUX_DEB_SIZE: "230000000",
  RELEASE_LINUX_DEB_SHA256: "LINUXDEBHASH",
};

test("the public Windows download redirects to the AWS installer", async () => {
  const response = await handleRequest(new Request("https://axle.llc/get?platform=windows"), env);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://downloads.example.test/releases/0.0.28/windows/Axle.exe");
});

test("unsupported systems default to Windows, while Linux and macOS resolve to installers", async () => {
  assert.equal(requestedPlatform(new Request("https://axle.llc/get"), new URL("https://axle.llc/get")), "windows-x64");
  assert.equal(requestedPlatform(new Request("https://axle.llc/get", { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64)" } }), new URL("https://axle.llc/get")), "linux-x64");
  assert.equal(requestedPlatform(new Request("https://axle.llc/get", { headers: { "User-Agent": "Mozilla/5.0 (Linux; Android 15)" } }), new URL("https://axle.llc/get")), "windows-x64");

  const arm = await handleRequest(new Request("https://axle.llc/get?platform=macos"), env);
  assert.equal(arm.headers.get("location"), "https://downloads.example.test/releases/0.0.28/macos/arm64/Axle.dmg");
  const linux = await handleRequest(new Request("https://axle.llc/get?platform=linux"), env);
  assert.equal(linux.headers.get("location"), "https://downloads.example.test/releases/0.0.28/linux/Axle-x64.AppImage");
});

test("a Linux visitor can request the .deb package", async () => {
  const deb = await handleRequest(new Request("https://axle.llc/get?platform=linux&format=deb"), env);
  assert.equal(deb.status, 302);
  assert.equal(deb.headers.get("location"), "https://downloads.example.test/releases/0.0.28/linux/Axle-amd64.deb");

  // The default stays the AppImage so links handed out before .deb support
  // existed keep resolving to the format people were already told to expect.
  const fallback = await handleRequest(new Request("https://axle.llc/get?platform=linux"), env);
  assert.equal(fallback.headers.get("location"), "https://downloads.example.test/releases/0.0.28/linux/Axle-x64.AppImage");
  const explicit = await handleRequest(new Request("https://axle.llc/get?platform=linux&format=AppImage"), env);
  assert.equal(explicit.headers.get("location"), "https://downloads.example.test/releases/0.0.28/linux/Axle-x64.AppImage");
});

test("an installer format that does not exist for a platform fails closed", async () => {
  const windowsDeb = await handleRequest(new Request("https://axle.llc/get?platform=windows&format=deb"), env);
  assert.equal(windowsDeb.status, 404);
  assert.match((await windowsDeb.json()).error, /deb windows-x64 installer/u);

  const unknownFormat = await handleRequest(new Request("https://axle.llc/get?platform=linux&format=rpm"), env);
  assert.equal(unknownFormat.status, 404);

  const intelDmg = await handleRequest(new Request("https://axle.llc/get?platform=macos-x64&format=dmg"), env);
  assert.equal(intelDmg.status, 302);
  assert.equal(intelDmg.headers.get("location"), "https://downloads.example.test/releases/0.0.28/macos/x64/Axle.dmg");
});

test("a missing installer still records which format was asked for", async () => {
  const originalFetch = globalThis.fetch;
  let payload;
  globalThis.fetch = async (_input, init) => {
    payload = JSON.parse(init.body);
    return new Response("{}", { status: 200 });
  };
  try {
    const response = await handleRequest(
      new Request("https://axle.llc/get?platform=windows&format=deb"),
      { ...env, ANALYTICS_ENDPOINT: "https://analytics.example.test/analytics/event" },
    );
    assert.equal(response.status, 404);
    assert.equal(payload.outcome, "missing-installer");
    assert.equal(payload.file, "deb");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the manifest describes the local launch build", async () => {
  const response = await handleRequest(new Request("https://axle.llc/get/manifest"), env);
  const body = await response.json();
  assert.equal(body.version, "0.0.28");
  assert.equal(body.files[0].name, "Axle-x64.exe");
  assert.equal(body.files[0].size, 342384168);
  assert.equal(body.files[0].sha256, env.RELEASE_WINDOWS_SHA256);
  assert.deepEqual(body.files.slice(1).map((file) => file.platform), ["macos-arm64", "macos-x64", "linux-x64", "linux-x64", "linux-x64"]);
  assert.deepEqual(body.files.slice(1).map((file) => file.sha256), [env.RELEASE_MAC_ARM64_SHA256, env.RELEASE_MAC_X64_SHA256, null, env.RELEASE_LINUX_ASC_SHA256, env.RELEASE_LINUX_DEB_SHA256]);
});

test("the desktop updater resolves only known AWS release assets", async () => {
  const latest = await handleRequest(new Request("https://axle.llc/get/updates/latest.yml"), env);
  assert.equal(latest.status, 302);
  assert.equal(latest.headers.get("location"), "https://downloads.example.test/releases/0.0.28/latest.yml");

  const traversal = await handleRequest(new Request("https://axle.llc/get/updates/%2e%2e%2fsecret"), env);
  assert.equal(traversal.status, 404);
});

test("desktop updater feed checks do not record installer analytics", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {
    calls.push(args);
    return new Response("{}", { status: 200 });
  };
  try {
    const response = await handleRequest(
      new Request("https://axle.llc/get/updates/latest.yml"),
      { ...env, ANALYTICS_ENDPOINT: "https://analytics.example.test/analytics/event" },
    );
    assert.equal(response.status, 302);
    assert.equal(calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public installer redirects remain real installer analytics calls", async () => {
  const originalFetch = globalThis.fetch;
  let payload;
  globalThis.fetch = async (_input, init) => {
    payload = JSON.parse(init.body);
    return new Response("{}", { status: 200 });
  };
  try {
    const response = await handleRequest(
      new Request("https://axle.llc/get?platform=windows&downloadId=click-1"),
      { ...env, ANALYTICS_ENDPOINT: "https://analytics.example.test/analytics/event" },
    );
    assert.equal(response.status, 302);
    assert.equal(payload.kind, "download_request");
    assert.equal(payload.platform, "windows-x64");
    assert.equal(payload.file, "Axle-x64.exe");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("architecture-specific updater paths cannot cross platforms", () => {
  assert.deepEqual(updateRequest("/get/updates/windows/latest.yml"), { platform: "windows-x64", name: "latest.yml" });
  assert.deepEqual(updateRequest("/get/updates/windows/x64/latest.yml"), { platform: "windows-x64", name: "latest.yml" });
  assert.deepEqual(updateRequest("/get/updates/linux/Axle-x64.AppImage"), { platform: "linux-x64", name: "Axle-x64.AppImage" });
  assert.deepEqual(updateRequest("/get/updates/linux/Axle-x64.AppImage.asc"), { platform: "linux-x64", name: "Axle-x64.AppImage.asc" });
  assert.deepEqual(updateRequest("/get/updates/linux/latest-linux.yml"), { platform: "linux-x64", name: "latest-linux.yml" });
  assert.deepEqual(updateRequest("/get/updates/macos/arm64/latest-mac.yml"), { platform: "macos-arm64", name: "latest-mac-arm64.yml" });
  assert.deepEqual(updateRequest("/get/updates/macos/x64/latest-mac.yml"), { platform: "macos-x64", name: "latest-mac-x64.yml" });
  assert.deepEqual(updateRequest("/get/updates/macos/x64/Axle-x64.zip"), { platform: "macos-x64", name: "Axle-x64.zip" });
  assert.equal(updateRequest("/get/updates/macos/arm64/../secret"), null);
});

test("dynamic AWS manifests require complete HTTPS file metadata", () => {
  const manifest = validateManifest({
    version: "0.0.29",
    files: [{
      name: "latest-mac.yml",
      platform: "macos-arm64",
      size: 321,
      contentType: "text/yaml",
      url: "https://downloads.example.test/releases/0.0.29/macos/arm64/latest-mac.yml",
    }],
  });
  assert.equal(manifest.files[0].platform, "macos-arm64");
  assert.throws(() => validateManifest({ version: "0.0.29", files: [{ name: "bad", platform: "macos-arm64", size: 1, url: "http://unsafe.test/bad" }] }), /configured with HTTPS/u);
});

test("GitHub release manifests keep Intel and Apple Silicon feeds distinct", () => {
  const manifest = releaseConfig({
    RELEASE_PUBLIC_BASE_URL: "https://github.com/darkness22s/Axle-primary-related/releases/download/v1.1.2",
    RELEASE_VERSION: "1.1.2",
    RELEASE_WINDOWS_SIZE: "10",
    RELEASE_WINDOWS_BLOCKMAP_SIZE: "11",
    RELEASE_WINDOWS_YML_SIZE: "12",
    RELEASE_MAC_ARM64_SIZE: "13",
    RELEASE_MAC_ARM64_BLOCKMAP_SIZE: "14",
    RELEASE_MAC_ARM64_YML_SIZE: "15",
    RELEASE_MAC_ARM64_YML_NAME: "latest-mac-arm64.yml",
    RELEASE_MAC_X64_SIZE: "16",
    RELEASE_MAC_X64_BLOCKMAP_SIZE: "17",
    RELEASE_MAC_X64_YML_SIZE: "18",
    RELEASE_MAC_X64_YML_NAME: "latest-mac-x64.yml",
    RELEASE_LINUX_SIZE: "19",
    RELEASE_LINUX_ASC_SIZE: "20",
    RELEASE_LINUX_YML_SIZE: "21",
  });
  assert.equal(manifest.files.find((file) => file.platform === "macos-arm64" && file.name.endsWith(".yml")).name, "latest-mac-arm64.yml");
  assert.equal(manifest.files.find((file) => file.platform === "macos-x64" && file.name.endsWith(".yml")).name, "latest-mac-x64.yml");
  assert.equal(manifest.files.find((file) => file.platform === "linux-x64" && file.name.endsWith(".yml")).name, "latest-linux.yml");
  assert.equal(manifest.files.filter((file) => file.name.endsWith(".zip")).length, 2);
});

test("a versioned public release overrides stale external manifest bindings", async () => {
  const response = await handleRequest(new Request("https://axle.llc/get/updates/macos/x64/latest-mac-x64.yml"), {
    RELEASE_PUBLIC_BASE_URL: "https://github.com/darkness22s/Axle-primary-related/releases/download/v1.1.2",
    RELEASE_MANIFEST_URL: "https://stale.example.test/manifest.json",
    RELEASE_VERSION: "1.1.2",
    RELEASE_MAC_X64_ZIP_SIZE: "10",
    RELEASE_MAC_X64_SIZE: "11",
    RELEASE_MAC_X64_BLOCKMAP_SIZE: "12",
    RELEASE_MAC_X64_YML_NAME: "latest-mac-x64.yml",
    RELEASE_MAC_X64_YML_SIZE: "13",
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://github.com/darkness22s/Axle-primary-related/releases/download/v1.1.2/latest-mac-x64.yml");
});

test("latest stable GitHub release serves pinned update feeds for every platform", async () => {
  const releaseTag = "v1.1.22";
  const releaseBase = `https://github.com/axle-ai-code/Axle/releases/download/${releaseTag}`;
  const assetNames = [
    "Axle-x64.exe", "Axle-x64.exe.blockmap", "latest.yml",
    "Axle-arm64.zip", "Axle-arm64.dmg", "Axle-arm64.dmg.blockmap", "latest-mac-arm64.yml",
    "Axle-x64.zip", "Axle-x64.dmg", "Axle-x64.dmg.blockmap", "latest-mac-x64.yml",
    "Axle-x64.AppImage", "Axle-x64.AppImage.asc", "Axle-x64.AppImage.zsync", "Axle-amd64.deb", "latest-linux.yml",
  ];
  const release = {
    id: 122,
    tag_name: releaseTag,
    name: "Axle 1.1.22",
    body: "Update all desktop platforms.",
    published_at: "2026-10-04T00:00:00Z",
    draft: false,
    prerelease: false,
    assets: assetNames.map((name) => ({
      name,
      size: 1024,
      content_type: "application/octet-stream",
      digest: name === "Axle-amd64.deb" ? `sha256:${"a".repeat(64)}` : null,
      browser_download_url: `${releaseBase}/${name}`,
    })),
  };
  const feeds = new Map([
    ["latest.yml", `version: 1.1.22
files:
  - url: Axle-x64.exe
    sha512: windows-hash
`],
    ["latest-mac-arm64.yml", `version: 1.1.22
files:
  - url: Axle-arm64.zip
    sha512: arm64-hash
`],
    ["latest-mac-x64.yml", `version: 1.1.22
files:
  - url: Axle-x64.zip
    sha512: x64-hash
`],
    ["latest-linux.yml", `version: 1.1.22
files:
  - url: Axle-x64.AppImage
    sha512: linux-hash
`],
  ]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const requestUrl = String(input);
    if (requestUrl === "https://api.github.com/repos/axle-ai-code/Axle/releases/latest") return Response.json(release);
    const assetName = decodeURIComponent(new URL(requestUrl).pathname.split("/").at(-1));
    const feed = feeds.get(assetName);
    return feed ? new Response(feed, { headers: { "content-type": "application/yaml" } }) : new Response("Not found", { status: 404 });
  };

  try {
    const updateRoutes = [
      ["/get/updates/windows/x64/latest.yml", "Axle-x64.exe"],
      ["/get/updates/macos/arm64/latest-mac.yml", "Axle-arm64.zip"],
      ["/get/updates/macos/x64/latest-mac.yml", "Axle-x64.zip"],
      ["/get/updates/linux/latest-linux.yml", "Axle-x64.AppImage"],
    ];
    const updateEnv = {
      RELEASE_LATEST_API_URL: "https://api.github.com/repos/axle-ai-code/Axle/releases/latest",
      RELEASE_PUBLIC_BASE_URL: "https://github.com/axle-ai-code/Axle/releases/download/v1.1.15",
      RELEASE_VERSION: "1.1.15",
    };
    for (const [path, assetName] of updateRoutes) {
      const response = await handleRequest(new Request(`https://axle.llc${path}`), updateEnv);
      assert.equal(response.status, 200, path);
      assert((await response.text()).includes(`${releaseBase}/${assetName}`), path);
    }

    const debResponse = await handleRequest(new Request("https://axle.llc/get/updates/linux/Axle-amd64.deb"), updateEnv);
    assert.equal(debResponse.status, 302);
    assert.equal(debResponse.headers.get("location"), `${releaseBase}/Axle-amd64.deb`);
    const debInstaller = await handleRequest(new Request("https://axle.llc/get?platform=linux&format=deb"), updateEnv);
    assert.equal(debInstaller.status, 302);
    assert.equal(debInstaller.headers.get("location"), `${releaseBase}/Axle-amd64.deb`);
    const appimageInstaller = await handleRequest(new Request("https://axle.llc/get?platform=linux"), updateEnv);
    assert.equal(appimageInstaller.headers.get("location"), `${releaseBase}/Axle-x64.AppImage`);
    const manifestResponse = await handleRequest(new Request("https://axle.llc/get/manifest"), updateEnv);
    const publicRelease = await manifestResponse.json();
    assert.equal(publicRelease.version, "1.1.22");
    assert(publicRelease.files.some((file) => file.name === "Axle-amd64.deb"));
    // A digest the API publishes is carried through; assets without one stay null.
    assert.equal(publicRelease.files.find((file) => file.name === "Axle-amd64.deb").sha256, "A".repeat(64));
    assert.equal(publicRelease.files.find((file) => file.name === "Axle-x64.exe").sha256, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("beta never replaces the stable launch build", async () => {
  const response = await handleRequest(new Request("https://axle.llc/get?channel=beta"), env);
  assert.equal(response.status, 404);
});

test("invalid AWS release configuration fails closed", async () => {
  assert.throws(() => releaseConfig({ ...env, AWS_RELEASE_BASE_URL: "http://insecure.example" }), /configured with HTTPS/u);
  assert.throws(() => releaseConfig({ ...env, AWS_LINUX_BASE_URL: undefined }), /AWS_LINUX_BASE_URL must be configured with HTTPS/u);
  const response = await worker.fetch(new Request("https://axle.llc/get"), {});
  assert.equal(response.status, 502);
});

test("the pinned fallback mirrors the release repository it points at", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const vars = Object.fromEntries([...toml.matchAll(/^([A-Z][A-Z0-9_]*) = "([^"]*)"$/gmu)].map((match) => [match[1], match[2]]));
  const repo = /repos\/([^/]+\/[^/]+)\/releases\/latest$/u.exec(vars.RELEASE_LATEST_API_URL)?.[1];
  assert(repo, "RELEASE_LATEST_API_URL must be a GitHub latest-release endpoint");
  assert.equal(
    vars.RELEASE_PUBLIC_BASE_URL,
    `https://github.com/${repo}/releases/download/v${vars.RELEASE_VERSION}`,
    "the offline fallback must pin the same repository and version the live lookup uses",
  );
  for (const key of ["RELEASE_WINDOWS_SHA256", "RELEASE_LINUX_ASC_SHA256", "RELEASE_LINUX_DEB_SHA256"]) {
    assert.match(vars[key], /^[0-9A-F]{64}$/u, `${key} must be an uppercase sha256 digest`);
  }
  assert(Number(vars.RELEASE_LINUX_DEB_SIZE) > 0, "the fallback must describe the .deb it advertises");
});
