import { Request, Response, NextFunction } from "express";

const DANGEROUS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
  /javascript\s*:/gi,
  /on\w+\s*=\s*["'].*?["']/gi,
  /data:\s*text\/html/gi,
  /vbscript\s*:/gi,
];

function sanitizeString(input: string): string {
  let sanitized = input;
  for (const pattern of DANGEROUS_PATTERNS) {
    sanitized = sanitized.replace(pattern, "");
  }
  return sanitized;
}

function sanitizeObject(obj: unknown): unknown {
  if (typeof obj === "string") return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeObject(value);
    }
    return result;
  }
  return obj;
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction) {
  if (req.body && typeof req.body === "object") {
    req.body = sanitizeObject(req.body);
  }
  if (req.query && typeof req.query === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(req.query)) {
      sanitized[key] = typeof value === "string" ? sanitizeString(value) : value;
    }
    Object.defineProperty(req, "query", {
      value: sanitized,
      writable: true,
      configurable: true,
    });
  }
  if (req.params && typeof req.params === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(req.params)) {
      sanitized[key] = typeof value === "string" ? sanitizeString(value) : value;
    }
    Object.defineProperty(req, "params", {
      value: sanitized,
      writable: true,
      configurable: true,
    });
  }
  next();
}
