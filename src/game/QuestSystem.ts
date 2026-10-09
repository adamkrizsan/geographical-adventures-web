import * as THREE from 'three';
import { EARTH_RADIUS_KM, WORLD_RADIUS } from '../config';
import { angleBetween, latLonToVector3 } from '../math/geo';
import type { Globe } from '../world/Globe';
import type { Player } from '../entity/Player';
import { HotAirBalloon, CityMarker } from './Markers';
import { Package } from './Package';
import { locationCountryName, type QuestData, type QuestLocation } from './questData';
import type { QuestUI } from '../ui/QuestUI';
import type { ModelLibrary } from '../world/models';

export interface ActiveQuest {
  pickup: QuestLocation;
  deliver: QuestLocation;
  hasPickedUp: boolean;
  completed: boolean;
  pickupPoint: THREE.Vector3;
  deliverPoint: THREE.Vector3;
  distanceKm: number;
  balloon?: HotAirBalloon;
  pendingPackage?: Package;
}

interface DeliveryResult {
  targetCity: string;
  targetCountry: string;
  landedCountry: string | null;
  landedInOcean: boolean;
  distanceKM: number;
  landedInCorrectCountry: boolean;
}

const PERFECT_RADIUS = 75;
const GOOD_RADIUS = 300;
const OK_RADIUS = 1000;
const PERFECT_BOOST_TIME_ADD = 15;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Port of QuestCreator + QuestSystem: three active delivery quests, each a pickup balloon
 * and a delivery city, with the same location weighting and result scoring.
 */
export class QuestSystem {
  readonly active: ActiveQuest[] = [];
  score = 0;
  bestScore = Number(localStorage.getItem('ga.bestScore') ?? 0);
  timeSinceStart = 0;
  endless = false;

  private readonly prng: () => number;
  private readonly history: ActiveQuest[] = [];
  private readonly packages: Package[] = [];
  private readonly markers: CityMarker[] = [];
  private readonly deliveries: DeliveryResult[] = [];
  private readonly scratch = new THREE.Vector3();

  constructor(
    private readonly data: QuestData,
    private readonly globe: Globe,
    private readonly player: Player,
    private readonly scene: THREE.Scene,
    private readonly ui: QuestUI,
    private readonly models: ModelLibrary,
    seed: number | null = null,
    private readonly timedModeDurationSeconds = 15 * 60,
  ) {
    // Upstream QuestCreator.randomizeSeed = 1: pick a fresh seed each run (pass an explicit
    // seed, e.g. from `?seed=`, for a reproducible sequence).
    this.prng = mulberry32(seed ?? ((Math.random() * 0x100000000) >>> 0));
  }

  start(): void {
    for (let i = 0; i < 3; i++) this.setNewActiveQuest(i);
  }

  /** Debug: simulate picking up the first quest's package (e.g. `?carry`). */
  debugPickupFirst(): void {
    const quest = this.active[0];
    if (quest && !quest.hasPickedUp) this.onPickup(quest);
  }

  /** Debug: spawn a package at the player (for inspecting the parachute). */
  debugSpawnPackage(): void {
    const pkg = new Package(this.player.getPosition(), new THREE.Vector3(), this.globe, this.models.crate);
    this.scene.add(pkg.object);
    this.packages.push(pkg);
  }

  get timeRemaining(): number {
    if (this.endless) return Infinity;
    return Math.max(0, this.timedModeDurationSeconds - this.timeSinceStart);
  }

  /** True while a package is held (picked up but not yet delivered). */
  get carrying(): boolean {
    return this.active.some((q) => q.hasPickedUp && !q.completed);
  }

  /** The quest whose package the player is currently carrying, if any. */
  get activeDelivery(): ActiveQuest | null {
    return this.active.find((q) => q.hasPickedUp && !q.completed) ?? null;
  }

  update(dt: number): void {
    this.timeSinceStart += dt;

    for (const quest of this.active) {
      const target = quest.hasPickedUp ? quest.deliverPoint : quest.pickupPoint;
      quest.distanceKm = angleBetween(this.player.positionUnit, target) * EARTH_RADIUS_KM;
    }

    // Balloon pickups. Only one package may be carried at a time: while a package is held
    // (picked up but not yet delivered) the other balloons stay in place.
    const carrying = this.carrying;
    for (const quest of this.active) {
      if (!quest.hasPickedUp && quest.balloon) {
        if (quest.balloon.update(this.player.position, this.timeSinceStart, !carrying)) {
          this.onPickup(quest);
        }
      }
    }

    // City markers
    for (const marker of this.markers) marker.update(dt);

    // Packages in flight
    for (const pkg of this.packages) {
      pkg.update(dt);
      if (pkg.landed && !pkg.reported) {
        pkg.reported = true;
        const quest = this.active.find((q) => q.pendingPackage === pkg);
        if (quest) this.completeDelivery(quest, pkg);
      }
    }

    this.ui.setQuests(this.active.map((q) => this.ui.describeQuest(q)));
    this.ui.setStatus(this.timeRemaining, this.score, this.bestScore);
  }

