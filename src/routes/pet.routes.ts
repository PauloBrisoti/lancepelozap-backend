import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { requireStorePermission } from "../middleware/requireStorePermission";
import {
  listTutors, createTutor, updateTutor, deleteTutor,
  listPets, createPet, updatePet, deletePet, adoptPet,
  listPetVaccines, createPetVaccine, updatePetVaccine, deletePetVaccine,
  listPetWeights, createPetWeight, deletePetWeight,
  listServiceCatalog, createCatalogItem, updateCatalogItem, deleteCatalogItem,
  listServiceOrders, createServiceOrder, updateServiceOrderStatus, updateServiceOrder, deleteServiceOrder, remindServiceOrder,
} from "../controllers/PetOperacionalController";

const router = Router();

router.use(requireAuth);

// Tutors
router.get("/tutors", listTutors);
router.post("/tutors", requireStorePermission('gerenciar_clientes'), createTutor);
router.put("/tutors/:id", requireStorePermission('gerenciar_clientes'), updateTutor);
router.delete("/tutors/:id", requireStorePermission('gerenciar_clientes'), deleteTutor);

// Pets
router.get("/pets", listPets);
router.post("/pets", requireStorePermission('gerenciar_clientes'), createPet);
router.put("/pets/:id", requireStorePermission('gerenciar_clientes'), updatePet);
router.delete("/pets/:id", requireStorePermission('gerenciar_clientes'), deletePet);
router.post("/pets/:id/adotar", requireStorePermission('gerenciar_clientes'), adoptPet);

// Vacinas & vermífugos
router.get("/vaccines", listPetVaccines);
router.post("/vaccines", requireStorePermission('gerenciar_clientes'), createPetVaccine);
router.put("/vaccines/:id", requireStorePermission('gerenciar_clientes'), updatePetVaccine);
router.delete("/vaccines/:id", requireStorePermission('gerenciar_clientes'), deletePetVaccine);

// Evolução de peso
router.get("/weights", listPetWeights);
router.post("/weights", requireStorePermission('gerenciar_clientes'), createPetWeight);
router.delete("/weights/:id", requireStorePermission('gerenciar_clientes'), deletePetWeight);

// Service Catalog
router.get("/service-catalog", listServiceCatalog);
router.post("/service-catalog", requireStorePermission('gerenciar_clientes'), createCatalogItem);
router.put("/service-catalog/:id", requireStorePermission('gerenciar_clientes'), updateCatalogItem);
router.delete("/service-catalog/:id", requireStorePermission('gerenciar_clientes'), deleteCatalogItem);

// Service Orders
router.get("/service-orders", listServiceOrders);
router.post("/service-orders", requireStorePermission('gerenciar_clientes'), createServiceOrder);
router.patch("/service-orders/:id/status", requireStorePermission('gerenciar_clientes'), updateServiceOrderStatus);
router.put("/service-orders/:id", requireStorePermission('gerenciar_clientes'), updateServiceOrder);
router.delete("/service-orders/:id", requireStorePermission('gerenciar_clientes'), deleteServiceOrder);
router.post("/service-orders/:id/lembrar",
  requireStorePermission('gerenciar_clientes'),
  remindServiceOrder);

export default router;
