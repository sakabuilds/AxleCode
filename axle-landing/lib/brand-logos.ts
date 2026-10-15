/**
 * Real vendor marks for the provider and integration catalogues.
 *
 * Keyed by provider id or integration name, mapped to a file in
 * `public/brand-logos`. Everything listed here is the vendor's own mark taken
 * from their site or from the desktop app's copy of it — nothing is a redrawn
 * approximation. A few marks whose official colour is near-black (GitHub,
 * Anthropic, Sentry, DeepSeek) ship as a recoloured copy so they stay legible
 * on the dark page.
 *
 * A catalogue entry with no logo falls back to its written mark, which is what
 * the built-in tools, the router, and customer-supplied endpoints use because
 * they have no logo of their own.
 */
const LOGO = (file: string) => `/brand-logos/${file}`;

export const PROVIDER_LOGOS: Readonly<Record<string, string>> = {
  openai: LOGO("openai.svg"),
  anthropic: LOGO("anthropic.svg"),
  gemini: LOGO("googlegemini.svg"),
  openrouter: LOGO("openrouter.png"),
  fireworks: LOGO("fireworks.png"),
  cerebras: LOGO("cerebras.png"),
  groq: LOGO("groq.svg"),
  "nvidia-nim": LOGO("nvidia.svg"),
  mistral: LOGO("mistral.svg"),
  deepseek: LOGO("deepseek.svg"),
  xai: LOGO("xai.png"),
  "ollama-cloud": LOGO("ollama.svg"),
  ollama: LOGO("ollama.svg"),
};

export const INTEGRATION_LOGOS: Readonly<Record<string, string>> = {
  GitHub: LOGO("github.svg"),
  Git: LOGO("git.svg"),
  Figma: LOGO("figma.svg"),
  Linear: LOGO("linear.svg"),
  Notion: LOGO("notion.svg"),
  Sentry: LOGO("sentry.svg"),
  Playwright: LOGO("playwright.svg"),
  Slack: LOGO("slack.svg"),
};

export const providerLogo = (id: string): string | undefined => PROVIDER_LOGOS[id];
export const integrationLogo = (name: string): string | undefined => INTEGRATION_LOGOS[name];