  /** Drop a package toward the nearest pending delivery (Space). */
  tryDropPackage(): void {
    let best: ActiveQuest | null = null;
    let bestDst = Infinity;
    for (const quest of this.active) {
      if (quest.hasPickedUp && !quest.completed && !quest.pendingPackage) {
        const dst = angleBetween(this.player.positionUnit, quest.deliverPoint);
        if (dst < bestDst) {
          bestDst = dst;
          best = quest;
        }
      }
    }

    if (!best) {
      this.ui.showMessage('You don\u2019t have any packages to deliver!', 2);
      return;
    }

    // Upstream Player.DropPackage instantiates the package with no inherited velocity, so it
    // falls from the release point rather than flying alongside the plane (making it aimable).
    const startVel = this.scratch.set(0, 0, 0);
    const pkg = new Package(this.player.getPosition(), startVel, this.globe, this.models.crate);
    this.scene.add(pkg.object);
    this.packages.push(pkg);
    best.pendingPackage = pkg;
  }

  private onPickup(quest: ActiveQuest): void {
    quest.hasPickedUp = true;
    quest.balloon?.dispose();
    quest.balloon = undefined;
    const country = locationCountryName(quest.deliver);
    this.ui.showMessage(
      `You collected a package! It's marked for delivery to ${quest.deliver.city.displayName}, ${country}`,
      5,
    );
  }

  private completeDelivery(quest: ActiveQuest, pkg: Package): void {
    quest.completed = true;

    const cityPointUnit = quest.deliverPoint;
    const landedPoint = pkg.object.position.clone();
    const distanceKM = angleBetween(landedPoint.normalize(), cityPointUnit) * EARTH_RADIUS_KM;
    const landedInOcean = pkg.surfaceInfo === null;
    const landedCountry = pkg.surfaceInfo?.countryName ?? null;
    const landedInCorrectCountry = landedCountry === quest.deliver.country.name;

    const result: DeliveryResult = {
      targetCity: quest.deliver.city.displayName,
      targetCountry: locationCountryName(quest.deliver, 15),
      landedCountry,
      landedInOcean,
      distanceKM,
      landedInCorrectCountry,
    };
    this.deliveries.push(result);
    this.score = this.calculateScore();
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      localStorage.setItem('ga.bestScore', String(this.bestScore));
    }

    this.ui.showMessage(this.createResultMessage(result), 6.5);
    this.player.addBoost(this.calculateBoost(result));

    // City marker at the target.
    const surface = this.globe.sampleSurface(cityPointUnit);
    if (surface) {
      const marker = new CityMarker(surface.point);
      this.scene.add(marker.object);
      this.markers.push(marker);
      setTimeout(() => {
        marker.dispose();
        this.markers.splice(this.markers.indexOf(marker), 1);
      }, 8000);
    }

    this.packages.splice(this.packages.indexOf(pkg), 1);
    pkg.dispose();

