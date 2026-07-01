import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireStorePermission } from "../middleware/requireStorePermission";
import { autoAudit } from "../middleware/autoAudit";
import { validate } from "../lib/validation";
import { customerSchema } from "../lib/validation";
import {
  createCustomer,
  deleteCustomer,
  generatePortalToken,
  listCustomers,
  updateCustomer
} from "../controllers/CustomerController";

export const customerRouter = Router();

customerRouter.use(requireAuth);
customerRouter.use(autoAudit());

customerRouter.get("/", listCustomers);
customerRouter.post("/", requireStorePermission('gerenciar_clientes'), validate(customerSchema), createCustomer);
customerRouter.put("/:id", requireStorePermission('gerenciar_clientes'), updateCustomer);
customerRouter.delete("/:id", requireStorePermission('gerenciar_clientes'), deleteCustomer);
customerRouter.post("/:id/portal-token", requireStorePermission('gerenciar_clientes'), generatePortalToken);
