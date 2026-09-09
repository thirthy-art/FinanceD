"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import styles from "@/app/invoice-list.module.css";

type PaymentFilterValue = "all" | "unpaid" | "paid";

export default function InvoicePaymentFilter({
  label,
  allLabel,
  unpaidLabel,
  paidLabel,
  value,
}: {
  label: string;
  allLabel: string;
  unpaidLabel: string;
  paidLabel: string;
  value: PaymentFilterValue;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  function updatePaymentFilter(nextValue: PaymentFilterValue) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextValue === "all") {
      params.delete("payment");
    } else {
      params.set("payment", nextValue);
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div className={styles.filter}>
      <span className={styles.filterLabel}>{label}</span>
      <div className={styles.segments} role="group" aria-label={label}>
        {([ ["all", allLabel], ["unpaid", unpaidLabel], ["paid", paidLabel] ] as const).map(([option, text]) => (
          <button key={option} type="button" aria-pressed={value === option} onClick={() => updatePaymentFilter(option)}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
