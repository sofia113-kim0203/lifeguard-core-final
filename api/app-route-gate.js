/**
 * P3.5 — GET /api/app-route-gate?path=/admin
 * Server-side role gate for SPA deep links (customer → LIFEGUARD redirect).
 */
import { readJsonBody } from "../server/claudeGroundedExecutionCore.js";
import {
  createUserSupabaseClient,
  readCustomerAuthHeader,
} from "../server/requireCustomerAuth.js";
import { evaluateAppRouteGate } from "../server/appRoleGate.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.statusCode = 200;
    res.end();
    return;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, reason: "METHOD_NOT_ALLOWED" }));
    return;
  }

  try {
    const authHeader = readCustomerAuthHeader(req);
    const userSupabase = createUserSupabaseClient(authHeader);
    let pathname = "/";
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      pathname = url.searchParams.get("path") ?? "/";
    } else {
      const body = req.body && typeof req.body === "object" ? req.body : await readJsonBody(req);
      pathname = body?.path ?? "/";
    }

    const gate = await evaluateAppRouteGate({ userSupabase, pathname });
    if (!gate.ok) {
      res.statusCode = gate.reason === "UNAUTHORIZED" ? 401 : 403;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, allowed: false, redirect: "/", reason: gate.reason }));
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        role: gate.role,
        path: gate.path,
        allowed: gate.allowed,
        redirect: gate.redirect,
      }),
    );
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: false,
        reason: "SERVER_ERROR",
        error_message: error instanceof Error ? error.message : "route_gate_failed",
      }),
    );
  }
}
