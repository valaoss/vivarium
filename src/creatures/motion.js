// Predict closest approach, so animals yield before their bodies overlap.
export function encounterTime(px, py, pz, vx, vy, vz, horizon = 0.65) {
  const vv = vx * vx + vy * vy + vz * vz;
  return vv < 1e-8 ? 0 : Math.max(0, Math.min(horizon, -(px * vx + py * vy + pz * vz) / vv));
}

// Acceleration-limited yaw: starts and finishes a turn without an angular snap.
export function turnVelocity(error, previous, maxSpeed, acceleration, dt) {
  const target = Math.sign(error) * Math.min(maxSpeed, Math.sqrt(2 * acceleration * Math.abs(error)));
  return previous + Math.max(-acceleration * dt, Math.min(acceleration * dt, target - previous));
}
