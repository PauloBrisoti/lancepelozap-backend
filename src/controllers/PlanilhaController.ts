import { Request, Response } from 'express';
import { PlanilhaParserService } from '../services/PlanilhaParserService';
import { ok, fail } from '../lib/response';
import { asyncHandler } from "../lib/asyncHandler";
import fs from 'fs';

export class PlanilhaController {

  preview = asyncHandler(async (req: Request, res: Response) => {

    try {
      if (!req.file) return fail(res, 'Arquivo não fornecido', 400);

      const result = await PlanilhaParserService.preview(req.file.path, req.file.originalname);

      // Limpar arquivo temporário
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      return ok(res, result);
    } catch (error: any) {
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      return fail(res, '', 400);
    }
  }, "visualizar");

  import = asyncHandler(async (req: Request, res: Response) => {

    try {
      const storeId = req.user?.storeId;
      const userId = req.user?.id;

      if (!storeId) return fail(res, 'Loja não identificada', 401);
      if (!userId) return fail(res, 'Usuário não identificado', 401);
      if (!req.file) return fail(res, 'Arquivo não fornecido', 400);

      // 1. Parse
      const parseResult = await PlanilhaParserService.parse(req.file.path, req.file.originalname);

      if (!parseResult.success || !parseResult.data) {
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return fail(res, 'Erro ao processar planilha', 400, parseResult.errors);
      }

      // 2. Salvar no banco com checkpoint
      const result = await PlanilhaParserService.saveToDatabase(storeId, parseResult.data, userId);

      // 3. Limpar
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);

      return ok(res, {
        imported: result.imported,
        warnings: [...parseResult.warnings, ...result.warnings],
        errors: parseResult.errors,
        preview: parseResult.preview.map(p => ({
          name: p.name,
          type: p.detectedType,
          rows: p.rowCount,
        })),
      });
    } catch (error: any) {
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return fail(res, '', 400);
    }
  }, "importar");
}
