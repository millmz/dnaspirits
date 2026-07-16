import { NextRequest, NextResponse } from "next/server";

/**
 * OpenAPI 3.1 schema for the content API, served for import into a ChatGPT
 * Custom GPT Action. The server URL is derived from the request domain so it's
 * always correct for wherever the app is deployed.
 */
export async function GET(req: NextRequest) {
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const server = `${proto}://${host}`;

  const post = {
    type: "object",
    properties: {
      id: { type: "string" },
      date: { type: "string", description: "YYYY-MM-DD" },
      channel: { type: "string", enum: ["INSTAGRAM", "TIKTOK", "YOUTUBE", "EMAIL", "OTHER"] },
      title: { type: "string" },
      caption: { type: "string" },
      hashtags: { type: "string" },
      assetUrl: { type: "string", description: "Link to the image or video to post" },
      status: { type: "string", enum: ["IDEA", "DRAFTED", "SCHEDULED", "POSTED"] },
      source: { type: "string", enum: ["MANUAL", "AGENT"] },
      approved: { type: "boolean" },
    },
  };

  const schema = {
    openapi: "3.1.0",
    info: {
      title: "De Nada Content Calendar",
      description:
        "Read the De Nada Tequila content calendar and propose new posts. Proposed posts are created as drafts and must be approved by a human in the De Nada app before they go live. Content only — no access to financial, equity, or customer data.",
      version: "1.0.0",
    },
    servers: [{ url: server }],
    paths: {
      "/api/content": {
        get: {
          operationId: "listPosts",
          summary: "List planned and posted content",
          parameters: [
            { name: "from", in: "query", required: false, schema: { type: "string" }, description: "Start date YYYY-MM-DD" },
            { name: "to", in: "query", required: false, schema: { type: "string" }, description: "End date YYYY-MM-DD" },
            { name: "status", in: "query", required: false, schema: { type: "string", enum: ["IDEA", "DRAFTED", "SCHEDULED", "POSTED"] } },
          ],
          responses: {
            "200": {
              description: "The content calendar",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { posts: { type: "array", items: post } } },
                },
              },
            },
          },
        },
        post: {
          operationId: "proposePost",
          summary: "Propose a new post (created as a draft pending human approval)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["title"],
                  properties: {
                    title: { type: "string", description: "Short working title" },
                    date: { type: "string", description: "Target date YYYY-MM-DD" },
                    channel: { type: "string", enum: ["INSTAGRAM", "TIKTOK", "YOUTUBE", "EMAIL", "OTHER"] },
                    caption: { type: "string", description: "Full post caption in the De Nada voice" },
                    hashtags: { type: "string", description: "Space-separated hashtags" },
                    assetUrl: { type: "string", description: "Link to the image/video, if any" },
                    notes: { type: "string", description: "Art direction or context" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Draft created", content: { "application/json": { schema: post } } },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer" },
      },
    },
    security: [{ bearerAuth: [] }],
  };

  return NextResponse.json(schema);
}
