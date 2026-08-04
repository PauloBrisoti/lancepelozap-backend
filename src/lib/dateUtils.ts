import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import { subDays } from 'date-fns';

export function getTimezone(): string {
  return process.env.TIMEZONE || 'America/Sao_Paulo';
}

/** Data de hoje no fuso da loja como "aaaa-mm-dd" */
export function todayInTimezone(): string {
  const now = toZonedTime(new Date(), getTimezone());
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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

/**
 * Parses a date sent by the client into a Date object.
 * Bare "YYYY-MM-DD" strings are interpreted as midnight in the store timezone
 * (NOT UTC), so a sale registered on 03/08 does not end up as 02/08 21:00.
 * "YYYY-MM-DDTHH:mm(:ss)" (datetime-local, sem fuso) é interpretado como hora
 * de parede no fuso da loja. Strings ISO completas (com Z/offset) são mantidas.
 */
export function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return fromZonedTime(`${trimmed}T00:00:00.000`, getTimezone());
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(trimmed)) {
    const withSeconds = trimmed.length === 16 ? `${trimmed}:00` : trimmed;
    return fromZonedTime(`${withSeconds}.000`, getTimezone());
  }
  return new Date(value);
}

/** Previous period with same duration (for YoY comparison) */
export function calcPrevBounds(firstDay: Date, lastDay: Date): { prevFirstDay: Date; prevLastDay: Date } {
  const diffDays = Math.round((lastDay.getTime() - firstDay.getTime()) / (1000 * 60 * 60 * 24)) || 1;
  return {
    prevFirstDay: subDays(firstDay, diffDays),
    prevLastDay: subDays(firstDay, 1),
  };
}
