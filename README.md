# Signet

A payment button for React.

Pass it a charge. It handles confirmation, the wait, and what happens after.

```tsx
<Signet amount="$27.50" onPay={chargeCard} />
```

```bash
pnpm install
pnpm dev
```

Timing can be tuned with `holdDuration` (1100 ms), `undoWindowMs` (3500 ms),
and `slipForgiveness` (0.92). Durations must be finite and positive; the release
threshold must be in (0, 1]. Invalid values use the defaults.

Style hooks: `[data-signet]`, `[data-signet-button]`, `[data-signet-fill]`,
`data-mode` and `data-phase`. Phases are `idle`, `holding`, `draining`, `undoing`,
`processing`, `paid`, and `failed`. The button's `--signet-progress` CSS variable
tracks the visible fill from 0 to 1.

The button forwards `ref`, `className`, `style`, and standard button attributes.
Callback refs support React cleanup functions. Signet owns `transform` for its
press and failure motion, so put layout transforms on a wrapper.

Component styles live in `@layer signet`; unlayered consumer rules override them.
Theme variables are `--signet-bg`, `--signet-fg`, `--signet-radius`,
`--signet-focus`, `--signet-paid`, `--signet-fail`, `--signet-track`, and
`--signet-fill-opacity`. Defaults preserve the payment demo's appearance.
