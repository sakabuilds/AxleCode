export const NAV_LINKS = [
  { href: "/product", label: "Product" },
  { href: "/features", label: "Features" },
  { href: "/models", label: "Models" },
  { href: "/integrations", label: "Integrations" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "Docs" },
  { href: "/changelog", label: "Changelog" },
  { href: "/company", label: "Company" },
] as const;

export const FOOTER_GROUPS = [
  {
    title: "Product",
    links: [
      { href: "/product", label: "Overview" },
      { href: "/features", label: "Features" },
      { href: "/models", label: "Models" },
      { href: "/integrations", label: "Integrations" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/changelog", label: "Changelog" },
      { href: "/docs#quickstart", label: "Quickstart" },
      { href: "/docs#api-reference", label: "API reference" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/company#about", label: "About" },
      { href: "/company#principles", label: "Principles" },
      { href: "/company#careers", label: "Careers" },
      { href: "/company#contact", label: "Contact" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/privacy", label: "Privacy" },
      { href: "/legal/terms", label: "Terms" },
      { href: "/legal/security", label: "Security" },
    ],
  },
] as const;
