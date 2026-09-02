import React, { useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  ChevronRight,
  ClipboardCheck,
  FileStack,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  Shield,
  Terminal,
  X,
} from "lucide-react";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import AILogsModal from "@/components/AILogsModal";
import ulaLogo from "@/assets/ula-logo.png";

const navItems = [
  { to: "/", label: "Dashboard", description: "Portfolio control", icon: LayoutDashboard, end: true },
  { to: "/claims", label: "Claims", description: "Claim register", icon: FolderOpen },
  { to: "/ai-reporting", label: "AI Reporting", description: "Draft and review", icon: FileStack },
  { to: "/annual-leave", label: "Annual Leave", description: "Team availability", icon: CalendarDays },
];

const pageTitles = {
  "/": "Management Dashboard",
  "/claims": "Claims Register",
  "/ai-reporting": "Reporting Workspace",
  "/annual-leave": "Annual Leave",
  "/users": "User Administration",
};

export default function Layout() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const pageTitle = useMemo(() => {
    if (location.pathname.startsWith("/claims/")) return "Claim Workspace";
    return pageTitles[location.pathname] || "ULA Claims Hub";
  }, [location.pathname]);

  const handleLogout = async () => {
    await appClient.auth.logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-background lg:flex">
      <a href="#main-content" className="fixed left-3 top-3 z-[60] -translate-y-20 bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus:translate-y-0">
        Skip to content
      </a>

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-300 lg:sticky lg:top-0 lg:h-screen ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="border-b border-sidebar-border px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-14 w-[72px] items-center justify-center overflow-hidden rounded-md bg-white">
              <img src={ulaLogo} alt="ULA" className="h-14 w-14 object-contain" />
            </div>
            <div className="min-w-0">
              <div className="font-heading text-xl font-semibold leading-none text-white">Claims Hub</div>
              <div className="mt-1 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/60">Controlled reporting</div>
            </div>
          </div>
        </div>

        <nav aria-label="Primary navigation" className="flex-1 px-3 py-5 overflow-y-auto">
          <div className="mb-3 px-3 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/45">Operations</div>
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => `group flex items-center gap-3 rounded-md px-3 py-3 transition-colors ${isActive ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground/76 hover:bg-sidebar-accent hover:text-white"}`}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-tight">{item.label}</span>
                    <span className="mt-0.5 block text-[0.68rem] leading-tight opacity-65">{item.description}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-70" aria-hidden="true" />
                </NavLink>
              );
            })}
          </div>

          {user?.role === "admin" && (
            <>
              <div className="mt-6 mb-3 px-3 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/45">Administration</div>
              <div className="space-y-1">
                <NavLink
                  to="/users"
                  onClick={() => setOpen(false)}
                  className={({ isActive }) => `group flex items-center gap-3 rounded-md px-3 py-3 transition-colors ${isActive ? "bg-sidebar-primary text-sidebar-primary-foreground" : "text-sidebar-foreground/76 hover:bg-sidebar-accent hover:text-white"}`}
                >
                  <Shield className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-tight">Users</span>
                    <span className="mt-0.5 block text-[0.68rem] leading-tight opacity-65">Access management</span>
                  </span>
                  <ChevronRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-70" aria-hidden="true" />
                </NavLink>
              </div>
            </>
          )}
        </nav>

        <div className="border-t border-sidebar-border p-4">
          <div className="mb-3 flex items-center gap-3 rounded-md bg-sidebar-accent/70 px-3 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/50 bg-primary/15 font-heading text-sm font-semibold text-white">
              {(user?.full_name || user?.email || "ULA").slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{user?.full_name || "ULA Professional"}</p>
              <p className="truncate text-[0.68rem] text-sidebar-foreground/55">{user?.email || "Local workspace"}</p>
            </div>
          </div>
          <Button variant="ghost" onClick={handleLogout} className="w-full justify-start text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-white">
            <LogOut className="mr-2 h-[18px] w-[18px]" />
            Sign out
          </Button>
        </div>
      </aside>

      {open && <button type="button" aria-label="Close navigation" className="fixed inset-0 z-40 bg-black/45 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur-sm sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen((value) => !value)} aria-label={open ? "Close navigation" : "Open navigation"}>
              {open ? <X /> : <Menu />}
            </Button>
            <div>
              <h1 className="font-heading text-xl font-semibold leading-none sm:text-2xl">{pageTitle}</h1>
              <p className="mt-1 hidden text-xs text-muted-foreground sm:block">United Loss Adjusters &amp; Surveyors</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <AILogsModal
              triggerButton={
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs font-medium border-border/80 hover:bg-muted/80 shadow-xs"
                  title="View real-time server AI analysis logs and diagnostics"
                >
                  <Terminal className="h-3.5 w-3.5 text-primary" />
                  <span>AI Logs</span>
                </Button>
              }
            />
            <span className="hidden items-center gap-1.5 status-mark border-primary/30 bg-primary/5 text-primary sm:inline-flex">
              <ClipboardCheck className="h-3.5 w-3.5" /> Local development
            </span>
          </div>
        </header>

        <main id="main-content" className="docket-enter mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
