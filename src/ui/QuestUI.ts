import type { ActiveQuest } from '../game/QuestSystem';
import { locationCountryName } from '../game/questData';

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export interface QuestRow {
  title: string;
  subtitle: string;
  distanceKm: number;
  state: 'pickup' | 'deliver' | 'done';
}

export interface DeliveryInfo {
  city: string;
  country: string;
  distanceKm: number;
}

/** DOM panel for the three active quests, messages, timer and score. */
export class QuestUI {
  private readonly questsEl = byId('quests');
  private readonly messageEl = byId('message');
  private readonly timerEl = byId('timer');
  private readonly scoreEl = byId('score');
  private readonly destinationEl = byId('destination');
  private readonly destArrow = byId('dest-arrow');
  private readonly destCity = byId('dest-city');
  private readonly destMeta = byId('dest-meta');
  private messageRemaining = 0;
  /** Direction hinting and distances are off by default (toggled with N). */
  private navAids = false;

  setNavAids(enabled: boolean): void {
    this.navAids = enabled;
    if (this.destArrow) this.destArrow.style.display = enabled ? '' : 'none';
  }

  /** Show/hide the prominent delivery-destination banner and point its arrow. */
  setDelivery(info: DeliveryInfo | null, relativeBearingDeg: number): void {
    if (!this.destinationEl) return;
    if (!info) {
      this.destinationEl.classList.remove('visible');
      return;
    }
    this.destinationEl.classList.add('visible');
    if (this.destCity) this.destCity.textContent = info.city;
    if (this.destMeta) {
      this.destMeta.textContent = this.navAids
        ? `${info.country} · ${Math.round(info.distanceKm)} km`
        : info.country;
    }
    if (this.destArrow) {
      this.destArrow.style.display = this.navAids ? '' : 'none';
      this.destArrow.style.transform = `rotate(${relativeBearingDeg.toFixed(1)}deg)`;
    }
  }

  setQuests(rows: QuestRow[]): void {
    if (!this.questsEl) return;
    this.questsEl.innerHTML = rows
      .map((row) => {
        const dist = this.navAids ? ` · ${row.distanceKm.toFixed(0)} km` : '';
        return `
      <div class="quest ${row.state}">
        <div class="quest-title">${row.title}</div>
        <div class="quest-sub">${row.subtitle}${dist}</div>
      </div>`;
      })
      .join('');
  }

  describeQuest(quest: ActiveQuest): QuestRow {
    const target = quest.hasPickedUp ? quest.deliver : quest.pickup;
    const country = locationCountryName(target);
    const verb = quest.hasPickedUp ? 'Deliver' : 'Pick up';
    return {
      title: `${verb}: ${target.city.displayName}`,
      subtitle: country,
      distanceKm: quest.distanceKm,
      state: quest.completed ? 'done' : quest.hasPickedUp ? 'deliver' : 'pickup',
    };
  }

  showMessage(text: string, duration: number): void {
    if (!this.messageEl) return;
    this.messageEl.textContent = text;
    this.messageEl.classList.add('visible');
    this.messageRemaining = duration;
  }

  update(dt: number): void {
    if (this.messageRemaining > 0) {
      this.messageRemaining -= dt;
      if (this.messageRemaining <= 0) this.messageEl?.classList.remove('visible');
    }
  }

  setStatus(timeRemaining: number, score: number, best: number): void {
    if (this.timerEl) {
      const s = Math.max(0, Math.floor(timeRemaining));
      this.timerEl.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }
    if (this.scoreEl) this.scoreEl.textContent = `score ${score}  ·  best ${best}`;
  }
}
