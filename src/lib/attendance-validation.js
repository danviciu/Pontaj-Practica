export const VALIDATION_STATUS = {
    VALIDA: 'VALIDA',
    INVALIDA: 'INVALIDA',
    IN_ASTEPTARE: 'IN_ASTEPTARE',
    CORECTATA_MANUAL: 'CORECTATA_MANUAL',
};

export const VALIDATION_REASON = {
    OK: 'OK',
    IN_AFARA_RAZEI: 'IN_AFARA_RAZEI',
    IN_AFARA_INTERVALULUI: 'IN_AFARA_INTERVALULUI',
    GPS_SLAB: 'GPS_SLAB',
    DUPLICAT_ZI: 'DUPLICAT_ZI',
    ELEV_INACTIV: 'ELEV_INACTIV',
    FARA_OPERATOR: 'FARA_OPERATOR',
    APROBAT_ADMIN: 'APROBAT_ADMIN',
    RESPINS_ADMIN: 'RESPINS_ADMIN',
};

const WEEK_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_ALIASES = {
    monday: 'monday',
    luni: 'monday',
    tuesday: 'tuesday',
    marti: 'tuesday',
    wednesday: 'wednesday',
    miercuri: 'wednesday',
    thursday: 'thursday',
    joi: 'thursday',
    friday: 'friday',
    vineri: 'friday',
    saturday: 'saturday',
    sambata: 'saturday',
    sunday: 'sunday',
    duminica: 'sunday',
};

function toMinutes(timeValue) {
    if (!timeValue || typeof timeValue !== 'string') return null;
    const parts = timeValue.split(':');
    if (parts.length < 2) return null;
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return hours * 60 + minutes;
}

function normalizeToken(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function normalizeDayToken(value) {
    const normalized = normalizeToken(value);
    return DAY_ALIASES[normalized] || normalized;
}

function includesDay(daysOfWeek, dayName) {
    const normalizedDayName = normalizeDayToken(dayName);
    return Array.isArray(daysOfWeek) && daysOfWeek.some((entry) => normalizeDayToken(entry) === normalizedDayName);
}

function dateKeyFromDate(dateValue) {
    return dateValue.toISOString().split('T')[0];
}

function isWithinDateRange(dateKey, startDate, endDate) {
    if (!startDate && !endDate) return true;
    if (startDate && dateKey < startDate) return false;
    if (endDate && dateKey > endDate) return false;
    return true;
}

function getBestClassPlan(classPlans, userClassName, dateKey) {
    return (classPlans || [])
        .filter((plan) => plan?.className === userClassName)
        .filter((plan) => isWithinDateRange(dateKey, plan?.validFrom, plan?.validTo))
        .sort((left, right) => Number(right?.priority || 0) - Number(left?.priority || 0))[0];
}

function getDirectPracticeScheduleCandidates(practiceSchedules, user, operator) {
    return (practiceSchedules || [])
        .filter((item) => item?.isActive !== false)
        .filter((item) => !item?.className || item.className === user?.className)
        .filter((item) => !item?.operatorId || item.operatorId === operator?.id)
        .filter((item) => !Array.isArray(item?.studentUserIds) || item.studentUserIds.length === 0 || item.studentUserIds.includes(user?.id))
        .filter((item) => Array.isArray(item?.daysOfWeek) && item.daysOfWeek.length > 0)
        .filter((item) => item?.checkinStartTime && item?.checkinEndTime);
}

function findDirectPracticeScheduleForDate(candidates, dateKey, dayName) {
    return (candidates || []).find((item) =>
        isWithinDateRange(dateKey, item?.validFrom, item?.validTo)
        && includesDay(item?.daysOfWeek, dayName)
    ) || null;
}

function findNextDirectPracticeScheduleSlot(candidates, now = new Date()) {
    const startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);

    for (let offset = 0; offset < 120; offset += 1) {
        const probeDate = new Date(startDate);
        probeDate.setDate(startDate.getDate() + offset);
        const probeDateKey = dateKeyFromDate(probeDate);
        const probeDayName = WEEK_DAYS[probeDate.getDay()];
        const schedule = findDirectPracticeScheduleForDate(candidates, probeDateKey, probeDayName);
        if (!schedule) continue;
        return {
            dateKey: probeDateKey,
            start: schedule.checkinStartTime,
            end: schedule.checkinEndTime,
            source: 'practice_schedule',
        };
    }

    return null;
}

