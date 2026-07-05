import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Spring, type SpringConfig } from "./spring.ts";
import styles from "./Signet.module.css";

export type SignetMode = "hold" | "undo";

type Phase = "idle" | "holding" | "draining" | "undoing" | "paid";
type Icon = "ring" | "check" | "none";

const FILL_DURATION_MS = 1100;
const FINISH_DURATION_MS = 450;
// Draining slower than a snap keeps release feeling like backing out, not failure.
const DRAIN_SPEED_FACTOR = 2.6;
// A release this close to the end is intent with a slipped finger, so it counts.
const SLIP_FORGIVENESS = 0.92;
const QUICK_TAP_MS = 200;
const UNDO_WINDOW_MS = 5000;
const HOLD_SCALE = 0.96;
// Ease-out exponent: the last stretch of the fill decelerates so it feels earned.
const FILL_END_EASE = 1.4;

const PRESS_SPRING: SpringConfig = { stiffness: 420, damping: 34 };
const SETTLE_SPRING: SpringConfig = { stiffness: 300, damping: 26 };
const SETTLE_KICK_VELOCITY = 1.5;

const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function easeFill(progress: number): number {
  return 1 - Math.pow(1 - progress, FILL_END_EASE);
}

function usePointerMode(override?: SignetMode): SignetMode {
  const [coarse, setCoarse] = useState(
    () => window.matchMedia("(pointer: coarse)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const onChange = (event: MediaQueryListEvent) => setCoarse(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return override ?? (coarse ? "hold" : "undo");
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface SignetProps {
  amount: string;
  mode?: SignetMode;
  onPaid?: () => void;
}

interface AnimState {
  raf: number;
  last: number;
  progress: number;
  filling: boolean;
  draining: boolean;
  holdStart: number;
  undoStart: number;
  finishStart: number;
  finishFrom: number;
  scale: Spring;
}

function Signet({ amount, mode: modeOverride, onPaid }: SignetProps) {
  const mode = usePointerMode(modeOverride);
  const [phase, setPhase] = useState<Phase>("idle");
  const [showHint, setShowHint] = useState(false);
  const [flash, setFlash] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  const anim = useRef<AnimState>(null);
  if (anim.current === null) {
    anim.current = {
      raf: 0,
      last: 0,
      progress: 0,
      filling: false,
      draining: false,
      holdStart: 0,
      undoStart: 0,
      finishStart: 0,
      finishFrom: 0,
      scale: new Spring(1, PRESS_SPRING),
    };
  }

  const commitPaid = useCallback((now: number) => {
    const a = anim.current!;
    a.filling = false;
    a.draining = false;
    a.undoStart = 0;
    if (a.progress > 0 && a.progress < 1) {
      a.finishFrom = a.progress;
      a.finishStart = now;
    }
    a.scale.config = PRESS_SPRING;
    a.scale.target = 1;
    setPhase("paid");
    setShowHint(false);
    setFlash(true);
    navigator.vibrate?.(30);
    onPaidRef.current?.();
  }, []);

  const tick = useCallback(
    (now: number) => {
      const a = anim.current!;
      const dt = now - a.last;
      a.last = now;
      let active = false;

      if (a.filling) {
        a.progress = Math.min(1, a.progress + dt / FILL_DURATION_MS);
        if (a.progress >= 1) {
          commitPaid(now);
        } else {
          active = true;
        }
      } else if (a.draining) {
        a.progress = Math.max(
          0,
          a.progress - (dt / FILL_DURATION_MS) * DRAIN_SPEED_FACTOR,
        );
        if (a.progress <= 0) {
          a.draining = false;
          setPhase("idle");
        } else {
          active = true;
        }
      }

      if (a.undoStart > 0) {
        const elapsed = now - a.undoStart;
        if (elapsed >= UNDO_WINDOW_MS) {
          commitPaid(now);
        } else {
          if (ringRef.current) {
            ringRef.current.style.strokeDashoffset = String(
              RING_CIRCUMFERENCE * (elapsed / UNDO_WINDOW_MS),
            );
          }
          active = true;
        }
      }

      if (a.finishStart > 0) {
        const elapsed = now - a.finishStart;
        if (elapsed >= FINISH_DURATION_MS) {
          a.progress = 1;
          a.finishStart = 0;
        } else {
          a.progress =
            a.finishFrom + (1 - a.finishFrom) * (elapsed / FINISH_DURATION_MS);
          active = true;
        }
      }

      if (a.scale.step(dt)) {
        active = true;
      }

      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${easeFill(a.progress)})`;
      }
      if (buttonRef.current) {
        buttonRef.current.style.transform = `scale(${a.scale.value})`;
      }

      a.raf = active ? requestAnimationFrame(tick) : 0;
    },
    [commitPaid],
  );

  const ensureRunning = useCallback(() => {
    const a = anim.current!;
    if (a.raf === 0) {
      a.last = performance.now();
      a.raf = requestAnimationFrame(tick);
    }
  }, [tick]);

  useEffect(() => {
    return () => {
      const a = anim.current!;
      if (a.raf !== 0) {
        cancelAnimationFrame(a.raf);
        a.raf = 0;
      }
    };
  }, []);

  const startHold = useCallback(() => {
    const a = anim.current!;
    if (a.filling || (phase !== "idle" && phase !== "draining")) return;
    a.filling = true;
    a.draining = false;
    a.holdStart = performance.now();
    a.scale.config = PRESS_SPRING;
    a.scale.target = prefersReducedMotion() ? 1 : HOLD_SCALE;
    setPhase("holding");
    setShowHint(false);
    ensureRunning();
  }, [phase, ensureRunning]);

  const releaseHold = useCallback(() => {
    const a = anim.current!;
    if (!a.filling) return;
    a.filling = false;
    a.scale.config = PRESS_SPRING;
    a.scale.target = 1;
    const now = performance.now();
    if (a.progress >= SLIP_FORGIVENESS) {
      commitPaid(now);
      return;
    }
    a.draining = true;
    setPhase("draining");
    if (now - a.holdStart < QUICK_TAP_MS) {
      setShowHint(true);
    }
    ensureRunning();
  }, [commitPaid, ensureRunning]);

  const startUndoWindow = useCallback(() => {
    const a = anim.current!;
    a.filling = false;
    a.draining = false;
    a.progress = 0;
    a.scale.target = 1;
    a.undoStart = performance.now();
    if (ringRef.current) {
      ringRef.current.style.strokeDashoffset = "0";
    }
    setPhase("undoing");
    setShowHint(false);
    ensureRunning();
  }, [ensureRunning]);

  const undo = useCallback(() => {
    const a = anim.current!;
    if (a.undoStart === 0) return;
    a.undoStart = 0;
    a.scale.config = SETTLE_SPRING;
    a.scale.target = 1;
    if (!prefersReducedMotion()) {
      a.scale.velocity = -SETTLE_KICK_VELOCITY;
    }
    setPhase("idle");
    ensureRunning();
  }, [ensureRunning]);

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (mode !== "hold" || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    startHold();
  };

  const onPointerUp = () => {
    if (mode !== "hold") return;
    releaseHold();
  };

  const onClick = () => {
    if (mode !== "undo") return;
    if (phase === "idle") {
      startUndoWindow();
    } else if (phase === "undoing") {
      undo();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (mode !== "hold") return;
    if (event.key === " ") {
      event.preventDefault();
      if (!event.repeat) startHold();
    } else if (event.key === "Enter" && phase === "idle") {
      // Sustained pressure is hard for some motor-impaired users:
      // Enter falls back to the single-press undo flow instead.
      event.preventDefault();
      startUndoWindow();
    }
  };

  const onKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (mode === "hold" && event.key === " ") {
      event.preventDefault();
      releaseHold();
    }
  };

  const label = (() => {
    if (phase === "paid") return "Paid";
    if (phase === "undoing") return "Undo";
    if (mode === "hold") return `Hold to pay ${amount}`;
    return `Pay ${amount}`;
  })();

  const status = (() => {
    if (phase === "paid") return "Payment complete.";
    if (phase === "undoing")
      return "Payment sent. Press again within five seconds to undo.";
    return "";
  })();

  const icon: Icon =
    phase === "undoing" ? "ring" : phase === "paid" ? "check" : "none";

  const [swap, setSwap] = useState({
    label,
    icon,
    ghost: null as { label: string; icon: Icon } | null,
    ghostKey: 0,
  });
  if (swap.label !== label) {
    setSwap({
      label,
      icon,
      ghost: { label: swap.label, icon: swap.icon },
      ghostKey: swap.ghostKey + 1,
    });
  }

  return (
    <div className={styles.signet}>
      <button
        ref={buttonRef}
        type="button"
        className={[
          styles.button,
          phase === "paid" ? styles.paid : "",
          flash ? styles.flash : "",
        ].join(" ")}
        disabled={phase === "paid"}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={(event) => event.preventDefault()}
        onAnimationEnd={(event) => {
          if (event.target === event.currentTarget) setFlash(false);
        }}
      >
        <div ref={fillRef} className={styles.fill} aria-hidden="true" />
        <span className={styles.label}>
          <span
            key={label}
            className={[
              styles.labelIn,
              phase === "paid" ? styles.slowSwap : "",
            ].join(" ")}
          >
            {phase === "undoing" && (
              <svg
                className={styles.ring}
                viewBox="0 0 20 20"
                width="18"
                height="18"
                aria-hidden="true"
              >
                <circle
                  className={styles.ringTrack}
                  cx="10"
                  cy="10"
                  r={RING_RADIUS}
                />
                <circle
                  ref={ringRef}
                  className={styles.ringArc}
                  cx="10"
                  cy="10"
                  r={RING_RADIUS}
                  strokeDasharray={RING_CIRCUMFERENCE}
                  strokeDashoffset="0"
                />
              </svg>
            )}
            {phase === "paid" && (
              <svg
                className={styles.check}
                viewBox="0 0 20 20"
                width="18"
                height="18"
                aria-hidden="true"
              >
                <path d="M4 10.5 8.5 15 16 6" />
              </svg>
            )}
            {label}
          </span>
          {swap.ghost !== null && (
            <span
              key={swap.ghostKey}
              className={[
                styles.labelOut,
                phase === "paid" ? styles.slowSwap : "",
              ].join(" ")}
              aria-hidden="true"
              onAnimationEnd={() =>
                setSwap((current) => ({ ...current, ghost: null }))
              }
            >
              {swap.ghost.icon === "ring" && (
                <svg
                  className={styles.ring}
                  viewBox="0 0 20 20"
                  width="18"
                  height="18"
                  aria-hidden="true"
                >
                  <circle
                    className={styles.ringTrack}
                    cx="10"
                    cy="10"
                    r={RING_RADIUS}
                  />
                  <circle
                    className={styles.ringArc}
                    cx="10"
                    cy="10"
                    r={RING_RADIUS}
                    strokeDasharray={RING_CIRCUMFERENCE}
                    strokeDashoffset={RING_CIRCUMFERENCE}
                  />
                </svg>
              )}
              {swap.ghost.icon === "check" && (
                <svg
                  className={styles.check}
                  viewBox="0 0 20 20"
                  width="18"
                  height="18"
                  aria-hidden="true"
                >
                  <path d="M4 10.5 8.5 15 16 6" />
                </svg>
              )}
              {swap.ghost.label}
            </span>
          )}
        </span>
      </button>
      <p
        className={styles.hint}
        data-visible={showHint || undefined}
        aria-hidden={!showHint}
      >
        Press and hold to pay
      </p>
      <p className={styles.status} role="status">
        {status}
      </p>
    </div>
  );
}

export default Signet;
