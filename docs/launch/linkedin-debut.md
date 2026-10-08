# LinkedIn debut — fact_checker_ke

**Purpose.** LinkedIn caps a post at ~3,000 characters and a comment at ~1,250, so the launch narrative is split: one tight hook **post**, then a **threaded series of follow-up comments** (post them yourself, in order, as replies to your own post) that walk through the whole project scope. Each block is within limit and carries its own hashtags.

**How to use.** Publish the main post. Immediately add the follow-up comments as a self-reply thread (LinkedIn surfaces early self-comments and it keeps the long-form scope out of the truncated post body). Tagging note: LinkedIn only turns an `@mention` into a real tag when you pick the company from its live dropdown while typing — the `@Name` tokens below are a checklist, not literal text to paste.

**Accuracy guardrails (do not drift from these when editing).** The product rates *claims, not people*; it makes **no IFCN-signatory claim** and is not an accredited fact-checker — do not imply otherwise. No accuracy percentages are claimed (none are benchmarked yet). "Live" means the public feed is serving. Vendors named below are genuinely in the stack.

---

## MAIN POST

> In Kenya, a claim can reach a million phones before any newsroom has finished reading it. A screenshot, a doctored clip, a "forwarded as received" voice note — by the time it's checked, it has already done its work.
>
> So I built something that doesn't wait.
>
> **fact_checker_ke** is an autonomous AI fact-checker for Kenyan claims. It surfaces what's going viral on its own, weighs each claim against grounded evidence, and publishes an assessment — working across English, Swahili and Sheng.
>
> Two rules it won't break:
>
> → **No bare verdicts.** Every assessment carries a confidence score and its actual cited sources. If the evidence isn't there, it says "unproven" or "awaiting sources" — it does not force a true/false.
>
> → **It rates claims, not people.** The output judges a statement, never a character, and anyone named gets a right of reply.
>
> It's autonomy-first, not human-free: the hard calls — legal risk, a named person, contested sources — escalate to human review. Built serverless, scale-to-zero, on Google Cloud's Johannesburg region, and open-source.
>
> It's live. Bring it your loudest claim and watch it get checked:
> 🔗 https://fact-checker-ke-web.vercel.app
>
> Built with @Anthropic Claude and @Google Cloud (Gemini grounding), on @Vercel, @Neon, @Upstash. More on how it works in the thread 👇
>
> #FactChecking #Misinformation #Kenya #AI #CivicTech #MediaLiteracy #Disinformation #AfricaTech #TrustAndSafety #Maandamano

---

## FOLLOW-UP COMMENTS (post as a self-reply thread, in order)

### Comment 1 — How it finds claims (two engines)

Most fact-checkers wait to be asked. This one has two ways in:

🔎 **A fetch engine** that watches what's actually trending in Kenya — YouTube's own "most popular KE" chart and a fact-check news triage feed — and pulls the check-worthy claims autonomously.

✍️ **A submission engine** — paste a link or text and it goes straight into the same pipeline. Even a bare video URL works: it reads the lawful public title + description to find the claim (never a pirated transcript).

Both land on one event-driven pipeline, so a claim you submit is handled exactly like one the engine found itself.

#CivicTech #AI #Kenya #FactChecking #OpenSource

### Comment 2 — How it checks (grounded, not guessed)

The pipeline is three stages, each doing one job:

🧠 **Analyze** — detect the language (EN/SW/Sheng), translate to a working language, and pull out the actual checkable claim (not the opinion or the rhetoric around it).

🔬 **Verify** — retrieve evidence, corroborate with Google-grounded search, and run a *relevance-and-recency guard*: a source only counts if it's genuinely about THIS claim and current — no borrowing an old article about a similar story to fake a verdict.

⚖️ **Publish-policy** — a risk-tiered gate. The higher the stakes (a named person, legal exposure), the more corroboration and confidence it demands before it publishes anything.

#AI #Misinformation #TrustAndSafety #MachineLearning #Kenya

### Comment 3 — It speaks Kenyan

Kenyan misinformation isn't in textbook English. It's in Swahili, in Sheng, in code-switched WhatsApp voice notes. A checker that only reads English misses most of it.

