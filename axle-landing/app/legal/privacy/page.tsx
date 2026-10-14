import type { Metadata } from "next";
import { LegalPage, type LegalSection } from "@/components/site/legal-page";

export const metadata: Metadata = {
  title: "Privacy & data",
  description: "Understand the desktop workflow, connected model providers, authentication, and download service data.",
};

const sections: LegalSection[] = [
  {
    id: "workspace",
    heading: "Your workspace and model context",
    paragraphs: [
      "The desktop app works with projects and tools in the environments you connect. When you use a model, prompts, attachments, tool results, and relevant source files can become part of the context sent to that provider.",
      "Running a desktop app does not mean every operation stays on your device. Review the models, integrations, and environments you choose before working with sensitive information.",
    ],
  },
  {
    id: "providers",
    heading: "Connected providers",
    paragraphs: [
      "Model providers and connected services process requests under their own terms and privacy policies. Retention, training controls, and account settings depend on the provider and service you use.",
      "Check the policy and settings for your selected provider, including whether you are using an API account, a subscription sign-in, or a local model.",
    ],
    links: [
      { label: "OpenAI privacy", href: "https://openai.com/policies/privacy-policy/" },
      { label: "Anthropic privacy", href: "https://www.anthropic.com/legal/privacy" },
      { label: "Google privacy", href: "https://policies.google.com/privacy" },
    ],
  },
  {
    id: "accounts",
    heading: "Sign-in, connections, and downloads",
    paragraphs: [
      "Account sign-in and connected apps use authentication services. Begin sign-in from the desktop app so the result can return to the correct session.",
      "The download service is configured to record request events, including the requested platform, release, download outcome, browser and operating system, and approximate country. These events help describe how desktop releases are delivered.",
    ],
  },
  {
    id: "choices",
    heading: "Choices you can make",
    paragraphs: ["Choose providers and integrations that meet the requirements of your project or organization."],
    bullets: [
      "Review the context and attachments included in requests.",
      "Disconnect integrations you no longer need and revoke their credentials with the provider.",
      "Keep your device and connected environments protected, and manage locally stored project data on those devices.",
    ],
    links: [{ label: "Configure your models", href: "/docs#models" }, { label: "Security guidance", href: "/legal/security" }],
  },
];

export default function PrivacyPage() {
  return <LegalPage eyebrow="The details" title="Privacy & data" updated="October 13, 2026" intro="A practical guide to where information goes when you use the desktop app, connect a model, or download a release." sections={sections} />;
}
