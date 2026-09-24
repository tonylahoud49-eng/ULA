import React, { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/use-toast";

export default function ConfirmAction({ action, onClose }) {
  const [busy, setBusy] = useState(false);
  return <AlertDialog open={Boolean(action)} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{action?.title}</AlertDialogTitle><AlertDialogDescription>{action?.description}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
        <AlertDialogAction disabled={busy} onClick={async (event) => {
          event.preventDefault();
          if (busy) return;
          setBusy(true);
          try { if (await action.onConfirm() !== false) onClose(); }
          catch (error) { toast({ variant: "destructive", title: "Action failed", description: error.message }); }
          finally { setBusy(false); }
        }}>{busy ? "Updating..." : action?.label || "Confirm"}</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
