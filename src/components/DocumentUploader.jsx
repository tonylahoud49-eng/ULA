import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { UploadCloud, FileText, Image as ImageIcon, X, Loader2 } from "lucide-react";

const FILE_TYPES = ["PDF", "Word", "Excel", "Email", "Invoice", "Policy", "Claim Form", "Bill of Lading", "Air Waybill", "Packing List", "Quotation", "Survey Report", "Statement", "Photo", "Other"];
const CATEGORIES = ["Policy Document", "Shipping Document", "Evidence", "Correspondence", "Financial", "Photo Evidence", "Other"];

const errorMessage = (error) => error?.response?.data?.error || error?.message || "Please try again.";

export default function DocumentUploader({ claimId, documents, onChanged }) {
  const [uploading, setUploading] = useState(false);
  const [type, setType] = useState("PDF");
  const [category, setCategory] = useState("Other");

  const handleFiles = async (files) => {
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        let uploaded;
        try {
          uploaded = await appClient.integrations.Core.UploadFile({ file });
          const guessed = file.type.startsWith("image/") ? "Photo" : type;
          await appClient.entities.ClaimDocument.create({
            claim_id: claimId,
            ...uploaded,
            file_name: file.name,
            file_type: guessed,
            category: guessed === "Photo" ? "Photo Evidence" : category,
            uploaded_date: new Date().toISOString(),
          });
        } catch (error) {
          if (uploaded) await appClient.integrations.Core.DeleteFile(uploaded);
          throw error;
        }
      }
      await onChanged();
    } catch (error) {
      await onChanged();
      toast({
        variant: "destructive",
        title: "Document upload failed",
        description: errorMessage(error),
      });
    } finally {
      setUploading(false);
    }
  };

  const remove = async (doc) => {
    try {
      await appClient.entities.ClaimDocument.delete(doc.id);
      await onChanged();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Document could not be removed",
        description: errorMessage(error),
      });
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-col md:flex-row gap-4 mb-5">
        <div className="flex-1">
          <Label className="text-xs">Default document type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>{FILE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="flex-1">
          <Label className="text-xs">Default category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <label className="border-2 border-dashed border-border rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors">
        <input type="file" multiple className="hidden" onChange={(e) => handleFiles(Array.from(e.target.files))} />
        {uploading ? (
          <><Loader2 className="w-8 h-8 text-primary animate-spin mb-2" /><p className="text-sm text-muted-foreground">Uploading…</p></>
        ) : (
          <><UploadCloud className="w-8 h-8 text-primary mb-2" /><p className="text-sm font-medium">Click to upload evidence</p><p className="text-xs text-muted-foreground mt-1">PDFs, Word, Excel, emails, invoices, policies, photos…</p></>
        )}
      </label>

      <div className="mt-5 space-y-2">
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No documents uploaded yet.</p>
        ) : (
          documents.map((d) => (
            <div key={d.id} className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-muted/30">
              {d.file_type === "Photo" ? <ImageIcon className="w-5 h-5 text-primary" /> : <FileText className="w-5 h-5 text-primary" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{d.file_name}</p>
                <p className="text-xs text-muted-foreground">{d.file_type} · {d.category}</p>
              </div>
              <DocumentLink document={d} />
              <Button size="icon" variant="ghost" onClick={() => remove(d)}><X className="w-4 h-4 text-muted-foreground" /></Button>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function DocumentLink({ document }) {
  const [resolved, setResolved] = useState({ url: null, error: null });

  useEffect(() => {
    let active = true;
    let objectUrl;
    appClient.documentStorage.resolveUrl(document.file_url || document.storage_key)
      .then(({ url, revoke }) => {
        if (!active) {
          if (revoke) URL.revokeObjectURL(url);
          return;
        }
        objectUrl = revoke ? url : undefined;
        setResolved({ url, error: null });
      })
      .catch((error) => {
        if (active) setResolved({ url: null, error });
      });

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [document.file_url, document.storage_key]);

  const handleClick = (event) => {
    if (resolved.url) return;
    event.preventDefault();
    toast({
      variant: "destructive",
      title: "Document is unavailable",
      description: resolved.error ? errorMessage(resolved.error) : "The document is still loading. Please try again.",
    });
  };

  return (
    <a
      href={resolved.url || "#"}
      target="_blank"
      rel="noreferrer"
      className="text-xs text-primary hover:underline"
      onClick={handleClick}
    >
      Open
    </a>
  );
}
