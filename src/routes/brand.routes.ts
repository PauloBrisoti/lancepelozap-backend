import { Router } from "express";
import { BrandController } from "../controllers/BrandController";
import { requireAuth } from "../middleware/auth";
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { autoAudit } from "../middleware/autoAudit";

const brandRouter = Router();
const brandController = new BrandController();

brandRouter.use(requireAuth);
brandRouter.use(requireWorkspaceType('PJ'));
brandRouter.use(autoAudit());

brandRouter.get("/", brandController.list);
brandRouter.post("/", brandController.create);
brandRouter.put("/:id", brandController.update);
brandRouter.delete("/:id", brandController.delete);

export { brandRouter };
