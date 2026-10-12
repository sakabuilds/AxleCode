import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { AxleLogo } from "./AxleLogo";

describe("AxleLogo", () => {
  it("renders the approved artwork as a currentColor alpha mask", () => {
    const markup = renderToStaticMarkup(<AxleLogo aria-label="Axle" role="img" />);

    expect(markup).toContain('fill="currentColor"');
    expect(markup).toContain('mask="url(#axle-logo-');
    expect(markup).toMatch(/mask-type:alpha/);
    expect(markup).toContain('<image href="data:image/png;base64,');
  });
});
