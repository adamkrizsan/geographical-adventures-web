/**
 * Unity `Mathf.SmoothDamp` / `SmoothDampAngle`, ported for the flight controller.
 */

export interface FloatRef {
  value: number;
}

export function smoothDamp(
  current: number,
  target: number,
  vel: FloatRef,
  smoothTime: number,
  dt: number,
  maxSpeed = Infinity,
): number {
  smoothTime = Math.max(0.0001, smoothTime);
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);

  let change = current - target;
  const originalTo = target;
  const maxChange = maxSpeed * smoothTime;
  change = Math.max(-maxChange, Math.min(maxChange, change));
  target = current - change;

  const temp = (vel.value + omega * change) * dt;
  vel.value = (vel.value - omega * temp) * exp;
  let output = target + (change + temp) * exp;

  if (originalTo - current > 0 === output > originalTo) {
    output = originalTo;
    vel.value = (output - originalTo) / dt;
  }
  return output;
}

function repeat(t: number, length: number): number {
  return t - Math.floor(t / length) * length;
}

function deltaAngle(current: number, target: number): number {
  let delta = repeat(target - current, 360);
  if (delta > 180) delta -= 360;
  return delta;
}

export function smoothDampAngle(
  current: number,
  target: number,
  vel: FloatRef,
  smoothTime: number,
  dt: number,
  maxSpeed = Infinity,
): number {
  return smoothDamp(current, target + deltaAngle(current, target), vel, smoothTime, dt, maxSpeed);
}
