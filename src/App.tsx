import { useState } from "react";
import Signet, { type SignetMode } from "./components/Signet/Signet.tsx";
import styles from "./App.module.css";

const MODES = [
  { value: "auto", label: "Auto" },
  { value: "hold", label: "Hold" },
  { value: "undo", label: "Undo" },
] as const;

const REPOSITORY = "levelorbit/signet";

const CONSEQUENCES = [
  "48 issues and 12 pull requests",
  "3 deploy keys and 2 webhooks",
  "the entire commit history",
];

type ModeChoice = (typeof MODES)[number]["value"];

function App() {
  const [modeChoice, setModeChoice] = useState<ModeChoice>("auto");
  const [resetKey, setResetKey] = useState(0);
  const [deleted, setDeleted] = useState(false);

  const mode: SignetMode | undefined =
    modeChoice === "auto" ? undefined : modeChoice;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Signet</h1>
        <p className={styles.tagline}>
          A hold-to-confirm component for destructive actions, adapted to mobile
          and desktop.
        </p>
      </header>

      <section className={styles.card} aria-labelledby="danger-heading">
        <div className={styles.cardHeader}>
          <span className={styles.dangerBadge}>Danger zone</span>
          <h2 id="danger-heading" className={styles.cardTitle}>
            Delete this repository
          </h2>
          <p className={styles.repository}>{REPOSITORY}</p>
        </div>

        <div className={styles.consequences}>
          <p className={styles.consequencesIntro}>This permanently removes:</p>
          <ul className={styles.consequenceList}>
            {CONSEQUENCES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>

        <Signet
          key={resetKey}
          labels={{
            action: "Delete repository",
            hold: "Hold to delete",
            confirmed: "Deleted",
          }}
          mode={mode}
          onConfirm={() => setDeleted(true)}
        />
      </section>

      <div className={styles.controls}>
        <fieldset className={styles.modes}>
          <legend className={styles.modesLegend}>Pointer mode</legend>
          {MODES.map(({ value, label }) => (
            <label key={value} className={styles.modeOption}>
              <input
                type="radio"
                name="mode"
                value={value}
                checked={modeChoice === value}
                onChange={() => setModeChoice(value)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          className={styles.reset}
          disabled={!deleted}
          onClick={() => {
            setResetKey((key) => key + 1);
            setDeleted(false);
          }}
        >
          Reset demo
        </button>
      </div>

      <div className={styles.footer}>
        <a
          className={styles.githubLink}
          href="https://github.com/levelorbit/signet"
          target="_blank"
          rel="noreferrer"
        >
          <svg
            className={styles.githubIcon}
            width="18"
            height="18"
            aria-hidden="true"
          >
            <use href="/icons.svg#github-icon" />
          </svg>
          Open on GitHub
        </a>
      </div>
    </main>
  );
}

export default App;
