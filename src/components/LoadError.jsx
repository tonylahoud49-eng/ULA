import React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LoadError({ message, onRetry }) {
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
    <p className="min-w-0 text-sm text-destructive break-words">{message}</p>
    <Button variant="outline" onClick={onRetry}><RefreshCw className="h-4 w-4" /> Try again</Button>
  </div>;
}
