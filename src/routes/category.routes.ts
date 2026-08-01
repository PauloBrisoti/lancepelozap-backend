import { Router } from "express";
import { CategoryController } from "../controllers/CategoryController";
import { requireAuth } from "../middleware/auth";
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { autoAudit } from "../middleware/autoAudit";
import { validate } from "../lib/validation";
import { categorySchema } from "../lib/validation";

const categoryRouter = Router();
const categoryController = new CategoryController();

categoryRouter.use(requireAuth);
categoryRouter.use(requireWorkspaceType('PJ'));
categoryRouter.use(autoAudit());

categoryRouter.get("/", categoryController.list);
categoryRouter.post("/", validate(categorySchema), categoryController.create);
categoryRouter.put("/:id", validate(categorySchema.partial()), categoryController.update);
categoryRouter.delete("/:id", categoryController.delete);

export { categoryRouter };
