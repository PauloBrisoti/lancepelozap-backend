import { Router } from "express";
import { ProductController } from "../controllers/ProductController";
import { requireAuth } from "../middleware/auth";
import { requireWorkspaceType } from '../middleware/requireWorkspaceType';
import { requireStorePermission } from "../middleware/requireStorePermission";
import { requirePlanFeature } from "../middleware/requirePlanFeature";
import { autoAudit } from "../middleware/autoAudit";
import { validate } from "../lib/validation";
import { productSchema } from "../lib/validation";

const productRouter = Router();
const productController = new ProductController();

productRouter.use(requireAuth);
productRouter.use(requireWorkspaceType('PJ'));
productRouter.use(autoAudit());

productRouter.get("/", productController.list);
productRouter.get("/by-ean/:ean", productController.findByEan);
productRouter.post("/",
  requireStorePermission('gerenciar_produtos'),
  requirePlanFeature('estoque'),
  validate(productSchema),
  productController.create
);
productRouter.put("/:id",
  requireStorePermission('gerenciar_produtos'),
  requirePlanFeature('estoque'),
  productController.update
);
productRouter.delete("/:id",
  requireStorePermission('gerenciar_produtos'),
  requirePlanFeature('estoque'),
  productController.delete
);

export { productRouter };
