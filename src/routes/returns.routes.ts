import { Router } from "express";
import { ReturnsController } from "../controllers/ReturnsController";
import { requireAuth } from "../middleware/auth";
import { requireStorePermission } from "../middleware/requireStorePermission";
import { autoAudit } from "../middleware/autoAudit";

const returnsRouter = Router();
const controller = new ReturnsController();

returnsRouter.use(requireAuth);
returnsRouter.use(autoAudit());

returnsRouter.get("/", controller.list);
returnsRouter.get("/:id", controller.getById);
returnsRouter.post("/",
  requireStorePermission("vender"),
  controller.create
);
returnsRouter.post("/:id/approve",
  requireStorePermission("gerenciar_estoque"),
  controller.approve
);
returnsRouter.post("/:id/reject",
  requireStorePermission("gerenciar_estoque"),
  controller.reject
);
returnsRouter.post("/:id/complete",
  requireStorePermission("gerenciar_estoque"),
  controller.complete
);

export { returnsRouter };
