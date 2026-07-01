-- AlterTable
ALTER TABLE "users" ADD COLUMN     "internal_role_id" TEXT;

-- CreateTable
CREATE TABLE "internal_roles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_role_permissions" (
    "id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "access_level" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "internal_role_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "internal_roles_name_key" ON "internal_roles"("name");

-- CreateIndex
CREATE UNIQUE INDEX "internal_role_permissions_role_id_module_key" ON "internal_role_permissions"("role_id", "module");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_internal_role_id_fkey" FOREIGN KEY ("internal_role_id") REFERENCES "internal_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_role_permissions" ADD CONSTRAINT "internal_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "internal_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
