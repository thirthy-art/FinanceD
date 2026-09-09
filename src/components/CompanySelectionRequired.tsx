import { getMessages } from "@/src/i18n";
import type { Locale } from "@/src/i18n/types";

export default function CompanySelectionRequired({ locale }: { locale: Locale }) {
  return (
    <div role="status" className="company-selection-required">
      {getMessages(locale).companySwitcher.selectAbove}
    </div>
  );
}
