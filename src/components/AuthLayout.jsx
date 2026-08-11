import React from "react";
import { CheckCircle, FileCheck2, ShieldCheck } from "lucide-react";
import ulaLogo from "@/assets/ula-logo.png";

export default function AuthLayout({ icon: Icon, title, subtitle, footer, children }) {
  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-[minmax(360px,0.8fr)_minmax(520px,1.2fr)]">
      <aside className="hidden min-h-screen flex-col justify-between border-r border-sidebar-border bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div>
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-24 items-center justify-center overflow-hidden rounded-md bg-white"><img src={ulaLogo} alt="ULA" className="h-20 w-20 object-contain" /></div>
            <div><p className="font-heading text-2xl font-semibold text-white">Claims Hub</p><p className="mt-1 text-xs uppercase tracking-[0.13em] text-sidebar-foreground/55">Controlled reporting</p></div>
          </div>
          <div className="mt-20 max-w-md">
            <h2 className="font-heading text-5xl font-semibold leading-[0.94] text-white">Evidence to issued report, under professional control.</h2>
            <p className="mt-6 max-w-[48ch] text-sm leading-6 text-sidebar-foreground/66">ULA Claims Hub keeps claim facts, source evidence, adjustment, review, and approval connected through one controlled workflow.</p>
          </div>
        </div>
        <div className="grid gap-px overflow-hidden rounded-md border border-sidebar-border bg-sidebar-border">
          {[{ icon: FileCheck2, label: "Evidence-linked drafting" }, { icon: CheckCircle, label: "Review and approval gates" }, { icon: ShieldCheck, label: "Controlled report versions" }].map((item) => (
            <div key={item.label} className="flex items-center gap-3 bg-sidebar px-4 py-3 text-sm text-sidebar-foreground/76"><item.icon className="h-4 w-4 text-primary" /><span>{item.label}</span></div>
          ))}
        </div>
      </aside>

      <main className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-7 flex items-start gap-4 border-b pb-5">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/5 text-primary"><Icon className="h-5 w-5" aria-hidden="true" /></div>
            <div><h1 className="font-heading text-3xl font-semibold leading-none text-foreground">{title}</h1>{subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}</div>
          </div>
          <div className="docket-surface rounded-lg p-6 sm:p-8">{children}</div>
          {footer && <p className="mt-6 text-center text-sm text-muted-foreground">{footer}</p>}
          <p className="mt-8 text-center text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">United Loss Adjusters &amp; Surveyors</p>
        </div>
      </main>
    </div>
  );
}
