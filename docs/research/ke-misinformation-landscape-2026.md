# KE political-misinformation & maandamano landscape (research, 2026-10-04)

Companion research grounding the autonomous fetch engine (ADR-0032) and the ingestion amendment (ADR-0002). Evidence legend: **[V]** verified by ≥2 independent results · **[U]** single/unconfirmed source · **[GAP]** not found, verify before building.

## 1. Where viral claims live
- **Legacy reach:** Citizen TV YouTube ~6M subs [V] — broadcast, not the speculative layer.
- **Political-commentary YouTube creators (the speculative/unverified layer):** Herman Manyora (UoN lecturer, widely clipped out of context) [V]; Alex Chamwada (finance-bill/legislative breakdowns, interviews MPs/activists) [V]; Cyprian Nyakundi — "Declassified" (whistleblower-style corruption claims, *historically a source of unverified/defamatory allegations*) [V]; Lynn Ngugi (personal-story format, ex-Tuko) [V]; "The Kenya We Want" (coalition channel amplifying street narratives) [V].
- **X (Twitter):** the #RutoMustGo / #RejectFinanceBill / #OccupyParliament / #OccupyStateHouse cluster (orig. 2024, recurs as a mobilization/attack frame) [V]. Activity is **bursty/event-driven**, not constant [V]. Specific recurring individual handles beyond pseudonymous accounts: **[GAP]** (do not hardcode handles without re-verifying they are live).
- **TikTok:** named "the leading disseminator of misinformation/disinformation in Kenya" ahead of 2027 polls [V]; AI deepfakes + coordinated campaigns e.g. **#TheLordOfViolence** (recasting June 2025 protests as orchestrated conspiracy) [V].
- **Cross-platform tactic (load-bearing):** the SAME old protest footage/photos re-captioned and recirculated across FB/IG/TikTok/X as "new" events [V].

## 2. Recurring false/contested narrative types
(a) **Recycled/misattributed old footage** — dominant pattern per PesaCheck/Africa Check [V]. (b) **Ethnic/regional framing** of a protest to delegitimize/fragment it [V]. (c) **Conflicting operational claims** (matatus/transport running? protest on/off?) driving commuter confusion [V]. (d) **Deepfakes** [V]. (e) **Coordinated conspiracy-framing** campaigns [V]. (f) Protest-turnout / police-casualty figures are structurally contested [V] but a specific 2026 debunk example was **[GAP]**.

## 3. Authoritative check-against sources
- **KNBS** — economic/demographic stats; used by PesaCheck [V]. Public API: **[GAP]** (verify at knbs.or.ke).
- **Parliament Hansard** — National Assembly `hansardna.parliament.go.ke` + Senate `hansardsn.parliament.go.ke`, full-text searchable [V] — "what was actually said/voted".
- **Judiciary** — `efiling.court.go.ke`, public Causelist Portal + Data Tracking Dashboard [V] — case-status verification.
- **IEBC** — official electoral authority [V]; public REST API **[GAP]** (verify at iebc.or.ke).
- **PesaCheck** (Code for Africa; East-Africa; publishes source data to **openAFRICA/CKAN** — reusable) [V]. **Africa Check** (continent-wide; documented 8-step method + rating scale) [V]. Both are the **fastest near-realtime debunk source** — poll as a **triage feed** (RSS likely; dedicated API **[GAP]**), not merely downstream validators.

## 4. Platform ingestion feasibility + ToS (the binding constraints)
- **YouTube Data API v3** — quota-based (10,000 units/day/project; `search.list` = 100 units → ~100 searches/day free). Most ToS-compliant/cheapest. **→ PRIMARY fetch source.** [V]
- **X/Twitter API v2** — free tier discontinued Feb 2026; now pay-per-use (~$0.005/read, cap 2M reads/mo); legacy Basic/Pro closed to new devs. **→ sampled + budgeted secondary, not a firehose.** [V]
- **TikTok Research API** — gated to academic/public-interest institutions in US/EEA/UK/CH; **commercial/for-profit orgs ineligible** → a Kenya-based commercial fact-checker almost certainly cannot qualify. **→ no autonomous discovery; embed-plus-metadata only when a clip surfaces elsewhere.** [V]
- **Compliance boundary:** official APIs first; downloading third-party video *audio* for STT crosses platform ToS and risks irreversible account bans — hard line (ADR-0002/0032).

## 5. Fact-check format references
- **Africa Check** — 8-step process (claim selection → evidence → archive/source checks → expert consult → evidenced write-up → internal review → publish/monitor); 6–7-point scale (correct…mostly-correct…unproven/exaggerated/misleading/incorrect); 3-person vote on disagreement; rates *statements of fact*, not opinion [V].
- **PesaCheck** — headline pattern `[VERDICT]: [claim], [why]` (e.g. "FALSE: These photos aren't of protests in Nairobi CBD on 21 April 2026"), verdict-first + reverse-image/source evidence [V].
- **CNN Facts First** — **NO formal letter/numeric rating scale** (earlier framing conflated it with PolitiFact). CNN uses narrative "the facts" annotations. **Do not model a rating scale on CNN.** [V correction]

## Sources
1. Reuters Institute — Kenya news creators/influencers 2025. 2. Eye Africa — Top Kenyan political-analysis YouTube channels. 3. SCIRP — Hashtag Activism: #RutoMustGo / #RejectFinanceBill. 4. X — @Jolenee7_ (single data point). 5. Nation Africa — Deepfakes/hashtags/hate, 2027 polls. 6. Business Daily — AI misinformation ahead of 2027. 7. PesaCheck — Nairobi CBD 21 Apr 2026 photos. 8. Africa Check — xenophobia-protest video. 9. The Star — protest transport fears. 10. Amnesty — social-media suppression of Gen-Z protests. 11. PesaCheck — Principles/funding. 12. Hansard NA/Senate. 13. Judiciary e-filing/causelist. 14. Code for Africa — openAFRICA. 15. Africa Check — How we rate claims. 16. getphyllo — YouTube API quota 2026. 17. postproxy — X API pricing 2026. 18. tokconnect — TikTok Research API eligibility.
