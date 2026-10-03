-- Single tenant row exists today; org_id columns default to it so existing
-- rows don't need backfilling when a second tenant is added (ADR-0009).
insert into organizations (id, name)
values ('00000000-0000-0000-0000-000000000001', 'fact_checker_ke')
on conflict (id) do nothing;
