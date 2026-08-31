import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type Ref,
} from "react";
import { Spring, type SpringConfig } from "./spring.ts";
import styles from "./Signet.module.css";

export type SignetMode = "hold" | "undo";
export type SignetStatus = "idle" | "confirming" | "processing" | "paid" | "failed";

type Phase = "idle" | "holding" | "draining" | "undoing" | "processing" | "paid" | "failed";
type Icon = "ring" | "check" | "none";

function toStatus(phase: Phase): SignetStatus {
  switch (phase) {
    case "holding":
    case "draining":
    case "undoing":
      return "confirming";
    case "processing":
    case "paid":
    case "failed":
      return phase;
    default:
      return "idle";
  }
}

const FILL_DURATION_MS = 1100;
const FINISH_DURATION_MS = 200;
const PROCESSING_FILL_MS = 200;
const FAIL_DRAIN_MS = 200;
// Letting go is the system responding: snappy, not a reverse of the 1.1s hold.
const RELEASE_MS = 200;
// A release this close to the end is intent with a slipped finger, so it counts.
const SLIP_FORGIVENESS = 0.92;
const QUICK_TAP_MS = 200;
const DEFAULT_UNDO_WINDOW_MS = 3500;
const HOLD_SCALE = 0.96;

const SHAKE_DURATION_MS = 280;
const SHAKE_CYCLES = 7;
const SHAKE_AMPLITUDE = 7;
const SHAKE_DECAY = 4.2;

const PRESS_SPRING: SpringConfig = { stiffness: 420, damping: 34 };
const SETTLE_SPRING: SpringConfig = { stiffness: 300, damping: 26 };
const SETTLE_KICK_VELOCITY = 1.5;

const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

function usePointerMode(override?: SignetMode): SignetMode {
  const [coarse, setCoarse] = useState(() => window.matchMedia("(pointer: coarse)").matches);
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

function Glyph({
  icon,
  ringRef,
  ringOffset = "0",
}: {
  icon: Icon;
  ringRef?: Ref<SVGCircleElement>;
  ringOffset?: string;
}) {
  if (icon === "ring") {
    return (
      <svg className={styles.ring} viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <circle className={styles.ringTrack} cx="10" cy="10" r={RING_RADIUS} />
        <circle
          ref={ringRef}
          className={styles.ringArc}
          cx="10"
          cy="10"
          r={RING_RADIUS}
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={ringOffset}
        />
      </svg>
    );
  }
  if (icon === "check") {
    return (
      <svg className={styles.check} viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <path d="M4 10.5 8.5 15 16 6" />
      </svg>
    );
  }
  return null;
}

/** Label is phase-driven, and type is always "button" so a form cannot submit from a half-confirmed hold. */
export type SignetProps = {
  amount: string;
  mode?: SignetMode;
  /** Runs after confirmation. Resolve to pay, reject to fail and offer retry. */
  onPay: () => Promise<void>;
  undoWindowMs?: number;
  onStatusChange?: (status: SignetStatus) => void;
} & Omit<ComponentProps<"button">, "children" | "type">;

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
  finishDuration: number;
  shakeRemain: number;
  shakeX: number;
  scale: Spring;
}

