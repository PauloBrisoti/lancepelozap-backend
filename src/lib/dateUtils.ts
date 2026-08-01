import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { subDays } from 'date-fns';

export function getTimezone(): string {
  return process.env.TIMEZONE || 'America/Sao_Paulo';
}

export function buildDateRange(startDate?: string, endDate?: string): { firstDay: Date; lastDay: Date } {
  const timezone = getTimezone();

  if (startDate && endDate) {
    return {
      firstDay: fromZonedTime(`${startDate}T00:00:00.000`, timezone),
      lastDay: fromZonedTime(`${endDate}T23:59:59.999`, timezone),
    };
  }

  const nowInTz = toZonedTime(new Date(), timezone);
  const year = nowInTz.getFullYear();
  const month = String(nowInTz.getMonth() + 1).padStart(2, '0');
  const lastDayOfMonth = String(new Date(nowInTz.getFullYear(), nowInTz.getMonth() + 1, 0).getDate()).padStart(2, '0');

  return {
    firstDay: fromZonedTime(`${year}-${month}-01T00:00:00.000`, timezone),
    lastDay: fromZonedTime(`${year}-${month}-${lastDayOfMonth}T23:59:59.999`, timezone),
  };
}

/** Previous period with same duration (for YoY comparison) */
export function calcPrevBounds(firstDay: Date, lastDay: Date): { prevFirstDay: Date; prevLastDay: Date } {
  const diffDays = Math.round((lastDay.getTime() - firstDay.getTime()) / (1000 * 60 * 60 * 24)) || 1;
  return {
    prevFirstDay: subDays(firstDay, diffDays),
    prevLastDay: subDays(firstDay, 1),
  };
}
