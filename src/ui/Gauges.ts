import * as THREE from 'three';
import type { Player } from '../entity/Player';

/** Port of Speedometer.cs + Compass.cs: a heading dial, a speed needle and a boost ring. */
const BOOST_INACTIVE = '#b0b0b0';
const BOOST_ACTIVE = '#e7490a';
const BOOST_CHARGING = '#8acd20';
const BOOST_RADIUS = 43;
const BOOST_CIRC = 2 * Math.PI * BOOST_RADIUS;

export class Gauges {
  private readonly dial = document.getElementById('compass-dial');
  private readonly needle = document.getElementById('speed-needle');
  private readonly boostRing = document.getElementById('boost-ring');
  private needleValue = 0;

  update(player: Player, dt: number): void {
    // Compass dial rotates so the current heading sits under the fixed marker.
    this.dial?.setAttribute('transform', `rotate(${(-player.heading).toFixed(1)} 50 50)`);

    // Speed needle: upstream Lerp(90, -90, value), smoothed (Speedometer.cs).
    this.needleValue = THREE.MathUtils.damp(this.needleValue, player.speedT, 1 / 0.1, dt);
    const angle = -90 + 180 * this.needleValue;
    this.needle?.setAttribute('transform', `rotate(${angle.toFixed(1)} 50 50)`);

    // Boost ring: remaining boost as an arc, coloured by state.
    if (this.boostRing) {
      const t = THREE.MathUtils.clamp(player.boostRemainingT, 0, 1);
      this.boostRing.setAttribute('stroke-dasharray', `${BOOST_CIRC.toFixed(1)}`);
      this.boostRing.setAttribute('stroke-dashoffset', `${(BOOST_CIRC * (1 - t)).toFixed(1)}`);
      this.boostRing.setAttribute(
        'stroke',
        player.isBoosting ? BOOST_ACTIVE : player.boostCharging ? BOOST_CHARGING : BOOST_INACTIVE,
      );
    }
  }
}
