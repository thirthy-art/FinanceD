"use client";
import { useEffect, useState } from "react";
import { flattenAccountHierarchy } from "@/src/lib/coa-hierarchy";
import { useI18n } from "@/src/i18n/context";
import CompanyAccessState, { companyAccessCode, type CompanyAccessCode } from "@/src/components/CompanyAccessState";
import { Badge } from "@/src/components/ui/badge";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Alert, EmptyState, LoadingState } from "@/src/components/ui/feedback";
import { Input } from "@/src/components/ui/input";
import { PageHeader, PageTitle } from "@/src/components/ui/page";
import { Select } from "@/src/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/src/components/ui/table";

interface Account { id: number; code: string; name: string; type: string; parentId: number | null; isPosting: boolean; isActive: boolean; }

const TYPES = ["asset", "liability", "equity", "revenue", "expense"];
const typeVariants = {
  asset: "info",
  liability: "destructive",
  equity: "warning",
  revenue: "success",
  expense: "neutral",
};

async function fetchAccounts(): Promise<{ rows: Account[]; access: CompanyAccessCode | null }> {
  const response = await fetch("/api/settings/chart-of-accounts");
  const data = await response.json().catch(() => null);
  const access = companyAccessCode(data);
  if (access) return { rows: [], access };
  if (!response.ok || !Array.isArray(data)) throw new Error("Could not load accounts");
  return { rows: data, access: null };
}

export default function ChartOfAccountsPage() {
  const { t } = useI18n();
  const c = t.coa;
  const cm = t.common;

  const typeLabels: Record<string, string> = {
    asset: c.typeAsset,
    liability: c.typeLiability,
    equity: c.typeEquity,
    revenue: c.typeRevenue,
    expense: c.typeExpense,
  };

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<CompanyAccessCode | null>(null);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("expense");
  const [addError, setAddError] = useState("");
  const [editId, setEditId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Partial<Account>>({});

  async function load() {
    const result = await fetchAccounts();
    setAccess(result.access);
    setAccounts(result.rows);
    setLoading(false);
  }
  useEffect(() => {
    let cancelled = false;
    void fetchAccounts().then((result) => {
      if (!cancelled) {
        setAccess(result.access);
        setAccounts(result.rows);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    const res = await fetch("/api/settings/chart-of-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: newCode, name: newName, type: newType }),
    });
    if (!res.ok) { setAddError(c.couldNotAdd); return; }
    setNewCode(""); setNewName(""); setNewType("expense");
    load();
  }

  async function saveEdit(id: number) {
    await fetch(`/api/settings/chart-of-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editData),
    });
    setEditId(null);
    load();
  }

  async function deactivate(id: number) {
    await fetch(`/api/settings/chart-of-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    load();
  }

  async function activate(id: number) {
    await fetch(`/api/settings/chart-of-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: true }),
    });
    load();
  }

  if (loading) return <LoadingState>{c.loading}</LoadingState>;
  if (access) return <CompanyAccessState code={access} />;
  const hierarchicalAccounts = flattenAccountHierarchy(accounts);

  return (
    <div>
      <PageHeader><PageTitle>{c.title}</PageTitle></PageHeader>

      <Card className="mb-6 overflow-hidden">
        {hierarchicalAccounts.length === 0 ? <EmptyState className="border-0">{c.title}</EmptyState> : <Table className="min-w-[820px]">
          <TableHeader>
            <TableRow>
              {[c.colCode, c.colName, c.colType, c.colPosting, c.colActive, ""].map((h) => (
                <TableHead key={h}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {hierarchicalAccounts.map((a) => (
              <TableRow key={a.id} className={`${a.isActive ? "" : "opacity-50"}${a.isPosting ? "" : " bg-[var(--muted)] font-semibold"}`}>
                {editId === a.id ? (
                  <>
                    <TableCell><Input className="w-24 font-mono" value={editData.code ?? a.code} onChange={(e) => setEditData((d) => ({ ...d, code: e.target.value }))} /></TableCell>
                    <TableCell><Input className="min-w-52" style={{ marginInlineStart: a.depth * 18 }} value={editData.name ?? a.name} onChange={(e) => setEditData((d) => ({ ...d, name: e.target.value }))} /></TableCell>
                    <TableCell><Select value={editData.type ?? a.type} onChange={(e) => setEditData((d) => ({ ...d, type: e.target.value }))}>
                        {TYPES.map((type) => <option key={type} value={type}>{typeLabels[type] ?? type}</option>)}
                      </Select></TableCell>
                    <TableCell>{a.isPosting ? c.posting : c.header}</TableCell><TableCell />
                    <TableCell><div className="flex gap-2"><Button size="sm" onClick={() => saveEdit(a.id)}>{cm.save}</Button><Button size="sm" variant="secondary" onClick={() => setEditId(null)}>{cm.cancel}</Button></div></TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className="font-mono font-semibold">{a.code}</TableCell>
                    <TableCell><span className="inline-block" style={{ paddingInlineStart: a.depth * 18 }}>{a.name}</span>{!a.isPosting && <Badge className="ms-2" variant="neutral">{c.nonPostingHeader}</Badge>}</TableCell>
                    <TableCell><Badge variant={(typeVariants[a.type as keyof typeof typeVariants] ?? "neutral") as "info" | "destructive" | "warning" | "success" | "neutral"}>{typeLabels[a.type] ?? a.type}</Badge></TableCell>
                    <TableCell>{a.isPosting ? c.postingYes : c.postingNo}</TableCell>
                    <TableCell><Badge variant={a.isActive ? "success" : "neutral"}>{a.isActive ? cm.yes : cm.no}</Badge></TableCell>
                    <TableCell><div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => { setEditId(a.id); setEditData({}); }}>{cm.edit}</Button>
                      {a.isActive
                        ? <Button size="sm" variant="ghost" onClick={() => deactivate(a.id)}>{cm.deactivate}</Button>
                        : <Button size="sm" variant="ghost" onClick={() => activate(a.id)}>{cm.activate}</Button>
                      }
                    </div></TableCell>
                  </>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>}
      </Card>

      <Card>
        <CardHeader><CardTitle>{c.addAccount}</CardTitle></CardHeader>
        <CardContent><form onSubmit={addAccount} className="ui-inline-form">
          <div className="w-28">
            <label className="ui-label">{c.colCode}</label>
            <Input value={newCode} onChange={(e) => setNewCode(e.target.value)} required placeholder={c.codePlaceholder} />
          </div>
          <div className="min-w-56 flex-1">
            <label className="ui-label">{c.colName}</label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} required placeholder={c.namePlaceholder} />
          </div>
          <div className="min-w-40">
            <label className="ui-label">{c.colType}</label>
            <Select value={newType} onChange={(e) => setNewType(e.target.value)}>
              {TYPES.map((type) => <option key={type} value={type}>{typeLabels[type] ?? type}</option>)}
            </Select>
          </div>
          <Button type="submit">{c.addAccount}</Button>
        </form>
        {addError && <Alert tone="error" className="mt-3">{addError}</Alert>}</CardContent>
      </Card>
    </div>
  );
}
