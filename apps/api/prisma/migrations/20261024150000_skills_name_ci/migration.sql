-- Skill names are unique per organisation regardless of case ("Bar" and "bar" clash).
-- SQL-only (expression index, not expressible in Prisma); future migrations must not drop it.
CREATE UNIQUE INDEX "skills_organization_id_lower_name_key" ON "skills" ("organization_id", lower("name"));
