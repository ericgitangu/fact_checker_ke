import { useState } from "react";
import { WaitlistForm } from "./waitlist-form";
import { TypedClaim } from "./components/typed-claim";
import {
  Wordmark,
  ExternalLinkIcon,
  MoonIcon,
  ShieldCheckIcon,
  SunIcon,
  TwoEngineFlow,
  VerdictScale,
  ConfidenceGauge,
  Reveal,
  Stagger,
  useTheme,
} from "@fact-checker-ke/brand";
import { ADVOCATE_SIGNOFF_COMPLETE, STANDING_CAVEAT_SHORT } from "@fact-checker-ke/core";

const GITHUB_URL = "https://github.com/ericgitangu";
const SAMPLE_CLAIM = "“Unemployment in Kenya fell to 2% last year.”";
const SAMPLE_CONFIDENCE = 0.78;

/**
 * Marketing site. Design concept "On the record" (see index.css header):
 * the hero shows the product — a representative fact-check — rather than
 * describing it. Saturated colour appears only on verdicts; the Newsreader
 * serif is reserved for the human claim under examination.
 */
function App(): React.JSX.Element {
  const methodologyUrl = `${import.meta.env.VITE_WEB_URL}/methodology`;
  const [theme, toggleTheme] = useTheme();
  const [claimTyped, setClaimTyped] = useState(false);

  return (
    <>
      <header className="nav">
        <a className="wordmark" href="#top" aria-label="fact_checker_ke home">
          <Wordmark size="md" variant={theme} />
        </a>
        <nav className="nav-links" aria-label="Primary">
          <a href={methodologyUrl}>
            Methodology
            <ExternalLinkIcon className="link-icon" />
          </a>
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            GitHub
            <ExternalLinkIcon className="link-icon" />
          </a>
          <a className="nav-join" href="#waitlist">
            Join the waitlist
          </a>
          <button
            type="button"
            role="switch"
            aria-checked={theme === "dark"}
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <SunIcon size={17} /> : <MoonIcon size={17} />}
          </button>
        </nav>
      </header>

      <main id="top">
        <section className="hero">
          <Stagger className="hero-copy" motion="rise" step={0.09} threshold={0.01}>
            <h1>
              Kenya&rsquo;s loudest claims,
              <br />
              checked against the evidence.
            </h1>
            <p className="hero-lede">
              fact_checker_ke checks claims we spot trending and claims you submit
              &mdash; in English, Swahili, and Sheng. AI weighs each one against the
              evidence and cites every source; a shrinking sample is audited by a
              person after publishing. We rate claims, not people.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#waitlist">
                Join the waitlist
              </a>
              <a className="btn btn-ghost" href={methodologyUrl}>
                Read the methodology
              </a>
            </div>
          </Stagger>

          <Reveal className="hero-card-reveal" motion="press" delay={0.25} threshold={0.01}>
          <figure className="checkcard" aria-label="Sample fact-check">
            <figcaption className="checkcard-tag">Sample fact-check</figcaption>
            <p className="checkcard-claim">
              <TypedClaim text={SAMPLE_CLAIM} onDone={() => setClaimTyped(true)} />
            </p>
            <p className="checkcard-source-claim">viral on TikTok &mdash; 1.2M views</p>
            <div className="verdict verdict-misleading">
              <span className={`verdict-stamp${claimTyped ? " stamp-ready" : ""}`}>Misleading</span>
              <ConfidenceGauge
                value={SAMPLE_CONFIDENCE}
                label="Confidence"
                variant={theme}
                size="sm"
                className="checkcard-gauge"
              />
            </div>
            <p className="checkcard-rationale">
              KNBS puts the 2024 unemployment rate near 5.6%. The 2% figure
              counts only the strictest definition and drops discouraged workers who have
              stopped looking.
            </p>
            <dl className="checkcard-meta">
              <div>
                <dt>Sources</dt>
                <dd>knbs.or.ke, worldbank.org</dd>
              </div>
              <div>
                <dt>Checked in</dt>
                <dd>
                  <span className="lang-chip">English</span>
                  <span className="lang-chip">Swahili</span>
                </dd>
              </div>
            </dl>
            <p className="checkcard-caveat">
              <ShieldCheckIcon size={15} />
              {STANDING_CAVEAT_SHORT.heading} We rate claims, not people &mdash; this is an
              AI assessment, for research purposes; you decide.
            </p>
          </figure>
          </Reveal>
        </section>

        <section className="scale" aria-labelledby="scale-h">
          <Reveal className="scale-intro" motion="rise">
            <h2 id="scale-h">Six verdicts. No opinions.</h2>
            <p>
              Every claim lands on one of six ratings, each tied to what the evidence
              actually supports &mdash; never to who said it.
            </p>
          </Reveal>
          <VerdictScale variant={theme} ariaLabel="The six-verdict rating scale" />
        </section>

        <section className="pipeline" aria-labelledby="pipeline-h">
          <h2 id="pipeline-h">Two engines, one pipeline</h2>
          <p className="pipeline-lede">
            Most claims we check, we go looking for &mdash; the rest, you bring to us.
            Either way, the same pipeline checks it.
          </p>
          <TwoEngineFlow variant={theme} />
        </section>

        <section className="street" aria-labelledby="street-h">
          <div className="street-inner">
            <h2 id="street-h">When the streets move, the rumours move faster.</h2>
            <p>
              During maandamano, fact_checker_ke tracks confirmed advisories at the ward
              level &mdash; road closures, safety notices, and the claims going viral about
              them. We show what&rsquo;s happening and where, never who is where.
            </p>
            <p className="street-note">
              Protester safety comes before engagement. Locations stay coarse, and anything
              that could put people at risk is held or dropped.
            </p>
          </div>
        </section>

        <section className="principles" aria-labelledby="principles-h">
          <h2 id="principles-h">How we keep it honest</h2>
          <ul className="principles-list">
            <li>
              <strong>Independent and open-source.</strong> The code is public, and the
              funding will be too.
            </li>
            <li>
              <strong>We cite everything.</strong> No verdict ships without the sources it
              rests on.
            </li>
            <li>
              <strong>People audit the AI.</strong> A shrinking sample of published
              assessments is reviewed and corrected after the fact &mdash; not gated
              before every claim goes out.
            </li>
            <li>
              <strong>Right of reply.</strong> Named people get a correction path and a
              chance to respond; a claim-level flag is never read as an indictment of a
              person.
            </li>
          </ul>
          <a className="principles-link" href={methodologyUrl}>
            Read the full methodology
          </a>
        </section>

        <section id="waitlist" className="waitlist-section" aria-labelledby="waitlist-h">
          <h2 id="waitlist-h">Be there when it launches.</h2>
          <p>
            We&rsquo;re building in the open. Leave your email and we&rsquo;ll tell you the
            day it goes live &mdash; no other mail.
          </p>
          <WaitlistForm />
        </section>
      </main>

      <footer className="site-footer">
        <p className="footer-lead">
          <Wordmark size="sm" variant={theme} showText={false} decorative className="footer-mark" />
          fact_checker_ke &mdash; an independent, open-source fact-checking project for Kenya.
        </p>
        <div className="footer-meta">
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <span>English, Swahili &amp; Sheng</span>
          <span>Built in Nairobi</span>
          {/* ADR-0033 AT-0033-2 deploy gate: /terms and /privacy exist as
              direct-link routes (see main.tsx) but stay OUT of the footer
              until ADVOCATE_SIGNOFF_COMPLETE flips true — draft legal text
              is not something we publicly surface pre-advocate-signoff. */}
          {ADVOCATE_SIGNOFF_COMPLETE && (
            <>
              <a href="/terms">Terms</a>
              <a href="/privacy">Privacy</a>
            </>
          )}
        </div>
      </footer>
    </>
  );
}

export default App;
