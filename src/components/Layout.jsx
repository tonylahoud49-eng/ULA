import React, { useState } from "react";
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { LayoutDashboard, FolderOpen, Sparkles, CalendarDays, LogOut, Menu, X, Shield } from "lucide-react";
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";

const navItems = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/claims", label: "Claims", icon: FolderOpen },
  { to: "/ai-reporting", label: "AI Reporting", icon: Sparkles },
  { to: "/annual-leave", label: "Annual Leave", icon: CalendarDays },
];

export default function Layout() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await appClient.auth.logout();
    navigate("/login");
  };

  return (
    <div className="min-h-screen bg-muted/30 flex">
      {/* Sidebar */}
      <aside
        className={`fixed lg:sticky top-0 z-40 h-screen w-64 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-300 ${
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="h-16 flex items-center gap-2.5 px-6 border-b border-sidebar-border">
          <div className="w-9 h-9 rounded-lg ula-gradient flex items-center justify-center shadow-sm">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div className="leading-tight">
            <div className="font-heading font-bold text-[15px] text-sidebar-foreground tracking-tight">ULA</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider">Claims System</div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                      : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`
                }
              >
                <Icon className="w-[18px] h-[18px]" />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <Button variant="ghost" onClick={handleLogout} className="w-full justify-start text-muted-foreground hover:text-foreground">
            <LogOut className="w-[18px] h-[18px] mr-3" />
            Sign out
          </Button>
        </div>
      </aside>

      {open && <div className="fixed inset-0 bg-black/30 z-30 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 sticky top-0 z-20 bg-background/80 backdrop-blur border-b border-border flex items-center justify-between px-4 lg:px-8">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(!open)}>
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
            <div>
              <h1 className="font-heading font-semibold text-[15px] text-foreground">United Loss Adjusters &amp; Surveyors</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">AI-Powered Claims Management</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="hidden md:inline">Global end-to-end loss adjusting</span>
            <div className="w-8 h-8 rounded-full ula-gradient flex items-center justify-center text-white text-xs font-semibold">ULA</div>
          </div>
        </header>

        <main className="flex-1 p-4 lg:p-8 max-w-[1400px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
