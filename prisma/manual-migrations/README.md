# Historical — do not run

These SQL files were applied by hand (`prisma db execute`) before FleetFlow adopted
Prisma Migrate on 2026-10-28. Their combined effect is captured in
`prisma/migrations/0_init`, which was marked as already applied on the existing
database. They are kept only as a record; several are not safe to re-run.

New schema changes go through `prisma/migrations/` — see the README.
