import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { Loader2, MapPin, AlertTriangle } from 'lucide-react';
import { calculateDistance, getCurrentPosition, getDateKey } from '@/components/utils/geolocation';
import {
    validateAttendanceAttempt,
    VALIDATION_STATUS,
    VALIDATION_REASON,
} from '@/lib/attendance-validation';

export default function AttendanceButton({ user, operator, onSuccess }) {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [distanceMeters, setDistanceMeters] = useState(null);

    const handleCheckIn = async () => {
        try {
            setIsSubmitting(true);

            if (!user?.id) {
                throw new Error('Utilizator invalid. Reincarca pagina si incearca din nou.');
            }

            if (!operator?.id) {
                throw new Error('Nu ai operator alocat. Contacteaza profesorul coordonator.');
            }

            if (typeof operator.lat !== 'number' || typeof operator.lng !== 'number') {
                throw new Error('Locatia operatorului nu este configurata corect.');
            }

            const dateKey = getDateKey();
            const existing = await base44.entities.Attendance.filter({
                studentUserId: user.id,
                dateKey,
            });

            const position = await getCurrentPosition();
            const rawDistance = calculateDistance(position.lat, position.lng, operator.lat, operator.lng);
            const roundedDistance = Math.round(rawDistance);
            setDistanceMeters(roundedDistance);

            const [periods, classPlans, practiceSchedules, schedules] = await Promise.all([
                base44.entities.PracticePeriod.list('-created_date', 200),
                base44.entities.ClassPracticePlan.list('-priority', 200),
                base44.entities.PracticeSchedule.list('-created_date', 200),
                base44.entities.Schedule.list('-created_date', 200),
            ]);

            const validation = validateAttendanceAttempt({
                now: new Date(),
                user,
                operator,
                existingAttendances: existing,
                periods,
                classPlans,
                practiceSchedules,
                schedules,
                distanceMeters: roundedDistance,
                accuracyMeters: position.accuracy,
            });

            if (validation.validationStatus !== VALIDATION_STATUS.VALIDA) {
                const titleMap = {
                    [VALIDATION_REASON.DUPLICAT_ZI]: 'Prezență deja înregistrată',
                    [VALIDATION_REASON.IN_AFARA_RAZEI]: 'Prezență respinsă',
                    [VALIDATION_REASON.IN_AFARA_INTERVALULUI]: 'Pontaj nepermis la această oră',
                    [VALIDATION_REASON.GPS_SLAB]: 'Precizie GPS insuficientă',
                    [VALIDATION_REASON.ELEV_INACTIV]: 'Cont inactiv',
                    [VALIDATION_REASON.FARA_OPERATOR]: 'Operator nealocat',
                };

                toast({
                    variant: 'destructive',
                    title: titleMap[validation.validationReason] || 'Nu am putut înregistra prezența',
                    description: validation.validationMessage,
                });
                return;
            }

            await base44.entities.Attendance.create({
                studentUserId: user.id,
                studentName: user.full_name || '',
                className: user.className || '',
                operatorId: operator.id,
                operatorName: operator.name || '',
                dateKey,
                timestamp: new Date().toISOString(),
                lat: position.lat,
                lng: position.lng,
                accuracyMeters: position.accuracy,
                distanceMeters: roundedDistance,
                allowedRadiusMeters: validation.allowedRadiusMeters,
                checkinWindowStart: validation.checkinWindowStart,
                checkinWindowEnd: validation.checkinWindowEnd,
                validationStatus: validation.validationStatus,
                validationReason: validation.validationReason,
                validationMessage: validation.validationMessage,
                requiresReview: validation.requiresReview,
                status: 'present',
            });

            toast({
                title: 'Prezenta inregistrata',
                description: `${validation.validationMessage} (${roundedDistance}m fata de operator).`,
            });
            onSuccess?.();
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Nu am putut inregistra prezenta',
                description: error?.message || 'A aparut o eroare neasteptata.',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!operator) {
        return (
            <Card className="border-amber-200 bg-amber-50">
                <CardContent className="pt-6">
                    <div className="flex items-start gap-3 text-amber-900">
                        <AlertTriangle className="h-5 w-5 mt-0.5" />
                        <div>
                            <p className="font-semibold">Nu ai un operator alocat</p>
                            <p className="text-sm">
                                Prezenta se poate pune doar dupa alocarea unui loc de practica.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="shadow-md border-blue-100">
            <CardContent className="pt-6 space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="font-semibold text-gray-900">Marcheaza prezenta</p>
                        <p className="text-sm text-gray-600">Operator: {operator.name}</p>
                    </div>
                    <Badge variant="outline">Raza: {Number(operator.radiusMeters) || 200}m</Badge>
                </div>

                <Button
                    onClick={handleCheckIn}
                    disabled={isSubmitting}
                    className="w-full bg-blue-600 hover:bg-blue-700"
                >
                    {isSubmitting ? (
                        <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Se verifica locatia...
                        </>
                    ) : (
                        <>
                            <MapPin className="h-4 w-4 mr-2" />
                            Pune prezenta acum
                        </>
                    )}
                </Button>

                {distanceMeters !== null && (
                    <p className="text-xs text-gray-500 text-center">
                        Distanta detectata la ultima verificare: {distanceMeters}m
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
