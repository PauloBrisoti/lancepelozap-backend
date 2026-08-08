import { Router } from "express";
import { PurchaseOrderController } from "../controllers/PurchaseOrderController";
import { requireAuth } from "../middleware/auth";
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requireStorePermission } from "../middleware/requireStorePermission";
import { autoAudit } from "../middleware/autoAudit";

const purchaseRouter = Router();
const controller = new PurchaseOrderController();

purchaseRouter.use(requireAuth);
purchaseRouter.use(requireWorkspaceType('PJ'));
purchaseRouter.use(autoAudit());

purchaseRouter.get("/", controller.list);
purchaseRouter.get("/credit-cards",
  requireStorePermission("gerenciar_compras"),
  controller.listCreditCards);
purchaseRouter.get("/cards/:id/invoices",
  requireStorePermission("gerenciar_compras"),
  controller.cardInvoices);
purchaseRouter.post("/cards/:id/invoice/pay",
  requireStorePermission("gerenciar_compras"),
  controller.payCardInvoice);
purchaseRouter.get("/:id", controller.getById);
purchaseRouter.post("/",
  requireStorePermission("gerenciar_compras"),
  controller.create
);
purchaseRouter.put("/:id",
  requireStorePermission("gerenciar_compras"),
  controller.update
);
purchaseRouter.patch("/:id/status",
  requireStorePermission("gerenciar_compras"),
  controller.updateStatus
);
purchaseRouter.post("/:id/receive",
  requireStorePermission("gerenciar_estoque"),
  controller.receive
);
purchaseRouter.post("/:id/revert",
  requireStorePermission("gerenciar_compras"),
  controller.revert
);
purchaseRouter.delete("/:id",
  requireStorePermission("gerenciar_compras"),
  controller.delete
);

export { purchaseRouter };
