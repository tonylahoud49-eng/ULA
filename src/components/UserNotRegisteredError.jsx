import React from 'react';
import { appClient } from "@/api/appClient";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

const UserNotRegisteredError = () => {
  const handleLogout = async () => {
    await appClient.auth.logout();
    window.location.href = "/login";
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-b from-white to-slate-50 p-4">
      <div className="max-w-md w-full p-8 bg-white rounded-lg shadow-lg border border-slate-100">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 mb-6 rounded-full bg-orange-100">
            <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-4">Access Restricted</h1>
          <p className="text-slate-600 mb-8">
            Your account is pending administrator approval. Please contact the app administrator to request access.
          </p>
          <div className="p-4 bg-slate-50 rounded-md text-sm text-slate-600 mb-6 text-left">
            <p className="font-semibold">Local Testing Instructions:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Click the button below to sign out.</li>
              <li>Sign in as <code className="bg-slate-100 px-1 py-0.5 rounded text-primary">admin@unitedlossadjusters.com</code> with the local administrator password.</li>
              <li>Open the Users page from the sidebar and approve your pending account.</li>
            </ul>
          </div>
          <Button onClick={handleLogout} className="w-full h-11 ula-gradient text-white">
            <LogOut className="w-4 h-4 mr-2" /> Back to Login
          </Button>
        </div>
      </div>
    </div>
  );
};

export default UserNotRegisteredError;