function resolveScheduleTimeWindow({ date, dateKey, user, operator, classPlans, practiceSchedules, schedules }) {
    const dayName = WEEK_DAYS[date.getDay()];

    const bestPlan = getBestClassPlan(classPlans, user?.className, dateKey);
    if (bestPlan) {
        const schedule = (practiceSchedules || []).find((item) =>
            item?.id === bestPlan.scheduleId
            && item?.isActive !== false
            && isWithinDateRange(dateKey, item?.validFrom, item?.validTo)
            && includesDay(item?.daysOfWeek, dayName)
            && (!item?.className || item.className === user?.className)
            && (!item?.operatorId || item.operatorId === operator?.id)
            && (!Array.isArray(item?.studentUserIds) || item.studentUserIds.length === 0 || item.studentUserIds.includes(user?.id))
        );

        if (schedule?.checkinStartTime && schedule?.checkinEndTime) {
            return {
                start: schedule.checkinStartTime,
                end: schedule.checkinEndTime,
                source: 'practice_schedule',
            };
        }
    }

    const directPracticeSchedule = findDirectPracticeScheduleForDate(
        getDirectPracticeScheduleCandidates(practiceSchedules, user, operator),
        dateKey,
        dayName
    );

    if (directPracticeSchedule?.checkinStartTime && directPracticeSchedule?.checkinEndTime) {
        return {
            start: directPracticeSchedule.checkinStartTime,
            end: directPracticeSchedule.checkinEndTime,
            source: 'practice_schedule_direct',
        };
    }

    const scheduleCandidates = (schedules || [])
        .filter((item) => item?.isActive !== false)
        .filter((item) => item?.operatorId === operator?.id)
        .filter((item) => !item?.className || item.className === user?.className)
        .filter((item) => includesDay(item?.daysOfWeek, dayName));

    if (scheduleCandidates.length > 0) {
        const preferred = scheduleCandidates.find((item) => item?.className === user?.className) || scheduleCandidates[0];
        if (preferred?.startTime && preferred?.endTime) {
            return {
                start: preferred.startTime,
                end: preferred.endTime,
                source: 'operator_schedule',
            };
        }
    }

    return null;
}

function getActivePeriod(periods, dateKey, user, operator) {
    return (periods || [])
        .filter((period) => period?.isActive !== false)
        .filter((period) => isWithinDateRange(dateKey, period?.startDate, period?.endDate))
        .filter((period) => !period?.className || period.className === user?.className)
        .filter((period) => !period?.operatorId || period.operatorId === operator?.id)
        .sort((left, right) => {
            const leftSpecificity = Number(Boolean(left?.className)) + Number(Boolean(left?.operatorId));
            const rightSpecificity = Number(Boolean(right?.className)) + Number(Boolean(right?.operatorId));
            if (leftSpecificity !== rightSpecificity) {
                return rightSpecificity - leftSpecificity;
            }
            return String(right?.startDate || '').localeCompare(String(left?.startDate || ''));
        })[0];
}

function findNextPeriod(periods, dateKey, user, operator) {
    return (periods || [])
        .filter((period) => period?.isActive !== false)
        .filter((period) => period?.startDate && period.startDate > dateKey)
        .filter((period) => !period?.className || period.className === user?.className)
        .filter((period) => !period?.operatorId || period.operatorId === operator?.id)
        .sort((left, right) => String(left?.startDate || '').localeCompare(String(right?.startDate || '')))[0] || null;
}

function resolvePeriodTimeWindow(activePeriod) {
    if (activePeriod?.checkinStartTime && activePeriod?.checkinEndTime) {
        return {
            start: activePeriod.checkinStartTime,
            end: activePeriod.checkinEndTime,
            source: 'practice_period',
        };
    }
    return null;
}

function makeResult(overrides = {}) {
    return {
        validationStatus: VALIDATION_STATUS.VALIDA,
        validationReason: VALIDATION_REASON.OK,
        validationMessage: 'Prezenta este valida.',
        requiresReview: false,
        checkinWindowStart: null,
        checkinWindowEnd: null,
        allowedRadiusMeters: null,
        ...overrides,
    };
}

