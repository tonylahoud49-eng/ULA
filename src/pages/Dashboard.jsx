import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import StatCard from "@/components/StatCard";
import { FolderOpen, AlertTriangle, FileText, DollarSign, TrendingUp, Clock, ArrowRight } from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
} from "recharts";

const BUSINESS_LINES = ["Yacht", "Property", "Marine Cargo (Reefer/GFS)", "Marine Cargo (Non-Reefer)", "Bulk Vessel", "Air Shipment (NET)", "Fidelity Claims"];
const PIE_COLORS = ["hsl(170 52% 38%)", "hsl(200 60% 45%)", "hsl(42 74% 52%)", "hsl(340 65% 55%)", "hsl(270 55% 50%)", "hsl(15 70% 50%)", "hsl(95 45% 45%)"];

export default function Dashboard() {
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await appClient.entities.Claim.list("-created_date", 200);
        setClaims(data);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const stats = useMemo(() => {
    const totalValue = claims.reduce((s, c) => s + (c.claim_amount || 0), 0);
    const open = claims.filter((c) => c.status !== "Closed").length;
    const pendingDocs = claims.filter((c) => c.missing_documents && c.missing_documents.length).length;
    const drafts = claims.filter((c) => c.status === "Report Draft").length;
    return { totalValue, open, pendingDocs, drafts, total: claims.length };
  }, [claims]);

  const byLine = useMemo(() => {
    const map = {};
    BUSINESS_LINES.forEach((l) => (map[l] = 0));
    claims.forEach((c) => {
      if (map[c.business_line] !== undefined) map[c.business_line]++;
    });
    return Object.entries(map).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [claims]);

  const byStatus = useMemo(() => {
    const map = {};
    claims.forEach((c) => (map[c.status] = (map[c.status] || 0) + 1));
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [claims]);

  const bySurveyor = useMemo(() => {
    const map = {};
    claims.forEach((c) => {
      const s = c.surveyor || "Unassigned";
      map[s] = (map[s] || 0) + 1;
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [claims]);

  const recent = claims.slice(0, 6);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-2xl font-heading font-bold text-foreground">Management Dashboard</h2>
          <p className="text-sm text-muted-foreground mt-1">Overview of all claims, recoveries, and outstanding actions across ULA.</p>
        </div>
        <Link to="/ai-reporting">
          <Button className="ula-gradient text-white hover:opacity-90">
            Start AI Report <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={FolderOpen} label="Total Claims" value={stats.total} sub={`${stats.open} currently open`} />
        <StatCard icon={AlertTriangle} label="Pending Documents" value={stats.pendingDocs} sub="Claims with missing evidence" accent="bg-amber-100 text-amber-600" />
        <StatCard icon={FileText} label="Draft Reports" value={stats.drafts} sub="Awaiting approval" accent="bg-blue-100 text-blue-600" />
        <StatCard icon={DollarSign} label="Total Claim Value" value={`$${(stats.totalValue / 1000000).toFixed(2)}M`} sub="Across all claims" accent="bg-emerald-100 text-emerald-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-5">
          <h3 className="font-heading font-semibold text-sm mb-4">Claims by Business Line</h3>
          {byLine.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={byLine} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2}>
                  {byLine.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : <Empty />}
          <div className="space-y-1.5 mt-3">
            {byLine.map((l, i) => (
              <div key={l.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                  {l.name}
                </span>
                <span className="font-medium">{l.value}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <h3 className="font-heading font-semibold text-sm mb-4">Claims by Status</h3>
          {byStatus.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={byStatus} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                <Bar dataKey="value" fill="hsl(170 52% 38%)" radius={[0, 4, 4, 0]} />
                <Tooltip />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Card>

        <Card className="p-5">
          <h3 className="font-heading font-semibold text-sm mb-4">Claims by Surveyor</h3>
          {bySurveyor.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={bySurveyor} margin={{ left: -10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis type="category" dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Bar dataKey="value" fill="hsl(200 60% 45%)" radius={[4, 4, 0, 0]} />
                <Tooltip />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty />}
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading font-semibold text-sm flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" /> Recent Claims
          </h3>
          <Link to="/claims" className="text-xs text-primary hover:underline flex items-center gap-1">
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
        {recent.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="pb-2 font-medium">Claim No.</th>
                  <th className="pb-2 font-medium">Title</th>
                  <th className="pb-2 font-medium">Business Line</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((c) => (
                  <tr key={c.id} className="border-b border-border/50 hover:bg-muted/40">
                    <td className="py-2.5 font-mono text-xs">{c.claim_number}</td>
                    <td className="py-2.5">
                      <Link to={`/claims/${c.id}`} className="font-medium hover:text-primary">{c.title}</Link>
                    </td>
                    <td className="py-2.5 text-muted-foreground">{c.business_line}</td>
                    <td className="py-2.5"><StatusBadge status={c.status} /></td>
                    <td className="py-2.5 text-right font-medium">{c.claim_amount ? `$${c.claim_amount.toLocaleString()}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty />}
      </Card>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    New: "bg-blue-100 text-blue-700",
    "Under Investigation": "bg-amber-100 text-amber-700",
    "Pending Documents": "bg-orange-100 text-orange-700",
    "Report Draft": "bg-purple-100 text-purple-700",
    "Report Final": "bg-emerald-100 text-emerald-700",
    Closed: "bg-muted text-muted-foreground",
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || "bg-muted"}`}>{status}</span>;
}

function Empty() {
  return <div className="flex flex-col items-center justify-center h-48 text-muted-foreground text-sm"><TrendingUp className="w-8 h-8 mb-2 opacity-40" />No data yet</div>;
}
