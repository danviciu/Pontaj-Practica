import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/use-toast';
import { Loader2, MapPin, AlertTriangle } from 'lucide-react';
import { calculateDistance, getCurrentPosition } from '@/components/utils/geolocation';
import { getDeviceInfo } from '@/lib/device-info';

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

            const position = await getCurrentPosition();
            const rawDistance = calculateDistance(position.lat, position.lng, operator.lat, operator.lng);
            const roundedDistance = Math.round(rawDistance);
            setDistanceMeters(roundedDistance);

            const deviceInfo = getDeviceInfo();
            const result = await base44.attendance.checkIn({
                lat: position.lat,
                lng: position.lng,
                accuracyMeters: position.accuracy,
                isMocked: position.isMocked === true,
                mockCheckAvailable: position.mockCheckAvailable === true,
                deviceLabel: deviceInfo.deviceLabel,
                devicePlatform: deviceInfo.devicePlatform,
            });

            const attendance = result?.attendance || null;
            const validationMessage = attendance?.validationMessage || result?.message || 'Prezenta a fost validata automat.';
            const validatedDistance = Number.isFinite(Number(attendance?.distanceMeters))
                ? Number(attendance.distanceMeters)
                : roundedDistance;

            setDistanceMeters(Math.round(validatedDistance));

            toast({
                title: 'Prezenta inregistrata',
                description: `${validationMessage} (${Math.round(validatedDistance)}m fata de operator).`,
            });
            onSuccess?.();
        } catch (error) {
            toast({
                variant: 'destructive',
                title: 'Nu am putut inregistra prezenta',
                description: error?.data?.validationMessage || error?.message || 'A aparut o eroare neasteptata.',
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
