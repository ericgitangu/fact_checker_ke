import { useState } from "react";
import { WaitlistForm } from "./waitlist-form";
import { TypedClaim } from "./components/typed-claim";
import {
  Wordmark,
  ExternalLinkIcon,
  MoonIcon,
  ShieldCheckIcon,
  SunIcon,
  useTheme,
} from "@fact-checker-ke/brand";

const GITHUB_URL = "https://github.com/ericgitangu";
const SAMPLE_CLAIM = "“Unemployment in Kenya fell to 2% last year.”";

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
          <div className="hero-copy">
            <h1>
              Kenya&rsquo;s loudest claims,
              <br />
              checked against the evidence.
            </h1>
            <p className="hero-lede">
              fact_checker_ke verifies what creators, politicians, and viral posts
              claim &mdash; in English, Swahili, and Sheng. Every verdict cites its
              sources, and a person reviews it before it&rsquo;s published. We rate
              claims, not people.
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#waitlist">
                Join the waitlist
              </a>
              <a className="btn btn-ghost" href={methodologyUrl}>
                Read the methodology
              </a>
            </div>
          </div>

          <figure className="checkcard" aria-label="Sample fact-check">
            <figcaption className="checkcard-tag">Sample fact-check</figcaption>
            <p className="checkcard-claim">
              <TypedClaim text={SAMPLE_CLAIM} onDone={() => setClaimTyped(true)} />
            </p>
            <p className="checkcard-source-claim">viral on TikTok &mdash; 1.2M views</p>
            <div className="verdict verdict-misleading">
              <span className={`verdict-stamp${claimTyped ? " stamp-ready" : ""}`}>Misleading</span>
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
            <p className="checkcard-review">
              <ShieldCheckIcon size={15} />
              Reviewed by an editor before publishing
            </p>
          </figure>
        </section>

        <section className="scale" aria-labelledby="scale-h">
          <div className="scale-intro">
            <h2 id="scale-h">Six verdicts. No opinions.</h2>
            <p>
              Every claim lands on one of six ratings, each tied to what the evidence
              actually supports &mdash; never to who said it.
            </p>
          </div>
          <ul className="scale-list">
            <li className="v-true">
              <span className="dot" aria-hidden="true" />
              <strong>True</strong>
              <span>Backed by credible evidence, with no material caveat.</span>
            </li>
            <li className="v-mostly">
              <span className="dot" aria-hidden="true" />
              <strong>Mostly true</strong>
              <span>Accurate in the main, but missing context changes the picture.</span>
            </li>
            <li className="v-misleading">
              <span className="dot" aria-hidden="true" />
              <strong>Misleading</strong>
              <span>Technically sourced, but framed to imply something the data doesn&rsquo;t.</span>
            </li>
            <li className="v-false">
              <span className="dot" aria-hidden="true" />
              <strong>False</strong>
              <span>Contradicted by the credible evidence we can find.</span>
            </li>
            <li className="v-unproven">
              <span className="dot" aria-hidden="true" />
              <strong>Unproven</strong>
              <span>No reliable evidence either way, yet.</span>
            </li>
            <li className="v-nc">
              <span className="dot" aria-hidden="true" />
              <strong>Not checkable</strong>
              <span>An opinion, a prediction, or a matter of belief &mdash; not a fact.</span>
            </li>
          </ul>
        </section>

        <section className="pipeline" aria-labelledby="pipeline-h">
          <h2 id="pipeline-h">From a link to a verdict</h2>
          <ol className="pipeline-steps">
            <li>
              <span className="step-no" aria-hidden="true">1</span>
              <h3>Submit</h3>
              <p>Paste a link or a quote from X, TikTok, YouTube, or a news site.</p>
            </li>
            <li>
              <span className="step-no" aria-hidden="true">2</span>
              <h3>Extract</h3>
              <p>We pull out the checkable claims and translate them, keeping the original words.</p>
            </li>
            <li>
              <span className="step-no" aria-hidden="true">3</span>
              <h3>Ground</h3>
              <p>Each claim is matched against credible sources &mdash; KNBS, Kenya Law, the Hansard, newsrooms.</p>
            </li>
            <li>
              <span className="step-no" aria-hidden="true">4</span>
              <h3>Review</h3>
              <p>A person confirms the evidence and the verdict before anything is published.</p>
            </li>
          </ol>
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
              <strong>A person signs off.</strong> AI drafts the analysis; an editor
              approves it.
            </li>
            <li>
              <strong>Right of reply.</strong> Named people get a chance to respond before a
              hard verdict.
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
        </div>
      </footer>
    </>
  );
}

export default App;
