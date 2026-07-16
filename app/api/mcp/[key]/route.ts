import { NextRequest, NextResponse } from "next/server";
import { authContentApi, authContentToken } from "@/lib/content-api";
import {
  CONTENT_CHANNELS,
  CONTENT_STATUSES,
  listContentPosts,
  proposeContentPost,
} from "@/lib/content-service";

/**
 * MCP (Model Context Protocol) endpoint for the De Nada content calendar,
 * so a ChatGPT Agent (or any MCP client) can connect via a custom connector.
 *
 * Transport: streamable HTTP, stateless — every request is a single JSON-RPC
 * message answered with a single JSON response (the spec allows JSON instead
 * of an SSE stream, and ChatGPT accepts both).
 *
 * Auth: ChatGPT's connector dialog only offers OAuth or "No authentication",
 * so the CONTENT_API_KEY rides in the URL path as a secret-URL:
 *   https://<host>/api/mcp/<CONTENT_API_KEY>
 * A Bearer header with the same key is also accepted (for MCP clients that
 * support custom headers). Scope is identical to the REST content API:
 * content only, and agent proposals always land as unapproved drafts.
 */

const PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"];
const LATEST_PROTOCOL = "2025-06-18";

const SERVER_INFO = { name: "denada-content-calendar", version: "1.0.0" };

const INSTRUCTIONS = [
  "You are connected to the De Nada Tequila content calendar.",
  "Use list_posts to see what is planned or already posted before proposing anything new.",
  "Use propose_post to draft posts. Every proposal is created as an UNAPPROVED draft — a human reviews and approves it inside the De Nada app before it reaches the live calendar, so never claim a post is scheduled or published.",
  "Brand voice: warm, host-first, never flashy. De Nada is additive-free tequila made at NOM 1414.",
].join(" ");

const TOOLS = [
  {
    name: "list_posts",
    description:
      "List posts on the De Nada content calendar (planned, drafted, scheduled, and posted). Optionally filter by date range or status. Returns up to 200 posts as JSON.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date, YYYY-MM-DD (inclusive)" },
        to: { type: "string", description: "End date, YYYY-MM-DD (inclusive)" },
        status: {
          type: "string",
          enum: CONTENT_STATUSES,
          description: "Only posts with this status",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "propose_post",
    description:
      "Propose a new post for the De Nada content calendar. The proposal is created as a DRAFT pending human approval in the De Nada app — it does not go live until a person approves it. Provide a full publish-ready caption and hashtags whenever possible.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string", description: "Short working title" },
        date: { type: "string", description: "Target date, YYYY-MM-DD" },
        channel: { type: "string", enum: CONTENT_CHANNELS, description: "Defaults to INSTAGRAM" },
        caption: { type: "string", description: "Full post caption in the De Nada voice" },
        hashtags: { type: "string", description: "Space-separated hashtags" },
        assetUrl: { type: "string", description: "Link to the image/video, if any" },
        notes: { type: "string", description: "Art direction or context for the team" },
      },
      additionalProperties: false,
    },
  },
];

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

const rpcResult = (id: string | number | null, result: unknown) => ({
  jsonrpc: "2.0",
  id,
  result,
});

const rpcError = (id: string | number | null, code: number, message: string) => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

const toolText = (payload: unknown, isError = false) => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  isError,
});

async function callTool(name: string, args: Record<string, unknown>) {
  if (name === "list_posts") {
    const posts = await listContentPosts({
      from: args.from ? String(args.from) : null,
      to: args.to ? String(args.to) : null,
      status: args.status ? String(args.status) : null,
    });
    return toolText({ posts });
  }
  if (name === "propose_post") {
    const result = await proposeContentPost(args);
    if (!result.ok) return toolText({ error: result.error }, true);
    return toolText({
      ...result.post,
      message:
        "Draft created — pending human approval in the De Nada app. It is NOT live yet.",
    });
  }
  return null;
}

async function handleMessage(msg: JsonRpcRequest): Promise<object | null> {
  const id = msg.id ?? null;
  const method = msg.method ?? "";

  // Notifications (no id) get no response body.
  if (msg.id === undefined || msg.id === null) return null;

  switch (method) {
    case "initialize": {
      const requested = String(msg.params?.protocolVersion ?? "");
      const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await callTool(name, args);
        if (!result) return rpcError(id, -32602, `Unknown tool: ${name}`);
        return rpcResult(id, result);
      } catch {
        return rpcResult(id, toolText({ error: "Tool execution failed." }, true));
      }
    }
    // Friendly empties for clients that probe despite our capabilities.
    case "resources/list":
      return rpcResult(id, { resources: [] });
    case "resources/templates/list":
      return rpcResult(id, { resourceTemplates: [] });
    case "prompts/list":
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

function authorize(req: NextRequest, key: string) {
  // Bearer header wins if present; otherwise the URL path segment is the key.
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? authContentApi(req) : authContentToken(key);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const auth = authorize(req, decodeURIComponent(key));
  if (!auth.ok) {
    return NextResponse.json(rpcError(null, -32000, auth.message), { status: auth.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error: body must be JSON."), {
      status: 400,
    });
  }

  // Batch support (older protocol revisions allow arrays).
  if (Array.isArray(body)) {
    const responses = (await Promise.all(body.map((m) => handleMessage(m ?? {})))).filter(
      (r): r is object => r !== null
    );
    if (responses.length === 0) return new NextResponse(null, { status: 202 });
    return NextResponse.json(responses);
  }

  const response = await handleMessage((body ?? {}) as JsonRpcRequest);
  if (response === null) return new NextResponse(null, { status: 202 });
  return NextResponse.json(response);
}

// Stateless server: no server-initiated SSE stream, no sessions to delete.
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
