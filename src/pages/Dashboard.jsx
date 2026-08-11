import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CircleDollarSign,
  FileCheck2,
  FileStack,
  FolderOpen,
  Loader2,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";

const BUSINESS_LINES = ["Yacht", "Property", "Marine Cargo (Reefer/GFS)", "Marine Cargo (Non-Reefer)", "Bulk Vessel", "Air Shipment (NET)", "Land Shipment", "Fidelity Claims"];
const PIE_COLORS = ["#1f8a79", "#496f84", "#bd8731", "#b44f46", "#688f83", "#4f5d5a", "#8d6d43"];

const statusClass = {
  New: "border-sky-300 bg-sky-50 text-sky-800",
  "Under Investigation": "border-amber-300 bg-amber-50 text-amber-800",
  "Pending Documents": "border-orange-300 bg-orange-50 text-orange-800",
  "Report Draft": "border-violet-300 bg-violet-50 text-violet-800",
  "Report Final": "border-emerald-300 bg-emerald-50 text-emerald-800",
  Closed: "border-border bg-muted text-muted-foreground",
};

export default function Dashboard() {
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    appClient.entities.Claim.list("-created_date", 200)
      .then((data) => active && setClaims(data))
      .catch((error) => console.error(error))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const stats = useMemo(() => {
    const totalValue = claims.reduce((sum, claim) => sum + (Number(claim.claim_amount) || 0), 0);
    const open = claims.filter((claim) => claim.status !== "Closed").length;
    const pendingDocs = claims.filter((claim) => claim.missing_documents?.length).length;
    const drafts = claims.filter((claim) => claim.status === "Report Draft").length;
    return { totalValue, open, pendingDocs, drafts, total: claims.length };
  }, [claims]);

  const byLine = useMemo(() => {
    const values = Object.fromEntries(BUSINESS_LINES.map((line) => [line, 0]));
    claims.forEach((claim) => {
      if (values[claim.business_line] !== undefined) values[claim.business_line] += 1;
    });
    return Object.entries(values).filter(([, value]) => value > 0).map(([name, value]) => ({ name, value }));
  }, [claims]);

  const byStatus = useMemo(() => {
    const values = {};
    claims.forEach((claim) => { values[claim.status || "New"] = (values[claim.status || "New"] || 0) + 1; });
    return Object.entries(values).map(([name, value]) => ({ name, value }));
  }, [claims]);

  const bySurveyor = useMemo(() => {
    const values = {};
    claims.forEach((claim) => {
      const surveyor = claim.surveyor || "Unassigned";
      values[surveyor] = (values[surveyor] || 0) + 1;
    });
    return Object.entries(values).map(([name, value]) => ({ name, value }));
  }, [claims]);

  const recent = claims.slice(0, 7);

  if (loading) {
    return <div className="flex min-h-[420px] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" aria-label="Loading dashboard" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="docket-header">
        <div>
          <h2 className="docket-title">Portfolio release control</h2>
          <p className="docket-subtitle">Track evidence gaps, report readiness, financial exposure, and the next professional gate across every active claim.</p>
        </div>
        <Button asChild>
          <Link to="/ai-reporting">Start controlled report <ArrowRight /></Link>
        </Button>
      </div>

      <section aria-label="Portfolio summary" className="metric-strip sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={FolderOpen} label="Open claims" value={stats.open} detail={`${stats.total} total registered`} />
        <Metric icon={AlertTriangle} label="Evidence gaps" value={stats.pendingDocs} detail="Claims missing required sources" tone="amber" />
        <Metric icon={FileStack} label="Draft reports" value={stats.drafts} detail="Awaiting professional action" tone="blue" />
        <Metric icon={CircleDollarSign} label="Claimed exposure" value={`$${(stats.totalValue / 1_000_000).toFixed(2)}M`} detail="Across the current register" />
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.85fr)]">
        <section className="docket-surface overflow-hidden rounded-lg" aria-labelledby="release-register-title">
          <div className="flex items-center justify-between border-b px-5 py-4">
            <div>
              <h3 id="release-register-title" className="font-heading text-xl font-semibold">Recent claim register</h3>
              <p className="mt-1 text-xs text-muted-foreground">Newest matters and their current release state</p>
            </div>
            <Link to="/claims" className="flex items-center gap-1 text-sm font-semibold text-primary hover:underline">Open register <ArrowRight className="h-4 w-4" /></Link>
          </div>
          {recent.length ? (
            <div className="overflow-x-auto">
              <table className="register-table">
                <thead><tr><th>Claim</th><th>Business line</th><th>Gate</th><th className="text-right">Claimed</th><th aria-label="Open" /></tr></thead>
                <tbody>
                  {recent.map((claim) => (
                    <tr key={claim.id}>
                      <td>
                        <Link to={`/claims/${claim.id}`} className="font-semibold hover:text-primary">{claim.title}</Link>
                        <div className="mt-0.5 font-mono text-[0.7rem] text-muted-foreground">{claim.claim_number}</div>
                      </td>
                      <td className="text-muted-foreground">{claim.business_line || "Unclassified"}</td>
                      <td><StatusMark status={claim.status || "New"} /></td>
                      <td className="text-right font-semibold">{claim.claim_amount ? `$${Number(claim.claim_amount).toLocaleString()}` : "—"}</td>
                      <td className="w-12 text-right"><Link to={`/claims/${claim.id}`} aria-label={`Open ${claim.claim_number || claim.title}`}><ArrowRight className="ml-auto h-4 w-4 text-muted-foreground" /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <EmptyState />}
        </section>

        <section className="docket-surface rounded-lg p-5" aria-labelledby="line-title">
          <div className="border-b pb-3">
            <h3 id="line-title" className="font-heading text-xl font-semibold">Business-line distribution</h3>
            <p className="mt-1 text-xs text-muted-foreground">Registered claim count by reporting template</p>
          </div>
          {byLine.length ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={byLine} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={58} outerRadius={84} paddingAngle={1} stroke="none" isAnimationActive={false}>
                    {byLine.map((item, index) => <Cell key={item.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2 border-t pt-4">
                {byLine.map((item, index) => (
                  <div key={item.name} className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex min-w-0 items-center gap-2 text-muted-foreground"><span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }} /><span className="truncate">{item.name}</span></span>
                    <span className="font-semibold">{item.value}</span>
                  </div>
                ))}
              </div>
            </>
          ) : <EmptyState compact />}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartPanel title="Claims by status" description="Volume waiting at each workflow state" data={byStatus} layout="vertical" color="#1f8a79" />
        <ChartPanel title="Surveyor allocation" description="Current claim workload by assigned surveyor" data={bySurveyor} color="#496f84" />
      </div>
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail, tone }) {
  const tones = { amber: "text-amber-700 bg-amber-50 border-amber-200", blue: "text-sky-700 bg-sky-50 border-sky-200" };
  return (
    <div className="metric-cell flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="docket-label">{label}</p>
        <p className="mt-1 font-heading text-3xl font-semibold leading-none">{value}</p>
        <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      </div>
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md border ${tones[tone] || "border-primary/20 bg-primary/5 text-primary"}`}><Icon className="h-[18px] w-[18px]" /></div>
    </div>
  );
}

function StatusMark({ status }) {
  return <span className={`status-mark ${statusClass[status] || "border-border bg-muted text-muted-foreground"}`}>{status}</span>;
}

function ChartPanel({ title, description, data, layout, color }) {
  return (
    <section className="docket-surface rounded-lg p-5">
      <div className="border-b pb-3">
        <h3 className="font-heading text-xl font-semibold">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {data.length ? (
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={data} layout={layout} margin={layout ? { left: 24, right: 10, top: 24 } : { left: -12, right: 10, top: 24 }}>
            <CartesianGrid strokeDasharray="2 4" horizontal={!layout} vertical={Boolean(layout)} stroke="hsl(150 10% 82%)" />
            {layout ? <><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} /></> : <><XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={62} /><YAxis tick={{ fontSize: 11 }} /></>}
            <Tooltip />
            <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      ) : <EmptyState compact />}
    </section>
  );
}

function EmptyState({ compact = false }) {
  return <div className={`flex flex-col items-center justify-center text-center text-sm text-muted-foreground ${compact ? "min-h-44" : "min-h-64"}`}><FileCheck2 className="mb-2 h-7 w-7 text-primary/45" /><p>No claim data registered yet.</p></div>;
}
