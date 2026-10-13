// Afterlight's clock: play starts at 23:48, and an in-game minute passes
// every 45 seconds of play.
export function gameClock(seconds) {
  const total = (23 * 60 + 48 + Math.floor(Math.max(0, seconds) / 45)) % 1440, hours = Math.floor(total / 60), minutes = total % 60;
  return { hours, minutes, text: `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}` };
}
