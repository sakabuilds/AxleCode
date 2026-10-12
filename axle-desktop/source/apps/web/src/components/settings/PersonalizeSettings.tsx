import { useEffect, useState } from "react";
import { SaveIcon } from "lucide-react";

import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const USE_CASE_OPTIONS = [
  "Build new products",
  "Improve an existing codebase",
  "Learn and explore code",
  "Automate engineering work",
] as const;

type AxlePersonality = "coding" | "everyday";

const PERSONALITIES: ReadonlyArray<{
  id: AxlePersonality;
  label: string;
  description: string;
}> = [
  {
    id: "coding",
    label: "For coding",
    description:
      "Direct and efficient. Focuses on writing robust code and explaining technical tradeoffs clearly.",
  },
  {
    id: "everyday",
    label: "For everyday tasks",
    description: "Warm and approachable. Explains concepts thoroughly and encourages questions.",
  },
];

export function PersonalizeSettingsPanel() {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const [instructions, setInstructions] = useState(settings.customInstructions);
  const [personality, setPersonality] = useState<AxlePersonality>(
    (settings.axlePersonality as AxlePersonality | undefined) ?? "coding",
  );

  useEffect(() => {
    setInstructions(settings.customInstructions);
  }, [settings.customInstructions]);

  useEffect(() => {
    if (settings.axlePersonality) {
      setPersonality(settings.axlePersonality as AxlePersonality);
    }
  }, [settings.axlePersonality]);

  const trimmedInstructions = instructions.trim();
  const isDirty = trimmedInstructions !== settings.customInstructions;

  return (
    <SettingsPageContainer
      title="Personalize"
      description="Set the tone, context, and guidance for your work with Axle."
    >
      <SettingsSection title="Personality">
        <SettingsRow
          title="Default tone"
          description="Choose the default tone for Axle responses."
          control={
            <Select
              value={personality}
              onValueChange={(value) => {
                if (value) {
                  setPersonality(value as AxlePersonality);
                  updateSettings({ axlePersonality: value as AxlePersonality });
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-52" aria-label="Axle personality">
                <SelectValue>
                  {PERSONALITIES.find((p) => p.id === personality)?.label ?? "For coding"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {PERSONALITIES.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">{p.label}</span>
                      <span className="text-xs text-muted-foreground">{p.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection title="Custom instructions">
        <SettingsRow
          title="Instructions"
          description="Preferences and conventions Axle should follow alongside your chosen tone."
        >
          <div className="space-y-3 pb-4">
            <Textarea
              aria-label="Custom instructions"
              className="mt-3 min-h-48 resize-y text-[13px] leading-6"
              maxLength={12_000}
              placeholder="Example: Prefer TypeScript, keep changes small, run focused tests, and explain important tradeoffs."
              rows={10}
              value={instructions}
              onChange={(event) => setInstructions(event.currentTarget.value)}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {instructions.length.toLocaleString()} / 12,000 characters
              </span>
              <Button
                size="sm"
                disabled={!isDirty}
                onClick={() => updateSettings({ customInstructions: trimmedInstructions })}
              >
                <SaveIcon className="size-3.5" />
                Save instructions
              </Button>
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Preferences">
        <SettingsRow
          title="Primary use"
          description="Used to personalize onboarding and future Axle improvements."
          control={
            <Select
              value={settings.onboardingUseCase}
              onValueChange={(value) => {
                if (value) updateSettings({ onboardingUseCase: value });
              }}
            >
              <SelectTrigger className="w-full sm:w-64" aria-label="Primary Axle use">
                <SelectValue>{settings.onboardingUseCase || "Choose a use"}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {USE_CASE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
