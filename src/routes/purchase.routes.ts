import { Router } from "express";
import { PurchaseOrderController } from "../controllers/PurchaseOrderController";
import { requireAuth } from "../middleware/auth";
import { requireStorePermission } from "../middleware/requireStorePermission";
import { autoAudit } from "../middleware/autoAudit";

const purchaseRouter = Router();
const controller = new PurchaseOrderController();

purchaseRouter.use(requireAuth);
purchaseRouter.use(autoAudit());

purchaseRouter.get("/", controller.list);
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
purchaseRouter.delete("/:id",
  requireStorePermission("gerenciar_compras"),
  controller.delete
);

export { purchaseRouter };
