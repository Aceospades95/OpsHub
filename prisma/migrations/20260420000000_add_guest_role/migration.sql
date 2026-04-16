-- Add GUEST role as the default for new Google SSO users. Guests can only
-- see the Intranet + Team modules and nothing else; managers/admins must
-- assign them to projects before broader content becomes visible.
ALTER TYPE "Role" ADD VALUE 'GUEST';
