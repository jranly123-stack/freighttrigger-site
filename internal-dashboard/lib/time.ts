export function easternParts(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false
  });
  return Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
}

export function inBusinessWindow(now = new Date()) {
  const parts = easternParts(now);
  const weekday = String(parts.weekday);
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const dayOk = ["Mon", "Tue", "Wed", "Thu", "Fri"].includes(weekday);
  const minutes = hour * 60 + minute;
  return dayOk && minutes >= 9 * 60 + 30 && minutes <= 15 * 60 + 30;
}

export function daysBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}
