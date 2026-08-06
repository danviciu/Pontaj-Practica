export const APP_TIME_ZONE = 'Europe/Bucharest';

const WEEK_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_INDEX_BY_SHORT_NAME = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};

const APP_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
});

function normalizeDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
}

export function getAppTimeParts(value = new Date()) {
    const parts = Object.fromEntries(
        APP_TIME_FORMATTER
            .formatToParts(normalizeDate(value))
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value])
    );

    const hours = Number(parts.hour);
    const minutes = Number(parts.minute);
    const weekdayIndex = WEEKDAY_INDEX_BY_SHORT_NAME[parts.weekday];

    return {
        dateKey: `${parts.year}-${parts.month}-${parts.day}`,
        dayName: WEEK_DAYS[weekdayIndex] || null,
        minutes: ((Number.isFinite(hours) ? hours : 0) * 60) + (Number.isFinite(minutes) ? minutes : 0),
    };
}

export function getAppDateKey(value = new Date()) {
    return getAppTimeParts(value).dateKey;
}

export function getAppDayName(value = new Date()) {
    return getAppTimeParts(value).dayName;
}

export function getAppMinutes(value = new Date()) {
    return getAppTimeParts(value).minutes;
}

export function addDaysToDateKey(dateKey, days) {
    const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return getAppDateKey();

    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + Number(days || 0)));
    return date.toISOString().split('T')[0];
}

export function getDayNameFromDateKey(dateKey) {
    const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return getAppDayName();

    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return WEEK_DAYS[date.getUTCDay()];
}
