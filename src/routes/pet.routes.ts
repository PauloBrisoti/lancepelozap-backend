import { Router } from "express";
import { requireAuth } from "../middleware/auth";
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
router.post("/tutors", createTutor);
router.put("/tutors/:id", updateTutor);
router.delete("/tutors/:id", deleteTutor);

// Pets
router.get("/pets", listPets);
router.post("/pets", createPet);
router.put("/pets/:id", updatePet);
router.delete("/pets/:id", deletePet);
router.post("/pets/:id/adotar", adoptPet);

// Vacinas & vermífugos
router.get("/vaccines", listPetVaccines);
router.post("/vaccines", createPetVaccine);
router.put("/vaccines/:id", updatePetVaccine);
router.delete("/vaccines/:id", deletePetVaccine);

// Evolução de peso
router.get("/weights", listPetWeights);
router.post("/weights", createPetWeight);
router.delete("/weights/:id", deletePetWeight);

// Service Catalog
router.get("/service-catalog", listServiceCatalog);
router.post("/service-catalog", createCatalogItem);
router.put("/service-catalog/:id", updateCatalogItem);
router.delete("/service-catalog/:id", deleteCatalogItem);

// Service Orders
router.get("/service-orders", listServiceOrders);
router.post("/service-orders", createServiceOrder);
router.patch("/service-orders/:id/status", updateServiceOrderStatus);
router.put("/service-orders/:id", updateServiceOrder);
router.delete("/service-orders/:id", deleteServiceOrder);
router.post("/service-orders/:id/lembrar", remindServiceOrder);

export default router;
