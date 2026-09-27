import { damp } from './physics.js';

export const MOVEMENT = Object.freeze({ walk: 2.4, jog: 5.8, sprint: 10.8, aim: 2.6, acceleration: 24, braking: 34, turn: 22 });

export function footVelocity(player, axes, yaw, dt, { sprint = false, walk = false, aiming = false, sprintSpeed = MOVEMENT.sprint } = {}) {
  const amount = Math.hypot(axes.x, axes.y);
  const speed = aiming ? MOVEMENT.aim : sprint ? sprintSpeed : walk ? MOVEMENT.walk : MOVEMENT.jog;
  const rate = amount > .05 ? MOVEMENT.acceleration : MOVEMENT.braking;
  player.vx = damp(player.vx ?? 0, (Math.cos(yaw) * axes.x - Math.sin(yaw) * axes.y) * speed, rate, dt);
  player.vz = damp(player.vz ?? 0, (-Math.sin(yaw) * axes.x - Math.cos(yaw) * axes.y) * speed, rate, dt);
  if (amount < .05 && Math.hypot(player.vx, player.vz) < .03) player.vx = player.vz = 0;
  return { x: player.vx * dt, z: player.vz * dt };
}
