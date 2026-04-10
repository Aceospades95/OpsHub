-- DropForeignKey
ALTER TABLE "Assignment" DROP CONSTRAINT IF EXISTS "Assignment_projectRoleId_fkey";
ALTER TABLE "Assignment" DROP CONSTRAINT IF EXISTS "Assignment_roleDefinitionId_fkey";
ALTER TABLE "ProjectRole" DROP CONSTRAINT IF EXISTS "ProjectRole_projectId_fkey";
ALTER TABLE "ProjectRole" DROP CONSTRAINT IF EXISTS "ProjectRole_roleDefinitionId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "Assignment_projectRoleId_idx";
DROP INDEX IF EXISTS "Assignment_roleDefinitionId_idx";

-- AlterTable: remove columns from Assignment
ALTER TABLE "Assignment" DROP COLUMN IF EXISTS "projectRoleId";
ALTER TABLE "Assignment" DROP COLUMN IF EXISTS "roleDefinitionId";

-- DropTable
DROP TABLE IF EXISTS "ProjectRole";
DROP TABLE IF EXISTS "RoleDefinition";
