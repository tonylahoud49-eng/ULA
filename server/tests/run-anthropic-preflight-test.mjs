import app from "../index.mjs";

const listener = await new Promise((resolve) => {
  const server = app.listen(0, "127.0.0.1", () => resolve(server));
});

try {
  const address = listener.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/ai/connectivity`, { method: "POST" });
  const body = await response.json();
  const result = {
    ready: response.ok && body.ok === true,
    server_running: true,
    provider: body.connectivity?.provider || body.provider || "anthropic",
    model: body.connectivity?.model || body.model || process.env.ANTHROPIC_MODEL || null,
    anthropic_http_status: body.connectivity?.http_status || body.provider_status || null,
    error: response.ok ? null : body.error,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ready) process.exitCode = 1;
} finally {
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
}
