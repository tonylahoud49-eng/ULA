import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerAnalysisJobRoutes } from "../ai/analysisJobRoutes.mjs";

test("saved job routes require session, owner and current claim access; changed attachments block resume/result/provisional", async (t) => {
  let access = true, changed = false, resumed = 0;
  const app = express(); app.use(express.json());
  const job = { id: "saved", claim_id: "claim", manifest: [{ id: "doc", file_name: "evidence.pdf", storage_key: "original" }] };
  registerAnalysisJobRoutes(app, {
    requireAccess: (request, response, next) => { if (!request.headers.authorization) return response.status(401).json({ error: "Sign in" }); request.authUser = { id: request.headers.authorization }; next(); },
    upload: (_request, _response, next) => next(),
    repository: { get: async () => access ? { id: "claim" } : null, filter: async () => [{ id: "doc", file_name: "evidence.pdf", storage_key: changed ? "replacement" : "original" }] },
    getJobs: () => ({
      get: (_id, owner) => { if (owner !== "owner") throw Object.assign(new Error("Analysis job not found."), { status: 404 }); return job; },
      owned: () => job, latest: () => job,
      resume: () => { resumed += 1; return job; }, result: () => ({ analysis: {} }), provisional: async () => ({ provisional: true }),
    }),
    getChat: () => ({ history: () => ({ messages: [] }) }),
  });
  const server = app.listen(0, "127.0.0.1"); await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/ai/jobs/saved`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { authorization: "other" } })).status, 404);
  assert.equal((await fetch(url, { headers: { authorization: "owner" } })).status, 200);
  access = false;
  assert.equal((await fetch(`${url}/chat`, { headers: { authorization: "owner" } })).status, 404);
  access = true; changed = true;
  for (const [suffix, method] of [["resume", "POST"], ["result", "GET"], ["provisional", "POST"]]) {
    const result = await fetch(`${url}/${suffix}`, { method, headers: { authorization: "owner" } });
    assert.equal(result.status, 409); assert.match((await result.json()).error, /attachments changed/);
  }
  assert.equal(resumed, 0);
});