function Signet({
  amount,
  mode: modeOverride,
  onPay,
  undoWindowMs = DEFAULT_UNDO_WINDOW_MS,
  onStatusChange,
  disabled,
  className,
  ref,
  onPointerDown: onPointerDownProp,
  onPointerUp: onPointerUpProp,
  onPointerCancel: onPointerCancelProp,
  onLostPointerCapture: onLostPointerCaptureProp,
  onClick: onClickProp,
  onKeyDown: onKeyDownProp,
  onKeyUp: onKeyUpProp,
  onContextMenu: onContextMenuProp,
  ...props
}: SignetProps) {
  const mode = usePointerMode(modeOverride);
  const [phase, setPhase] = useState<Phase>("idle");
  const [showHint, setShowHint] = useState(false);
  const [flash, setFlash] = useState(false);

  const buttonRef = useRef<HTMLButtonElement>(null);
  const setButtonRef = useCallback(
    (node: HTMLButtonElement | null) => {
      buttonRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  const fillRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const onPayRef = useRef(onPay);
  onPayRef.current = onPay;
  const undoWindowMsRef = useRef(undoWindowMs);
  undoWindowMsRef.current = undoWindowMs;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const payIdRef = useRef(0);

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
      finishDuration: FINISH_DURATION_MS,
      shakeRemain: 0,
      shakeX: 0,
      scale: new Spring(1, PRESS_SPRING),
    };
  }

  const ensureRunningRef = useRef<() => void>(() => {});

  const succeed = useCallback((now: number) => {
    const a = anim.current!;
    a.filling = false;
    a.draining = false;
    a.undoStart = 0;
    a.shakeRemain = 0;
    a.shakeX = 0;
    if (a.progress > 0 && a.progress < 1) {
      a.finishFrom = a.progress;
      a.finishStart = now;
      a.finishDuration = FINISH_DURATION_MS;
    } else {
      a.progress = 1;
    }
    a.scale.config = PRESS_SPRING;
    a.scale.target = 1;
    phaseRef.current = "paid";
    setPhase("paid");
    setShowHint(false);
    setFlash(true);
    navigator.vibrate?.(30);
    ensureRunningRef.current();
  }, []);

  const fail = useCallback(() => {
    const a = anim.current!;
    a.filling = false;
    a.draining = false;
    a.undoStart = 0;
    a.finishStart = 0;
    a.scale.config = PRESS_SPRING;
    a.scale.target = 1;
    if (!prefersReducedMotion()) {
      a.shakeRemain = SHAKE_DURATION_MS;
      a.shakeX = 0;
    }
    phaseRef.current = "failed";
    setPhase("failed");
    setShowHint(false);
    setFlash(false);
    ensureRunningRef.current();
  }, []);

  const startProcessing = useCallback(
    (now: number) => {
      const current = phaseRef.current;
      if (current === "processing" || current === "paid") return;

      const a = anim.current!;
      a.filling = false;
      a.draining = false;
      a.undoStart = 0;
      a.shakeRemain = 0;
      a.shakeX = 0;
      if (a.progress < 1) {
        a.finishFrom = a.progress;
        a.finishStart = now;
        a.finishDuration = PROCESSING_FILL_MS;
      }
      a.scale.config = PRESS_SPRING;
      a.scale.target = 1;
      phaseRef.current = "processing";
      setPhase("processing");
      setShowHint(false);
      setFlash(false);

      const id = ++payIdRef.current;
      void Promise.resolve()
        .then(() => onPayRef.current())
        .then(
          () => {
            if (payIdRef.current !== id) return;
            succeed(performance.now());
          },
          () => {
            if (payIdRef.current !== id) return;
            fail();
          },
        );
      ensureRunningRef.current();
    },
    [fail, succeed],
  );

  const tick = useCallback(
    (now: number) => {
      const a = anim.current!;
      const dt = now - a.last;
      a.last = now;
      let active = false;

      if (a.filling) {
        // Linear: this fill is a progress indicator, not a decorative ease.
        a.progress = Math.min(1, a.progress + dt / FILL_DURATION_MS);
        if (a.progress >= 1) {
          startProcessing(now);
        } else {
          active = true;
        }
      } else if (a.draining) {
        a.progress = Math.max(0, a.progress - dt / RELEASE_MS);
        if (a.progress <= 0) {
          a.draining = false;
          setPhase("idle");
        } else {
          active = true;
        }
      } else if (phaseRef.current === "failed" && a.finishStart === 0 && a.progress > 0) {
        a.progress = Math.max(0, a.progress - dt / FAIL_DRAIN_MS);
        if (a.progress > 0) active = true;
      }

      if (a.undoStart > 0) {
        const elapsed = now - a.undoStart;
        const windowMs = undoWindowMsRef.current;
        if (elapsed >= windowMs) {
          startProcessing(now);
        } else {
          a.progress = Math.max(0, 1 - elapsed / windowMs);
          if (ringRef.current) {
            ringRef.current.style.strokeDashoffset = String(
              RING_CIRCUMFERENCE * (elapsed / windowMs),
            );
          }
          active = true;
        }
      }

      if (a.finishStart > 0) {
        const elapsed = now - a.finishStart;
        if (elapsed >= a.finishDuration) {
          a.progress = 1;
          a.finishStart = 0;
        } else {
          const t = easeOut(elapsed / a.finishDuration);
          a.progress = a.finishFrom + (1 - a.finishFrom) * t;
          active = true;
        }
      }

      if (a.scale.step(dt)) {
        active = true;
      }

      if (a.shakeRemain > 0) {
        a.shakeRemain = Math.max(0, a.shakeRemain - dt);
        const t = 1 - a.shakeRemain / SHAKE_DURATION_MS;
        a.shakeX =
          Math.sin(t * Math.PI * SHAKE_CYCLES) * SHAKE_AMPLITUDE * Math.exp(-t * SHAKE_DECAY);
        if (a.shakeRemain === 0) a.shakeX = 0;
        active = true;
      }

      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${a.progress})`;
      }
      if (buttonRef.current) {
        buttonRef.current.style.transform = `translateX(${a.shakeX}px) scale(${a.scale.value})`;
      }

      a.raf = active ? requestAnimationFrame(tick) : 0;
    },
    [startProcessing],
  );

  const ensureRunning = useCallback(() => {
    const a = anim.current!;
    if (a.raf === 0) {
      a.last = performance.now();
      a.raf = requestAnimationFrame(tick);
    }
  }, [tick]);
  ensureRunningRef.current = ensureRunning;

  useEffect(() => {
    return () => {
      payIdRef.current += 1;
      const a = anim.current!;
      if (a.raf !== 0) {
        cancelAnimationFrame(a.raf);
        a.raf = 0;
      }
    };
  }, []);

  useEffect(() => {
    onStatusChange?.(toStatus(phase));
  }, [phase, onStatusChange]);

  const startHold = useCallback(() => {
    const a = anim.current!;
    if (a.filling || (phase !== "idle" && phase !== "draining")) return;
    a.filling = true;
    a.draining = false;
    a.holdStart = performance.now();
    setPhase("holding");
    setShowHint(false);
    ensureRunning();
  }, [phase, ensureRunning]);

  const releaseHold = useCallback(() => {
    const a = anim.current!;
    if (!a.filling) return;
    a.filling = false;
    const now = performance.now();
    if (a.progress >= SLIP_FORGIVENESS) {
      startProcessing(now);
      return;
    }
    a.draining = true;
    setPhase("draining");
    if (now - a.holdStart < QUICK_TAP_MS) {
      setShowHint(true);
    }
    ensureRunning();
  }, [ensureRunning, startProcessing]);

  const startUndoWindow = useCallback(() => {
    const a = anim.current!;
    a.filling = false;
    a.draining = false;
    // Start full so the window has a bar to drain, instead of blanking on tap.
    a.progress = 1;
    if (fillRef.current) fillRef.current.style.transform = "scaleX(1)";
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
    // Recede the remaining bar instead of popping it off.
    a.draining = true;
    a.scale.config = SETTLE_SPRING;
    a.scale.target = 1;
    if (!prefersReducedMotion()) {
      a.scale.velocity = -SETTLE_KICK_VELOCITY;
    }
    setPhase("draining");
    ensureRunning();
  }, [ensureRunning]);

  const retry = useCallback(() => {
    // Already confirmed once. Charge again without another hold or undo window.
    startProcessing(performance.now());
  }, [startProcessing]);

  useEffect(() => {
    const current = phaseRef.current;
    if (current === "paid" || current === "processing") return;
    payIdRef.current += 1;
    const a = anim.current!;
    a.filling = false;
    a.draining = false;
    a.undoStart = 0;
    a.progress = 0;
    a.shakeRemain = 0;
    a.shakeX = 0;
    a.scale.snap(1);
    setPhase("idle");
    setShowHint(false);
    ensureRunning();
  }, [mode, ensureRunning]);

  const locked = Boolean(disabled) || phase === "processing" || phase === "paid";

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerDownProp?.(event);
    if (event.defaultPrevented || locked || event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or already-released pointers can throw; the press should still run.
    }
    // Press scale is pointer-only. Keyboard Space still fills, without the dip.
    const a = anim.current!;
    a.scale.config = PRESS_SPRING;
    a.scale.target = prefersReducedMotion() ? 1 : HOLD_SCALE;
    ensureRunning();
    if (mode === "hold") startHold();
  };

  const endPress = () => {
    const a = anim.current!;
    a.scale.config = PRESS_SPRING;
    a.scale.target = 1;
    ensureRunning();
    if (mode === "hold") releaseHold();
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerUpProp?.(event);
    endPress();
  };

  const onPointerCancel = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerCancelProp?.(event);
    endPress();
  };

  const onLostPointerCapture = (event: PointerEvent<HTMLButtonElement>) => {
    onLostPointerCaptureProp?.(event);
    endPress();
  };

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    onClickProp?.(event);
    if (event.defaultPrevented || locked) return;
    if (phase === "failed") {
      retry();
      return;
    }
    if (mode !== "undo") return;
    if (phase === "idle") {
      startUndoWindow();
    } else if (phase === "undoing") {
      undo();
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    onKeyDownProp?.(event);
    if (event.defaultPrevented) return;
    if (locked && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      return;
    }
    if (phase === "failed" && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      if (!event.repeat) retry();
      return;
    }
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
    onKeyUpProp?.(event);
    if (event.defaultPrevented) return;
    if (mode === "hold" && event.key === " ") {
      event.preventDefault();
      releaseHold();
    }
  };

  const onContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    onContextMenuProp?.(event);
    event.preventDefault();
  };

  const label = (() => {
    if (phase === "paid") return "Paid";
    if (phase === "processing") return "Paying";
    if (phase === "failed") return "Retry";
    if (phase === "undoing") return "Undo";
    if (mode === "hold") return `Hold to pay ${amount}`;
    return `Pay ${amount}`;
  })();

  const status = (() => {
    if (phase === "paid") return "Payment complete.";
    if (phase === "processing") return "Processing payment.";
    if (phase === "failed") return "Payment failed. Press to retry.";
    if (phase === "undoing") return "Press again to undo before the payment is sent.";
    return "";
  })();

  const icon: Icon = phase === "undoing" ? "ring" : phase === "paid" ? "check" : "none";

  const [swap, setSwap] = useState({
    label,
    icon,
    ghost: null as { label: string; icon: Icon; ringOffset: string } | null,
    ghostKey: 0,
  });
  if (swap.label !== label) {
    if (prefersReducedMotion()) {
      setSwap({ label, icon, ghost: null, ghostKey: swap.ghostKey });
    } else {
      setSwap({
        label,
        icon,
        ghost: {
          label: swap.label,
          icon: swap.icon,
          ringOffset: ringRef.current?.style.strokeDashoffset || "0",
        },
        ghostKey: swap.ghostKey + 1,
      });
    }
  }

  return (
    <div className={styles.signet}>
      <button
        {...props}
        ref={setButtonRef}
        type="button"
        className={[
          styles.button,
          phase === "paid" ? styles.paid : "",
          phase === "processing" ? styles.processing : "",
          phase === "failed" ? styles.failed : "",
          flash ? styles.flash : "",
          className ?? "",
        ].join(" ")}
        // Native disabled drops the focused control from the tab order.
        aria-label={label}
        aria-disabled={disabled || phase === "paid" || undefined}
        aria-busy={phase === "processing" || undefined}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onLostPointerCapture={onLostPointerCapture}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onContextMenu={onContextMenu}
      >
        <div ref={fillRef} className={styles.fill} aria-hidden="true" />
        <div className={styles.sheen} aria-hidden="true" />
        <div className={styles.glint} aria-hidden="true" onAnimationEnd={() => setFlash(false)} />
        <span className={styles.label} aria-hidden="true">
          <span
            key={`in-${swap.ghostKey}`}
            className={styles.face}
            data-swap={swap.ghostKey > 0 || undefined}
          >
            <Glyph icon={swap.icon} ringRef={swap.icon === "ring" ? ringRef : undefined} />
            {swap.label}
          </span>
          {swap.ghost !== null && (
            <span
              key={`out-${swap.ghostKey}`}
              className={[styles.face, styles.faceLeave].join(" ")}
              aria-hidden="true"
              onAnimationEnd={() => setSwap((current) => ({ ...current, ghost: null }))}
            >
              <Glyph icon={swap.ghost.icon} ringOffset={swap.ghost.ringOffset} />
              {swap.ghost.label}
            </span>
          )}
        </span>
      </button>
      <p
        className={styles.hint}
        data-visible={showHint || phase === "failed" || undefined}
        aria-hidden={phase === "failed" || !showHint}
      >
        {phase === "failed" ? "Payment failed" : "Press and hold to pay"}
      </p>
      <p className={styles.status} role="status">
        {status}
      </p>
    </div>
  );
}

export { Signet };
export default Signet;
