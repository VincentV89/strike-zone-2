/**
 * Renders a full-screen, user-visible error when the game cannot start at all
 * (for example WebGL2 is unavailable). Replaces any previous fatal message.
 */
export function renderFatalError(doc: Document, message: string): HTMLElement {
  doc.querySelector('[data-testid="fatal-error"]')?.remove();
  const box = doc.createElement('div');
  box.setAttribute('data-testid', 'fatal-error');
  box.setAttribute('role', 'alert');
  box.className = 'fatal-error';
  const title = doc.createElement('h2');
  title.textContent = 'Strike Zone 2 could not start';
  const detail = doc.createElement('p');
  detail.textContent = message;
  box.append(title, detail);
  doc.body.appendChild(box);
  return box;
}
