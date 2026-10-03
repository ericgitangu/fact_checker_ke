import { createTranslator } from "next-intl";
import { messages, type Locale } from "@fact-checker-ke/i18n";

/**
 * Real-catalog stand-in for `next-intl/server`, used only in tests.
 *
 * `getTranslations`/`getLocale`/`getMessages` from `next-intl/server`
 * resolve the active locale via request-scoped config that Next's server
 * runtime wires up per-request (see apps/web/i18n/request.ts) — there is
 * no HTTP request in a vitest/jsdom process, so that plumbing has nothing
 * to read from. This mock replaces ONLY that request-scoping glue, not
 * the translations themselves: `createTranslator` is next-intl's own
 * (non-server) translation engine, and `messages` is imported straight
 * from `@fact-checker-ke/i18n` — the exact same catalog `apps/web` ships.
 * So every string an a11y test sees is the real, shipped copy; only the
 * "how do we know which locale this request is" mechanism is swapped for
 * an explicit one, because that mechanism is Next.js server
 * infrastructure, not component or translation logic.
 */
export function createNextIntlServerMock(locale: Locale = "en") {
  const localeMessages = messages[locale];
  return {
    getTranslations: async (
      namespaceOrOpts?: string | { namespace?: string },
    ) => {
      const namespace =
        typeof namespaceOrOpts === "string" ? namespaceOrOpts : namespaceOrOpts?.namespace;
      // `createTranslator`'s `namespace` is typed against a literal union
      // of every real dotted-path key in the catalog (`NamespaceKeys<...>`)
      // so that normal, non-test call sites get compile-time checking of
      // namespace strings. Here the namespace is whatever string the
      // REAL component passed to `getTranslations(...)` at runtime (e.g.
      // "check", "submit.upload") -- next-intl itself only validates that
      // dynamically, by walking the message object, not via this type. A
      // test-only mock calling a real namespace string through this
      // runtime-checked path is safe; the cast only bypasses the extra
      // compile-time literal-union check next-intl adds for normal code.
      return createTranslator({
        locale,
        messages: localeMessages,
        // See the comment above: bypasses next-intl's compile-time
        // literal-union namespace check only, not its runtime lookup.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        namespace: namespace as any,
      });
    },
    getLocale: async () => locale,
    getMessages: async () => localeMessages,
    getNow: async () => new Date(),
    getTimeZone: async () => "Africa/Nairobi",
  };
}
