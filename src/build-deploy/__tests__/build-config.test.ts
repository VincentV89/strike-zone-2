import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '../../..');

describe('public/_headers (Cloudflare Pages CSP)', () => {
  const headers = readFileSync(join(ROOT, 'public/_headers'), 'utf-8');

  it('applies rules to all paths', () => {
    expect(headers.trim()).toMatch(/^\/\*/);
  });

  it('contains Content-Security-Policy', () => {
    expect(headers).toContain('Content-Security-Policy:');
  });

  it('CSP default-src is self', () => {
    expect(headers).toContain("default-src 'self'");
  });

  it("CSP frame-ancestors is 'none'", () => {
    expect(headers).toContain("frame-ancestors 'none'");
  });

  it('CSP object-src is none', () => {
    expect(headers).toContain("object-src 'none'");
  });

  it('contains X-Content-Type-Options nosniff', () => {
    expect(headers).toContain('X-Content-Type-Options: nosniff');
  });

  it('contains X-Frame-Options DENY', () => {
    expect(headers).toContain('X-Frame-Options: DENY');
  });

  it('contains Strict-Transport-Security', () => {
    expect(headers).toContain('Strict-Transport-Security:');
  });

  it('contains Referrer-Policy', () => {
    expect(headers).toContain('Referrer-Policy:');
  });
});

describe('.env.example', () => {
  const envExample = readFileSync(join(ROOT, '.env.example'), 'utf-8');

  it('contains VITE_LEADERBOARD_URL placeholder', () => {
    expect(envExample).toContain('VITE_LEADERBOARD_URL=');
  });

  it('does not contain real secrets or tokens', () => {
    expect(envExample).not.toMatch(/[a-zA-Z0-9]{40,}/);
  });
});

describe('vite.config.ts', () => {
  const viteConfigSource = readFileSync(join(ROOT, 'vite.config.ts'), 'utf-8');

  it('defines __LEADERBOARD_URL__', () => {
    expect(viteConfigSource).toContain('__LEADERBOARD_URL__');
  });

  it('reads from VITE_LEADERBOARD_URL env var', () => {
    expect(viteConfigSource).toContain('VITE_LEADERBOARD_URL');
  });

  it('targets es2022', () => {
    expect(viteConfigSource).toContain('es2022');
  });
});

describe('.github/workflows/ci.yml', () => {
  const workflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf-8');

  it('uses npm ci (not npm install)', () => {
    expect(workflow).toContain('npm ci');
    expect(workflow).not.toMatch(/npm install(?!\s+-g)/);
  });

  it('runs npm audit before deploy', () => {
    const auditIndex = workflow.indexOf('npm audit');
    const deployIndex = workflow.indexOf('wrangler@3 deploy');
    expect(auditIndex).toBeGreaterThan(-1);
    expect(deployIndex).toBeGreaterThan(auditIndex);
  });

  it('deploys to staging before production', () => {
    const stagingIndex = workflow.indexOf('--env staging');
    const prodIndex = workflow.lastIndexOf('wrangler@3 deploy\n');
    expect(stagingIndex).toBeGreaterThan(-1);
    expect(prodIndex).toBeGreaterThan(stagingIndex);
  });

  it('includes staging smoke test before production deploy', () => {
    const smokeIndex = workflow.indexOf('Smoke test');
    const prodDeployIndex = workflow.indexOf('Deploy leaderboard backend → production');
    expect(smokeIndex).toBeGreaterThan(-1);
    expect(prodDeployIndex).toBeGreaterThan(smokeIndex);
  });

  it('deploy job only runs on push to main', () => {
    expect(workflow).toContain("refs/heads/main");
    expect(workflow).toContain('event_name == \'push\'');
  });

  it('secrets are referenced via GitHub Encrypted Secrets syntax', () => {
    expect(workflow).toContain('${{ secrets.CLOUDFLARE_API_TOKEN }}');
    expect(workflow).toContain('${{ secrets.CLOUDFLARE_ACCOUNT_ID }}');
  });
});
