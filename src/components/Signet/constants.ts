import type { SpringConfig } from "./spring.ts";

export const FILL_DURATION_MS = 1100;
export const FINISH_DURATION_MS = 200;
export const PROCESSING_FILL_MS = 200;
export const FAIL_DRAIN_MS = 200;
// Letting go is the system responding: snappy, not a reverse of the 1.1s hold.
export const RELEASE_MS = 200;
// A release this close to the end is intent with a slipped finger, so it counts.
export const SLIP_FORGIVENESS = 0.92;
export const QUICK_TAP_MS = 200;
export const DEFAULT_UNDO_WINDOW_MS = 3500;
export const HOLD_SCALE = 0.96;

export const SHAKE_DURATION_MS = 280;
export const SHAKE_CYCLES = 7;
export const SHAKE_AMPLITUDE = 7;
export const SHAKE_DECAY = 4.2;

export const PRESS_SPRING: SpringConfig = { stiffness: 420, damping: 34 };
export const SETTLE_SPRING: SpringConfig = { stiffness: 300, damping: 26 };
export const SETTLE_KICK_VELOCITY = 1.5;

export const RING_RADIUS = 8;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
