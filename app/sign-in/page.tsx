import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Landmark } from "lucide-react";
import { auth, configuredAuthProviders, signIn } from "@/auth";
import { getMessages, resolveLocale } from "@/src/i18n";
import { LOCALE_COOKIE } from "@/src/i18n/types";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  if (await auth()) redirect("/");
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const labels = getMessages(locale).auth;
  const callbackUrl = safeCallbackUrl((await searchParams).callbackUrl);
  const providerIds = configuredAuthProviders.map((provider) => provider.id);

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="app-brand-mark" aria-hidden="true"><Landmark size={19} strokeWidth={2.2} /></span>
          <span>FinanceD</span>
        </div>
        <h1 className="auth-title">{labels.signInTitle}</h1>
        <p className="auth-description">{labels.signInDescription}</p>
        <div className="auth-providers">
          {providerIds.includes("google") && <ProviderButton provider="google" mark="G" label={labels.signInGoogle} callbackUrl={callbackUrl} />}
          {providerIds.includes("microsoft-entra-id") && <ProviderButton provider="microsoft-entra-id" mark="M" label={labels.signInMicrosoft} callbackUrl={callbackUrl} />}
          {providerIds.length === 0 && <p role="alert" className="ui-alert ui-alert-warning">{labels.noProviders}</p>}
        </div>
      </div>
    </div>
  );
}

function safeCallbackUrl(value: string | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function ProviderButton({ provider, mark, label, callbackUrl }: { provider: string; mark: string; label: string; callbackUrl: string }) {
  return (
    <form action={async () => {
      "use server";
      await signIn(provider, { redirectTo: callbackUrl });
    }}>
      <button type="submit" className="auth-provider-button">
        <span className="auth-provider-mark" aria-hidden="true">{mark}</span>
        <span>{label}</span>
      </button>
    </form>
  );
}
