import { Router } from "express";
import { BrandController } from "../controllers/BrandController";
import { requireAuth } from "../middleware/auth";
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requireStorePermission } from "../middleware/requireStorePermission";
import { autoAudit } from "../middleware/autoAudit";

const brandRouter = Router();
const brandController = new BrandController();

brandRouter.use(requireAuth);
brandRouter.use(requireWorkspaceType('PJ'));
brandRouter.use(autoAudit());

brandRouter.get("/", brandController.list);
brandRouter.post("/", requireStorePermission('gerenciar_produtos'), brandController.create);
brandRouter.put("/:id", requireStorePermission('gerenciar_produtos'), brandController.update);
brandRouter.delete("/:id", requireStorePermission('gerenciar_produtos'), brandController.delete);

export { brandRouter };
