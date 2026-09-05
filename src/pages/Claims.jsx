import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { appClient } from "@/api/appClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, ArrowRight, FolderOpen, Plus, Search, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";

const BUSINESS_LINES = [
  "Yacht",
  "Property",
  "Marine Cargo (Reefer/GFS)",
  "Marine Cargo (Non-Reefer)",
  "Bulk Vessel",
  "Air Shipment (NET)",
  "Land Shipment",
  "Fidelity Claims",
  "Unclassified",
];

const STATUSES = [
  "New",
  "Under Investigation",
  "Pending Documents",
  "Report Draft",
  "Report Final",
  "Closed",
];

const statusStyles = {
  New: "border-sky-300 bg-sky-50 text-sky-800",
  "Under Investigation": "border-amber-300 bg-amber-50 text-amber-800",
  "Pending Documents": "border-orange-300 bg-orange-50 text-orange-800",
  "Report Draft": "border-violet-300 bg-violet-50 text-violet-800",
  "Report Final": "border-emerald-300 bg-emerald-50 text-emerald-800",
  Closed: "border-border bg-muted text-muted-foreground",
};

export default function Claims() {
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [businessLine, setBusinessLine] = useState("all");
  const [generatingDummy, setGeneratingDummy] = useState(false);
  const navigate = useNavigate();

  const generateDummyClaim = async () => {
    setGeneratingDummy(true);
    try {
      // 1. Create a claim
      const claim = await appClient.entities.Claim.create({
        title: "Dummy Claim - Refrigerated Apples",
        business_line: "Marine Cargo (Reefer/GFS)",
        status: "New",
        priority: "High",
        insured: "Al Futtaim Logistics",
        insurer: "Orient Insurance",
        broker: "Marsh",
        claim_amount: 45000.00,
        deductible: 500.00,
        cause_of_loss: "Temperature abuse during transit resulting in cargo spoilage.",
        policy_number: "M-CARGO-2023-4411",
        date_of_loss: "2023-11-14",
        vessel_name: "MSC ISABELLA",
        container_number: "MSCU1234567",
        visibility: "private",
      });

      // 2. Dummy Invoice
      const invoiceContent = "COMMERCIAL INVOICE\nInvoice #: INV-9921\nDate: 2023-11-01\nTotal Amount: 45000.00 USD\nItems: 1000 boxes of Apples\nUnit Price: 45.00 USD\nTotal Commercial Value: USD 45,000.00";
      const invoiceFile = new File([invoiceContent], "commercial_invoice.txt", { type: "text/plain" });
      const invoiceUpload = await appClient.integrations.Core.UploadFile({ file: invoiceFile });
      await appClient.entities.ClaimDocument.create({ claim_id: claim.id, file_name: "commercial_invoice.txt", file_mime_type: "text/plain", category: "Commercial Invoice", ...invoiceUpload });

      // 3. Dummy Survey Report
      const surveyContent = "SURVEY REPORT\nDate of Attendance: 2023-11-15\nSurveyor: Petro Zaarour\nLocation: Beirut Port\nStatement of facts:\n1. The container MSCU1234567 was opened on 2023-11-15.\n2. The temperature logger recorded +15C instead of the required +2C to +4C.\n3. 1,000 boxes of apples were found to have sustained quality deterioration.\n4. Total damage USD 45,000.00.";
      const surveyFile = new File([surveyContent], "survey_report.txt", { type: "text/plain" });
      const surveyUpload = await appClient.integrations.Core.UploadFile({ file: surveyFile });
      await appClient.entities.ClaimDocument.create({ claim_id: claim.id, file_name: "survey_report.txt", file_mime_type: "text/plain", category: "Survey Report", ...surveyUpload });

      // 4. Dummy Bill of Lading
      const bolContent = "BILL OF LADING\nBill of Lading No: MSCU99887766\nShipper: USA Apple Exports\nConsignee: Al Futtaim Logistics\nCarrier: MSC\nVessel: MSC ISABELLA\nPort of Origin: New York\nDESTINO/DESTIN: Beirut\nGross Weight: 25,000 KGS\nTotal Packages: 1000 cartons\nShipped on Board MSC ISABELLA 01-NOV-2023";
      const bolFile = new File([bolContent], "bill_of_lading.txt", { type: "text/plain" });
      const bolUpload = await appClient.integrations.Core.UploadFile({ file: bolFile });
      await appClient.entities.ClaimDocument.create({ claim_id: claim.id, file_name: "bill_of_lading.txt", file_mime_type: "text/plain", category: "Bill of Lading", ...bolUpload });

      // 5. Dummy Photographs
      const DUMMY_IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
      const b64toBlob = (b64Data, contentType='', sliceSize=512) => {
        const byteCharacters = atob(b64Data);
        const byteArrays = [];
        for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
          const slice = byteCharacters.slice(offset, offset + sliceSize);
          const byteNumbers = new Array(slice.length);
          for (let i = 0; i < slice.length; i++) byteNumbers[i] = slice.charCodeAt(i);
          byteArrays.push(new Uint8Array(byteNumbers));
        }
        return new Blob(byteArrays, {type: contentType});
      }
      
      for (let i = 1; i <= 3; i++) {
        const photoFile = new File([b64toBlob(DUMMY_IMAGE.split(',')[1], 'image/jpeg')], `damage_photo_${i}.jpg`, { type: "image/jpeg" });
        const photoUpload = await appClient.integrations.Core.UploadFile({ file: photoFile });
        await appClient.entities.ClaimDocument.create({
          claim_id: claim.id,
          file_name: `damage_photo_${i}.jpg`,
          file_mime_type: "image/jpeg",
          category: "Photo Evidence",
          ...photoUpload
        });
      }

      navigate(`/claims/${claim.id}`);
    } catch (e) {
      console.error(e);
      alert("Failed to generate dummy claim");
    } finally {
      setGeneratingDummy(false);
    }
  };

  useEffect(() => {
    let active = true;

    const loadClaims = async () => {
      try {
        const data = await appClient.entities.Claim.list("-created_date", 500);
        if (active) setClaims(data);
      } catch (err) {
        if (active) setError(err.message || "Failed to load claims");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadClaims();
    return () => {
      active = false;
    };
  }, []);

  const filteredClaims = useMemo(() => {
    const term = search.trim().toLowerCase();
    return claims.filter((claim) => {
      const matchesSearch = !term || [claim.claim_number, claim.title, claim.insured, claim.surveyor]
        .some((value) => String(value || "").toLowerCase().includes(term));
      const matchesStatus = status === "all" || claim.status === status;
      const matchesBusinessLine = businessLine === "all" || claim.business_line === businessLine;
      return matchesSearch && matchesStatus && matchesBusinessLine;
    });
  }, [businessLine, claims, search, status]);

  return (
    <div className="space-y-6">
      <div className="docket-header">
        <div>
          <h2 className="docket-title">Claims register</h2>
          <p className="docket-subtitle">Search every matter, identify its current gate, and open the controlled claim workspace.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={generateDummyClaim} disabled={generatingDummy}>
            <Sparkles className="w-4 h-4 mr-2 text-primary" /> {generatingDummy ? "Generating..." : "Generate Dummy Claim"}
          </Button>
          <Link to="/ai-reporting">
            <Button>
              <Plus className="w-4 h-4 mr-2" /> New AI Claim
            </Button>
          </Link>
        </div>
      </div>

      <Card className="docket-surface p-4 shadow-none">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search claims..."
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger><SelectValue placeholder="All statuses" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={businessLine} onValueChange={setBusinessLine}>
            <SelectTrigger><SelectValue placeholder="All business lines" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All business lines</SelectItem>
              {BUSINESS_LINES.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {error ? (
        <Card className="docket-surface flex items-center gap-3 border-destructive/35 bg-destructive/5 p-6 text-destructive shadow-none">
          <AlertTriangle className="w-5 h-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </Card>
      ) : (
        <Card className="docket-surface overflow-hidden shadow-none">
          <div className="px-5 py-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-2 font-heading font-semibold text-sm">
              <FolderOpen className="w-4 h-4 text-primary" /> All Claims
            </div>
            <span className="text-xs text-muted-foreground">{filteredClaims.length} claims</span>
          </div>

          {loading ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading claims...</div>
          ) : filteredClaims.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No claims match the selected filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="register-table">
                <thead>
                  <tr>
                    <th>Claim</th>
                    <th>Business Line</th>
                    <th>Insured</th>
                    <th>Visibility</th>
                    <th>Status</th>
                    <th>Surveyor</th>
                    <th aria-label="Open claim" />
                  </tr>
                </thead>
                <tbody>
                  {filteredClaims.map((claim) => (
                    <tr key={claim.id}>
                      <td>
                        <Link to={`/claims/${claim.id}`} className="font-medium hover:text-primary">
                          {claim.title}
                        </Link>
                        <div className="text-xs text-muted-foreground mt-0.5">{claim.claim_number}</div>
                      </td>
                      <td>{claim.business_line || "Unclassified"}</td>
                      <td>{claim.insured || "—"}</td>
                      <td><span className={`status-mark ${claim.visibility === "public" ? "border-primary/30 bg-primary/5 text-primary" : "border-border bg-muted text-muted-foreground"}`}>{claim.visibility === "public" ? "Public" : "Private"}</span></td>
                      <td>
                        <span className={`status-mark ${statusStyles[claim.status] || "border-border bg-muted text-muted-foreground"}`}>
                          {claim.status || "New"}
                        </span>
                      </td>
                      <td>{claim.surveyor || "Unassigned"}</td>
                      <td className="text-right">
                        <Link to={`/claims/${claim.id}`} aria-label={`Open ${claim.claim_number || claim.title}`}>
                          <ArrowRight className="w-4 h-4 text-muted-foreground" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
