import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth, configuredAuthProviders, signIn } from "@/auth";
import { getMessages, resolveLocale } from "@/src/i18n";
import { LOCALE_COOKIE } from "@/src/i18n/types";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  if (await auth()) redirect("/");
  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const labels = getMessages(locale).auth;
  const callbackUrl = safeCallbackUrl((await searchParams).callbackUrl);
  const providerIds = configuredAuthProviders.map((provider) => provider.id);

  return (
    <div style={{ maxWidth: 420, margin: "48px auto", padding: 28, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1e3a5f", marginBottom: 8 }}>{labels.signInTitle}</h1>
      <p style={{ color: "#64748b", marginBottom: 24 }}>{labels.signInDescription}</p>
      <div style={{ display: "grid", gap: 12 }}>
        {providerIds.includes("google") && <ProviderButton provider="google" label={labels.signInGoogle} callbackUrl={callbackUrl} />}
        {providerIds.includes("microsoft-entra-id") && <ProviderButton provider="microsoft-entra-id" label={labels.signInMicrosoft} callbackUrl={callbackUrl} />}
        {providerIds.length === 0 && <p role="alert" style={{ color: "#b45309" }}>{labels.noProviders}</p>}
      </div>
    </div>
  );
}

function safeCallbackUrl(value: string | undefined) {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/";
}

function ProviderButton({ provider, label, callbackUrl }: { provider: string; label: string; callbackUrl: string }) {
  return (
    <form action={async () => {
      "use server";
      await signIn(provider, { redirectTo: callbackUrl });
    }}>
      <button type="submit" style={{ width: "100%", minHeight: 44, border: "1px solid #cbd5e1", borderRadius: 6, background: "#fff", color: "#1e293b", fontWeight: 600, cursor: "pointer" }}>
        {label}
      </button>
    </form>
  );
}
