import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/site/legal-page";

export const metadata: Metadata = {
  title: "Terms & licensing",
  description: "Read about the desktop license, third-party service terms, and reviewing the work you create.",
};

const sections: LegalSection[] = [
  {
    id: "license",
    heading: "The desktop license",
    paragraphs: [
      "Axle desktop software is proprietary to T3 Tools and its licensors. Your use of the software is governed by the terms you accept when you install or use the app. You may not copy, modify, distribute, sublicense, or create derivative works except as expressly permitted in writing by T3 Tools or by applicable law.",
      "Consult the license and third-party notices shipped with the version you install for the exact terms and copyright attribution.",
    ],
    links: [{ label: "Download the desktop app", href: "/download" }],
  },
  {
    id: "services",
    heading: "Third-party services",
    paragraphs: [
      "Model providers, connected apps, and hosting services can have their own accounts, usage limits, charges, and terms. Review those terms before connecting a service or submitting content.",
      "A software license and a provider subscription cover different things. Check your provider account for inference costs and usage conditions.",
    ],
    links: [{ label: "Model setup", href: "/docs#models" }, { label: "Privacy & data", href: "/legal/privacy" }],
  },
  {
    id: "work",
    heading: "Your projects and generated work",
    paragraphs: [
      "Use repositories, data, and services you are authorized to access. Review the permissions you grant to agents and integrations, especially when they can run commands or change files.",
      "Generated code and suggestions can contain errors. Review changes, run appropriate checks, and assess any third-party licensing requirements before using or distributing the result.",
    ],
  },
  {
    id: "warranty",
    heading: "License notices and warranty",
    paragraphs: [
      "The desktop software is provided “as is,” without warranties of any kind to the extent permitted by law. Refer to the terms shipped with the version you install for the applicable warranty disclaimer and limitation of liability.",
      "Keep the third-party license and attribution notices required by the software and its dependencies when redistributing a build.",
    ],
    links: [{ label: "Release notes", href: "/changelog" }],
  },
];

export default function TermsPage() {
  return <LegalPage eyebrow="The details" title="Terms & licensing" updated="October 26, 2026" intro="The desktop license, connected-service terms, and a few practical responsibilities when building with AI." sections={sections} />;
}
