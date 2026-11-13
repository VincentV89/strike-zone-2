/** Returns the full UI HTML structure as a string for injection into a container. */
export function createUITemplate(): string {
  return `
<div data-screen="main-menu" class="screen active">
  <div class="main-menu__content">
    <h1 class="main-menu__title">Strike Zone 2</h1>

    <div class="main-menu__config">
      <label class="config-label" for="map-selector">Map</label>
      <select id="map-selector" data-testid="map-selector">
        <option value="map-a">Map A — Warehouse</option>
        <option value="map-b">Map B — Courtyard</option>
      </select>

      <label class="config-label">Bot Count</label>
      <div class="bot-stepper">
        <button data-testid="bot-dec-button" aria-label="Decrease bot count">−</button>
        <span data-testid="bot-count-display">3</span>
        <button data-testid="bot-inc-button" aria-label="Increase bot count">+</button>
      </div>
    </div>

    <button data-testid="play-button" class="btn-primary">Play</button>
  </div>
</div>

<div data-screen="hud" class="screen">
  <div class="hud">
    <div class="hud__vitals">
      <span class="hud__label">HP</span>
      <span data-hud="health">100</span>
    </div>
    <div class="hud__vitals">
      <span class="hud__label">AMM</span>
      <span data-hud="ammo">30</span>
    </div>
    <div class="hud__timer" data-hud="timer">03:00</div>
    <div class="hud__vitals">
      <span class="hud__label">K</span>
      <span data-hud="kills">0</span>
    </div>
    <div class="hud__crosshair" aria-hidden="true">+</div>
  </div>
</div>

<div data-screen="end-round" class="screen">
  <div class="end-round__content">
    <h2 data-testid="outcome-display"></h2>
    <p class="end-round__score">Score: <span data-testid="score-display">0</span></p>

    <div class="end-round__submit">
      <label for="alias-input">Alias</label>
      <input
        id="alias-input"
        type="text"
        data-testid="alias-input"
        maxlength="20"
        placeholder="Enter alias (1–20 chars)"
      />
      <span data-testid="alias-error" class="error-msg"></span>
      <button data-testid="submit-button" class="btn-secondary">Submit Score</button>
      <span data-testid="submit-status" class="status-msg"></span>
    </div>

    <div class="end-round__actions">
      <button data-testid="play-again-button" class="btn-primary">Play Again</button>
      <button data-testid="view-leaderboard-button" class="btn-secondary">View Leaderboard</button>
    </div>
  </div>
</div>

<div data-screen="leaderboard" class="screen">
  <div class="leaderboard__content">
    <h2>Leaderboard</h2>
    <span data-testid="leaderboard-status" class="status-msg"></span>
    <table class="leaderboard__table">
      <thead>
        <tr>
          <th>#</th>
          <th>Alias</th>
          <th>Score</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody data-testid="leaderboard-body"></tbody>
    </table>
    <button data-testid="leaderboard-back-button" class="btn-secondary">Back</button>
  </div>
</div>
`;
}
