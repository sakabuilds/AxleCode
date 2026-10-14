import { Check } from "lucide-react";

const FEATURES = [
  "Local project workspace",
  "Provider API keys",
  "Local model connection",
  "Files, terminal, and Git",
  "MCP server support",
  "Usage billing",
  "Availability",
];

export function ComparisonTable() {
  return (
    <div className="hairline overflow-hidden rounded-[20px] bg-[#101010]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[610px] border-collapse text-left">
          <caption className="sr-only">
            Free plan availability and status of planned Pro and Team offerings
          </caption>
          <thead>
            <tr className="border-b border-white/10">
              <th
                scope="col"
                className="px-6 py-6 text-sm font-normal text-mute"
              >
                Your workspace
              </th>
              {["Free", "Pro", "Team"].map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="px-6 py-6 text-center text-sm font-medium"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((feature, index) => (
              <tr
                key={feature}
                className="border-b border-white/[0.07] last:border-b-0"
              >
                <th
                  scope="row"
                  className="px-6 py-5 text-[13px] font-normal text-mute"
                >
                  {feature}
                </th>
                <td className="px-6 py-5 text-center text-xs">
                  {index < 5 ? (
                    <>
                      <Check size={15} aria-hidden="true" className="mx-auto" />
                      <span className="sr-only">Included</span>
                    </>
                  ) : index === 5 ? (
                    "Your provider"
                  ) : (
                    "Available now"
                  )}
                </td>
                <td className="px-6 py-5 text-center text-xs text-mute">
                  {index === 6 ? "Planned" : "To be announced"}
                </td>
                <td className="px-6 py-5 text-center text-xs text-mute">
                  {index === 6 ? "Planned" : "To be announced"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
