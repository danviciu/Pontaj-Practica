import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { MapPin, Clock, Navigation, User, Building2 } from 'lucide-react';
import { format } from 'date-fns';
import { ro } from 'date-fns/locale';
import { getValidationReasonLabel } from '@/lib/attendance-labels';

const STATUS_LABELS = {
    VALIDA: 'Validata',
    INVALIDA: 'Respinsa',
    IN_ASTEPTARE: 'In asteptare',
    CORECTATA_MANUAL: 'Corectata manual',
};

function statusVariant(statusValue) {
    if (statusValue === 'VALIDA' || statusValue === 'CORECTATA_MANUAL') return 'default';
    if (statusValue === 'IN_ASTEPTARE') return 'secondary';
    return 'destructive';
}

export default function AttendanceDetailsModal({ student, attendance, operator, isOpen, onClose }) {
    if (!student) return null;

    const validationStatus = attendance?.validationStatus || (attendance ? 'VALIDA' : 'NEPONTAT');
    const validationReason = attendance?.validationReason || (attendance ? 'OK' : 'FARA_PONTAJ');
    const validationReasonLabel = getValidationReasonLabel(validationReason);
    const validationMessage = attendance?.validationMessage || '';

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="text-xl">Detalii prezenta</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                        <User className="h-5 w-5 text-blue-600 mt-0.5" />
                        <div>
                            <p className="font-semibold text-lg">{student.full_name}</p>
                            <p className="text-sm text-gray-600">Clasa {student.className || 'N/A'}</p>
                            <p className="text-xs text-gray-500 mt-1">{student.email}</p>
                        </div>
                    </div>

                    {attendance ? (
                        <>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="p-3 bg-gray-50 rounded-lg border">
                                    <p className="text-xs text-gray-600 font-medium mb-1">Status validare</p>
                                    <Badge variant={statusVariant(validationStatus)}>
                                        {STATUS_LABELS[validationStatus] || validationStatus}
                                    </Badge>
                                </div>
                                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                                    <p className="text-xs text-blue-700 font-medium mb-1">Data</p>
                                    <p className="text-sm font-semibold">
                                        {format(new Date(attendance.timestamp), 'd MMM yyyy', { locale: ro })}
                                    </p>
                                </div>
                            </div>

                            <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                                <p className="text-xs text-amber-800 font-medium mb-1">Motiv</p>
                                <p className="text-sm font-semibold text-amber-900">{validationReasonLabel}</p>
                                {validationMessage && (
                                    <p className="text-xs text-amber-700 mt-1">{validationMessage}</p>
                                )}
                            </div>

                            <div className="space-y-3">
                                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                                    <Clock className="h-5 w-5 text-gray-600" />
                                    <div>
                                        <p className="text-xs text-gray-500">Ora inregistrarii</p>
                                        <p className="font-semibold">{format(new Date(attendance.timestamp), 'HH:mm:ss')}</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                                    <Navigation className="h-5 w-5 text-gray-600" />
                                    <div>
                                        <p className="text-xs text-gray-500">Distanta fata de operator</p>
                                        <p className="font-semibold">{attendance.distanceMeters} metri</p>
                                        {attendance.allowedRadiusMeters && (
                                            <p className="text-xs text-gray-400">Raza permisa: {attendance.allowedRadiusMeters}m</p>
                                        )}
                                        {attendance.accuracyMeters && (
                                            <p className="text-xs text-gray-400">Acuratete GPS: ±{Math.round(attendance.accuracyMeters)}m</p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {typeof attendance.lat === 'number' && typeof attendance.lng === 'number' && (
                                <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                                    <div className="flex items-start gap-3">
                                        <MapPin className="h-5 w-5 text-blue-600 mt-0.5" />
                                        <div className="flex-1">
                                            <p className="text-xs text-blue-700 font-medium mb-2">Coordonate GPS</p>
                                            <div className="space-y-1 text-sm font-mono">
                                                <p>Lat: {attendance.lat.toFixed(6)}</p>
                                                <p>Lng: {attendance.lng.toFixed(6)}</p>
                                            </div>
                                            <a
                                                href={`https://www.google.com/maps?q=${attendance.lat},${attendance.lng}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-blue-600 hover:text-blue-800 underline mt-2 inline-block"
                                            >
                                                Vezi pe Google Maps →
                                            </a>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {operator && (
                                <div className="p-4 bg-gray-50 rounded-lg">
                                    <div className="flex items-start gap-3">
                                        <Building2 className="h-5 w-5 text-gray-600 mt-0.5" />
                                        <div>
                                            <p className="text-xs text-gray-500 mb-1">Operator economic</p>
                                            <p className="font-semibold">{operator.name}</p>
                                            {operator.address && (
                                                <p className="text-sm text-gray-600 mt-1">{operator.address}</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </>
                    ) : (
                        <div className="p-8 text-center">
                            <Badge variant="destructive" className="mb-3">Nepontat</Badge>
                            <p className="text-gray-600">Nu exista inregistrare pentru ziua selectata.</p>
                        </div>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
