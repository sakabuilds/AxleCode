const DOWNLOAD_BASE_URL = "https://axle-download.axle-download-worker.workers.dev";

export const DOWNLOAD_URL = "https://axle.llc/download";

const MANIFEST_URL = `${DOWNLOAD_BASE_URL}/get/manifest`;
const CACHE_KEY = "axle-latest-release";

export interface ReleaseFile {
  name: string;
  platform: string;
}

export interface Release {
  version: string;
  publishedAt: string | null;
  changelog: string;
  files: ReleaseFile[];
}

export function downloadUrl(platform: string): string {
  return `${DOWNLOAD_BASE_URL}/get?platform=${encodeURIComponent(platform)}`;
}

export async function fetchLatestRelease(): Promise<Release> {
  const cached = sessionStorage.getItem(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const data = await fetch(MANIFEST_URL).then((r) => r.json());

  if (data?.version && data?.files) {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(data));
  }

  return data;
}
