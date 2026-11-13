import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UISystem } from '../ui-system.js';
import { createUITemplate } from '../template.js';
import type { UIState, UIAction } from '../types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContainer(): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = createUITemplate();
  return div;
}

function makeUIState(overrides: {
  health?: number;
  ammo?: number;
  timeRemaining?: number;
  kills?: number;
  phase?: 'pre-match' | 'in-round' | 'round-end';
  outcome?: 'win' | 'lose' | null;
  score?: number;
}): UIState {
  return {
    playerState: {
      health: overrides.health ?? 100,
      ammo: overrides.ammo ?? 30,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0 },
      isAlive: (overrides.health ?? 100) > 0,
    },
    roundState: {
      phase: overrides.phase ?? 'in-round',
      timeRemaining: overrides.timeRemaining ?? 60_000,
      outcome: overrides.outcome ?? null,
      kills: overrides.kills ?? 0,
      score: overrides.score ?? 0,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('UISystem', () => {
  let ui: UISystem;
  let container: HTMLElement;

  beforeEach(() => {
    ui = new UISystem();
    container = makeContainer();
    ui.init(container);
  });

  // ─── Initialization ───────────────────────────────────────────────────────

  it('starts on main-menu screen', () => {
    const mainMenu = container.querySelector('[data-screen="main-menu"]')!;
    expect(mainMenu.classList.contains('active')).toBe(true);
  });

  it('other screens are not active initially', () => {
    expect(container.querySelector('[data-screen="hud"]')!.classList.contains('active')).toBe(false);
    expect(container.querySelector('[data-screen="end-round"]')!.classList.contains('active')).toBe(false);
    expect(container.querySelector('[data-screen="leaderboard"]')!.classList.contains('active')).toBe(false);
  });

  // ─── Screen transitions ───────────────────────────────────────────────────

  it('showHUD activates hud screen', () => {
    ui.showHUD();
    expect(container.querySelector('[data-screen="hud"]')!.classList.contains('active')).toBe(true);
    expect(container.querySelector('[data-screen="main-menu"]')!.classList.contains('active')).toBe(false);
  });

  it('showMainMenu activates main-menu screen', () => {
    ui.showHUD();
    ui.showMainMenu();
    expect(container.querySelector('[data-screen="main-menu"]')!.classList.contains('active')).toBe(true);
    expect(container.querySelector('[data-screen="hud"]')!.classList.contains('active')).toBe(false);
  });

  it('showEndRound activates end-round screen', () => {
    ui.showHUD();
    ui.showEndRound('win', 1500);
    expect(container.querySelector('[data-screen="end-round"]')!.classList.contains('active')).toBe(true);
    expect(container.querySelector('[data-screen="hud"]')!.classList.contains('active')).toBe(false);
  });

  it('showEndRound is idempotent — no-op when already on end-round', () => {
    ui.showHUD();
    ui.showEndRound('win', 1000);
    const outcome = container.querySelector('[data-testid="outcome-display"]')!;
    const firstText = outcome.textContent;
    ui.showEndRound('lose', 500); // should not update because already on end-round
    expect(outcome.textContent).toBe(firstText);
  });

  it('showEndRound displays outcome and score', () => {
    ui.showHUD();
    ui.showEndRound('win', 2500);
    expect(container.querySelector('[data-testid="outcome-display"]')!.textContent).toBe('Victory!');
    expect(container.querySelector('[data-testid="score-display"]')!.textContent).toBe('2500');
  });

  it('showEndRound with lose outcome shows Defeated', () => {
    ui.showHUD();
    ui.showEndRound('lose', 0);
    expect(container.querySelector('[data-testid="outcome-display"]')!.textContent).toBe('Defeated');
  });

  // ─── HUD update ───────────────────────────────────────────────────────────

  it('update() reflects health, ammo, timer, kills in HUD', () => {
    ui.showHUD();
    ui.update(makeUIState({ health: 75, ammo: 10, timeRemaining: 65_000, kills: 2 }));

    expect(container.querySelector('[data-hud="health"]')!.textContent).toBe('75');
    expect(container.querySelector('[data-hud="ammo"]')!.textContent).toBe('10');
    expect(container.querySelector('[data-hud="timer"]')!.textContent).toBe('01:05');
    expect(container.querySelector('[data-hud="kills"]')!.textContent).toBe('2');
  });

  it('update() is a no-op when not on hud screen', () => {
    // stays on main-menu
    ui.update(makeUIState({ health: 50 }));
    expect(container.querySelector('[data-hud="health"]')!.textContent).toBe('100');
  });

  it('update() auto-transitions to end-round on round-end phase', () => {
    ui.showHUD();
    ui.update(makeUIState({ phase: 'round-end', outcome: 'win', score: 1000 }));
    expect(container.querySelector('[data-screen="end-round"]')!.classList.contains('active')).toBe(true);
  });

  it('update() auto-transition fires only once (idempotent)', () => {
    ui.showHUD();
    ui.update(makeUIState({ phase: 'round-end', outcome: 'win', score: 1000 }));
    // second call with round-end — still on end-round, not flickering
    ui.update(makeUIState({ phase: 'round-end', outcome: 'win', score: 1000 }));
    expect(container.querySelector('[data-screen="end-round"]')!.classList.contains('active')).toBe(true);
    expect(container.querySelector('[data-screen="hud"]')!.classList.contains('active')).toBe(false);
  });

  // ─── Leaderboard ─────────────────────────────────────────────────────────

  it('showLeaderboard renders entries sorted by score descending', () => {
    ui.showHUD();
    ui.showEndRound('win', 1000);
    ui.showLeaderboard([
      { alias: 'Alice', score: 100, timestamp: '2026-01-01T00:00:00Z' },
      { alias: 'Bob', score: 300, timestamp: '2026-01-02T00:00:00Z' },
      { alias: 'Charlie', score: 200, timestamp: '2026-01-03T00:00:00Z' },
    ]);

    const rows = container.querySelectorAll('[data-testid="leaderboard-body"] tr');
    expect(rows.length).toBe(3);
    expect(rows[0]!.querySelectorAll('td')[1]!.textContent).toBe('Bob');
  });

  it('showLeaderboard with empty entries shows unavailable message', () => {
    ui.showHUD();
    ui.showEndRound('win', 0);
    ui.showLeaderboard([]);

    const status = container.querySelector('[data-testid="leaderboard-status"]')!;
    expect(status.textContent).toContain('unavailable');
  });

  // ─── onSubmitResult ───────────────────────────────────────────────────────

  it('onSubmitResult success disables submit button', () => {
    ui.showHUD();
    ui.showEndRound('win', 1000);
    ui.onSubmitResult({ success: true });

    const submitBtn = container.querySelector('[data-testid="submit-button"]')!;
    expect(submitBtn.hasAttribute('disabled')).toBe(true);
    expect(container.querySelector('[data-testid="submit-status"]')!.textContent).toContain('submitted');
  });

  it('onSubmitResult failure re-enables submit button', () => {
    ui.showHUD();
    ui.showEndRound('win', 1000);
    ui.onSubmitResult({ success: false, error: 'Network error' });

    const submitBtn = container.querySelector('[data-testid="submit-button"]')!;
    expect(submitBtn.hasAttribute('disabled')).toBe(false);
  });

  // ─── Action dispatch ─────────────────────────────────────────────────────

  it('dispatches start-game action with config on play button click', () => {
    const handler = vi.fn();
    ui.onAction(handler);

    const playBtn = container.querySelector<HTMLButtonElement>('[data-testid="play-button"]')!;
    playBtn.click();

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'start-game' }),
    );
    const action = handler.mock.calls[0]![0] as UIAction & { type: 'start-game' };
    expect(action.config.mapId).toBe('map-a');
    expect(action.config.botCount).toBe(3);
  });

  it('dispatches play-again action on play-again button click', () => {
    const handler = vi.fn();
    ui.onAction(handler);
    ui.showHUD();
    ui.showEndRound('lose', 0);

    container.querySelector<HTMLButtonElement>('[data-testid="play-again-button"]')!.click();
    expect(handler).toHaveBeenCalledWith({ type: 'play-again' });
  });

  it('blocks submit-score dispatch with invalid alias', () => {
    const handler = vi.fn();
    ui.onAction(handler);
    ui.showHUD();
    ui.showEndRound('win', 1000);

    // alias input is empty by default
    container.querySelector<HTMLButtonElement>('[data-testid="submit-button"]')!.click();
    expect(handler).not.toHaveBeenCalled();
  });

  it('dispatches submit-score with valid alias', () => {
    const handler = vi.fn();
    ui.onAction(handler);
    ui.showHUD();
    ui.showEndRound('win', 1000);

    const aliasInput = container.querySelector<HTMLInputElement>('[data-testid="alias-input"]')!;
    aliasInput.value = 'Hero';

    container.querySelector<HTMLButtonElement>('[data-testid="submit-button"]')!.click();
    expect(handler).toHaveBeenCalledWith({ type: 'submit-score', alias: 'Hero' });
  });

  // ─── dispose ─────────────────────────────────────────────────────────────

  it('dispose() removes all event listeners — clicks no longer dispatch actions', () => {
    const handler = vi.fn();
    ui.onAction(handler);
    ui.dispose();

    container.querySelector<HTMLButtonElement>('[data-testid="play-button"]')!.click();
    expect(handler).not.toHaveBeenCalled();
  });

  // ─── Bot count stepper ────────────────────────────────────────────────────

  it('bot inc/dec buttons update bot count display', () => {
    const incBtn = container.querySelector<HTMLButtonElement>('[data-testid="bot-inc-button"]')!;
    const decBtn = container.querySelector<HTMLButtonElement>('[data-testid="bot-dec-button"]')!;
    const display = container.querySelector('[data-testid="bot-count-display"]')!;

    incBtn.click();
    expect(display.textContent).toBe('4');

    decBtn.click();
    expect(display.textContent).toBe('3');
  });

  it('bot dec button does not go below 1', () => {
    const decBtn = container.querySelector<HTMLButtonElement>('[data-testid="bot-dec-button"]')!;
    const display = container.querySelector('[data-testid="bot-count-display"]')!;

    for (let i = 0; i < 10; i++) decBtn.click();
    expect(display.textContent).toBe('1');
  });

  it('bot inc button does not go above 8', () => {
    const incBtn = container.querySelector<HTMLButtonElement>('[data-testid="bot-inc-button"]')!;
    const display = container.querySelector('[data-testid="bot-count-display"]')!;

    for (let i = 0; i < 10; i++) incBtn.click();
    expect(display.textContent).toBe('8');
  });
});
