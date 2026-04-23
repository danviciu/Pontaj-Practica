import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DAY_STATUS, getDayStatusMeta } from './attendance-status-presets';

const LEGEND_ORDER = [
    DAY_STATUS.PRESENT,
    DAY_STATUS.JUSTIFIED_ABSENT,
    DAY_STATUS.ABSENT,
    DAY_STATUS.PENDING,
    DAY_STATUS.NOT_APPLICABLE,
];

const LEGEND_DESCRIPTION = {
    [DAY_STATUS.PRESENT]: 'Elevul a pontat valid in ziua respectiva.',
    [DAY_STATUS.JUSTIFIED_ABSENT]: 'Absenta este justificata si aprobata de admin.',
    [DAY_STATUS.ABSENT]: 'Nu exista pontaj valid si nici justificare aprobata.',
    [DAY_STATUS.PENDING]: 'Ziua este in curs sau urmeaza sa fie pontata.',
    [DAY_STATUS.NOT_APPLICABLE]: 'Zi in afara programului/perioadei de practica.',
};

export default function DashboardStatusLegend() {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">Legenda statusuri</CardTitle>
            </CardHeader>
            <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
                    {LEGEND_ORDER.map((statusKind) => {
                        const meta = getDayStatusMeta(statusKind);
                        return (
                            <div key={statusKind} className="rounded-lg border p-3 space-y-2">
                                <div className="flex items-center gap-2">
                                    <span className={`inline-flex h-3 w-3 rounded-full ${meta.swatchClassName}`} />
                                    <p className="font-medium text-sm">{meta.label}</p>
                                </div>
                                <p className="text-xs text-gray-600">
                                    {LEGEND_DESCRIPTION[statusKind]}
                                </p>
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}