export function getAttendanceWindow({
    now = new Date(),
    user,
    operator,
    periods = [],
    classPlans = [],
    practiceSchedules = [],
    schedules = [],
}) {
    const dateKey = dateKeyFromDate(now);
    const dayName = WEEK_DAYS[now.getDay()];
    const hasPeriodsConfigured = (periods || []).length > 0;
    const activePeriod = hasPeriodsConfigured ? getActivePeriod(periods, dateKey, user, operator) : null;
    const hasActivePeriod = !hasPeriodsConfigured || Boolean(activePeriod);
    const nextPeriod = hasPeriodsConfigured && !activePeriod ? findNextPeriod(periods, dateKey, user, operator) : null;

    const directPracticeScheduleCandidates = getDirectPracticeScheduleCandidates(practiceSchedules, user, operator);
    const hasPracticeScheduleConstraints = directPracticeScheduleCandidates.length > 0;
    const activeDirectPracticeSchedule = findDirectPracticeScheduleForDate(directPracticeScheduleCandidates, dateKey, dayName);
    const nextDirectPracticeSlot = findNextDirectPracticeScheduleSlot(directPracticeScheduleCandidates, now);

    const scheduleWindow = resolveScheduleTimeWindow({
        date: now,
        dateKey,
        user,
        operator,
        classPlans,
        practiceSchedules,
        schedules,
    });

    const timeWindow = resolvePeriodTimeWindow(activePeriod) || scheduleWindow || null;

    let isWithinTimeWindow = true;
    let nextCheckinSlot = nextDirectPracticeSlot;
    if (timeWindow?.start && timeWindow?.end) {
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const startMinutes = toMinutes(timeWindow.start);
        const endMinutes = toMinutes(timeWindow.end);
        if (
            startMinutes !== null
            && endMinutes !== null
            && (nowMinutes < startMinutes || nowMinutes > endMinutes)
        ) {
            isWithinTimeWindow = false;
        }

        if (startMinutes !== null && endMinutes !== null) {
            if (nowMinutes <= endMinutes) {
                nextCheckinSlot = {
                    dateKey,
                    start: timeWindow.start,
                    end: timeWindow.end,
                    source: timeWindow.source || 'schedule',
                };
            }
        }
    } else if (hasPracticeScheduleConstraints || hasPeriodsConfigured) {
        isWithinTimeWindow = false;
    }

    if (!nextCheckinSlot && nextPeriod?.startDate) {
        nextCheckinSlot = {
            dateKey: nextPeriod.startDate,
            start: nextPeriod.checkinStartTime || null,
            end: nextPeriod.checkinEndTime || null,
            source: 'practice_period',
        };
    }

    return {
        dateKey,
        hasPeriodsConfigured,
        hasActivePeriod,
        activePeriod,
        nextPeriod,
        hasPracticeScheduleConstraints,
        activeDirectPracticeSchedule,
        nextDirectPracticeSlot,
        nextCheckinSlot,
        timeWindow,
        isWithinTimeWindow,
        isCheckinAllowedNow: hasActivePeriod && isWithinTimeWindow,
    };
}

function formatDateKeyRo(dateKey) {
    try {
        const date = new Date(`${dateKey}T00:00:00`);
        if (Number.isNaN(date.getTime())) return dateKey;
        return new Intl.DateTimeFormat('ro-RO', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        }).format(date);
    } catch {
        return dateKey;
    }
}

