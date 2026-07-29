import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Spring } from "./spring.ts";
import {
  DRAIN_SPEED_FACTOR,
  FILL_DURATION_MS,
  FILL_END_EASE,
  FINISH_DURATION_MS,
  HOLD_SCALE,
  PRESS_SPRING,
  QUICK_TAP_MS,
  RING_CIRCUMFERENCE,
  RING_RADIUS,
  SETTLE_KICK_VELOCITY,
  SETTLE_SPRING,
  SLIP_FORGIVENESS,
  UNDO_WINDOW_MS,
} from "./constants.ts";
import styles from "./Signet.module.css";

export type SignetMode = "hold" | "undo";

type Phase = "idle" | "holding" | "draining" | "undoing" | "confirmed";
type Icon = "ring" | "check" | "none";

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

export interface SignetLabels {
  /** Resting label in undo mode, where a single press commits. */
  action: string;
  /** Resting label in hold mode, which should name the gesture. */
  hold: string;
  /** Terminal label once the action is committed. */
  confirmed: string;
  /**
   * Label shown while the undo window is open.
   * @default "Undo"
   */
  undo?: string;
}

interface SignetProps {
  labels: SignetLabels;
  mode?: SignetMode;
  onConfirm?: () => void;
  /**
   * How long the button must be held before the action commits, in ms.
   * @default 1100
   */
  holdDuration?: number;
  /**
   * How long a committed action stays undoable in undo mode, in ms.
   * @default 5000
   */
  undoWindow?: number;
  /**
   * Progress between 0 and 1 past which releasing still commits, so a finger
   * that slips near the end reads as intent rather than a cancel.
   * @default 0.92
   */
  slipForgiveness?: number;
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

function Signet({
  labels,
  mode: modeOverride,
  onConfirm,
  holdDuration = FILL_DURATION_MS,
  undoWindow = UNDO_WINDOW_MS,
  slipForgiveness = SLIP_FORGIVENESS,
}: SignetProps) {
  const mode = usePointerMode(modeOverride);
  const [phase, setPhase] = useState<Phase>("idle");
  const [showHint, setShowHint] = useState(false);
  const [flash, setFlash] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;
  const configRef = useRef({ holdDuration, undoWindow, slipForgiveness });
  configRef.current = { holdDuration, undoWindow, slipForgiveness };
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

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

  const commitConfirm = useCallback((now: number) => {
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
    setPhase("confirmed");
    setShowHint(false);
    setFlash(true);
    navigator.vibrate?.(30);
    onConfirmRef.current?.();
  }, []);

  const tick = useCallback(
    (now: number) => {
      const a = anim.current!;
      const config = configRef.current;
      const dt = now - a.last;
      a.last = now;
      let active = false;

      if (a.filling) {
        a.progress = Math.min(1, a.progress + dt / config.holdDuration);
        if (a.progress >= 1) {
          commitConfirm(now);
        } else {
          active = true;
        }
      } else if (a.draining) {
        a.progress = Math.max(
          0,
          a.progress - (dt / config.holdDuration) * DRAIN_SPEED_FACTOR,
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
        if (elapsed >= config.undoWindow) {
          commitConfirm(now);
        } else {
          if (ringRef.current) {
            ringRef.current.style.strokeDashoffset = String(
              RING_CIRCUMFERENCE * (elapsed / config.undoWindow),
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

      const eased = easeFill(a.progress);
      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${eased})`;
      }
      if (buttonRef.current) {
        buttonRef.current.style.transform = `scale(${a.scale.value})`;
        // Published for consumers building their own fill. Kept on the button
        // rather than the wrapper: a variable recalculates every descendant,
        // and the button has the fewest.
        buttonRef.current.style.setProperty("--signet-progress", String(eased));
      }

      a.raf = active ? requestAnimationFrame(tick) : 0;
    },
    [commitConfirm],
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
    if (a.progress >= configRef.current.slipForgiveness) {
      commitConfirm(now);
      return;
    }
    a.draining = true;
    setPhase("draining");
    if (now - a.holdStart < QUICK_TAP_MS) {
      setShowHint(true);
    }
    ensureRunning();
  }, [commitConfirm, ensureRunning]);

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

  useEffect(() => {
    if (phaseRef.current === "confirmed") return;
    const a = anim.current!;
    a.filling = false;
    a.draining = false;
    a.undoStart = 0;
    a.progress = 0;
    a.scale.snap(1);
    setPhase("idle");
    setShowHint(false);
    ensureRunning();
  }, [mode, ensureRunning]);

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
    if (phase === "confirmed") return labels.confirmed;
    if (phase === "undoing") return labels.undo ?? "Undo";
    return mode === "hold" ? labels.hold : labels.action;
  })();

  const status = (() => {
    if (phase === "confirmed") return `${labels.confirmed}.`;
    if (phase === "undoing")
      return `${labels.confirmed}. Press again within ${Math.round(undoWindow / 1000)} seconds to undo.`;
    return "";
  })();

  const icon: Icon =
    phase === "undoing" ? "ring" : phase === "confirmed" ? "check" : "none";

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
    <div className={styles.signet} data-signet="" data-mode={mode}>
      <button
        ref={buttonRef}
        type="button"
        data-signet-button=""
        data-phase={phase}
        data-mode={mode}
        className={[styles.button, flash ? styles.flash : ""].join(" ")}
        disabled={phase === "confirmed"}
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
        <div
          ref={fillRef}
          data-signet-fill=""
          className={styles.fill}
          aria-hidden="true"
        />
        <span className={styles.label}>
          <span
            key={label}
            className={[
              styles.labelIn,
              phase === "confirmed" ? styles.slowSwap : "",
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
            {phase === "confirmed" && (
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
                phase === "confirmed" ? styles.slowSwap : "",
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
        Press and hold to confirm
      </p>
      <p className={styles.status} role="status">
        {status}
      </p>
    </div>
  );
}

export default Signet;
