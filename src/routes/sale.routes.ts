import { Router } from "express";
import { SaleController } from "../controllers/SaleController";
import { requireAuth } from "../middleware/auth";
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requireStorePermission } from "../middleware/requireStorePermission";
import { autoAudit } from "../middleware/autoAudit";
import { validate } from "../lib/validation";
import { saleSchema } from "../lib/validation";

const saleRouter = Router();
const saleController = new SaleController();

saleRouter.use(requireAuth);
saleRouter.use(requireWorkspaceType('PJ'));
saleRouter.use(autoAudit());

saleRouter.get("/", saleController.list);
saleRouter.get("/summary", saleController.summary);
saleRouter.post("/",
  requireStorePermission('vender', { maxDiscount: 100, maxValue: 5000 }),
  validate(saleSchema),
  saleController.create
);
saleRouter.put("/:id",
  requireStorePermission('vender'),
  saleController.update
);
saleRouter.put("/:id/cancel",
  requireStorePermission('cancelar_venda'),
  saleController.cancel
);
saleRouter.post("/:id/request-delete",
  requireStorePermission('cancelar_venda'),
  saleController.requestDelete
);
saleRouter.post("/:id/confirm-delete",
  requireStorePermission('cancelar_venda'),
  saleController.delete
);
saleRouter.delete("/:id",
  requireStorePermission('cancelar_venda'),
  saleController.delete
);

export { saleRouter };
