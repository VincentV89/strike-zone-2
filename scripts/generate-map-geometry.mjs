#!/usr/bin/env node
/**
 * Generates public/maps/<id>/geometry.glb from public/maps/<id>/definition.json.
 *
 * Each collider box in the definition becomes one visible box mesh, so the
 * rendered level always matches the collision volumes. The output is
 * deterministic for a given definition, and the files are committed.
 *
 * Usage: npm run generate:maps            (all maps)
 *        node scripts/generate-map-geometry.mjs dust   (one map)
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BoxGeometry, Color, Group, Mesh, MeshStandardMaterial } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAPS_DIR = join(ROOT, 'public', 'maps');

// GLTFExporter (binary mode) reads Blobs through FileReader, which Node lacks.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    result = null;
    onload = null;
    onloadend = null;
    onerror = null;
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then(
        (buf) => {
          this.result = buf;
          this.onload?.({ target: this });
          this.onloadend?.({ target: this });
        },
        (err) => this.onerror?.(err),
      );
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then(
        (buf) => {
          const type = blob.type || 'application/octet-stream';
          this.result = `data:${type};base64,${Buffer.from(buf).toString('base64')}`;
          this.onload?.({ target: this });
          this.onloadend?.({ target: this });
        },
        (err) => this.onerror?.(err),
      );
    }
  };
}

const PALETTE = {
  dust: { floor: 0xc2a46b, wall: 0x8c6d46, obstacle: 0x6e5333 },
  compound: { floor: 0x5a6150, wall: 0x6f6f6f, obstacle: 0x4b5a6b },
};
const DEFAULT_PALETTE = { floor: 0x777777, wall: 0x555555, obstacle: 0x444444 };

/** Classifies a collider so the level reads clearly: floor, perimeter wall or obstacle. */
function classify(collider, index, all) {
  if (index === 0 && collider.max.y <= 0.5) return 'floor';
  const floor = all[0];
  const touchesEdge =
    collider.min.x <= floor.min.x || collider.max.x >= floor.max.x ||
    collider.min.z <= floor.min.z || collider.max.z >= floor.max.z;
  return touchesEdge ? 'wall' : 'obstacle';
}

function buildScene(definition) {
  const palette = PALETTE[definition.id] ?? DEFAULT_PALETTE;
  const materials = {
    floor: new MeshStandardMaterial({ color: new Color(palette.floor), roughness: 0.95, name: 'floor' }),
    wall: new MeshStandardMaterial({ color: new Color(palette.wall), roughness: 0.9, name: 'wall' }),
    obstacle: new MeshStandardMaterial({ color: new Color(palette.obstacle), roughness: 0.85, name: 'obstacle' }),
  };

  const group = new Group();
  group.name = `map-${definition.id}`;
  definition.colliders.forEach((c, i, all) => {
    const size = { x: c.max.x - c.min.x, y: c.max.y - c.min.y, z: c.max.z - c.min.z };
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) {
      throw new Error(`${definition.id}: collider ${i} has a non-positive size`);
    }
    const kind = classify(c, i, all);
    const mesh = new Mesh(new BoxGeometry(size.x, size.y, size.z), materials[kind]);
    mesh.name = `${kind}-${i}`;
    mesh.position.set((c.min.x + c.max.x) / 2, (c.min.y + c.max.y) / 2, (c.min.z + c.max.z) / 2);
    group.add(mesh);
  });
  return group;
}

async function exportGlb(scene) {
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary: true });
  if (!(result instanceof ArrayBuffer)) {
    throw new Error('GLTFExporter did not return a binary ArrayBuffer');
  }
  return Buffer.from(result);
}

async function generate(mapId) {
  const defPath = join(MAPS_DIR, mapId, 'definition.json');
  if (!existsSync(defPath)) throw new Error(`No definition.json for map "${mapId}" at ${defPath}`);
  const definition = JSON.parse(readFileSync(defPath, 'utf-8'));
  const glb = await exportGlb(buildScene(definition));
  const outPath = join(MAPS_DIR, mapId, 'geometry.glb');
  writeFileSync(outPath, glb);
  console.log(`generate-map-geometry: wrote ${outPath} (${glb.length} bytes, ${definition.colliders.length} boxes)`);
}

const requested = process.argv.slice(2);
const mapIds = requested.length > 0
  ? requested
  : readdirSync(MAPS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

for (const id of mapIds) {
  await generate(id);
}
