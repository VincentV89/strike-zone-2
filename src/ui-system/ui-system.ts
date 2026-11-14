import type {
  ActionHandler,
  MatchConfig,
  RoundOutcome,
  ScreenId,
  ScoreEntry,
  SubmitResultState,
  UIAction,
  UIState,
} from './types.js';
import { validateAlias, validateMatchConfig } from './validation.js';

const ERROR_MESSAGES = {
  submitFailed: 'Submission failed — please try again.',
  leaderboardUnavailable: 'Leaderboard unavailable.',
  alreadySubmitted: 'Score already submitted.',
  invalidAlias: 'Alias must be 1–20 printable ASCII characters.',
} as const;

export class UISystem {
  // ─── Cached DOM refs (populated in init) ──────────────────────────────────
  private container!: HTMLElement;

  // HUD elements
  private healthBar!: HTMLElement;
  private ammoCounter!: HTMLElement;
  private timerDisplay!: HTMLElement;
  private killCounter!: HTMLElement;

  // Screen containers
  private screenMainMenu!: HTMLElement;
  private screenHud!: HTMLElement;
  private screenEndRound!: HTMLElement;
  private screenLeaderboard!: HTMLElement;

  // Main menu controls
  private mapSelector!: HTMLSelectElement;
  private botCountDisplay!: HTMLElement;
  private botDecBtn!: HTMLElement;
  private botIncBtn!: HTMLElement;
  private playBtn!: HTMLElement;

  // End-round elements
  private outcomeDisplay!: HTMLElement;
  private scoreDisplay!: HTMLElement;
  private aliasInput!: HTMLInputElement;
  private aliasError!: HTMLElement;
  private submitBtn!: HTMLElement;
  private submitStatus!: HTMLElement;
  private playAgainBtn!: HTMLElement;
  private viewLeaderboardBtn!: HTMLElement;

  // Leaderboard elements
  private leaderboardBody!: HTMLElement;
  private leaderboardStatus!: HTMLElement;
  private leaderboardBackBtn!: HTMLElement;

  // ─── Internal state ───────────────────────────────────────────────────────
  private currentScreen: ScreenId = 'main-menu';
  private submitResult: SubmitResultState = 'idle';
  private leaderboardLoading = false;
  private matchConfig: MatchConfig = { mapId: 'map-a', botCount: 3 };
  private actionHandler: ActionHandler | null = null;

  // Listener registry for clean disposal
  private listeners: Array<
    [EventTarget, string, EventListenerOrEventListenerObject]
  > = [];

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  init(container: HTMLElement): void {
    this.container = container;

    // HUD
    this.healthBar = this.q('[data-hud="health"]');
    this.ammoCounter = this.q('[data-hud="ammo"]');
    this.timerDisplay = this.q('[data-hud="timer"]');
    this.killCounter = this.q('[data-hud="kills"]');

    // Screens
    this.screenMainMenu = this.q('[data-screen="main-menu"]');
    this.screenHud = this.q('[data-screen="hud"]');
    this.screenEndRound = this.q('[data-screen="end-round"]');
    this.screenLeaderboard = this.q('[data-screen="leaderboard"]');

    // Main menu
    this.mapSelector = this.q<HTMLSelectElement>('[data-testid="map-selector"]');
    this.botCountDisplay = this.q('[data-testid="bot-count-display"]');
    this.botDecBtn = this.q('[data-testid="bot-dec-button"]');
    this.botIncBtn = this.q('[data-testid="bot-inc-button"]');
    this.playBtn = this.q('[data-testid="play-button"]');

    // End round
    this.outcomeDisplay = this.q('[data-testid="outcome-display"]');
    this.scoreDisplay = this.q('[data-testid="score-display"]');
    this.aliasInput = this.q<HTMLInputElement>('[data-testid="alias-input"]');
    this.aliasError = this.q('[data-testid="alias-error"]');
    this.submitBtn = this.q('[data-testid="submit-button"]');
    this.submitStatus = this.q('[data-testid="submit-status"]');
    this.playAgainBtn = this.q('[data-testid="play-again-button"]');
    this.viewLeaderboardBtn = this.q('[data-testid="view-leaderboard-button"]');

    // Leaderboard
    this.leaderboardBody = this.q('[data-testid="leaderboard-body"]');
    this.leaderboardStatus = this.q('[data-testid="leaderboard-status"]');
    this.leaderboardBackBtn = this.q('[data-testid="leaderboard-back-button"]');

    this.registerListeners();
    this.applyScreen('main-menu');
    this.renderMatchConfig();
  }

