import { useState, type FormEvent } from "react";

const GITHUB_URL = "https://github.com/ericgitangu";

function App(): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState(false);

  /**
   * Client-side stub only — no data submission backend exists yet for the
   * marketing site waitlist (see docs/adr). This intentionally does not
   * call any API; it's a UX placeholder until a real capture mechanism
   * (e.g. a hosted form or a dedicated endpoint) is chosen.
   */
  function handleWaitlistSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setJoined(true);
  }

  return (
    <>
      <section className="hero container">
        <h1>fact_checker_ke</h1>
        <p>
          Submit a link or a claim from Kenyan social media. Get a transcript, extracted
          claims, retrieval against known sources, and a draft verdict — always reviewed
          by a human before anything is published.
        </p>
        <a className="cta" href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
          View the code on GitHub
        </a>
      </section>

      <section className="steps container">
        <h2>How it works</h2>
        <div className="step">
          <span className="n">1</span>
          <p>Submit a URL (video, post, article) or paste the text of a claim.</p>
        </div>
        <div className="step">
          <span className="n">2</span>
          <p>We transcribe and normalize the content, then extract checkable claims.</p>
        </div>
        <div className="step">
          <span className="n">3</span>
          <p>
            Retrieval-augmented generation drafts a verdict against credible sources —
            labelled clearly as AI-assisted, not final.
          </p>
        </div>
        <div className="step">
          <span className="n">4</span>
          <p>A human reviewer approves (or corrects) the verdict before it is published.</p>
        </div>
        <p>
          Read the full <a href="/methodology">methodology</a>.
        </p>
      </section>

      <section className="waitlist-section container">
        <h2>Join the waitlist</h2>
        <form className="waitlist" onSubmit={handleWaitlistSubmit}>
          <input
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={joined}
          />
          <button type="submit" disabled={joined}>
            {joined ? "You're on the list" : "Join"}
          </button>
        </form>
      </section>

      <footer className="container">
        <p>
          fact_checker_ke — an independent, open-source fact-checking project for Kenya.{" "}
          <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
        </p>
      </footer>
    </>
  );
}

export default App;
