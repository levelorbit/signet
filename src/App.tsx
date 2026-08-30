import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from "react";
import Signet, { type SignetMode } from "./components/Signet/Signet.tsx";
import { Spring } from "./components/Signet/spring.ts";
import styles from "./App.module.css";

const MODES = [
  { value: "auto", label: "Auto" },
  { value: "hold", label: "Hold" },
  { value: "undo", label: "Undo" },
] as const;

const OUTCOMES = [
  { value: "ok", label: "Succeed" },
  { value: "fail", label: "Fail" },
] as const;

// Long enough for the processing sheen to read as a charge in flight.
const PAY_DELAY_MS = 900;

const ORDER = [
  { name: "Wax seal kit", price: 24 },
  { name: "Shipping", price: 3.5 },
];

const TOTAL = ORDER.reduce((sum, line) => sum + line.price, 0);

function formatUSD(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

type ModeChoice = (typeof MODES)[number]["value"];
type Outcome = (typeof OUTCOMES)[number]["value"];

const THUMB_SPRING = { stiffness: 380, damping: 34 };

function useThumbSpring(index: number, snapRef: RefObject<boolean>) {
  const thumbRef = useRef<HTMLSpanElement>(null);
  const springRef = useRef<Spring | null>(null);
  if (springRef.current === null) {
    springRef.current = new Spring(index, THUMB_SPRING);
  }

  useEffect(() => {
    const spring = springRef.current!;
    const thumb = thumbRef.current;
    if (!thumb) return;

    // Keyboard motion and reduced-motion both snap. Pointer-driven changes stretch.
    const snap = snapRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    snapRef.current = false;

    if (snap) {
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
  }, [index, snapRef]);

  return thumbRef;
}

function Segmented<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
}: {
  name: string;
  legend: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const selectedIndex = options.findIndex((option) => option.value === value);
  const snapRef = useRef(false);
  const thumbRef = useThumbSpring(selectedIndex, snapRef);

  const onThumbKeyDown = (event: KeyboardEvent<HTMLFieldSetElement>) => {
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowRight":
      case "ArrowUp":
      case "ArrowDown":
        snapRef.current = true;
    }
  };

  return (
    <fieldset className={styles.modes} onKeyDown={onThumbKeyDown}>
      <legend className={styles.modesLegend}>{legend}</legend>
      <div
        className={styles.switcher}
        style={{ "--switcher-cols": options.length } as CSSProperties}
      >
        <span ref={thumbRef} className={styles.thumb} aria-hidden="true" />
        {options.map(({ value: option, label }) => (
          <label key={option} className={styles.modeOption}>
            <input
              className={styles.modeInput}
              type="radio"
              name={name}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            <span className={styles.modeLabel}>{label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function App() {
  const [modeChoice, setModeChoice] = useState<ModeChoice>("auto");
  const [outcome, setOutcome] = useState<Outcome>("ok");
  const [resetKey, setResetKey] = useState(0);
  const [paid, setPaid] = useState(false);
  const [busy, setBusy] = useState(false);
  const payRef = useRef<HTMLButtonElement>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const outcomeRef = useRef(outcome);
  outcomeRef.current = outcome;

  const mode: SignetMode | undefined = modeChoice === "auto" ? undefined : modeChoice;

  const onPay = useCallback(() => {
    return new Promise<void>((resolve, reject) => {
      window.setTimeout(() => {
        if (outcomeRef.current === "ok") {
          setPaid(true);
          resolve();
        } else {
          reject(new Error("Payment failed"));
        }
      }, PAY_DELAY_MS);
    });
  }, []);

  useLayoutEffect(() => {
    if (paid) resetRef.current?.focus();
  }, [paid]);

  useLayoutEffect(() => {
    if (resetKey === 0) return;
    payRef.current?.focus();
  }, [resetKey]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Signet</h1>
        <p className={styles.tagline}>From click to receipt.</p>
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
        <Signet
          key={resetKey}
          ref={payRef}
          amount={formatUSD(TOTAL)}
          mode={mode}
          onPay={onPay}
          onBusyChange={setBusy}
        />
      </section>

      <div className={styles.controls}>
        <div className={styles.controlGroup}>
          <Segmented
            name="mode"
            legend="Pointer mode"
            value={modeChoice}
            options={MODES}
            onChange={setModeChoice}
          />
          <Segmented
            name="outcome"
            legend="Charge"
            value={outcome}
            options={OUTCOMES}
            onChange={setOutcome}
          />
        </div>
        <button
          ref={resetRef}
          type="button"
          className={styles.reset}
          disabled={!busy}
          onClick={() => {
            setResetKey((key) => key + 1);
            setPaid(false);
            setBusy(false);
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
