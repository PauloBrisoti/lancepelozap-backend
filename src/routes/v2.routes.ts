import { Router } from "express";
import { DashboardV2Controller } from "../controllers/DashboardV2Controller";
import { requireAuth } from "../middleware/auth";
import { requireStorePermission } from "../middleware/requireStorePermission";

const router = Router();

router.get("/dashboard/tenant", requireAuth, requireStorePermission("ver_financeiro"), DashboardV2Controller.getTenantDashboard);
router.get("/dashboard/pj", requireAuth, requireStorePermission("ver_financeiro"), DashboardV2Controller.getPjMetrics);

export default router;
