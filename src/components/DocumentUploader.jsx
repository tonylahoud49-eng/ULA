import React, { useEffect, useState } from "react";
import { appClient } from "@/api/appClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { UploadCloud, FileText, Image as ImageIcon, X, Loader2 } from "lucide-react";

const FILE_TYPES = ["Official Final Report", "PDF", "Word", "Excel", "Email", "Invoice", "Policy", "Claim Form", "Bill of Lading", "Air Waybill", "Packing List", "Quotation", "Survey Report", "Statement", "Photo", "Other"];
const CATEGORIES = ["Official Final Report", "Policy Document", "Shipping Document", "Evidence", "Correspondence", "Financial", "Photo Evidence", "Other"];

const errorMessage = (error) => error?.response?.data?.error || error?.message || "Please try again.";

export default function DocumentUploader({ claimId, documents, onChanged }) {
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
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

  const onDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(true);
  };

  const onDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) handleFiles(files);
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
    <Card className="docket-surface overflow-hidden shadow-none">
      <div className="border-b bg-muted/35 px-5 py-4">
        <h3 className="font-heading text-xl font-semibold">Evidence register</h3>
        <p className="mt-1 text-xs text-muted-foreground">Binary files are stored separately; only lightweight metadata and provider references enter the claim database.</p>
      </div>
      <div className="flex flex-col gap-4 border-b px-5 py-4 md:flex-row">
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
      <div
        className={`m-5 flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed p-8 transition-colors ${dragging ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "border-primary/45 bg-primary/[0.025] hover:border-primary hover:bg-primary/5"}`}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => document.getElementById(`file-input-${claimId}`)?.click()}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") document.getElementById(`file-input-${claimId}`)?.click(); }}
        role="button"
        tabIndex={0}
        aria-label="Drop files here or click to browse"
      >
        <input id={`file-input-${claimId}`} type="file" multiple className="hidden" onChange={(e) => { handleFiles(Array.from(e.target.files)); e.target.value = ""; }} />
        {uploading ? (
          <><Loader2 className="w-8 h-8 text-primary animate-spin mb-2" /><p className="text-sm text-muted-foreground">Uploading…</p></>
        ) : dragging ? (
          <><UploadCloud className="w-8 h-8 text-primary mb-2 animate-bounce" /><p className="text-sm font-semibold text-primary">Drop files here</p><p className="text-xs text-muted-foreground mt-1">Release to upload all selected files</p></>
        ) : (
          <><UploadCloud className="w-8 h-8 text-primary mb-2" /><p className="text-sm font-semibold">Add source evidence</p><p className="text-xs text-muted-foreground mt-1">Drop files here, or click to browse · PDF, Word, Excel, email, images, and more</p></>
        )}
      </div>

      <div className="border-t px-5 py-4">
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">No documents uploaded yet.</p>
        ) : (
          <div className="divide-y border">
          {documents.map((d, index) => (
            <div key={d.id} className="flex items-center gap-3 p-3 hover:bg-muted/30">
              <span className="w-9 shrink-0 font-mono text-[0.68rem] text-muted-foreground">E-{String(index + 1).padStart(2, "0")}</span>
              {d.file_type === "Photo" ? <ImageIcon className="w-5 h-5 text-primary" /> : <FileText className="w-5 h-5 text-primary" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{d.file_name}</p>
                <p className="text-xs text-muted-foreground">{d.file_type} · {d.category}</p>
              </div>
              <DocumentLink document={d} />
              <Button size="icon" variant="ghost" onClick={() => remove(d)}><X className="w-4 h-4 text-muted-foreground" /></Button>
            </div>
          ))}
          </div>
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
