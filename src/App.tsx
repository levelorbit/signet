import { useEffect, useRef, useState } from "react";
import Signet, { type SignetMode } from "./components/Signet/Signet.tsx";
import { Spring } from "./components/Signet/spring.ts";
import styles from "./App.module.css";

const MODES = [
  { value: "auto", label: "Auto" },
  { value: "hold", label: "Hold" },
  { value: "undo", label: "Undo" },
] as const;

const ORDER = [
  { name: "Wax seal kit", price: 24 },
  { name: "Shipping", price: 3.5 },
];

const TOTAL = ORDER.reduce((sum, line) => sum + line.price, 0);

function formatUSD(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type ModeChoice = (typeof MODES)[number]["value"];

const THUMB_SPRING = { stiffness: 380, damping: 34 };

function useThumbSpring(index: number) {
  const thumbRef = useRef<HTMLSpanElement>(null);
  const springRef = useRef<Spring | null>(null);
  if (springRef.current === null) {
    springRef.current = new Spring(index, THUMB_SPRING);
  }

  useEffect(() => {
    const spring = springRef.current!;
    const thumb = thumbRef.current;
    if (!thumb) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      spring.snap(index);
      thumb.style.transform = `translate3d(${index * 100}%, 0, 0)`;
      return;
    }

    spring.target = index;
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const moving = spring.step(now - last);
      last = now;
      // Stretch along the travel axis so the thumb reads as one moving piece.
      const stretch = 1 + Math.min(Math.abs(spring.velocity) * 0.008, 0.12);
      thumb.style.transform = `translate3d(${spring.value * 100}%, 0, 0) scaleX(${stretch})`;
      if (moving) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [index]);

  return thumbRef;
}

function App() {
  const [modeChoice, setModeChoice] = useState<ModeChoice>("auto");
  const [resetKey, setResetKey] = useState(0);
  const [paid, setPaid] = useState(false);
  const selectedIndex = MODES.findIndex((mode) => mode.value === modeChoice);
  const thumbRef = useThumbSpring(selectedIndex);

  const mode: SignetMode | undefined = modeChoice === "auto" ? undefined : modeChoice;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Signet</h1>
        <p className={styles.tagline}>
          A hold-to-confirm component, adapted to handle mobile and desktop.
        </p>
      </header>

      <section className={styles.card} aria-label="Checkout demo">
        <div className={styles.lines}>
          {ORDER.map(({ name, price }) => (
            <div key={name} className={styles.item}>
              <div>{name}</div>
              <div className={styles.itemPrice}>{formatUSD(price)}</div>
            </div>
          ))}
          <div className={styles.total}>
            <div>Total</div>
            <div className={styles.totalPrice}>{formatUSD(TOTAL)}</div>
          </div>
        </div>
        <div className={styles.payment}>
          <svg
            className={styles.cardIcon}
            viewBox="0 0 28 18"
            width="28"
            height="18"
            aria-hidden="true"
          >
            <rect x="0.5" y="0.5" width="27" height="17" rx="3" />
            <circle cx="11" cy="9" r="4.5" />
            <circle cx="17" cy="9" r="4.5" />
          </svg>
          <span>Mastercard ···· 4242</span>
          <span className={styles.paymentSaved}>Saved</span>
        </div>
        <Signet key={resetKey} amount={formatUSD(TOTAL)} mode={mode} onPaid={() => setPaid(true)} />
      </section>

      <div className={styles.controls}>
        <fieldset className={styles.modes}>
          <legend className={styles.modesLegend}>Pointer mode</legend>
          <div className={styles.switcher}>
            <span ref={thumbRef} className={styles.thumb} aria-hidden="true" />
            {MODES.map(({ value, label }) => (
              <label key={value} className={styles.modeOption}>
                <input
                  className={styles.modeInput}
                  type="radio"
                  name="mode"
                  value={value}
                  checked={modeChoice === value}
                  onChange={() => setModeChoice(value)}
                />
                <span className={styles.modeLabel}>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button
          type="button"
          className={styles.reset}
          disabled={!paid}
          onClick={() => {
            setResetKey((key) => key + 1);
            setPaid(false);
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
          <svg className={styles.githubIcon} width="18" height="18" aria-hidden="true">
            <use href="/icons.svg#github-icon" />
          </svg>
          Open on GitHub
        </a>
      </div>
    </main>
  );
}

export default App;
