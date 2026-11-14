import { Mesh, Raycaster, Vector3 } from 'three';

import type { EntityId, RaycastHit, Vec3 } from '../renderer-core/types.js';

interface CombatantRecord {
  health: number;
  ammo: number;
  isAlive: boolean;
}

function assertEntityId(id: unknown, param: string): asserts id is string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError(`${param}: must be a non-empty string, got ${JSON.stringify(id)}`);
  }
}

function assertFiniteDamage(damage: unknown): asserts damage is number {
  if (typeof damage !== 'number' || !Number.isFinite(damage) || damage <= 0) {
    throw new TypeError(`damage: must be a finite positive number, got ${damage}`);
  }
}

function assertUnitVector(dir: Vec3, param: string): void {
  const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y + dir.z * dir.z);
  if (Math.abs(len - 1) > 0.01) {
    throw new RangeError(
      `${param}: must be a unit vector (length ≈ 1 ± 0.01), got length ${len.toFixed(4)}`,
    );
  }
}

export class CombatSystem {
  private readonly combatantMap = new Map<EntityId, CombatantRecord>();
  private readonly hitboxRegistry = new Map<EntityId, Mesh>();
  private readonly meshToEntityId = new Map<Mesh, EntityId>();
  private readonly raycaster = new Raycaster();
  private readonly _originVec = new Vector3();
  private readonly _directionVec = new Vector3();

  initCombatant(entityId: EntityId, startHealth: number, startAmmo: number): void {
    assertEntityId(entityId, 'entityId');
    this.combatantMap.set(entityId, { health: startHealth, ammo: startAmmo, isAlive: true });
  }

  registerHitbox(entityId: EntityId, mesh: Mesh): void {
    assertEntityId(entityId, 'entityId');
    this.hitboxRegistry.set(entityId, mesh);
    this.meshToEntityId.set(mesh, entityId);
  }

  unregisterHitbox(entityId: EntityId): void {
    assertEntityId(entityId, 'entityId');
    this._doUnregister(entityId);
  }

  fire(origin: Vec3, direction: Vec3, shooterId: EntityId, damage: number): RaycastHit | null {
    assertEntityId(shooterId, 'shooterId');
    assertFiniteDamage(damage);
    assertUnitVector(direction, 'direction');

    const record = this.combatantMap.get(shooterId);
    if (!record) {
      throw new Error(`Combatant not initialized: ${shooterId}`);
    }

    if (record.ammo <= 0) return null;

    const candidates: Mesh[] = [];
    for (const [eid, mesh] of this.hitboxRegistry) {
      if (eid !== shooterId) candidates.push(mesh);
    }

    this._originVec.set(origin.x, origin.y, origin.z);
    this._directionVec.set(direction.x, direction.y, direction.z).normalize();
    this.raycaster.set(this._originVec, this._directionVec);

    const hits = this.raycaster.intersectObjects(candidates, false);

    record.ammo -= 1;

    if (hits.length === 0) return null;

    const hit = hits[0]!;
    const hitEntityId = this.meshToEntityId.get(hit.object as Mesh);
    if (!hitEntityId) return null;

    const targetRecord = this.combatantMap.get(hitEntityId);
    if (!targetRecord) return null;

    targetRecord.health = Math.max(0, targetRecord.health - damage);
    if (targetRecord.health === 0) {
      targetRecord.isAlive = false;
      this._doUnregister(hitEntityId);
    }

    const faceNormal = hit.face?.normal ?? { x: 0, y: 0, z: 0 };
    return {
      entityId: hitEntityId,
      point: { x: hit.point.x, y: hit.point.y, z: hit.point.z },
      normal: { x: faceNormal.x, y: faceNormal.y, z: faceNormal.z },
      distance: hit.distance,
    };
  }

  applyDamage(entityId: EntityId, dmg: number): void {
    assertEntityId(entityId, 'entityId');
    assertFiniteDamage(dmg);

    const record = this.combatantMap.get(entityId);
    if (!record) {
      throw new Error(`Combatant not found: ${entityId}`);
    }

    if (record.health === 0) return;

    record.health = Math.max(0, record.health - dmg);
    if (record.health === 0) {
      record.isAlive = false;
      this._doUnregister(entityId);
    }
  }

  isEliminated(entityId: EntityId): boolean {
    assertEntityId(entityId, 'entityId');
    const record = this.combatantMap.get(entityId);
    return record ? record.health === 0 : false;
  }

  getHealth(entityId: EntityId): number {
    assertEntityId(entityId, 'entityId');
    return this.combatantMap.get(entityId)?.health ?? 0;
  }

  getAmmo(entityId: EntityId): number {
    assertEntityId(entityId, 'entityId');
    return this.combatantMap.get(entityId)?.ammo ?? 0;
  }

  reset(): void {
    this.combatantMap.clear();
    this.hitboxRegistry.clear();
    this.meshToEntityId.clear();
  }

  private _doUnregister(entityId: EntityId): void {
    const mesh = this.hitboxRegistry.get(entityId);
    this.hitboxRegistry.delete(entityId);
    if (mesh) this.meshToEntityId.delete(mesh);
  }
}
