import { createServer } from "node:http";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function readKnowledgeContext(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 5) {
    throw new HttpError(400, "knowledgeContext must contain at most five profiles.");
  }
  return value.map((profile, index) => {
    if (
      typeof profile !== "object" ||
      profile === null ||
      Array.isArray(profile) ||
      typeof profile.id !== "string" ||
      typeof profile.type !== "string" ||
      typeof profile.name !== "string" ||
      typeof profile.description !== "string" ||
      typeof profile.guidance !== "string" ||
      profile.id.length > 80 ||
      profile.type.length > 30 ||
      profile.name.length > 100 ||
      profile.description.length > 500 ||
      profile.guidance.length > 2000
    ) {
      throw new HttpError(400, `knowledgeContext[${index}] is invalid.`);
    }
    return {
      id: profile.id,
      type: profile.type,
      name: profile.name,
      description: profile.description,
      guidance: profile.guidance,
    };
  });
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) {
      throw new HttpError(413, "Request body exceeds 1 MB.");
    }
    chunks.push(chunk);
  }

  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      throw new Error("Expected a JSON object.");
    }
    return body;
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "Invalid JSON request body.",
    );
  }
}

export function startAgentServer({ name, port, routes }) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") {
      sendJson(response, 200, { name, status: "ok" });
      return;
    }

    const handler = routes[`${request.method} ${url.pathname}`];
    if (!handler) {
      sendJson(response, 404, { error: "Not found." });
      return;
    }

    try {
      const body = await readJson(request);
      sendJson(response, 200, await handler(body));
    } catch (error) {
      const status =
        error instanceof HttpError ? error.status : 500;
      if (status === 500) {
        console.error(`[${name}]`, error);
      }
      sendJson(response, status, {
        error: error instanceof Error ? error.message : "Agent request failed.",
      });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`${name} listening on http://127.0.0.1:${port}`);
  });

  return server;
}
