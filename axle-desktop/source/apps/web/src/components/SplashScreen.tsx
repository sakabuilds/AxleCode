import { AxleLogo } from "./AxleLogo";

export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex size-24 items-center justify-center" aria-label="Axle splash screen">
        <AxleLogo role="img" aria-label="Axle" className="size-16 text-foreground" />
      </div>
    </div>
  );
}
