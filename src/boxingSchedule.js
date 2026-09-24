import { BOXING_SLOTS, plannerDay, plannerWeek } from './jointPlanner.js';

// Standing user-confirmed appointments; never infer attendance or load from these.
export function boxingWeek(day, reference = null) {
  return plannerWeek(day).flatMap((date, index) => {
    const slot = BOXING_SLOTS.find(entry => entry.weekday === index + 1);
    if (!slot) return [];
    const week = reference?.weeks.find(w => w.start <= date && date <= w.end);
    const run = week?.sessions.find(s => s.date === date) || null;
    return [{ ...slot, date, id: `club:${date}`, source: 'user-recurring', status: 'planned',
      runningKnown: Boolean(week), run }];
  });
}

export function boxingToday(now) {
  const today = plannerDay(now);
  return boxingWeek(today).find(slot => slot.date === today) || null;
}
