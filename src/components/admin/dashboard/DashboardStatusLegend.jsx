import React from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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

// Popover instead of an always-visible card: works identically via tap on
// touch devices (Radix triggers on click, not hover), and reclaims the
// vertical space the legend used to take permanently on the dashboard.
export default function DashboardStatusLegend() {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="gap-2">
                    <Info className="h-3.5 w-3.5" />
                    Legenda statusuri
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
                <p className="text-sm font-semibold mb-3">Ce inseamna culorile</p>
                <div className="space-y-3">
                    {LEGEND_ORDER.map((statusKind) => {
                        const meta = getDayStatusMeta(statusKind);
                        return (
                            <div key={statusKind} className="flex items-start gap-2.5">
                                <span className={`inline-flex h-2.5 w-2.5 rounded-full mt-1 flex-shrink-0 ${meta.swatchClassName}`} />
                                <div>
                                    <p className="text-sm font-medium leading-tight">{meta.label}</p>
                                    <p className="text-xs text-gray-500 leading-snug mt-0.5">
                                        {LEGEND_DESCRIPTION[statusKind]}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}
