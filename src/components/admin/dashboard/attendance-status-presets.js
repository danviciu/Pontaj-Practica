export const DAY_STATUS = {
    PRESENT: 'PRESENT',
    JUSTIFIED_ABSENT: 'JUSTIFIED_ABSENT',
    ABSENT: 'ABSENT',
    PENDING: 'PENDING',
    NOT_APPLICABLE: 'NOT_APPLICABLE',
};

export const DAY_STATUS_META = {
    [DAY_STATUS.PRESENT]: {
        label: 'Prezent',
        shortLabel: 'P',
        swatchClassName: 'bg-emerald-500',
        badgeClassName: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    },
    [DAY_STATUS.JUSTIFIED_ABSENT]: {
        label: 'Absent motivat',
        shortLabel: 'M',
        swatchClassName: 'bg-sky-500',
        badgeClassName: 'bg-sky-100 text-sky-800 border-sky-200',
    },
    [DAY_STATUS.ABSENT]: {
        label: 'Absent nemotivat',
        shortLabel: 'A',
        swatchClassName: 'bg-red-500',
        badgeClassName: 'bg-red-100 text-red-800 border-red-200',
    },
    [DAY_STATUS.PENDING]: {
        label: 'In asteptare',
        shortLabel: 'I',
        swatchClassName: 'bg-amber-500',
        badgeClassName: 'bg-amber-100 text-amber-800 border-amber-200',
    },
    [DAY_STATUS.NOT_APPLICABLE]: {
        label: 'Fara program',
        shortLabel: '-',
        swatchClassName: 'bg-slate-400',
        badgeClassName: 'bg-slate-100 text-slate-700 border-slate-200',
    },
};

export function getDayStatusMeta(statusKind) {
    return DAY_STATUS_META[statusKind] || DAY_STATUS_META[DAY_STATUS.NOT_APPLICABLE];
}
