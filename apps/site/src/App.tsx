import { WaitlistForm } from "./waitlist-form";

const GITHUB_URL = "https://github.com/ericgitangu";

function App(): React.JSX.Element {
  const methodologyUrl = `${import.meta.env.VITE_WEB_URL}/methodology`;

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
          Read the full <a href={methodologyUrl}>methodology</a>.
        </p>
      </section>

      <section className="waitlist-section container">
        <h2>Join the waitlist</h2>
        <WaitlistForm />
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
