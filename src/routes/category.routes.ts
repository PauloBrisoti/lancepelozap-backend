import { Router } from "express";
import { CategoryController } from "../controllers/CategoryController";
import { requireAuth } from "../middleware/auth";
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requireStorePermission } from "../middleware/requireStorePermission";
import { autoAudit } from "../middleware/autoAudit";
import { validate } from "../lib/validation";
import { categorySchema } from "../lib/validation";

const categoryRouter = Router();
const categoryController = new CategoryController();

categoryRouter.use(requireAuth);
categoryRouter.use(requireWorkspaceType('PJ'));
categoryRouter.use(autoAudit());

categoryRouter.get("/", categoryController.list);
categoryRouter.post("/", requireStorePermission('gerenciar_produtos'), validate(categorySchema), categoryController.create);
categoryRouter.put("/:id", requireStorePermission('gerenciar_produtos'), validate(categorySchema.partial()), categoryController.update);
categoryRouter.delete("/:id", requireStorePermission('gerenciar_produtos'), categoryController.delete);

export { categoryRouter };