    // New quest in this slot.
    this.setNewActiveQuest(this.active.indexOf(quest));
  }

  private setNewActiveQuest(index: number): void {
    const pointsToAvoid: THREE.Vector3[] = [this.player.positionUnit.clone()];
    for (let i = 0; i < this.history.length; i++) {
      const old = this.history[i];
      const isRecent = this.history.length - i <= 5;
      if (isRecent || !old.hasPickedUp) pointsToAvoid.push(old.pickupPoint);
      if (isRecent || !old.completed) pointsToAvoid.push(old.deliverPoint);
    }

    const pickup = this.pickRandomLocation(pointsToAvoid, 10);
    pointsToAvoid.push(pickup.pickupPoint);
    const deliver = this.pickRandomLocation(pointsToAvoid, 10);

    const quest: ActiveQuest = {
      pickup: pickup.location,
      deliver: deliver.location,
      hasPickedUp: false,
      completed: false,
      pickupPoint: pickup.pickupPoint,
      deliverPoint: deliver.pickupPoint,
      distanceKm: 0,
    };

    // Spawn the pickup balloon, painted with the pickup country's flag.
    const balloonPos = quest.pickupPoint.clone().multiplyScalar(WORLD_RADIUS);
    const flagCode = quest.pickup.overrideFlagCode ?? quest.pickup.country.alpha2 ?? null;
    quest.balloon = new HotAirBalloon(balloonPos, this.models.balloon, flagCode);
    this.scene.add(quest.balloon.object);

    this.active[index] = quest;
    this.history.push(quest);
  }

  private pickRandomLocation(avoid: THREE.Vector3[], avoidDegrees: number): { location: QuestLocation; pickupPoint: THREE.Vector3 } {
    for (let attempt = 0; attempt < 100; attempt++) {
      const location = this.weightedRandomLocation();
      const point = latLonToVector3(location.city.lat, location.city.lon, 1);
      let closest = 180;
      for (const a of avoid) closest = Math.min(closest, angleBetween(point, a) * (180 / Math.PI));
      if (closest > avoidDegrees) return { location, pickupPoint: point };
    }
    const location = this.weightedRandomLocation();
    return { location, pickupPoint: latLonToVector3(location.city.lat, location.city.lon, 1) };
  }

  private weightedRandomLocation(): QuestLocation {
    const locations = this.data.locations;
    let total = 0;
    for (const l of locations) total += l.weight;
    let r = this.prng() * total;
    for (const l of locations) {
      r -= l.weight;
      if (r <= 0) return l;
    }
    return locations[locations.length - 1];
  }

  private calculateBoost(result: DeliveryResult): number {
    if (result.distanceKM <= PERFECT_RADIUS) return PERFECT_BOOST_TIME_ADD;
    const t = THREE.MathUtils.clamp((result.distanceKM - PERFECT_RADIUS) / (OK_RADIUS - PERFECT_RADIUS), 0, 1);
    const maxNonPerfect = PERFECT_BOOST_TIME_ADD * 0.75;
    let boostAdd = THREE.MathUtils.lerp(maxNonPerfect, 0, 1 - Math.pow(1 - t, 3));
    if (result.landedInCorrectCountry) {
      boostAdd += 2;
      boostAdd = Math.min(boostAdd, maxNonPerfect);
    }
    return boostAdd;
  }

  private calculateScore(): number {
    let distanceScore = 0;
    let streakScore = 0;
    let bonusScore = 0;
    let perfectStreak = 0;
    let goodStreak = 0;
    for (const result of this.deliveries) {
      distanceScore += Math.pow(1 - Math.min(1, result.distanceKM / 3000), 5) * 100;
      if (result.landedInCorrectCountry) bonusScore += 10;
      if (result.distanceKM <= PERFECT_RADIUS) {
        perfectStreak++;
      } else {
        perfectStreak = 0;
        if (result.distanceKM <= GOOD_RADIUS) goodStreak++;
        else goodStreak = 0;
      }
      if (perfectStreak > 1) streakScore += 30 + (perfectStreak - 1) * 20;
      else if (goodStreak > 1) streakScore += (goodStreak - 1) * 10;
    }
    return Math.ceil(distanceScore + streakScore + bonusScore);
  }

  private createResultMessage(result: DeliveryResult): string {
    const dstString = distanceString(result.distanceKM);
    const targetCountry = result.targetCountry;
    const landed = result.landedCountry ?? 'ocean';

    if (result.distanceKM <= PERFECT_RADIUS) {
      if (result.landedInOcean) {
        return `Perfect delivery! The package will land just ${dstString} from the city centre (although in the water, unfortunately).`;
      }
      if (!result.landedInCorrectCountry) {
        return `Perfect delivery! The package will land just ${dstString} from the city centre (but will have to be brought across from ${landed} to ${targetCountry}).`;
      }
      return `Perfect delivery! The package will land just ${dstString} from the city centre.`;
    }
    if (result.distanceKM <= GOOD_RADIUS) {
      if (result.landedInCorrectCountry) return `Good enough! The package will land ${dstString} from the city.`;
      if (result.landedInOcean) return `Good enough! The package will land ${dstString} from the city, but will have to be fished out of the water.`;
      return `Good enough! The package will land ${dstString} from the city (but will have to be transported from ${landed} to ${targetCountry}).`;
    }
    if (result.distanceKM <= OK_RADIUS) {
      if (result.landedInCorrectCountry) return `An okay attempt. The package will land ${dstString} from the city.`;
      if (result.landedInOcean) return `An okay attempt. The package will land ${dstString} from the city, and will have to be fished out of the water.`;
      return `An okay attempt. The package will land ${dstString} from the city (and will have to be transported from ${landed} to ${targetCountry}).`;
    }
    if (result.landedInCorrectCountry) {
      return `Oh no! The package will land ${dstString} away from the city. On the bright side, it's in the right country at least!`;
    }
    if (result.landedInOcean) {
      return `Oh no! The package will land in the water, ${dstString} away from the city.`;
    }
    return `Oh no! The package will land ${dstString} away from the city, and in ${landed} instead of ${targetCountry}.`;
  }
}

function distanceString(dstKm: number): string {
  const rounded = Math.ceil(dstKm);
  return `${rounded} kilometre${rounded === 1 ? '' : 's'}`;
}
