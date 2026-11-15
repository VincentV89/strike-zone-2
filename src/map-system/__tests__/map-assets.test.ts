/**
 * Validates the real files under public/maps — the contract the unit tests'
 * injected loaders never exercise (D-01, D-02, D-11).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MAP_DISPLAY_NAMES, MAP_IDS } from '../types.js';
import type { MapDefinitionJSON, RawAABB } from '../types.js';
import { buildWaypointGraph } from '../waypoint-graph.js';

const MAPS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../public/maps');
const BOT_HALF_WIDTH = 0.3;
const BOT_HEIGHT = 1.8;

function readDefinition(id: string): MapDefinitionJSON {
  return JSON.parse(readFileSync(join(MAPS_DIR, id, 'definition.json'), 'utf-8')) as MapDefinitionJSON;
}

type P = { x: number; y: number; z: number };

/** True when a bot-sized body standing at p overlaps the collider. */
function bodyInside(p: P, c: RawAABB): boolean {
  return (
    p.x - BOT_HALF_WIDTH < c.max.x && p.x + BOT_HALF_WIDTH > c.min.x &&
    p.y < c.max.y && p.y + BOT_HEIGHT > c.min.y &&
    p.z - BOT_HALF_WIDTH < c.max.z && p.z + BOT_HALF_WIDTH > c.min.z
  );
}

/** Samples the straight XZ segment a→b and reports whether a bot body would clip a collider. */
function segmentBlocked(a: P, b: P, colliders: RawAABB[]): boolean {
  const steps = 200;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y, z: a.z + (b.z - a.z) * t };
    if (colliders.some((c) => bodyInside(p, c))) return true;
  }
  return false;
}

describe('public/maps assets', () => {
  it('has exactly one folder per MapId', () => {
    const folders = readdirSync(MAPS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(folders).toEqual([...MAP_IDS].sort());
  });

  describe.each(MAP_IDS.map((id) => [id]))('%s', (id) => {
    const def = readDefinition(id);

    it('has definition.json whose id and displayName match MAP_IDS/MAP_DISPLAY_NAMES', () => {
      expect(def.id).toBe(id);
      expect(def.displayName).toBe(MAP_DISPLAY_NAMES[id]);
    });

    it('has a geometry.glb that is a glTF 2.0 binary (D-02)', () => {
      const path = join(MAPS_DIR, id, 'geometry.glb');
      expect(existsSync(path)).toBe(true);
      const buf = readFileSync(path);
      expect(buf.subarray(0, 4).toString('ascii')).toBe('glTF');
      expect(buf.readUInt32LE(4)).toBe(2);
      expect(buf.readUInt32LE(8)).toBe(buf.length);
    });

    it('builds a connected waypoint graph and has 8 bot spawns', () => {
      expect(() => buildWaypointGraph(def.waypoints)).not.toThrow();
      expect(def.spawnPoints.bots.length).toBeGreaterThanOrEqual(8);
    });

    it('places every spawn and waypoint outside colliders (D-11)', () => {
      const points: Array<[string, P]> = [
        ...def.spawnPoints.player.map((p, i): [string, P] => [`player spawn ${i}`, p]),
        ...def.spawnPoints.bots.map((p, i): [string, P] => [`bot spawn ${i}`, p]),
        ...def.waypoints.map((w): [string, P] => [`waypoint ${w.id}`, w.position]),
      ];
      const inside = points
        .filter(([, p]) => def.colliders.some((c) => bodyInside(p, c)))
        .map(([name]) => name);
      expect(inside).toEqual([]);
    });

    it('routes every waypoint edge around obstacles', () => {
      const byId = new Map(def.waypoints.map((w) => [w.id, w.position]));
      const blocked: string[] = [];
      for (const w of def.waypoints) {
        for (const n of w.neighbors) {
          if (segmentBlocked(w.position, byId.get(n)!, def.colliders)) blocked.push(`${w.id}→${n}`);
        }
      }
      expect(blocked).toEqual([]);
    });
  });
});
