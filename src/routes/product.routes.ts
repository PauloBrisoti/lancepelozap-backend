import { Router } from "express";
import { ProductController } from "../controllers/ProductController";
import { requireAuth } from "../middleware/auth";
import { requireStorePermission } from "../middleware/requireStorePermission";
import { requirePlanFeature } from "../middleware/requirePlanFeature";
import { autoAudit } from "../middleware/autoAudit";
import { validate } from "../lib/validation";
import { productSchema } from "../lib/validation";

const productRouter = Router();
const productController = new ProductController();

productRouter.use(requireAuth);
productRouter.use(autoAudit());

productRouter.get("/", productController.list);
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
