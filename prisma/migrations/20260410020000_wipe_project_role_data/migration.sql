-- Wipe test data from ProjectRole and RoleDefinition tables
-- (Keeps the schema intact, just clears the user-added test rows)

-- First null out the FK references from Assignment
UPDATE "Assignment" SET "projectRoleId" = NULL WHERE "projectRoleId" IS NOT NULL;
UPDATE "Assignment" SET "roleDefinitionId" = NULL WHERE "roleDefinitionId" IS NOT NULL;

-- Then clear the tables
DELETE FROM "ProjectRole";
DELETE FROM "RoleDefinition";