export function validateAttendanceAttempt({
    now = new Date(),
    user,
    operator,
    existingAttendances = [],
    periods = [],
    classPlans = [],
    practiceSchedules = [],
    schedules = [],
    distanceMeters,
    accuracyMeters,
}) {
    const windowInfo = getAttendanceWindow({
        now,
        user,
        operator,
        periods,
        classPlans,
        practiceSchedules,
        schedules,
    });

    const allowedRadiusMeters = Number(operator?.radiusMeters) || 200;

    if (!user?.id || user?.isActive === false) {
        return makeResult({
            validationStatus: VALIDATION_STATUS.INVALIDA,
            validationReason: VALIDATION_REASON.ELEV_INACTIV,
            validationMessage: 'Contul elevului este inactiv. Contacteaza administratorul.',
            allowedRadiusMeters,
        });
    }

    if (!operator?.id) {
        return makeResult({
            validationStatus: VALIDATION_STATUS.INVALIDA,
            validationReason: VALIDATION_REASON.FARA_OPERATOR,
            validationMessage: 'Nu exista operator alocat pentru elev.',
            allowedRadiusMeters,
        });
    }

    if ((existingAttendances || []).length > 0) {
        return makeResult({
            validationStatus: VALIDATION_STATUS.INVALIDA,
            validationReason: VALIDATION_REASON.DUPLICAT_ZI,
            validationMessage: 'Exista deja o prezenta inregistrata pentru azi.',
            allowedRadiusMeters,
        });
    }

    if (windowInfo.hasPeriodsConfigured && !windowInfo.hasActivePeriod) {
        const nextDateLabel = windowInfo.nextCheckinSlot?.dateKey
            ? formatDateKeyRo(windowInfo.nextCheckinSlot.dateKey)
            : null;
        const nextTimeLabel = windowInfo.nextCheckinSlot?.start && windowInfo.nextCheckinSlot?.end
            ? ` intre ${windowInfo.nextCheckinSlot.start} si ${windowInfo.nextCheckinSlot.end}`
            : '';
        const nextMessage = nextDateLabel
            ? ` Urmatorul interval posibil: ${nextDateLabel}${nextTimeLabel}.`
            : '';
        return makeResult({
            validationStatus: VALIDATION_STATUS.INVALIDA,
            validationReason: VALIDATION_REASON.IN_AFARA_INTERVALULUI,
            validationMessage: `Nu exista o perioada de practica activa pentru data de azi.${nextMessage}`,
            allowedRadiusMeters,
        });
    }

    if (windowInfo.hasPracticeScheduleConstraints && !windowInfo.timeWindow) {
        const nextDateLabel = windowInfo.nextCheckinSlot?.dateKey
            ? formatDateKeyRo(windowInfo.nextCheckinSlot.dateKey)
            : null;
        const nextTimeLabel = windowInfo.nextCheckinSlot?.start && windowInfo.nextCheckinSlot?.end
            ? ` intre ${windowInfo.nextCheckinSlot.start} si ${windowInfo.nextCheckinSlot.end}`
            : '';
        const nextMessage = nextDateLabel
            ? ` Urmatorul interval posibil: ${nextDateLabel}${nextTimeLabel}.`
            : ' Verifica zilele si perioada configurata de admin.';
        return makeResult({
            validationStatus: VALIDATION_STATUS.INVALIDA,
            validationReason: VALIDATION_REASON.IN_AFARA_INTERVALULUI,
            validationMessage: `Nu exista interval de pontaj activ pentru acest moment.${nextMessage}`,
            allowedRadiusMeters,
        });
    }

    const timeWindow = windowInfo.timeWindow;
    if (!windowInfo.isWithinTimeWindow && timeWindow?.start && timeWindow?.end) {
        return makeResult({
            validationStatus: VALIDATION_STATUS.INVALIDA,
            validationReason: VALIDATION_REASON.IN_AFARA_INTERVALULUI,
            validationMessage: `Pontaj permis doar intre ${timeWindow.start} si ${timeWindow.end}.`,
            checkinWindowStart: timeWindow.start,
            checkinWindowEnd: timeWindow.end,
            allowedRadiusMeters,
        });
    }

    if (typeof accuracyMeters === 'number' && accuracyMeters > 120) {
        return makeResult({
            validationStatus: VALIDATION_STATUS.INVALIDA,
            validationReason: VALIDATION_REASON.GPS_SLAB,
            validationMessage: `Semnal GPS slab (±${Math.round(accuracyMeters)}m). Incearca din nou intr-o zona deschisa.`,
            requiresReview: true,
            checkinWindowStart: timeWindow?.start || null,
            checkinWindowEnd: timeWindow?.end || null,
            allowedRadiusMeters,
        });
    }

    if (typeof distanceMeters === 'number' && distanceMeters > allowedRadiusMeters) {
        return makeResult({
            validationStatus: VALIDATION_STATUS.INVALIDA,
            validationReason: VALIDATION_REASON.IN_AFARA_RAZEI,
            validationMessage: `Distanta prea mare: ${distanceMeters}m (maxim permis ${allowedRadiusMeters}m).`,
            checkinWindowStart: timeWindow?.start || null,
            checkinWindowEnd: timeWindow?.end || null,
            allowedRadiusMeters,
        });
    }

    return makeResult({
        validationStatus: VALIDATION_STATUS.VALIDA,
        validationReason: VALIDATION_REASON.OK,
        validationMessage: 'Prezenta a fost validata automat.',
        checkinWindowStart: timeWindow?.start || null,
        checkinWindowEnd: timeWindow?.end || null,
        allowedRadiusMeters,
    });
}
