import { Response } from 'express';

export function ok<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function fail(res: Response, message: string, status = 400, details?: unknown) {
  return res.status(status).json({ success: false, error: message, details });
}

export function paginated<T>(res: Response, data: T[], total: number, page: number, limit: number) {
  return res.json({
    success: true,
    data,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
  });
}
