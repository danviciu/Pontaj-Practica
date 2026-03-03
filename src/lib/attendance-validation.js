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

function toMinutes(timeValue) {
    if (!timeValue || typeof timeValue !== 'string') return null;
    const parts = timeValue.split(':');
    if (parts.length < 2) return null;
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
    return hours * 60 + minutes;
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

function resolveScheduleTimeWindow({ date, dateKey, user, operator, classPlans, practiceSchedules, schedules }) {
    const dayName = WEEK_DAYS[date.getDay()];

    const bestPlan = getBestClassPlan(classPlans, user?.className, dateKey);
    if (bestPlan) {
        const schedule = (practiceSchedules || []).find((item) =>
            item?.id === bestPlan.scheduleId
            && item?.isActive !== false
            && isWithinDateRange(dateKey, item?.validFrom, item?.validTo)
            && Array.isArray(item?.daysOfWeek)
            && item.daysOfWeek.includes(dayName)
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

    const scheduleCandidates = (schedules || [])
        .filter((item) => item?.isActive !== false)
        .filter((item) => item?.operatorId === operator?.id)
        .filter((item) => !item?.className || item.className === user?.className)
        .filter((item) => Array.isArray(item?.daysOfWeek) && item.daysOfWeek.includes(dayName));

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
    const hasPeriodsConfigured = (periods || []).length > 0;
    const activePeriod = hasPeriodsConfigured ? getActivePeriod(periods, dateKey, user, operator) : null;
    const hasActivePeriod = !hasPeriodsConfigured || Boolean(activePeriod);

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
    }

    return {
        dateKey,
        hasPeriodsConfigured,
        hasActivePeriod,
        activePeriod,
        timeWindow,
        isWithinTimeWindow,
    };
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
        return makeResult({
            validationStatus: VALIDATION_STATUS.INVALIDA,
            validationReason: VALIDATION_REASON.IN_AFARA_INTERVALULUI,
            validationMessage: 'Nu exista o perioada de practica activa pentru data de azi.',
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
