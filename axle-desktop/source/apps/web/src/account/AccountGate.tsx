import { LoaderCircleIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { AxleLogo } from "../components/AxleLogo";
import { AuthLoadingScreen, AuthSurfaceShell } from "../components/auth/AuthSurfaceShell";
import { Button } from "../components/ui/button";
import { useAccountActions, useAccountState } from "./AccountAuthProvider";
import { fetchSignInProviders, type SignInProvider } from "./clerkRuntime";

const FALLBACK_PROVIDERS: readonly SignInProvider[] = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
];

function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && window.desktopBridge !== undefined;
}

function ProviderIcon({ providerId }: { readonly providerId: string }) {
  if (providerId === "google") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
      </svg>
    );
  }
  if (providerId === "github") {
    return (
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
      </svg>
    );
  }
  return null;
}

function ProviderButtons({
  providers,
  onSignIn,
}: {
  readonly providers: readonly SignInProvider[];
  readonly onSignIn: (providerId: string) => void;
}) {
  return (
    <div className="flex w-full flex-col gap-2">
      {providers.map((provider, index) => (
        <Button
          key={provider.id}
          className="w-full"
          size="lg"
          variant={index === 0 ? "default" : "outline"}
          onClick={() => onSignIn(provider.id)}
        >
          <ProviderIcon providerId={provider.id} />
          Continue with {provider.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * Blocks the renderer until an Axle account is signed in. Only the desktop app
 * is gated; the hosted web app keeps its own pairing flow and has no desktop
 * bridge to complete this browser sign-in.
 */
export function AccountGate({ children }: { readonly children: ReactNode }) {
  const account = useAccountState();
  const { signIn } = useAccountActions();
  const desktop = isDesktopRuntime();
  const [providers, setProviders] = useState<readonly SignInProvider[]>(FALLBACK_PROVIDERS);
  const [pending, setPending] = useState(false);
  const needsProviders = desktop && (account.status === "signed-out" || account.status === "error");

  useEffect(() => {
    if (!needsProviders) return;
    let active = true;
    void fetchSignInProviders().then((configured) => {
      if (active && configured.length > 0) setProviders(configured);
    });
    return () => {
      active = false;
    };
  }, [needsProviders]);

  useEffect(() => {
    if (account.status === "signed-in") setPending(false);
  }, [account.status]);

  if (!desktop || account.status === "signed-in") {
    return children;
  }

  if (account.status === "loading") {
    return <AuthLoadingScreen />;
  }

  const startSignIn = (providerId: string) => {
    setPending(true);
    signIn(providerId);
  };

  if (account.status === "error") {
    return (
      <AuthSurfaceShell>
        <div className="flex flex-col items-center text-center">
          <AxleLogo role="img" aria-label="Axle" className="size-14" />
          <h1 className="mt-6 text-xl font-semibold tracking-tight">Sign-in didn't finish</h1>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{account.error}</p>
          <div className="mt-8 w-full">
            <ProviderButtons providers={providers} onSignIn={startSignIn} />
          </div>
          <Button
            className="mt-4"
            size="sm"
            variant="ghost"
            onClick={() => window.location.reload()}
          >
            Reload app
          </Button>
        </div>
      </AuthSurfaceShell>
    );
  }

  return (
    <AuthSurfaceShell>
      <div className="flex flex-col items-center text-center">
        <AxleLogo role="img" aria-label="Axle" className="size-16" />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Sign in to Axle</h1>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
          Choose how you want to continue. You'll finish signing in in your browser.
        </p>
        <div className="mt-8 w-full">
          <ProviderButtons providers={providers} onSignIn={startSignIn} />
        </div>
        {pending ? (
          <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground" role="status">
            <LoaderCircleIcon className="size-3.5 animate-spin" />
            Waiting for the browser…
          </p>
        ) : null}
        <p className="mt-8 text-xs text-muted-foreground">Axle never sees your password.</p>
      </div>
    </AuthSurfaceShell>
  );
}
