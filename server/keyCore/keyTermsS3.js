/**
 * Thin S3 GET/PUT for the existing terms bucket.
 * Preview uses AWS_ROLE_ARN + OIDC at request time. No new env.
 * Factory upload may use named profile lifeguard-terms-uploader only.
 */
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TERMS_LIBRARY_BUCKET,
  TERMS_LIBRARY_REGION,
} from "./keyTermsLibrary.js";

export const TERMS_UPLOADER_PROFILE = "lifeguard-terms-uploader";

function loadNamedAwsProfile(profileName) {
  if (profileName !== TERMS_UPLOADER_PROFILE) return null;
  const credPath = path.join(os.homedir(), ".aws", "credentials");
  if (!fs.existsSync(credPath)) return null;
  const text = fs.readFileSync(credPath, "utf8");
  const marker = `[${profileName}]`;
  const start = text.indexOf(marker);
  if (start < 0) return null;
  const rest = text.slice(start + marker.length);
  const end = rest.search(/\n\[/);
  const block = end >= 0 ? rest.slice(0, end) : rest;
  const accessKeyId = block.match(/aws_access_key_id\s*=\s*(\S+)/)?.[1] || "";
  const secretAccessKey = block.match(/aws_secret_access_key\s*=\s*(\S+)/)?.[1] || "";
  const sessionToken = block.match(/aws_session_token\s*=\s*(\S+)/)?.[1] || "";
  if (!accessKeyId || !secretAccessKey) return null;
  return { accessKeyId, secretAccessKey, sessionToken };
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function hashHex(value) {
  const hash = createHash("sha256");
  if (value == null || value === "") hash.update("");
  else hash.update(value);
  return hash.digest("hex");
}

function amzDate(now = new Date()) {
  const compact = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz: compact.slice(0, 16) + "Z", day: compact.slice(0, 8) };
}

function encodeKey(key) {
  return String(key)
    .split("/")
    .map((part) => encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join("/");
}

function signV4({ method, url, headers, body, credentials, region, service = "s3" }) {
  const { amz, day } = amzDate();
  const payloadHash = hashHex(body || "");
  const host = url.host;
  const signed = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amz,
    ...headers,
  };
  if (credentials.sessionToken) signed["x-amz-security-token"] = credentials.sessionToken;
  const names = Object.keys(signed)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names
    .map((name) => {
      const raw = Object.entries(signed).find(([key]) => key.toLowerCase() === name)[1];
      return `${name}:${String(raw).trim()}\n`;
    })
    .join("");
  const canonical = [
    method,
    url.pathname,
    url.search.replace(/^\?/, ""),
    canonicalHeaders,
    names.join(";"),
    payloadHash,
  ].join("\n");
  const scope = `${day}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amz, scope, hashHex(canonical)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, day), region), service),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  return {
    ...signed,
    Authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}`,
  };
}

async function assumePreviewRole() {
  if (process.env.VERCEL_ENV === "production") {
    return { credentials: null, reason: "TERMS_READ_UNAVAILABLE" };
  }
  const roleArn = process.env.AWS_ROLE_ARN;
  if (!roleArn) {
    return { credentials: null, reason: "TERMS_READ_UNAVAILABLE" };
  }
  let token = "";
  try {
    let oidc = null;
    try {
      oidc = await import("@vercel/functions/oidc");
    } catch {
      oidc = await import("@vercel/oidc");
    }
    token = String((await oidc.getVercelOidcToken()) || "").trim();
  } catch {
    token = "";
  }
  if (!token) {
    return { credentials: null, reason: "TERMS_READ_UNAVAILABLE" };
  }
  const body = new URLSearchParams({
    Action: "AssumeRoleWithWebIdentity",
    Version: "2011-06-15",
    RoleArn: roleArn,
    RoleSessionName: "lifeguard-preview-terms-read",
    WebIdentityToken: token,
  });
  const res = await fetch(`https://sts.${TERMS_LIBRARY_REGION}.amazonaws.com/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const xml = await res.text();
  const accessKeyId = xml.match(/<AccessKeyId>([^<]+)<\/AccessKeyId>/)?.[1];
  const secretAccessKey = xml.match(/<SecretAccessKey>([^<]+)<\/SecretAccessKey>/)?.[1];
  const sessionToken = xml.match(/<SessionToken>([^<]+)<\/SessionToken>/)?.[1];
  if (!res.ok || !accessKeyId || !secretAccessKey || !sessionToken) {
    return { credentials: null, reason: "TERMS_ASSUME_DENIED" };
  }
  return { credentials: { accessKeyId, secretAccessKey, sessionToken } };
}

export async function resolveTermsS3Credentials({ allowStatic = false } = {}) {
  const preview = await assumePreviewRole();
  if (preview.credentials) return preview.credentials;
  if (!allowStatic) return null;
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.AWS_SESSION_TOKEN || "",
    };
  }
  return loadNamedAwsProfile(TERMS_UPLOADER_PROFILE);
}

export async function termsS3Request({
  method,
  key,
  body = null,
  contentType = "application/octet-stream",
  credentials,
  checksumSha256 = null,
}) {
  if (!credentials) {
    return { ok: false, status: 0, reason: "WRITE_PERMISSION_BLOCKED" };
  }
  const url = new URL(`https://${TERMS_LIBRARY_BUCKET}.s3.${TERMS_LIBRARY_REGION}.amazonaws.com/${encodeKey(key)}`);
  const extra = {};
  if (body && method !== "GET" && method !== "HEAD") extra["content-type"] = contentType;
  if (checksumSha256 && method !== "GET" && method !== "HEAD") {
    extra["x-amz-checksum-sha256"] = checksumSha256;
    extra["x-amz-sdk-checksum-algorithm"] = "SHA256";
  }
  const headers = signV4({
    method,
    url,
    headers: extra,
    body: body && method !== "GET" && method !== "HEAD" ? body : "",
    credentials,
    region: TERMS_LIBRARY_REGION,
  });
  const res = await fetch(url, {
    method,
    headers,
    body: body && method !== "GET" && method !== "HEAD" ? body : undefined,
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  if (res.status === 404) return { ok: false, status: 404, reason: "NO_SUCH_KEY", key };
  if (!res.ok) {
    const xml = bytes.toString("utf8");
    const code = xml.match(/<Code>([^<]+)<\/Code>/)?.[1] || "";
    const checksumFail =
      code === "BadDigest" ||
      code === "XAmzContentSHA256Mismatch" ||
      code === "InvalidChunkSizeError" ||
      /checksum/i.test(code);
    return {
      ok: false,
      status: res.status,
      reason:
        checksumFail
          ? "CHECKSUM_MISMATCH"
          : res.status === 403
            ? "ACCESS_DENIED"
            : "S3_HTTP_ERROR",
      key,
    };
  }
  return { ok: true, status: res.status, key, bytes };
}

export async function defaultTermsGetObject(key) {
  const preview = await assumePreviewRole();
  if (preview.credentials) {
    const got = await termsS3Request({
      method: "GET",
      key,
      credentials: preview.credentials,
    });
    if (got.ok) return { found: true, key, bytes: got.bytes };
  }
  const creds = await resolveTermsS3Credentials({ allowStatic: true });
  if (!creds) {
    return {
      found: false,
      reason: preview.reason || "TERMS_READ_UNAVAILABLE",
      key,
    };
  }
  const got = await termsS3Request({ method: "GET", key, credentials: creds });
  if (!got.ok) return { found: false, reason: got.reason, key };
  return { found: true, key, bytes: got.bytes };
}