fact_checker_ke identifies and works across **English, Swahili and Sheng** from the first stage — and there's a dedicated **maandamano (protest) advisory tracker** for the moments when accurate, calm information matters most: area, status, and sources, not rumour.

#Swahili #Sheng #Kenya #CivicTech #Maandamano #MediaLiteracy

### Comment 4 — The ethics are the product, not the footnote

This is a defamation and abuse target by design, so the guardrails are load-bearing:

• It rates **claims, not people** — and anyone named in a claim has a **right of reply**.
• Every published assessment ships an **evidence file** (cited sources, retrieved documents) — built for Kenya's **Data Protection Act 2019**.
• It makes **no IFCN-signatory claim** — it's a tool that complements the real fact-checking ecosystem (@PesaCheck, @AfricaCheck, AFP Fact Check), not a replacement for it.
• The production prompts, credibility weights and abuse thresholds stay private; the interfaces are open.

#DataProtection #TrustAndSafety #Ethics #Kenya #FactChecking

### Comment 5 — Built lean on purpose (the engineering)

Zero always-on infrastructure. Everything scales to zero and only costs money while it's working:

• Next.js PWA on @Vercel; two services (Fastify + FastAPI) on @Google Cloud Run, Johannesburg region (closest to Nairobi).
• @Neon serverless Postgres, @Upstash Redis + QStash, all Terraform-managed.
• Per-engine **daily spend breakers** on every AI call, and a device quota + rate limits on intake — so an abuse spike is bounded to a known dollar figure, not a surprise bill.

A credible public service that a solo build can actually afford to keep running.

#Serverless #GoogleCloud #Vercel #Terraform #CloudEngineering #CostOptimization

### Comment 6 — It gets smarter when you push back

See a verdict you can improve? Add a source. A reader-submitted link **re-grounds** the claim and can move the assessment forward — a crowdsourcing flywheel where the community strengthens the evidence base, with the guardrails holding throughout.

This is day one. The roadmap: a native share-sheet mobile client, deeper synthetic-media/deepfake triage, and a wider KE source allow-list.

If you work in media, civic tech, elections integrity or trust & safety in the region — I'd love your eyes on it.

🔗 https://fact-checker-ke-web.vercel.app

#CivicTech #Elections #AfricaTech #Kenya #OpenSource #AI

---

## Tagging cheat-sheet (select from LinkedIn's dropdown while typing)

**Definitely tag (genuinely in the stack / mission):**
- Anthropic — Claude (analyze + verify draft models)
- Google Cloud / Google — Gemini grounding, Cloud Run, Speech-to-Text, Fact Check Tools, Google News
- Vercel — web PWA + BFF
- Neon — serverless Postgres
- Upstash — Redis + QStash

**Tag respectfully as ecosystem peers (mention, do not imply partnership/endorsement):**
- PesaCheck, Africa Check, AFP Fact Check, Code for Africa, Meedan

**Hashtag bank (mix ~8–10 per post/comment, don't dump all):**
`#FactChecking #Misinformation #Disinformation #Kenya #AI #CivicTech #MediaLiteracy #TrustAndSafety #Maandamano #Elections #AfricaTech #OpenSource #Serverless #GoogleCloud #Vercel #DataProtection #Swahili #Sheng #MachineLearning #CloudEngineering`

---

## Engagement tracking (measure what the post drives)

GA-4 is being wired into the web app (consent-gated via the existing EEA/UK banner; see `apps/web`). Once the Measurement ID is set (`NEXT_PUBLIC_GA_MEASUREMENT_ID` in Vercel env), track for the debut week:
- **Acquisition**: sessions + source/medium (LinkedIn referral spike on launch day).
- **Activation**: `submit_claim` events (did visitors actually try it?) and feed engagement.
- **Retention**: returning visitors across the showcase week — the signal for the post-week cost-tuning decision (how far to cut spend vs. keep it responsive).

Note: `gcloud` cannot provision GA-4 (Analytics is not a gcloud-managed product); the property is created in the Analytics console (or via Claude in Chrome) and only the Measurement ID is wired into the app.
