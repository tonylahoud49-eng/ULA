import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { BrowserRouter as Router, Route, Routes, Navigate } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import ScrollToTop from './components/ScrollToTop';
import ProtectedRoute from '@/components/ProtectedRoute';
import Layout from '@/components/Layout';

// Lazy-load page components for code splitting & fast initial render
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Claims = lazy(() => import('@/pages/Claims'));
const ClaimDetail = lazy(() => import('@/pages/ClaimDetail'));
const AIReporting = lazy(() => import('@/pages/AIReporting'));
const AnnualLeave = lazy(() => import('@/pages/AnnualLeave'));
const Login = lazy(() => import('@/pages/Login'));
const ForgotPassword = lazy(() => import('@/pages/ForgotPassword'));
const ResetPassword = lazy(() => import('@/pages/ResetPassword'));
const OAuthConsent = lazy(() => import('@/pages/OAuthConsent'));
const AdminUsers = lazy(() => import('@/pages/AdminUsers'));

const PageFallback = () => (
  <div className="flex min-h-[300px] w-full items-center justify-center p-8">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-slate-800" />
  </div>
);

const AuthenticatedApp = () => {
  const { user, isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
  const loginReturnTo = `/login?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`;

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur-sm">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-primary"></div>
      </div>
    );
  }

  if (authError?.type === 'auth_required') {
    navigateToLogin();
    return null;
  }

  // Render the main app
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Navigate to="/login" replace />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/oauth/consent" element={<OAuthConsent />} />
        <Route element={<ProtectedRoute unauthenticatedElement={<Navigate to={loginReturnTo} replace />} />}>
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/claims" element={<Claims />} />
            <Route path="/claims/:id" element={<ClaimDetail />} />
            <Route path="/ai-reporting" element={<AIReporting />} />
            <Route path="/annual-leave" element={<AnnualLeave />} />
            <Route path="/users" element={user?.role === 'admin' ? <AdminUsers /> : <Navigate to="/" replace />} />
          </Route>
        </Route>
        <Route path="*" element={<PageNotFound />} />
      </Routes>
    </Suspense>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ScrollToTop />
          <AuthenticatedApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
