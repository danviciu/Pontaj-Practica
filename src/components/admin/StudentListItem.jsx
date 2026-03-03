import React from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import StatusIndicator from '../attendance/StatusIndicator';
import { MapPin, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { getValidationReasonLabel } from '@/lib/attendance-labels';

const STATUS_LABELS = {
    VALIDA: 'Validata',
    INVALIDA: 'Respinsa',
    IN_ASTEPTARE: 'In asteptare',
    CORECTATA_MANUAL: 'Corectata manual',
    NEPONTAT: 'Nepontat',
    PENDING: 'Pending',
    ABSENT: 'Absent',
    PRESENT: 'Prezent',
};

function getStatusVariant(statusValue) {
    if (statusValue === 'VALIDA' || statusValue === 'CORECTATA_MANUAL' || statusValue === 'PRESENT') return 'default';
    if (statusValue === 'IN_ASTEPTARE' || statusValue === 'PENDING') return 'secondary';
    if (statusValue === 'NEPONTAT') return 'outline';
    return 'destructive';
}

function getCardBorderColor(statusValue) {
    if (statusValue === 'VALIDA' || statusValue === 'CORECTATA_MANUAL' || statusValue === 'PRESENT') return '#22c55e';
    if (statusValue === 'IN_ASTEPTARE' || statusValue === 'PENDING') return '#f59e0b';
    return '#ef4444';
}

function getStatusIndicatorVariant(statusValue) {
    if (statusValue === 'VALIDA' || statusValue === 'CORECTATA_MANUAL' || statusValue === 'PRESENT') return 'present';
    if (statusValue === 'IN_ASTEPTARE' || statusValue === 'PENDING') return 'pending';
    return 'absent';
}

export default function StudentListItem({ student, attendance, statusInfo, onClick }) {
    const statusValue = attendance?.validationStatus || statusInfo?.dashboardStatus || (attendance ? 'VALIDA' : 'NEPONTAT');
    const statusLabel = STATUS_LABELS[statusValue] || statusValue;
    const statusVariant = getStatusVariant(statusValue);
    const indicatorVariant = getStatusIndicatorVariant(statusValue);
    const reasonCode = attendance?.validationReason || statusInfo?.reason || (!attendance ? 'FARA_PONTAJ' : 'OK');
    const reasonLabel = getValidationReasonLabel(reasonCode);

    return (
        <Card
            className="p-4 hover:shadow-md transition-shadow cursor-pointer border-l-4"
            style={{ borderLeftColor: getCardBorderColor(statusValue) }}
            onClick={onClick}
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1">
                    <StatusIndicator
                        isPresent={indicatorVariant === 'present'}
                        variant={indicatorVariant}
                        size="large"
                    />
                    <div className="flex-1">
                        <p className="font-semibold text-base">{student.full_name}</p>
                        <p className="text-sm text-gray-500">Clasa {student.className || 'N/A'}</p>
                        <p className="text-xs text-gray-400 mt-1">{reasonLabel}</p>
                    </div>
                </div>

                <div className="text-right space-y-1">
                    <Badge variant={statusVariant} className="text-xs">
                        {statusLabel}
                    </Badge>
                    {attendance?.timestamp && (
                        <div className="flex items-center gap-1 text-xs text-gray-500">
                            <Clock className="h-3 w-3" />
                            {format(new Date(attendance.timestamp), 'HH:mm')}
                        </div>
                    )}
                </div>
            </div>

            {attendance && (
                <div className="mt-3 pt-3 border-t text-xs text-gray-600 space-y-1">
                    <div className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" />
                        <span>Distanta: {attendance.distanceMeters ?? '-'}m</span>
                    </div>
                    {typeof attendance.lat === 'number' && typeof attendance.lng === 'number' && (
                        <div className="text-gray-400">
                            Coordonate: {attendance.lat.toFixed(6)}, {attendance.lng.toFixed(6)}
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
}
