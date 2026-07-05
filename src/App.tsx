import { useState } from "react";
import Signet, { type SignetMode } from "./components/Signet/Signet.tsx";
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

function App() {
  const [modeChoice, setModeChoice] = useState<ModeChoice>("auto");
  const [resetKey, setResetKey] = useState(0);
  const [paid, setPaid] = useState(false);

  const mode: SignetMode | undefined =
    modeChoice === "auto" ? undefined : modeChoice;

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
        <Signet
          key={resetKey}
          amount={formatUSD(TOTAL)}
          mode={mode}
          onPaid={() => setPaid(true)}
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
          disabled={!paid}
          onClick={() => {
            setResetKey((key) => key + 1);
            setPaid(false);
          }}
        >
          Reset demo
        </button>
      </div>

    </main>
  );
}

export default App;
