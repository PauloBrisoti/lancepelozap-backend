import { Router } from "express";
import { DashboardV2Controller } from "../controllers/DashboardV2Controller";
import { requireAuth } from "../middleware/auth";

const router = Router();

router.get("/dashboard/tenant", requireAuth, DashboardV2Controller.getTenantDashboard);
router.get("/dashboard/pj", requireAuth, DashboardV2Controller.getPjMetrics);

export default router;
