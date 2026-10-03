// ADR-0013: Conventional Commits, enforced locally via lefthook's
// commit-msg hook (`pnpm exec commitlint --edit`).
module.exports = {
  extends: ['@commitlint/config-conventional'],
};
