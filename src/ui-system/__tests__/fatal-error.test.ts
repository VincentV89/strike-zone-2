import { describe, it, expect, beforeEach } from 'vitest';
import { renderFatalError } from '../fatal-error.js';

describe('renderFatalError', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('adds a visible alert with the message', () => {
    const el = renderFatalError(document, 'WebGL2 is not available on this device or browser');
    expect(el.getAttribute('role')).toBe('alert');
    expect(document.querySelector('[data-testid="fatal-error"]')!.textContent).toContain('WebGL2 is not available');
  });

  it('replaces a previous fatal message instead of stacking', () => {
    renderFatalError(document, 'first');
    renderFatalError(document, 'second');
    const all = document.querySelectorAll('[data-testid="fatal-error"]');
    expect(all).toHaveLength(1);
    expect(all[0]!.textContent).toContain('second');
  });

  it('renders the message as text, not HTML', () => {
    renderFatalError(document, '<img src=x onerror=alert(1)>');
    expect(document.querySelector('[data-testid="fatal-error"] img')).toBeNull();
  });
});
