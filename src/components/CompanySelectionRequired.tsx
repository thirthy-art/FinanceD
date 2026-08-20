import { getMessages } from "@/src/i18n";
import type { Locale } from "@/src/i18n/types";

export default function CompanySelectionRequired({ locale }: { locale: Locale }) {
  return (
    <div
      role="status"
      style={{
        maxWidth: 520,
        margin: "48px auto",
        padding: "28px 24px",
        border: "1px solid #e2e8f0",
        borderRadius: 8,
        background: "#fff",
        color: "#475569",
        textAlign: "center",
        fontSize: 16,
        fontWeight: 600,
      }}
    >
      {getMessages(locale).companySwitcher.selectAbove}
    </div>
  );
}
