-- ADR-0031 (two-engine pivot amendment) / ADR-0032 "safe-launch" seed.
--
-- WHY THIS MIGRATION EXISTS (docs/runbooks/go-live.md §0): the code's own
-- zero-value defaults are auto-publish ON and fetch-ingestion LIVE:
--   - services/pipeline/app/stages/publish_policy.py's PublishPolicyFlags()
--     defaults global_auto_publish_enabled = True.
--   - services/api/src/lib/publish-kill-switch.ts's isAutonomousPublishFrozen
--     returns false (not frozen) when no policy_flags row exists for key
--     'autonomous_publish_kill_switch'.
--   - services/api/src/lib/fetch-kill-switch.ts's isFetchEngineFrozen
--     likewise returns false (not frozen) for 'fetch_engine_kill_switch'.
-- Without this seed, a FRESH prod DB (no policy_flags rows yet) inherits
-- those defaults verbatim: the moment real keys + a deploy land, the
-- system starts autonomously fetching, verifying, and auto-publishing.
-- This migration makes the first-deploy posture SHADOW MODE instead --
-- both kill-switches FROZEN -- so enabling is a deliberate later action
-- (go-live.md §5), never an accidental side effect of adding a key.
--
-- IDEMPOTENCY / SAFETY ON THE EXISTING DEV DB (both required by the task
-- that added this migration):
--   - `on conflict (key) do nothing` on the policy_flags insert means this
--     NEVER overwrites a row that already exists -- on a dev DB where an
--     operator has already deliberately flipped either switch (frozen or
--     not), this migration changes nothing. It only fills the gap on a
--     DB that has never had the row at all.
--   - The system-actor upsert below uses `on conflict (email) do update
--     set email = excluded.email returning id`, a no-op write that still
--     returns a row on conflict, so re-running this file (outside the
--     normal "each migration applies exactly once" tracking, e.g. by hand
--     against a throwaway DB per the go-live runbook's own verification
--     step) never creates a duplicate user or errors.
--   - The audit_log insert is itself guarded by `where not exists (...)`
--     keyed on a `seed` marker in its metadata, so re-running this file
--     never duplicates the audit trail either.
--
-- WHY A SEED USER: policy_flags.updated_by is NOT NULL with a foreign key
-- to users.id (packages/db/src/schema.ts, ~line 813) -- every write,
-- including this one, must name a real actor. Unlike `organizations`
-- (0002_seed_default_org.sql's fixed-UUID tenant row), there is no
-- pre-existing seed/system user to reference, so this migration creates
-- one: a non-authenticatable system actor used ONLY as the audit actor
-- for this seed write.
--   - Its `password_hash` is deliberately NOT in the `scrypt:<salt>:<hash>`
--     format `verifyPassword` (services/api/src/lib/auth/password.ts)
--     expects (the function's `parts[0] !== "scrypt"` guard short-circuits
--     to `false` for ANY input before ever touching scryptSync) -- this
--     account can never authenticate, by construction, not by convention.
--   - `role` is left NULL -- no elevated grant, same "pending, ungranted"
--     state a freshly registered account starts in (services/api/src/lib/
--     auth/service.ts's register path).

-- statement-breakpoint
insert into users (id, email, password_hash, role, mfa_enabled)
values (
  '00000000-0000-0000-0000-0000000000f0',
  'system-seed@fact-checker-ke.internal',
  'seed-marker:not-a-scrypt-hash:no-login-possible',
  null,
  false
)
on conflict (email) do update set email = excluded.email
returning id;
--> statement-breakpoint

-- `enabled: true` means the kill switch is THROWN, i.e. FROZEN -- mirrors
-- the naming convention in publish-kill-switch.ts / fetch-kill-switch.ts
-- (and ADR-0007's pre-existing maandamano_kill_switch).
insert into policy_flags (key, value, updated_by)
select v.key, v.value::jsonb, u.id
from (
  values
    ('autonomous_publish_kill_switch', 'true'),
    ('fetch_engine_kill_switch', 'true')
) as v(key, value)
cross join (
  select id from users where email = 'system-seed@fact-checker-ke.internal'
) as u
on conflict (key) do nothing;
--> statement-breakpoint

-- Audit trail for the two rows above, matching the shape
-- services/api/src/lib/policy-audit.ts#updatePolicyFlag writes for every
-- other policy_flags mutation (same action name, same target_type/
-- target_id convention) -- a `seed` marker in metadata both documents
-- provenance and lets this statement guard against duplicate rows on a
-- manual re-run of this file.
insert into audit_log (actor_id, action, target_type, target_id, metadata)
select
  u.id,
  'policy.kill_switch_flipped',
  'policy_flag',
  k.key,
  jsonb_build_object(
    'key', k.key,
    'value', true,
    'advocateSignoffRef', null,
    'seed', '0014_safe_launch_shadow_mode_seed'
  )
from (values ('autonomous_publish_kill_switch'), ('fetch_engine_kill_switch')) as k(key)
cross join (
  select id from users where email = 'system-seed@fact-checker-ke.internal'
) as u
where not exists (
  select 1
  from audit_log
  where target_type = 'policy_flag'
    and target_id = k.key
    and metadata ->> 'seed' = '0014_safe_launch_shadow_mode_seed'
);
