import { Router } from "express";
import { QuoteController } from "../controllers/QuoteController";
import { requireAuth } from "../middleware/auth";
import { requireStorePermission } from "../middleware/requireStorePermission";
import { autoAudit } from "../middleware/autoAudit";

const quoteRouter = Router();
const quoteController = new QuoteController();

quoteRouter.use(requireAuth);
quoteRouter.use(autoAudit());

quoteRouter.get("/", quoteController.list);
quoteRouter.get("/:id", quoteController.getById);
quoteRouter.post("/",
  requireStorePermission("gerenciar_orcamentos"),
  quoteController.create
);
quoteRouter.put("/:id",
  requireStorePermission("gerenciar_orcamentos"),
  quoteController.update
);
quoteRouter.patch("/:id/status",
  requireStorePermission("gerenciar_orcamentos"),
  quoteController.updateStatus
);
quoteRouter.delete("/:id",
  requireStorePermission("gerenciar_orcamentos"),
  quoteController.delete
);
quoteRouter.post("/:id/convert",
  requireStorePermission("vender"),
  quoteController.convertToSale
);

export { quoteRouter };
