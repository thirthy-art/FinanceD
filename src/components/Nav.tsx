"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Invoices" },
  { href: "/invoices/new", label: "New Invoice" },
  { href: "/cash-flow", label: "Cash Forecast" },
  { href: "/settings/chart-of-accounts", label: "Chart of Accounts" },
  { href: "/settings/vendors", label: "Vendors" },
  { href: "/settings/company", label: "Company" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav style={{ background: "#1e3a5f", color: "#fff" }}>
      <div
        className="max-w-7xl mx-auto px-4 flex items-center gap-1"
        style={{ height: 52 }}
      >
        <Link
          href="/"
          style={{ fontWeight: 700, fontSize: 18, marginRight: 24, color: "#fff", textDecoration: "none" }}
        >
          FinanceD
        </Link>
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            style={{
              padding: "6px 12px",
              borderRadius: 6,
              color: pathname === l.href ? "#fff" : "#cbd5e1",
              background: pathname === l.href ? "rgba(255,255,255,0.15)" : "transparent",
              textDecoration: "none",
              fontSize: 13,
              fontWeight: pathname === l.href ? 600 : 400,
            }}
          >
            {l.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
