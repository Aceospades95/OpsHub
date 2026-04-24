-- Track the role a user held before being auto-promoted by a project assignment.
-- When the user loses all their assignments, their role can be reverted to this
-- value. Null for users who have never been auto-promoted.
ALTER TABLE "User" ADD COLUMN "promotedFromRole" "Role";
