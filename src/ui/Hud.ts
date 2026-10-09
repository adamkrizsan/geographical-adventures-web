import { formatLatLon } from '../math/geo';
import type { Player } from '../entity/Player';

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** Tiny DOM HUD. Replaces the uGUI elements ported in later phases. */
export class Hud {
  private readonly pos = byId('hud-pos');
  private readonly alt = byId('hud-alt');
  private readonly speed = byId('hud-speed');
  private readonly heading = byId('hud-heading');
  private readonly fps = byId('hud-fps');
  private readonly controls = byId('controls');
  private readonly hBadge = byId('h-badge');
  private readonly metrics = byId('hud-metrics');

  private frames = 0;
  private elapsed = 0;

  /** Toggle the oversized control hints (H). The H badge stays but shrinks. */
  toggleControls(): void {
    this.controls?.classList.toggle('hidden');
    this.hBadge?.classList.toggle('small');
    this.metrics?.classList.toggle('hidden');
  }

  update(player: Player, dt: number): void {
    this.frames++;
    this.elapsed += dt;
    if (this.elapsed >= 0.5) {
      if (this.fps) this.fps.textContent = `${Math.round(this.frames / this.elapsed)} fps`;
      this.frames = 0;
      this.elapsed = 0;
    }

    if (this.pos) this.pos.textContent = formatLatLon(player.latLon);
    if (this.alt) this.alt.textContent = `${player.elevation.toFixed(1)} u`;
    if (this.speed) this.speed.textContent = player.speed.toFixed(1);
    if (this.heading) this.heading.textContent = `${player.heading.toFixed(0).padStart(3, '0')}°`;
  }
}
