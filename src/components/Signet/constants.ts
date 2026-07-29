import type { SpringConfig } from "./spring.ts";

/** How long a hold must be sustained before the action commits. */
export const FILL_DURATION_MS = 1100;

/** How long the fill takes to run to full after a commit lands early. */
export const FINISH_DURATION_MS = 450;

/** Draining slower than a snap keeps release feeling like backing out, not failure. */
export const DRAIN_SPEED_FACTOR = 2.6;

/** A release this close to the end is intent with a slipped finger, so it counts. */
export const SLIP_FORGIVENESS = 0.92;

/** A press shorter than this reads as a tap, so the hold hint is worth showing. */
export const QUICK_TAP_MS = 200;

/** How long a committed action stays undoable in undo mode. */
export const UNDO_WINDOW_MS = 5000;

/** How far the button scales down while held. */
export const HOLD_SCALE = 0.96;

/** Ease-out exponent: the last stretch of the fill decelerates so it feels earned. */
export const FILL_END_EASE = 1.4;

export const PRESS_SPRING: SpringConfig = { stiffness: 420, damping: 34 };

export const SETTLE_SPRING: SpringConfig = { stiffness: 300, damping: 26 };

/** Velocity injected on undo, so the button springs back rather than easing. */
export const SETTLE_KICK_VELOCITY = 1.5;

export const RING_RADIUS = 8;

export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
