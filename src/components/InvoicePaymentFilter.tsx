"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
    <label className="invoice-payment-filter">
      <span>{label}:</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => updatePaymentFilter(event.target.value as PaymentFilterValue)}
      >
        <option value="all">{allLabel}</option>
        <option value="unpaid">{unpaidLabel}</option>
        <option value="paid">{paidLabel}</option>
      </select>
    </label>
  );
}
