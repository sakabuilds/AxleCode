import { CloudJobError } from "./cloudErrors.ts";

const REVISION = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

export interface CloudRevisionResolver {
  /** Resolves a branch, tag, or commit to the commit id a run starts from. */
  resolve(repositoryUrl: string, sourceRef: string): Promise<string>;
}

/**
 * Commit resolution for cloud schedules. Pinned commit ids pass through;
 * branch and tag names are resolved through the GitHub API. Setting
 * `AXLE_GITHUB_TOKEN` on the control plane raises the API rate limit (and is
 * required by GitHub for private-repository metadata, even though clones stay
 * credential-free).
 */
export function createCloudRevisionResolver(
  options: { fetch?: typeof fetch; githubToken?: string | null } = {},
): CloudRevisionResolver {
  const fetchImpl = options.fetch ?? fetch;
  const token = options.githubToken?.trim() || null;
  return {
    async resolve(repositoryUrl: string, sourceRef: string): Promise<string> {
      const pinned = sourceRef.toLowerCase();
      if (REVISION.test(pinned)) return pinned;
      const repository = new URL(repositoryUrl);
      if (repository.hostname !== "github.com") throw new CloudJobError("invalid_source_ref");
      const [owner, project] = repository.pathname
        .replace(/^\/+/u, "")
        .split("/")
        .map((part) => part.replace(/\.git$/u, ""));
      if (!owner || !project) throw new CloudJobError("invalid_repository");
      const headers: Record<string, string> = {
        accept: "application/vnd.github+json",
        "user-agent": "axle-account",
      };
      if (token !== null) headers.authorization = `Bearer ${token}`;
      let response: Response;
      try {
        response = await fetchImpl(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(project)}/commits/${encodeURIComponent(sourceRef)}`,
          { headers },
        );
      } catch {
        throw new CloudJobError("source_revision_unavailable");
      }
      if (!response.ok) throw new CloudJobError("source_revision_unavailable");
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new CloudJobError("source_revision_unavailable");
      }
      const sha =
        body !== null && typeof body === "object" ? (body as { sha?: unknown }).sha : undefined;
      if (typeof sha !== "string" || !REVISION.test(sha.toLowerCase()))
        throw new CloudJobError("source_revision_unavailable");
      return sha.toLowerCase();
    },
  };
}
