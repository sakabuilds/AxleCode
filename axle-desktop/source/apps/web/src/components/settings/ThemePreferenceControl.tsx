import { useId } from "react";
import { CheckIcon } from "lucide-react";

import { cn } from "../../lib/utils";

type ThemePreference = "light" | "dark" | "system";

const THEMES: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function ThemePreview({ dark }: { dark: boolean }) {
  return (
    <span
      className={cn(
        "absolute inset-0 grid grid-cols-[24%_1fr] overflow-hidden rounded-[3px]",
        dark ? "bg-[#1a1a1a]" : "bg-[#faf9f6]",
      )}
    >
      <span
        className={cn(
          "space-y-1 border-r px-1.5 py-2",
          dark ? "border-[#333333] bg-[#141414]" : "border-[#deddd8] bg-[#ecebe6]",
        )}
      >
        <span className={cn("block h-1 w-2 rounded-sm", dark ? "bg-[#9d9e9f]" : "bg-[#6d6e6d]")} />
        <span className={cn("block h-0.5 rounded-sm", dark ? "bg-[#58595b]" : "bg-[#c4c3be]")} />
        <span className={cn("block h-0.5 rounded-sm", dark ? "bg-[#58595b]" : "bg-[#c4c3be]")} />
      </span>
      <span className="flex flex-col gap-1 px-2 py-2.5">
        <span
          className={cn("block h-1 w-3/5 rounded-sm", dark ? "bg-[#8c8d8f]" : "bg-[#8a8b88]")}
        />
        <span
          className={cn("block h-0.5 w-full rounded-sm", dark ? "bg-[#343538]" : "bg-[#deddd8]")}
        />
        <span
          className={cn("block h-0.5 w-4/5 rounded-sm", dark ? "bg-[#343538]" : "bg-[#deddd8]")}
        />
        <span
          className={cn(
            "mt-auto block h-3 w-full rounded-sm border",
            dark ? "border-[#333333] bg-[#242424]" : "border-[#deddd8] bg-white",
          )}
        />
      </span>
    </span>
  );
}

export function ThemePreferenceControl({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
}) {
  const name = useId();

  return (
    <fieldset aria-label="Theme preference" className="grid w-[282px] max-w-full grid-cols-3 gap-3">
      {THEMES.map((theme) => (
        <label key={theme.value} className="group min-w-0 cursor-pointer">
          <input
            type="radio"
            name={name}
            value={theme.value}
            checked={value === theme.value}
            onChange={() => onChange(theme.value)}
            aria-label={`${theme.label} theme`}
            className="peer sr-only"
          />
          <span className="relative block h-[60px] rounded-md border border-border p-1 transition-colors group-hover:border-muted-foreground/60 peer-checked:border-foreground peer-checked:ring-1 peer-checked:ring-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring">
            <span className="relative block size-full overflow-hidden rounded-[3px]" aria-hidden>
              <ThemePreview dark={theme.value === "dark"} />
              {theme.value === "system" ? (
                <span className="absolute inset-0 [clip-path:polygon(50%_0,100%_0,100%_100%,50%_100%)]">
                  <ThemePreview dark />
                </span>
              ) : null}
            </span>
          </span>
          <span className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground peer-checked:font-medium peer-checked:text-foreground">
            {theme.label}
            {value === theme.value ? <CheckIcon className="size-3" aria-hidden /> : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
