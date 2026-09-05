import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { AlertTriangle, Coins, History, Search } from "lucide-react";
import AIBillingHistory from "@/components/AIBillingHistory";

const formatTime = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value)) : "—";

export default function Settings() {
  const navigate = useNavigate();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [entity, setEntity] = useState("all");

  useEffect(() => {
    appClient.entities.AuditLog.list("-timestamp", 1000)
      .then(setEntries)
      .catch((reason) => setError(reason.message || "Audit history could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  const entities = useMemo(() => [...new Set(entries.map((entry) => entry.entity).filter(Boolean))].sort(), [entries]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesEntity = entity === "all" || entry.entity === entity;
      const matchesSearch = !term || [entry.actor_name, entry.actor_email, entry.action, entry.entity, entry.record_label, entry.record_id]
        .some((value) => String(value || "").toLowerCase().includes(term));
      return matchesEntity && matchesSearch;
    });
  }, [entries, entity, search]);

  return (
    <div className="space-y-6">
      <div className="docket-header">
        <div>
          <h2 className="docket-title">Settings & System History</h2>
          <p className="docket-subtitle">
            Review AI model consumption costs, token metrics, and the protected append-only activity history across the claims hub.
          </p>
        </div>
      </div>

      <Tabs defaultValue="ai-billing" className="w-full">
        <TabsList className="w-full justify-start gap-4 border-b border-border/80 pb-px">
          <TabsTrigger value="ai-billing" className="gap-2 text-xs sm:text-sm">
            <Coins className="h-4 w-4 text-emerald-600" />
            AI Usage & Billing History
          </TabsTrigger>
          <TabsTrigger value="audit-log" className="gap-2 text-xs sm:text-sm">
            <History className="h-4 w-4 text-primary" />
            Global Audit Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ai-billing" className="mt-6">
          <AIBillingHistory
            onSelectClaim={(claimId) => navigate(`/claims/${claimId}`)}
          />
        </TabsContent>

        <TabsContent value="audit-log" className="mt-6">
          <Card className="docket-surface overflow-hidden p-0 shadow-none border border-border/80">
            <div className="flex flex-col justify-between gap-3 border-b bg-muted/25 px-5 py-4 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 font-heading text-xl font-semibold">
                <History className="h-5 w-5 text-primary" /> Global audit log
              </div>
              <span className="status-mark border-primary/30 bg-primary/5 text-primary">Append-only history</span>
            </div>
            <div className="grid gap-3 border-b p-4 md:grid-cols-[1fr_220px]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="pl-9"
                  placeholder="Search actor, action, record, or ID"
                />
              </div>
              <Select value={entity} onValueChange={setEntity}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All areas</SelectItem>
                  {entities.map((item) => (
                    <SelectItem key={item} value={item}>{item}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {error ? (
              <div className="flex items-center gap-3 p-6 text-sm text-destructive">
                <AlertTriangle className="h-5 w-5" />
                {error}
              </div>
            ) : loading ? (
              <div className="p-10 text-center text-sm text-muted-foreground">Loading activity history…</div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">No audit events match the current filters.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="register-table min-w-[980px]">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Record</th>
                      <th>Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((entry) => (
                      <tr key={entry.id}>
                        <td className="whitespace-nowrap text-xs text-muted-foreground">{formatTime(entry.timestamp)}</td>
                        <td>
                          <div className="font-medium">{entry.actor_name || "System"}</div>
                          <div className="text-xs text-muted-foreground">{entry.actor_email}</div>
                        </td>
                        <td>
                          <span className="status-mark border-border bg-muted text-muted-foreground">
                            {entry.entity} · {entry.action}
                          </span>
                        </td>
                        <td>
                          <div className="font-medium">{entry.record_label || "—"}</div>
                          <div className="font-mono text-xs text-muted-foreground">{entry.record_id || "—"}</div>
                        </td>
                        <td className="max-w-[310px] text-xs text-muted-foreground">
                          {entry.before || entry.after ? (
                            <details>
                              <summary className="cursor-pointer text-primary">View recorded values</summary>
                              <div className="mt-2 grid gap-2">
                                <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border bg-muted/40 p-2 text-[0.68rem]">
                                  {JSON.stringify(entry.before, null, 2) || "No prior value"}
                                </pre>
                                <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded border bg-muted/40 p-2 text-[0.68rem]">
                                  {JSON.stringify(entry.after, null, 2) || "No resulting value"}
                                </pre>
                              </div>
                            </details>
                          ) : (
                            "Activity recorded"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
