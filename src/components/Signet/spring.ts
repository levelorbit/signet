export interface SpringConfig {
  stiffness: number;
  damping: number;
}

const MAX_FRAME_MS = 64;
const SUBSTEP_S = 0.008;
const REST_VELOCITY = 0.001;
const REST_DISTANCE = 0.0005;

export class Spring {
  value: number;
  velocity = 0;
  target: number;
  config: SpringConfig;

  constructor(value: number, config: SpringConfig) {
    this.value = value;
    this.target = value;
    this.config = config;
  }

  /**
   * Semi-implicit Euler, chopped into small substeps so stiff springs
   * stay stable when a throttled CPU delivers long frames.
   * Returns true while the spring is still moving.
   */
  step(dtMs: number): boolean {
    const dt = Math.min(dtMs, MAX_FRAME_MS) / 1000;
    const steps = Math.max(1, Math.ceil(dt / SUBSTEP_S));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const acceleration =
        this.config.stiffness * (this.target - this.value) -
        this.config.damping * this.velocity;
      this.velocity += acceleration * h;
      this.value += this.velocity * h;
    }
    if (
      Math.abs(this.velocity) < REST_VELOCITY &&
      Math.abs(this.target - this.value) < REST_DISTANCE
    ) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }
    return true;
  }

  snap(value: number) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }
}