  dispose(): void {
    for (const [target, type, fn] of this.listeners) {
      target.removeEventListener(type, fn);
    }
    this.listeners = [];
    this.actionHandler = null;
  }

  // ─── Action registration ─────────────────────────────────────────────────

  onAction(handler: ActionHandler): void {
    this.actionHandler = handler;
  }

  // ─── Frame update (called by GameEngine at ~60 fps) ──────────────────────

  update(state: UIState): void {
    if (this.currentScreen !== 'hud') return;

    // 1. Player vitals
    this.healthBar.textContent = String(state.playerState.health);
    this.ammoCounter.textContent = String(state.playerState.ammo);

    // 2. Timer MM:SS
    const totalSecs = Math.ceil(state.roundState.timeRemaining / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    this.timerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    // 3. Kill counter
    this.killCounter.textContent = String(state.roundState.kills);

    // 4. Auto-transition on round-end (idempotent guard)
    if (state.roundState.phase === 'round-end') {
      const outcome = state.roundState.outcome ?? 'lose';
      this.showEndRound(outcome, state.roundState.score);
    }
  }

  // ─── Screen transitions ───────────────────────────────────────────────────

  showMainMenu(): void {
    this.submitResult = 'idle';
    this.applyScreen('main-menu');
    this.renderMatchConfig();
  }

  showHUD(): void {
    this.applyScreen('hud');
  }

  showEndRound(outcome: RoundOutcome, score: number): void {
    if (this.currentScreen === 'end-round') return;
    this.submitResult = 'idle';
    this.outcomeDisplay.textContent = outcome === 'win' ? 'Victory!' : 'Defeated';
    this.scoreDisplay.textContent = String(score);
    this.aliasInput.value = '';
    this.aliasError.textContent = '';
    this.submitStatus.textContent = '';
    this.submitBtn.removeAttribute('disabled');
    this.applyScreen('end-round');
  }

  showLeaderboard(entries: ScoreEntry[]): void {
    this.leaderboardLoading = false;
    this.renderLeaderboard(entries);
    this.applyScreen('leaderboard');
  }

  onSubmitResult(result: { success: boolean; error?: string }): void {
    if (result.success) {
      this.submitResult = 'ok';
      this.submitStatus.textContent = 'Score submitted!';
      this.submitBtn.setAttribute('disabled', '');
    } else {
      this.submitResult = 'error';
      this.submitStatus.textContent = ERROR_MESSAGES.submitFailed;
      this.submitBtn.removeAttribute('disabled');
    }
    this.submitBtn.classList.remove('loading');
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private applyScreen(screen: ScreenId): void {
    this.currentScreen = screen;
    this.screenMainMenu.classList.toggle('active', screen === 'main-menu');
    this.screenHud.classList.toggle('active', screen === 'hud');
    this.screenEndRound.classList.toggle('active', screen === 'end-round');
    this.screenLeaderboard.classList.toggle('active', screen === 'leaderboard');
  }

  private renderMatchConfig(): void {
    this.mapSelector.value = this.matchConfig.mapId;
    this.botCountDisplay.textContent = String(this.matchConfig.botCount);
    this.updatePlayButton();
  }

  private updatePlayButton(): void {
    const valid = validateMatchConfig(this.matchConfig);
    if (valid) {
      this.playBtn.removeAttribute('disabled');
    } else {
      this.playBtn.setAttribute('disabled', '');
    }
  }

  private renderLeaderboard(entries: ScoreEntry[]): void {
    if (entries.length === 0) {
      this.leaderboardStatus.textContent = ERROR_MESSAGES.leaderboardUnavailable;
      this.leaderboardBody.textContent = '';
      return;
    }
    this.leaderboardStatus.textContent = '';
    const sorted = [...entries].sort((a, b) => b.score - a.score).slice(0, 10);
    this.leaderboardBody.textContent = '';
    sorted.forEach((entry, i) => {
      const row = document.createElement('tr');

      const rankCell = document.createElement('td');
      rankCell.textContent = String(i + 1);

      const aliasCell = document.createElement('td');
      aliasCell.textContent = entry.alias;

      const scoreCell = document.createElement('td');
      scoreCell.textContent = String(entry.score);

      const dateCell = document.createElement('td');
      dateCell.textContent = formatDate(entry.timestamp);

      row.appendChild(rankCell);
      row.appendChild(aliasCell);
      row.appendChild(scoreCell);
      row.appendChild(dateCell);
      this.leaderboardBody.appendChild(row);
    });
  }

  private registerListeners(): void {
    // Map selector
    this.on(this.mapSelector, 'change', () => {
      const val = this.mapSelector.value;
      if (val === 'map-a' || val === 'map-b') {
        this.matchConfig = { ...this.matchConfig, mapId: val };
        this.updatePlayButton();
      }
    });

    // Bot count stepper
    this.on(this.botDecBtn, 'click', () => {
      if (this.matchConfig.botCount > 1) {
        this.matchConfig = {
          ...this.matchConfig,
          botCount: this.matchConfig.botCount - 1,
        };
        this.botCountDisplay.textContent = String(this.matchConfig.botCount);
        this.updatePlayButton();
      }
    });

    this.on(this.botIncBtn, 'click', () => {
      if (this.matchConfig.botCount < 8) {
        this.matchConfig = {
          ...this.matchConfig,
          botCount: this.matchConfig.botCount + 1,
        };
        this.botCountDisplay.textContent = String(this.matchConfig.botCount);
        this.updatePlayButton();
      }
    });

    // Play button
    this.on(this.playBtn, 'click', () => {
      if (!validateMatchConfig(this.matchConfig)) return;
      this.dispatch({ type: 'start-game', config: { ...this.matchConfig } });
    });

    // Alias input validation on input event
    this.on(this.aliasInput, 'input', () => {
      const alias = this.aliasInput.value;
      if (alias.length > 0 && !validateAlias(alias)) {
        this.aliasError.textContent = ERROR_MESSAGES.invalidAlias;
      } else {
        this.aliasError.textContent = '';
      }
    });

    // Submit score
    this.on(this.submitBtn, 'click', () => {
      if (this.submitResult === 'ok') return;
      const alias = this.aliasInput.value;
      if (!validateAlias(alias)) {
        this.aliasError.textContent = ERROR_MESSAGES.invalidAlias;
        return;
      }
      this.aliasError.textContent = '';
      this.submitResult = 'loading';
      this.submitBtn.classList.add('loading');
      this.submitBtn.setAttribute('disabled', '');
      this.dispatch({ type: 'submit-score', alias });
    });

    // Play again
    this.on(this.playAgainBtn, 'click', () => {
      this.dispatch({ type: 'play-again' });
      this.showMainMenu();
    });

    // View leaderboard
    this.on(this.viewLeaderboardBtn, 'click', () => {
      if (this.leaderboardLoading) return;
      this.leaderboardLoading = true;
      this.dispatch({ type: 'view-leaderboard' });
    });

    // Leaderboard back button
    this.on(this.leaderboardBackBtn, 'click', () => {
      this.leaderboardLoading = false;
      this.applyScreen('end-round');
    });
  }

  private dispatch(action: UIAction): void {
    this.actionHandler?.(action);
  }

  private on(
    target: EventTarget,
    type: string,
    fn: EventListenerOrEventListenerObject,
  ): void {
    target.addEventListener(type, fn);
    this.listeners.push([target, type, fn]);
  }

  private q<T extends Element = HTMLElement>(selector: string): T {
    const el = this.container.querySelector<T>(selector);
    if (!el) throw new Error(`UISystem: required element "${selector}" not found`);
    return el;
  }
}

function formatDate(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return timestamp;
  }
}
