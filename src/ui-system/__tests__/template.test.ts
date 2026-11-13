import { describe, it, expect } from 'vitest';
import { createUITemplate } from '../template.js';

describe('createUITemplate', () => {
  it('contains all four screen containers', () => {
    const html = createUITemplate();
    expect(html).toContain('data-screen="main-menu"');
    expect(html).toContain('data-screen="hud"');
    expect(html).toContain('data-screen="end-round"');
    expect(html).toContain('data-screen="leaderboard"');
  });

  it('contains all HUD data attributes', () => {
    const html = createUITemplate();
    expect(html).toContain('data-hud="health"');
    expect(html).toContain('data-hud="ammo"');
    expect(html).toContain('data-hud="timer"');
    expect(html).toContain('data-hud="kills"');
  });

  it('contains data-testid on all interactive main-menu elements', () => {
    const html = createUITemplate();
    expect(html).toContain('data-testid="map-selector"');
    expect(html).toContain('data-testid="bot-dec-button"');
    expect(html).toContain('data-testid="bot-inc-button"');
    expect(html).toContain('data-testid="play-button"');
  });

  it('contains data-testid on all end-round interactive elements', () => {
    const html = createUITemplate();
    expect(html).toContain('data-testid="alias-input"');
    expect(html).toContain('data-testid="submit-button"');
    expect(html).toContain('data-testid="play-again-button"');
    expect(html).toContain('data-testid="view-leaderboard-button"');
  });

  it('contains data-testid on leaderboard elements', () => {
    const html = createUITemplate();
    expect(html).toContain('data-testid="leaderboard-body"');
    expect(html).toContain('data-testid="leaderboard-back-button"');
  });

  it('marks main-menu as the initial active screen', () => {
    const html = createUITemplate();
    // main-menu should have the "active" class; other screens should not precede
    const mainMenuIdx = html.indexOf('data-screen="main-menu"');
    const activeIdx = html.indexOf('class="screen active"');
    expect(activeIdx).toBeGreaterThan(-1);
    // The first "active" occurrence should be near main-menu
    expect(Math.abs(mainMenuIdx - activeIdx)).toBeLessThan(50);
  });
});
