/**
 * Keyboard input. Bindings mirror the upstream Input System actions
 * (Assets/Scripts/Input/Bindings/Player Action.inputactions).
 */

export interface FlightInput {
  /** Movement.x — A/D, -1..1 */
  turn: number;
  /** Movement.y — W/S, -1..1 */
  pitch: number;
  /** Speed (Q/E), -1..1 */
  accelerateDir: number;
  boost: boolean;
}

const PREVENT_DEFAULT = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();

  private readonly onDown = (e: KeyboardEvent): void => {
    if (!this.down.has(e.code)) this.pressed.add(e.code);
    this.down.add(e.code);
    if (PREVENT_DEFAULT.includes(e.code)) e.preventDefault();
  };
  private readonly onUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };
  private readonly onBlur = (): void => {
    this.down.clear();
    this.pressed.clear();
  };

  constructor(private readonly target: Window = window) {
    target.addEventListener('keydown', this.onDown);
    target.addEventListener('keyup', this.onUp);
    target.addEventListener('blur', this.onBlur);
  }

  private isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  /** True on the frame a key was first pressed. */
  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  get flight(): FlightInput {
    return {
      turn: (this.isDown('KeyD', 'ArrowRight') ? 1 : 0) - (this.isDown('KeyA', 'ArrowLeft') ? 1 : 0),
      pitch: (this.isDown('KeyW', 'ArrowUp') ? 1 : 0) - (this.isDown('KeyS', 'ArrowDown') ? 1 : 0),
      accelerateDir: (this.isDown('KeyE') ? 1 : 0) - (this.isDown('KeyQ') ? 1 : 0),
      boost: this.isDown('ShiftLeft', 'ShiftRight'),
    };
  }

  /** Call once at the end of each frame. */
  endFrame(): void {
    this.pressed.clear();
  }

  dispose(): void {
    this.target.removeEventListener('keydown', this.onDown);
    this.target.removeEventListener('keyup', this.onUp);
    this.target.removeEventListener('blur', this.onBlur);
  }
}
