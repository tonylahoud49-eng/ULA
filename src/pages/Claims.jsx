import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ArrowRight, FolderOpen, Plus, Search } from "lucide-react";

const BUSINESS_LINES = [
  "Yacht",
  "Property",
  "Marine Cargo (Reefer/GFS)",
  "Marine Cargo (Non-Reefer)",
  "Bulk Vessel",
  "Air Shipment (NET)",
  "Fidelity Claims",
  "Unclassified",
];

const STATUSES = [
  "New",
  "Under Investigation",
  "Pending Documents",
  "Report Draft",
  "Report Final",
  "Closed",
];

const statusStyles = {
  New: "bg-blue-100 text-blue-700",
  "Under Investigation": "bg-amber-100 text-amber-700",
  "Pending Documents": "bg-orange-100 text-orange-700",
  "Report Draft": "bg-violet-100 text-violet-700",
  "Report Final": "bg-emerald-100 text-emerald-700",
  Closed: "bg-slate-100 text-slate-600",
};

export default function Claims() {
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [businessLine, setBusinessLine] = useState("all");

  useEffect(() => {
    let active = true;

    const loadClaims = async () => {
      try {
        const data = await appClient.entities.Claim.list("-created_date", 500);
        if (active) setClaims(data);
      } catch (err) {
        if (active) setError(err.message || "Failed to load claims");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadClaims();
    return () => {
      active = false;
    };
  }, []);

  const filteredClaims = useMemo(() => {
    const term = search.trim().toLowerCase();
    return claims.filter((claim) => {
      const matchesSearch = !term || [claim.claim_number, claim.title, claim.insured, claim.surveyor]
        .some((value) => String(value || "").toLowerCase().includes(term));
      const matchesStatus = status === "all" || claim.status === status;
      const matchesBusinessLine = businessLine === "all" || claim.business_line === businessLine;
      return matchesSearch && matchesStatus && matchesBusinessLine;
    });
  }, [businessLine, claims, search, status]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-heading font-bold">Claims</h1>
          <p className="text-sm text-muted-foreground mt-1">View and manage all claims</p>
        </div>
        <Link to="/ai-reporting">
          <Button>
            <Plus className="w-4 h-4 mr-2" /> New AI Claim
          </Button>
        </Link>
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search claims..."
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={businessLine} onValueChange={setBusinessLine}>
            <SelectTrigger><SelectValue placeholder="All business lines" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All business lines</SelectItem>
              {BUSINESS_LINES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {error ? (
        <Card className="p-6 flex items-center gap-3 text-destructive">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-2 font-heading font-semibold text-sm">
              <FolderOpen className="w-4 h-4 text-primary" /> All Claims
            </div>
            <span className="text-xs text-muted-foreground">{filteredClaims.length} claims</span>
          </div>

          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading claims...</div>
          ) : filteredClaims.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No claims match the selected filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-5 py-3">Claim</th>
                    <th className="text-left font-medium px-5 py-3">Business Line</th>
                    <th className="text-left font-medium px-5 py-3">Insured</th>
                    <th className="text-left font-medium px-5 py-3">Status</th>
                    <th className="text-left font-medium px-5 py-3">Surveyor</th>
                    <th className="px-5 py-3" aria-label="Open claim" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredClaims.map((claim) => (
                    <tr key={claim.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-4">
                        <Link to={`/claims/${claim.id}`} className="font-medium hover:text-primary">
                          {claim.title}
                        </Link>
                        <div className="text-xs text-muted-foreground mt-0.5">{claim.claim_number}</div>
                      </td>
                      <td className="px-5 py-4">{claim.business_line || "Unclassified"}</td>
                      <td className="px-5 py-4">{claim.insured || "—"}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${statusStyles[claim.status] || "bg-slate-100 text-slate-600"}`}>
                          {claim.status || "New"}
                        </span>
                      </td>
                      <td className="px-5 py-4">{claim.surveyor || "Unassigned"}</td>
                      <td className="px-5 py-4 text-right">
                        <Link to={`/claims/${claim.id}`} aria-label={`Open ${claim.claim_number || claim.title}`}>
                          <ArrowRight className="w-4 h-4 text-muted-foreground" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
