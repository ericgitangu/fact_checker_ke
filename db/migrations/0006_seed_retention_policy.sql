-- ADR-0021 retention table, seeded as data so the sweeper
-- (services/api/src/lib/retention.ts) reads periods from Postgres
-- instead of a hardcoded constant. `retention_days = NULL` = indefinite.
insert into retention_policy (data_class, retention_days, notes) values
  ('anonymous_submission_no_claim', 30, 'ADR-0021: anonymous submissions with no claim found, unpublished.'),
  ('named_person_draft', 90, 'ADR-0021: drafts naming a person, unpublished, until publish/reject whichever first.'),
  ('published_check', null, 'ADR-0021: published checks + evidence, indefinite (IFCN/defamation record).'),
  ('waitlist_signup', 730, 'ADR-0021: 24 months inactivity; self-serve unsubscribe also deletes immediately.'),
  ('upload', null, 'ADR-0021: 24h after analysis completes -- enforced by GCS lifecycle rule, not this sweeper (out of services/api scope).'),
  ('application_log', 30, 'ADR-0021: provider default retention (Cloud Run/Vercel), not swept here.'),
  ('tracker_route_log', 7, 'ADR-0021: /maandamano/* logs, IP redacted at ingest.'),
  ('audit_log', null, 'ADR-0021: indefinite, append-only accountability record.'),
  ('idempotency_key', 1, 'ADR-0017: 24h TTL, enforced by the existing outbox-drain sweeper cleanup, not this table.')
on conflict (data_class) do nothing;
