import { jobError } from "./analysisJobStore.mjs";

export function registerAnalysisJobRoutes(app, { requireAccess, upload, getJobs, getChat, repository, env = process.env }) {
  const owner = (request) => request.authUser?.id || "local-development";
  const authorizeClaim = async (request, claimId) => {
    if (!claimId || typeof claimId !== "string") throw jobError("A claim is required.");
    if (repository && !await repository.get("Claim", claimId, request.authUser)) throw jobError("Claim not found.", 404);
  };
  const authorizeJob = async (request) => {
    const job = getJobs().get(request.params.id, owner(request));
    await authorizeClaim(request, job.claim_id);
    return job;
  };
  const route = (handler) => async (request, response) => {
    try { await handler(request, response); }
    catch (error) { response.status(Number(error.status) || 500).json({ error: error.message || "Analysis could not be loaded.", code: error.code || "analysis-job-error" }); }
  };
  const validateDocuments = async (request, jobOrInput) => {
    if (!repository) return;
    const documents = await repository.filter("ClaimDocument", { claim_id: jobOrInput.claim_id }, request.authUser);
    const manifest = jobOrInput.manifest;
    if (documents.length !== manifest.length || documents.some((document) => !manifest.some((item) => item.id === document.id && item.file_name === document.file_name && (item.storage_key || item.file_url || "") === (document.storage_key || document.file_url || "")))) {
      throw jobError("The claim attachments changed. Start a new analysis using the current evidence; the previous checkpoints remain saved.", 409, "analysis-evidence-changed");
    }
  };
  app.post("/api/ai/jobs", requireAccess, upload, route(async (request, response) => {
    const claim = JSON.parse(request.body.claim || "{}");
    const manifest = JSON.parse(request.body.manifest || "[]");
    const files = request.files || [];
    await authorizeClaim(request, claim.id);
    if (!Array.isArray(manifest)) throw jobError("Invalid evidence manifest.");
    await validateDocuments(request, { claim_id: claim.id, manifest });
    if (files.reduce((sum, file) => sum + file.size, 0) > (Number(env.AI_MAX_TOTAL_BYTES) || 50 * 1024 * 1024)) throw jobError("The combined upload exceeds the server size limit.", 413);
    if (request.body.provider && request.body.provider !== "anthropic") throw jobError("Saved analysis jobs currently use Claude. Select Claude or use the existing provider workflow.");
    if (!(env.ANTHROPIC_API_KEY || env.ANTHROTIC_API_KEY)) throw jobError("Claude is not configured on the server.", 503);
    const model = request.body.model || env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
    const job = await getJobs().create({ claim, manifest, files, model, owner: owner(request), actor: request.authUser });
    response.status(job.state === "complete" ? 200 : 202).json({ job });
  }));
  app.get("/api/ai/jobs", requireAccess, route(async (request, response) => {
    await authorizeClaim(request, request.query.claim_id);
    response.json({ job: getJobs().latest(request.query.claim_id, owner(request)) });
  }));
  app.get("/api/ai/jobs/:id", requireAccess, route(async (request, response) => {
    response.json({ job: await authorizeJob(request) });
  }));
  app.post("/api/ai/jobs/:id/resume", requireAccess, route(async (request, response) => {
    await authorizeJob(request);
    await validateDocuments(request, getJobs().owned(request.params.id, owner(request)));
    response.json({ job: getJobs().resume(request.params.id, owner(request)) });
  }));
  app.get("/api/ai/jobs/:id/result", requireAccess, route(async (request, response) => {
    await authorizeJob(request);
    await validateDocuments(request, getJobs().owned(request.params.id, owner(request)));
    response.json(getJobs().result(request.params.id, owner(request)));
  }));
  app.post("/api/ai/jobs/:id/provisional", requireAccess, route(async (request, response) => {
    await authorizeJob(request);
    await validateDocuments(request, getJobs().owned(request.params.id, owner(request)));
    response.json(await getJobs().provisional(request.params.id, owner(request)));
  }));
  app.get("/api/ai/jobs/:id/chat", requireAccess, route(async (request, response) => {
    await authorizeJob(request);
    response.json(getChat().history(request.params.id, owner(request)));
  }));
  app.post("/api/ai/jobs/:id/chat", requireAccess, route(async (request, response) => {
    await authorizeJob(request);
    response.json(await getChat().send(request.params.id, owner(request), request.body));
  }));
}
