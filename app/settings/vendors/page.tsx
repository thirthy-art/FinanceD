"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import VendorListActions from "@/src/components/VendorListActions";
import { useI18n } from "@/src/i18n/context";
import CompanyAccessState, { companyAccessCode, type CompanyAccessCode } from "@/src/components/CompanyAccessState";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Alert, EmptyState, LoadingState } from "@/src/components/ui/feedback";
import { Input } from "@/src/components/ui/input";
import { PageHeader, PageTitle } from "@/src/components/ui/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/src/components/ui/table";

interface Vendor {
  id: number;
  name: string;
  taxId: string | null;
  address: string | null;
  defaultCurrency: string | null;
  vendorStatus: "draft" | "active";
  isActive: boolean;
  invoiceCount: number;
  possibleDuplicate: boolean;
}

async function fetchVendors(): Promise<{ rows: Vendor[]; access: CompanyAccessCode | null }> {
  const response = await fetch("/api/settings/vendors");
  const data = await response.json().catch(() => null);
  const access = companyAccessCode(data);
  if (access) return { rows: [], access };
  if (!response.ok || !Array.isArray(data)) throw new Error("Could not load vendors");
  return { rows: data, access: null };
}

function VendorsContent() {
  const { t } = useI18n();
  const v = t.vendors;
  const cm = t.common;

  const searchParams = useSearchParams();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<CompanyAccessCode | null>(null);
  const [newName, setNewName] = useState("");
  const [newTaxId, setNewTaxId] = useState("");
  const [newCurrency, setNewCurrency] = useState("");
  const [addError, setAddError] = useState("");
  const [actionError, setActionError] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<Vendor>>({});
  const action = searchParams.get("action");
  const notice = action === "deleted"
    ? v.deletedNotice
    : action === "merged" ? v.mergedNotice : "";

  async function load() {
    const result = await fetchVendors();
    setAccess(result.access);
    setVendors(result.rows);
    setLoading(false);
  }
  useEffect(() => {
    let cancelled = false;
    void fetchVendors().then((result) => {
      if (!cancelled) {
        setAccess(result.access);
        setVendors(result.rows);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  async function addVendor(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    const body: Record<string, string> = { name: newName };
    if (newTaxId) body.taxId = newTaxId;
    if (newCurrency) body.defaultCurrency = newCurrency;
    const res = await fetch("/api/settings/vendors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) { setAddError(v.couldNotAdd); return; }
    setNewName(""); setNewTaxId(""); setNewCurrency("");
    load();
  }

  async function saveEdit(id: number) {
    await fetch(`/api/settings/vendors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editData),
    });
    setEditId(null);
    load();
  }

  if (loading) return <LoadingState>{v.loading}</LoadingState>;
  if (access) return <CompanyAccessState code={access} />;

  return (
    <div>
      <PageHeader><PageTitle>{v.title}</PageTitle></PageHeader>
      {notice && <Alert tone="success" className="mb-4">{notice}</Alert>}
      {actionError && <Alert tone="error" className="mb-4">{actionError}</Alert>}

      <Card className="mb-6 overflow-hidden">
        {vendors.length === 0 ? (
          <EmptyState className="border-0 shadow-none">{v.noVendors}</EmptyState>
        ) : (
          <Table className="min-w-[940px]">
            <TableHeader>
              <TableRow>
                {[v.colName, v.colTaxId, v.colDefaultCurrency, v.colActive, v.colInvoices, v.colDuplicate, ""].map((h) => (
                  <TableHead key={h}>{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendors.map((vendor) => (
                <TableRow key={vendor.id} className={vendor.isActive ? "" : "opacity-55"}>
                  {editId === vendor.id ? (
                    <>
                      <TableCell><Input className="min-w-48" value={editData.name ?? vendor.name} onChange={(e) => setEditData((d) => ({ ...d, name: e.target.value }))} /></TableCell>
                      <TableCell><Input className="min-w-32" value={editData.taxId ?? vendor.taxId ?? ""} onChange={(e) => setEditData((d) => ({ ...d, taxId: e.target.value }))} /></TableCell>
                      <TableCell><Input className="w-20" value={editData.defaultCurrency ?? vendor.defaultCurrency ?? ""} maxLength={3} onChange={(e) => setEditData((d) => ({ ...d, defaultCurrency: e.target.value.toUpperCase() }))} /></TableCell>
                      <TableCell /><TableCell /><TableCell />
                      <TableCell><div className="flex gap-2"><Button size="sm" onClick={() => saveEdit(vendor.id)}>{cm.save}</Button><Button size="sm" variant="secondary" onClick={() => setEditId(null)}>{cm.cancel}</Button></div></TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="font-semibold"><Link href={`/settings/vendors/${vendor.id}`} className="ui-table-link">{vendor.name}</Link></TableCell>
                      <TableCell className="text-[var(--muted-foreground)]">{vendor.taxId ?? "—"}</TableCell>
                      <TableCell className="text-[var(--muted-foreground)]">{vendor.defaultCurrency ?? "—"}</TableCell>
                      <TableCell><Badge variant={vendor.isActive ? "success" : "neutral"}>{vendor.isActive ? cm.yes : cm.no}</Badge></TableCell>
                      <TableCell className="tabular-nums">{vendor.invoiceCount}</TableCell>
                      <TableCell>{vendor.possibleDuplicate ? <Badge variant="warning">{v.possibleDuplicate}</Badge> : "—"}</TableCell>
                      <TableCell><div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => { setEditId(vendor.id); setEditData({}); }}>{cm.edit}</Button>
                        <Button size="sm" variant="ghost"
                          onClick={() => fetch(`/api/settings/vendors/${vendor.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !vendor.isActive }) }).then(load)}
                        >
                          {vendor.isActive ? cm.deactivate : cm.activate}
                        </Button>
                        <VendorListActions vendor={vendor} onDeleted={load} onError={setActionError} />
                      </div></TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle>{v.addVendor}</CardTitle></CardHeader>
        <CardContent><form onSubmit={addVendor} className="ui-inline-form">
          <div className="min-w-52 flex-1">
            <label className="ui-label">{v.nameLabel}</label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} required placeholder={v.vendorNamePlaceholder} />
          </div>
          <div className="min-w-40">
            <label className="ui-label">{v.taxIdLabel}</label>
            <Input value={newTaxId} onChange={(e) => setNewTaxId(e.target.value)} placeholder={v.taxIdOptionalPlaceholder} />
          </div>
          <div className="w-28">
            <label className="ui-label">{v.defaultCurrencyLabel}</label>
            <Input value={newCurrency} onChange={(e) => setNewCurrency(e.target.value.toUpperCase())} maxLength={3} placeholder="USD" />
          </div>
          <Button type="submit">{v.addVendor}</Button>
        </form>
        {addError && <Alert tone="error" className="mt-3">{addError}</Alert>}
        </CardContent>
      </Card>
    </div>
  );
}

export default function VendorsPage() {
  const { t } = useI18n();
  return <Suspense fallback={<LoadingState>{t.vendors.loading}</LoadingState>}><VendorsContent /></Suspense>;
}
