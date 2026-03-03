import React, { useEffect, useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MapPin, Building2, Calendar, Navigation, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AttendanceButton from '@/components/attendance/AttendanceButton';
import StatusIndicator from '@/components/attendance/StatusIndicator';
import { getDateKey } from '../components/utils/geolocation';
import { format } from 'date-fns';
import { ro } from 'date-fns/locale';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { getAttendanceWindow } from '@/lib/attendance-validation';
import { toast } from '@/components/ui/use-toast';

const STATUS_LABELS = {
    VALIDA: 'Validata',
    INVALIDA: 'Respinsa',
    IN_ASTEPTARE: 'In asteptare',
    CORECTATA_MANUAL: 'Corectata manual',
    NEPONTAT: 'Nepontat',
};

function badgeVariantForStatus(statusValue) {
    if (statusValue === 'VALIDA' || statusValue === 'CORECTATA_MANUAL') return 'default';
    if (statusValue === 'IN_ASTEPTARE') return 'secondary';
    if (statusValue === 'NEPONTAT') return 'outline';
    return 'destructive';
}

function isPresentStatus(statusValue) {
    return statusValue === 'VALIDA' || statusValue === 'CORECTATA_MANUAL';
}

export default function StudentHome() {
    const navigate = useNavigate();
    const [user, setUser] = useState(null);
    const [operator, setOperator] = useState(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [isLoadingUser, setIsLoadingUser] = useState(true);
    const [userLoadError, setUserLoadError] = useState('');

    useEffect(() => {
        async function loadUser() {
            setIsLoadingUser(true);
            setUserLoadError('');

            try {
                const currentUser = await Promise.race([
                    base44.auth.me(),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('Timeout la incarcarea profilului.')), 10000)
                    ),
                ]);

                if (!currentUser?.id) {
                    throw new Error('Nu am putut citi profilul utilizatorului.');
                }

                if (!currentUser.full_name || !currentUser.className || !currentUser.specialization) {
                    navigate(createPageUrl('OnboardingSetup'));
                    return;
                }

                setUser(currentUser);

                if (currentUser.operatorId) {
                    const ops = await base44.entities.Operator.filter({ id: currentUser.operatorId });
                    if (ops.length > 0) setOperator(ops[0]);
                }
            } catch (error) {
                if (error?.status === 401 || error?.status === 403) {
                    base44.auth.redirectToLogin(window.location.href);
                    return;
                }
                setUserLoadError(error?.message || 'Nu am putut incarca datele utilizatorului.');
            } finally {
                setIsLoadingUser(false);
            }
        }

        loadUser();
    }, [navigate]);

    const { data: todayAttendance } = useQuery({
        queryKey: ['todayAttendance', user?.id, refreshKey],
        queryFn: async () => {
            if (!user) return [];
            return await base44.entities.Attendance.filter({
                studentUserId: user.id,
                dateKey: getDateKey(),
            });
        },
        enabled: !!user,
    });

    const { data: recentAttendance } = useQuery({
        queryKey: ['recentAttendance', user?.id, refreshKey],
        queryFn: async () => {
            if (!user) return [];
            return await base44.entities.Attendance.filter(
                { studentUserId: user.id },
                '-created_date',
                7
            );
        },
        enabled: !!user,
    });

    const { data: periods = [] } = useQuery({
        queryKey: ['periods'],
        queryFn: () => base44.entities.PracticePeriod.list('-created_date', 200),
    });

    const { data: classPlans = [] } = useQuery({
        queryKey: ['classPracticePlans'],
        queryFn: () => base44.entities.ClassPracticePlan.list('-priority', 200),
    });

    const { data: practiceSchedules = [] } = useQuery({
        queryKey: ['practiceSchedules'],
        queryFn: () => base44.entities.PracticeSchedule.list('-created_date', 200),
    });

    const { data: schedules = [] } = useQuery({
        queryKey: ['operatorSchedules'],
        queryFn: () => base44.entities.Schedule.list('-created_date', 200),
    });

    const todayRecord = todayAttendance?.[0] || null;
    const todayStatus = todayRecord?.validationStatus || (todayRecord ? 'VALIDA' : 'NEPONTAT');
    const todayReason = todayRecord?.validationReason || (todayRecord ? 'OK' : 'FARA_PONTAJ');
    const todayMessage =
        todayRecord?.validationMessage ||
        (todayRecord ? 'Prezenta a fost inregistrata.' : 'Nu exista pontaj pentru azi.');
    const canCheckIn = !todayRecord;

    const attendanceWindow = useMemo(() => {
        if (!user || !operator) return null;
        return getAttendanceWindow({
            now: new Date(),
            user,
            operator,
            periods,
            classPlans,
            practiceSchedules,
            schedules,
        });
    }, [user, operator, periods, classPlans, practiceSchedules, schedules]);

    useEffect(() => {
        if (!user?.id || !operator?.id || todayRecord || !attendanceWindow) return;
        if (!attendanceWindow.hasActivePeriod || !attendanceWindow.isWithinTimeWindow) return;
        if (!attendanceWindow.timeWindow?.start || !attendanceWindow.timeWindow?.end) return;

        const reminderKey = `attendance.reminder.${user.id}.${getDateKey()}`;
        const lastReminder = Number(window.localStorage.getItem(reminderKey) || 0);
        const nowTs = Date.now();
        if (nowTs - lastReminder < 15 * 60 * 1000) return;

        window.localStorage.setItem(reminderKey, String(nowTs));
        toast({
            title: 'Reminder prezenta',
            description: `Poti marca prezenta azi intre ${attendanceWindow.timeWindow.start} si ${attendanceWindow.timeWindow.end}.`,
        });
    }, [user, operator, todayRecord, attendanceWindow]);

    if (isLoadingUser) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
        );
    }

    if (userLoadError) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4">
                <Card className="max-w-md w-full">
                    <CardHeader>
                        <CardTitle>Nu am putut incarca pagina</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <p className="text-sm text-gray-600">{userLoadError}</p>
                        <div className="flex gap-2">
                            <Button onClick={() => window.location.reload()} className="flex-1">
                                Reincarca
                            </Button>
                            <Button
                                variant="outline"
                                className="flex-1"
                                onClick={() => base44.auth.redirectToLogin(window.location.href)}
                            >
                                Login
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    if (!user) {
        return null;
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-4 pb-20">
            <div className="max-w-2xl mx-auto space-y-4">
                <div className="flex items-center justify-between pt-4">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">{user.full_name}</h1>
                        <p className="text-sm text-gray-500">
                            Clasa {user.className} • {user.specialization}
                        </p>
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => base44.auth.logout()}
                        className="text-gray-500 hover:text-gray-700"
                    >
                        <LogOut className="h-5 w-5" />
                    </Button>
                </div>

                <Card className="border-2 shadow-md">
                    <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                            <CardTitle className="text-lg">Status azi</CardTitle>
                            <StatusIndicator isPresent={isPresentStatus(todayStatus)} size="large" />
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex items-center justify-between">
                            <span className="text-2xl font-bold">
                                {STATUS_LABELS[todayStatus] || todayStatus}
                            </span>
                            <Badge variant={badgeVariantForStatus(todayStatus)} className="text-sm">
                                {format(new Date(), 'd MMMM yyyy', { locale: ro })}
                            </Badge>
                        </div>
                        <div className="text-sm text-gray-600">
                            <p><span className="font-semibold">Motiv:</span> {todayReason}</p>
                            <p><span className="font-semibold">Detalii:</span> {todayMessage}</p>
                        </div>
                    </CardContent>
                </Card>

                {attendanceWindow && (
                    <Card className="shadow-md border-slate-200">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Regula de pontaj</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2 text-sm">
                            <p>
                                <span className="font-semibold">Data:</span>{' '}
                                {attendanceWindow.hasPeriodsConfigured
                                    ? (attendanceWindow.hasActivePeriod
                                    ? `${attendanceWindow.activePeriod?.startDate || '-'} - ${attendanceWindow.activePeriod?.endDate || '-'}`
                                    : 'azi NU exista perioada activa')
                                    : 'fara restrictie explicita de perioada'}
                            </p>
                            <p>
                                <span className="font-semibold">Ora:</span>{' '}
                                {attendanceWindow.timeWindow?.start && attendanceWindow.timeWindow?.end
                                    ? `${attendanceWindow.timeWindow.start} - ${attendanceWindow.timeWindow.end}`
                                    : 'conform programului setat de admin'}
                            </p>
                            <p className={`${attendanceWindow.hasActivePeriod && attendanceWindow.isWithinTimeWindow ? 'text-green-700' : 'text-red-700'} font-medium`}>
                                {attendanceWindow.hasActivePeriod && attendanceWindow.isWithinTimeWindow
                                    ? 'Pontaj permis acum.'
                                    : 'Pontaj indisponibil acum.'}
                            </p>
                        </CardContent>
                    </Card>
                )}

                {operator && (
                    <Card className="shadow-md">
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Building2 className="h-5 w-5 text-blue-600" />
                                Locul de practica
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <div>
                                <p className="font-semibold text-lg">{operator.name}</p>
                                {operator.address && (
                                    <p className="text-sm text-gray-600 flex items-start gap-1 mt-1">
                                        <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                        {operator.address}
                                    </p>
                                )}
                            </div>
                            <div className="flex items-center gap-2 text-sm text-gray-500 pt-2 border-t">
                                <Navigation className="h-4 w-4" />
                                <span>Raza permisa: {operator.radiusMeters}m</span>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {canCheckIn && (
                    <AttendanceButton
                        user={user}
                        operator={operator}
                        onSuccess={() => setRefreshKey((k) => k + 1)}
                    />
                )}

                <Card className="shadow-md">
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Calendar className="h-5 w-5 text-blue-600" />
                            Istoric prezenta (ultimele 7 zile)
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {recentAttendance && recentAttendance.length > 0 ? (
                            <div className="space-y-3">
                                {recentAttendance.map((record) => {
                                    const recordStatus = record.validationStatus || 'VALIDA';
                                    const recordReason = record.validationReason || 'OK';
                                    return (
                                        <div
                                            key={record.id}
                                            className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                                        >
                                            <div className="flex items-center gap-3">
                                                <StatusIndicator isPresent={isPresentStatus(recordStatus)} />
                                                <div>
                                                    <p className="font-medium text-sm">
                                                        {format(new Date(record.timestamp), 'd MMMM yyyy', { locale: ro })}
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                        {format(new Date(record.timestamp), 'HH:mm')} • {record.distanceMeters}m
                                                    </p>
                                                    <p className="text-xs text-gray-500">
                                                        {recordReason}
                                                    </p>
                                                </div>
                                            </div>
                                            <Badge variant={badgeVariantForStatus(recordStatus)} className="text-xs">
                                                {STATUS_LABELS[recordStatus] || recordStatus}
                                            </Badge>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <p className="text-center text-gray-500 py-4">Nu exista inregistrari</p>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
