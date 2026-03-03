import React, { useMemo, useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, subDays } from 'date-fns';

import { getDateKey } from '../components/utils/geolocation';
import { getAttendanceWindow } from '@/lib/attendance-validation';

import DashboardHeader from '@/components/admin/dashboard/DashboardHeader';
import DashboardCharts from '@/components/admin/dashboard/DashboardCharts';
import DashboardFilters from '@/components/admin/dashboard/DashboardFilters';
import DashboardStudentLists from '@/components/admin/dashboard/DashboardStudentLists';
import DashboardKpiReport from '@/components/admin/dashboard/DashboardKpiReport';
import DashboardAuditTrail from '@/components/admin/dashboard/DashboardAuditTrail';
import AddStudentsModal from '@/components/admin/dashboard/modals/AddStudentsModal';
import CredentialsModal from '@/components/admin/dashboard/modals/CredentialsModal';
import AttendanceDetailsModal from '@/components/admin/AttendanceDetailsModal';
import { listAuditEvents } from '@/lib/audit-log';
import { toast } from '@/components/ui/use-toast';

const VALID_PRESENT_STATUSES = new Set(['VALIDA', 'CORECTATA_MANUAL']);

const DASHBOARD_STATUS = {
    PRESENT: 'PRESENT',
    ABSENT: 'ABSENT',
    PENDING: 'PENDING',
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

function getSelectedDateReference(selectedDate) {
    const candidate = new Date(`${selectedDate}T12:00:00`);
    if (Number.isNaN(candidate.getTime())) {
        return new Date();
    }
    return candidate;
}

function getNoAttendanceStatusInfo({
    student,
    operator,
    selectedDate,
    todayDateKey,
    nowMinutes,
    selectedDateReference,
    periods,
    classPlans,
    practiceSchedules,
    schedules,
}) {
    if (!operator?.id) {
        return {
            dashboardStatus: DASHBOARD_STATUS.PENDING,
            reason: 'FARA_OPERATOR',
            hasAttendance: false,
            validationStatus: 'NEPONTAT',
        };
    }

    const windowInfo = getAttendanceWindow({
        now: selectedDateReference,
        user: student,
        operator,
        periods,
        classPlans,
        practiceSchedules,
        schedules,
    });

    const isDateInsideConfiguredPeriod = !windowInfo.hasPeriodsConfigured || windowInfo.hasActivePeriod;

    if (!isDateInsideConfiguredPeriod) {
        return {
            dashboardStatus: DASHBOARD_STATUS.PENDING,
            reason: 'INAFARA_PERIOADEI',
            hasAttendance: false,
            validationStatus: 'NEPONTAT',
        };
    }

    if (selectedDate > todayDateKey) {
        return {
            dashboardStatus: DASHBOARD_STATUS.PENDING,
            reason: 'DATA_IN_VIITOR',
            hasAttendance: false,
            validationStatus: 'NEPONTAT',
        };
    }

    if (selectedDate < todayDateKey) {
        return {
            dashboardStatus: DASHBOARD_STATUS.ABSENT,
            reason: 'FARA_PONTAJ',
            hasAttendance: false,
            validationStatus: 'NEPONTAT',
        };
    }

    const windowEndMinutes = toMinutes(windowInfo.timeWindow?.end);
    if (windowEndMinutes !== null && nowMinutes > windowEndMinutes) {
        return {
            dashboardStatus: DASHBOARD_STATUS.ABSENT,
            reason: 'FARA_PONTAJ',
            hasAttendance: false,
            validationStatus: 'NEPONTAT',
        };
    }

    return {
        dashboardStatus: DASHBOARD_STATUS.PENDING,
        reason: 'IN_ASTEPTARE_PONTAJ',
        hasAttendance: false,
        validationStatus: 'NEPONTAT',
    };
}

function getStatusMessageForExport(statusInfo) {
    if (!statusInfo) return '';

    if (statusInfo.dashboardStatus === DASHBOARD_STATUS.PENDING) {
        switch (statusInfo.reason) {
        case 'DATA_IN_VIITOR':
            return 'Data selectata este in viitor.';
        case 'INAFARA_PERIOADEI':
            return 'Nu exista perioada activa pentru aceasta data.';
        case 'FARA_OPERATOR':
            return 'Elevul nu are operator alocat.';
        default:
            return 'Pontaj in asteptare pentru data selectata.';
        }
    }

    if (statusInfo.dashboardStatus === DASHBOARD_STATUS.ABSENT && statusInfo.reason === 'FARA_PONTAJ') {
        return 'Nu exista pontaj valid pentru data selectata.';
    }

    return '';
}

function listDateKeysInRange(startDateKey, endDateKey) {
    const start = new Date(`${startDateKey}T00:00:00`);
    const end = new Date(`${endDateKey}T00:00:00`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
        return [getDateKey()];
    }

    const keys = [];
    const cursor = new Date(start);
    while (cursor <= end) {
        keys.push(cursor.toISOString().split('T')[0]);
        cursor.setDate(cursor.getDate() + 1);
    }
    return keys;
}

function isDashboardPresentStatus(statusValue) {
    return statusValue === 'VALIDA' || statusValue === 'CORECTATA_MANUAL';
}

function getAttendanceRate(present, expected) {
    if (!expected) return 0;
    return (present / expected) * 100;
}

export default function AdminDashboard() {
    const queryClient = useQueryClient();
    const [selectedDate, setSelectedDate] = useState(getDateKey());
    const [selectedOperator, setSelectedOperator] = useState('all');
    const [selectedClass, setSelectedClass] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedStudent, setSelectedStudent] = useState(null);
    const [selectedAttendance, setSelectedAttendance] = useState(null);
    const [selectedOperatorData, setSelectedOperatorData] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [addStudentModalOpen, setAddStudentModalOpen] = useState(false);
    const [credentialsModalOpen, setCredentialsModalOpen] = useState(false);
    const [selectedPeriod, setSelectedPeriod] = useState('all');
    const [selectedValidationStatus, setSelectedValidationStatus] = useState('all');
    const [selectedValidationReason, setSelectedValidationReason] = useState('all');
    const [newStudents, setNewStudents] = useState([{ fullName: '', className: '' }]);
    const [generatedCredentials, setGeneratedCredentials] = useState([]);
    const [isAddingStudents, setIsAddingStudents] = useState(false);

    const { data: operators = [] } = useQuery({
        queryKey: ['operators'],
        queryFn: () => base44.entities.Operator.list('-created_date', 100),
    });

    const { data: students = [] } = useQuery({
        queryKey: ['students'],
        queryFn: async () => {
            const users = await base44.entities.User.list('-created_date', 500);
            return users.filter((entry) => entry.role === 'user' || !entry.role);
        },
    });

    const { data: attendances = [] } = useQuery({
        queryKey: ['attendances', selectedDate],
        queryFn: () => base44.entities.Attendance.filter({ dateKey: selectedDate }, '-created_date', 500),
    });

    const { data: periods = [] } = useQuery({
        queryKey: ['periods'],
        queryFn: () => base44.entities.PracticePeriod.list('-created_date', 100),
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

    const selectedPeriodEntity = useMemo(
        () => periods.find((entry) => entry.id === selectedPeriod) || null,
        [periods, selectedPeriod]
    );

    const reportRange = useMemo(() => {
        if (selectedPeriodEntity?.startDate && selectedPeriodEntity?.endDate) {
            return {
                startDateKey: selectedPeriodEntity.startDate,
                endDateKey: selectedPeriodEntity.endDate,
                label: `${selectedPeriodEntity.name} (${selectedPeriodEntity.startDate} - ${selectedPeriodEntity.endDate})`,
            };
        }
        return {
            startDateKey: selectedDate,
            endDateKey: selectedDate,
            label: `Data selectata: ${selectedDate}`,
        };
    }, [selectedPeriodEntity, selectedDate]);

    const reportDateKeys = useMemo(
        () => listDateKeysInRange(reportRange.startDateKey, reportRange.endDateKey),
        [reportRange]
    );

    const { data: weekAttendances = [] } = useQuery({
        queryKey: ['weekAttendances'],
        queryFn: async () => {
            const last7Days = Array.from({ length: 7 }, (_, index) => {
                const date = subDays(new Date(), 6 - index);
                return format(date, 'yyyy-MM-dd');
            });

            const allAttendances = await Promise.all(
                last7Days.map((dateKey) => (
                    base44.entities.Attendance.filter({ dateKey }, '-created_date', 500)
                ))
            );

            return last7Days.map((dateKey, index) => ({
                date: dateKey,
                count: allAttendances[index].length,
            }));
        },
    });

    const { data: reportAttendances = [] } = useQuery({
        queryKey: ['reportAttendances', reportRange.startDateKey, reportRange.endDateKey],
        queryFn: async () => {
            if (!reportDateKeys.length) return [];
            const byDay = await Promise.all(
                reportDateKeys.map((dateKey) => base44.entities.Attendance.filter({ dateKey }, '-created_date', 500))
            );
            return byDay.flat();
        },
    });

    const { data: auditLogs = [] } = useQuery({
        queryKey: ['auditLogs'],
        queryFn: () => listAuditEvents(25),
    });

    const attendancesByStudentId = useMemo(() => (
        new Map(attendances.map((attendanceItem) => [attendanceItem.studentUserId, attendanceItem]))
    ), [attendances]);

    const operatorsById = useMemo(() => {
        const map = new Map();
        operators.forEach((operatorItem) => {
            map.set(operatorItem.id, operatorItem);
        });
        return map;
    }, [operators]);

    const validationStatuses = [
        ...new Set(attendances.map((attendanceItem) => attendanceItem.validationStatus).filter(Boolean)),
    ];

    const classes = [...new Set(students.map((entry) => entry.className).filter(Boolean))];

    let periodFilteredStudents = students;
    if (selectedPeriod !== 'all') {
        const period = periods.find((entry) => entry.id === selectedPeriod);
        if (period) {
            periodFilteredStudents = students.filter((student) => {
                if (period.className && student.className !== period.className) return false;
                if (period.operatorId && student.operatorId !== period.operatorId) return false;
                return true;
            });
        }
    }

    const todayDateKey = getDateKey();
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const selectedDateReference = useMemo(() => getSelectedDateReference(selectedDate), [selectedDate]);

    const studentStatusInfoById = useMemo(() => {
        const map = new Map();

        periodFilteredStudents.forEach((student) => {
            const attendance = attendancesByStudentId.get(student.id);

            if (attendance) {
                const validationStatus = attendance.validationStatus || 'VALIDA';
                if (VALID_PRESENT_STATUSES.has(validationStatus)) {
                    map.set(student.id, {
                        dashboardStatus: DASHBOARD_STATUS.PRESENT,
                        reason: attendance.validationReason || 'OK',
                        hasAttendance: true,
                        validationStatus,
                    });
                    return;
                }

                if (validationStatus === 'IN_ASTEPTARE') {
                    map.set(student.id, {
                        dashboardStatus: DASHBOARD_STATUS.PENDING,
                        reason: attendance.validationReason || 'IN_ASTEPTARE',
                        hasAttendance: true,
                        validationStatus,
                    });
                    return;
                }

                map.set(student.id, {
                    dashboardStatus: DASHBOARD_STATUS.ABSENT,
                    reason: attendance.validationReason || 'RESPINS',
                    hasAttendance: true,
                    validationStatus,
                });
                return;
            }

            const operator = operatorsById.get(student.operatorId);
            map.set(
                student.id,
                getNoAttendanceStatusInfo({
                    student,
                    operator,
                    selectedDate,
                    todayDateKey,
                    nowMinutes,
                    selectedDateReference,
                    periods,
                    classPlans,
                    practiceSchedules,
                    schedules,
                })
            );
        });

        return map;
    }, [
        periodFilteredStudents,
        attendancesByStudentId,
        operatorsById,
        selectedDate,
        todayDateKey,
        nowMinutes,
        selectedDateReference,
        periods,
        classPlans,
        practiceSchedules,
        schedules,
    ]);

    const validationReasons = useMemo(() => (
        [
            ...new Set([
                ...attendances.map((attendanceItem) => attendanceItem.validationReason).filter(Boolean),
                ...Array.from(studentStatusInfoById.values()).map((statusInfo) => statusInfo.reason).filter(Boolean),
            ]),
        ]
    ), [attendances, studentStatusInfoById]);

    const filteredStudents = periodFilteredStudents.filter((student) => {
        const attendanceForStudent = attendancesByStudentId.get(student.id);
        const statusInfo = studentStatusInfoById.get(student.id);

        if (selectedOperator !== 'all' && student.operatorId !== selectedOperator) return false;
        if (selectedClass !== 'all' && student.className !== selectedClass) return false;

        if (selectedValidationStatus === 'NEPONTAT' && statusInfo?.hasAttendance) return false;
        if (selectedValidationStatus === 'PENDING' && statusInfo?.dashboardStatus !== DASHBOARD_STATUS.PENDING) return false;
        if (selectedValidationStatus === 'ABSENT' && statusInfo?.dashboardStatus !== DASHBOARD_STATUS.ABSENT) return false;
        if (
            selectedValidationStatus !== 'all'
            && !['NEPONTAT', 'PENDING', 'ABSENT'].includes(selectedValidationStatus)
            && (!attendanceForStudent || (attendanceForStudent.validationStatus || 'VALIDA') !== selectedValidationStatus)
        ) {
            return false;
        }

        if (selectedValidationReason !== 'all' && statusInfo?.reason !== selectedValidationReason) return false;

        const studentName = String(student.full_name || '').toLowerCase();
        if (searchTerm && !studentName.includes(searchTerm.toLowerCase())) return false;

        return true;
    });

    const studentsForKpi = periodFilteredStudents.filter((student) => {
        if (selectedOperator !== 'all' && student.operatorId !== selectedOperator) return false;
        if (selectedClass !== 'all' && student.className !== selectedClass) return false;
        return true;
    });

    const reportAttendanceByStudentDay = useMemo(() => {
        const map = new Map();
        reportAttendances.forEach((attendanceItem) => {
            const key = `${attendanceItem.dateKey}|${attendanceItem.studentUserId}`;
            if (!map.has(key)) {
                map.set(key, attendanceItem);
            }
        });
        return map;
    }, [reportAttendances]);

    const kpiReport = useMemo(() => {
        const todayKey = getDateKey();
        const summary = { expected: 0, present: 0, absent: 0, pending: 0, rate: 0 };
        const byClassMap = new Map();
        const byOperatorMap = new Map();

        const ensureBucket = (bucketMap, name) => {
            if (!bucketMap.has(name)) {
                bucketMap.set(name, { name, expected: 0, present: 0, absent: 0, pending: 0, rate: 0 });
            }
            return bucketMap.get(name);
        };

        studentsForKpi.forEach((student) => {
            const operator = operatorsById.get(student.operatorId);
            const classBucket = ensureBucket(byClassMap, student.className || 'Fara clasa');
            const operatorBucket = ensureBucket(byOperatorMap, operator?.name || 'Nealocat');

            reportDateKeys.forEach((dateKey) => {
                const dateRef = new Date(`${dateKey}T12:00:00`);
                const windowInfo = getAttendanceWindow({
                    now: dateRef,
                    user: student,
                    operator,
                    periods,
                    classPlans,
                    practiceSchedules,
                    schedules,
                });

                const isExpected = !windowInfo.hasPeriodsConfigured || windowInfo.hasActivePeriod;
                if (!isExpected) return;

                summary.expected += 1;
                classBucket.expected += 1;
                operatorBucket.expected += 1;

                const attendance = reportAttendanceByStudentDay.get(`${dateKey}|${student.id}`);
                if (attendance) {
                    const statusValue = attendance.validationStatus || 'VALIDA';
                    if (isDashboardPresentStatus(statusValue)) {
                        summary.present += 1;
                        classBucket.present += 1;
                        operatorBucket.present += 1;
                        return;
                    }
                    if (statusValue === 'IN_ASTEPTARE') {
                        summary.pending += 1;
                        classBucket.pending += 1;
                        operatorBucket.pending += 1;
                        return;
                    }
                    summary.absent += 1;
                    classBucket.absent += 1;
                    operatorBucket.absent += 1;
                    return;
                }

                if (dateKey > todayKey) {
                    summary.pending += 1;
                    classBucket.pending += 1;
                    operatorBucket.pending += 1;
                } else {
                    summary.absent += 1;
                    classBucket.absent += 1;
                    operatorBucket.absent += 1;
                }
            });
        });

        summary.rate = getAttendanceRate(summary.present, summary.expected);

        const byClass = Array.from(byClassMap.values())
            .map((entry) => ({ ...entry, rate: getAttendanceRate(entry.present, entry.expected) }))
            .sort((left, right) => right.expected - left.expected);

        const byOperator = Array.from(byOperatorMap.values())
            .map((entry) => ({ ...entry, rate: getAttendanceRate(entry.present, entry.expected) }))
            .sort((left, right) => right.expected - left.expected);

        return { summary, byClass, byOperator };
    }, [
        studentsForKpi,
        operatorsById,
        reportDateKeys,
        reportAttendanceByStudentDay,
        periods,
        classPlans,
        practiceSchedules,
        schedules,
    ]);

    const groupedStudents = filteredStudents.reduce((acc, student) => {
        const opId = student.operatorId || 'unassigned';
        if (!acc[opId]) acc[opId] = [];
        acc[opId].push(student);
        return acc;
    }, {});

    const totalStudents = filteredStudents.length;
    const presentCount = filteredStudents.filter((student) => (
        studentStatusInfoById.get(student.id)?.dashboardStatus === DASHBOARD_STATUS.PRESENT
    )).length;
    const absentCount = filteredStudents.filter((student) => (
        studentStatusInfoById.get(student.id)?.dashboardStatus === DASHBOARD_STATUS.ABSENT
    )).length;
    const pendingCount = filteredStudents.filter((student) => (
        studentStatusInfoById.get(student.id)?.dashboardStatus === DASHBOARD_STATUS.PENDING
    )).length;

    const operatorDistribution = operators
        .map((operatorItem) => ({
            name: operatorItem.name,
            count: students.filter((student) => student.operatorId === operatorItem.id).length,
        }))
        .filter((entry) => entry.count > 0);

    const classDistribution = classes.map((className) => ({
        name: className,
        count: students.filter((student) => student.className === className).length,
    }));

    const generateUsername = (fullName) => {
        const parts = fullName.trim().split(' ');
        const lastName = parts[parts.length - 1].toLowerCase();
        const firstInitial = parts[0]?.[0]?.toLowerCase() || '';
        const random = Math.floor(Math.random() * 999);
        return `${firstInitial}${lastName}${random}`;
    };

    const generatePassword = () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let password = '';
        for (let index = 0; index < 8; index += 1) {
            password += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return password;
    };

    const handleAddStudents = async () => {
        const studentsToAdd = newStudents
            .map((entry) => ({
                fullName: String(entry.fullName || '').trim(),
                className: String(entry.className || '').trim(),
            }))
            .filter((entry) => entry.fullName && entry.className);

        if (studentsToAdd.length === 0) {
            toast({
                title: 'Date incomplete',
                description: 'Completeaza numele si clasa pentru cel putin un elev.',
                variant: 'destructive',
            });
            return;
        }

        setIsAddingStudents(true);
        try {
            const existingUsernames = new Set(
                students
                    .map((entry) => String(entry.email || '').split('@')[0].toLowerCase())
                    .filter(Boolean)
            );

            const credentials = [];
            let failedCount = 0;

            for (const student of studentsToAdd) {
                let created = false;
                for (let attempt = 0; attempt < 12 && !created; attempt += 1) {
                    const username = generateUsername(student.fullName);
                    if (existingUsernames.has(username)) {
                        continue;
                    }

                    const password = generatePassword();
                    const email = `${username}@practica.local`;

                    try {
                        await base44.entities.User.create({
                            role: 'user',
                            full_name: student.fullName,
                            className: student.className,
                            email,
                            password,
                            isActive: true,
                        });

                        existingUsernames.add(username);
                        credentials.push({
                            fullName: student.fullName,
                            className: student.className,
                            username,
                            password,
                            email,
                        });
                        created = true;
                    } catch (error) {
                        if (error?.status !== 409) {
                            break;
                        }
                    }
                }

                if (!created) {
                    failedCount += 1;
                }
            }

            await queryClient.invalidateQueries({ queryKey: ['students'] });
            setGeneratedCredentials(credentials);
            setAddStudentModalOpen(false);
            setNewStudents([{ fullName: '', className: '' }]);

            if (credentials.length > 0) {
                setCredentialsModalOpen(true);
            }

            toast({
                title: failedCount > 0 ? 'Adaugare partiala' : 'Elevi adaugati',
                description: `Creati: ${credentials.length}${failedCount > 0 ? ` | Esuati: ${failedCount}` : ''}`,
                variant: failedCount > 0 ? 'destructive' : 'default',
            });
        } catch (error) {
            toast({
                title: 'Nu am putut crea elevii',
                description: error?.message || 'A aparut o eroare la crearea conturilor.',
                variant: 'destructive',
            });
        } finally {
            setIsAddingStudents(false);
        }
    };

    const handleExportCredentials = () => {
        const headers = ['Nume Complet', 'Clasa', 'Username', 'Parola', 'Email'];
        const rows = generatedCredentials.map((entry) => [
            entry.fullName,
            entry.className,
            entry.username,
            entry.password,
            entry.email,
        ]);

        const csv = [headers, ...rows]
            .map((row) => row.map((cell) => `"${cell}"`).join(','))
            .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `credentiale_elevi_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
    };

    const handleStudentClick = (student) => {
        const attendance = attendancesByStudentId.get(student.id);
        const operator = operators.find((entry) => entry.id === student.operatorId);
        setSelectedStudent(student);
        setSelectedAttendance(attendance || null);
        setSelectedOperatorData(operator || null);
        setModalOpen(true);
    };

    const handleExportCSV = (operatorId = null) => {
        const headers = [
            'Nume Student',
            'Clasa',
            'Specializare',
            'Operator',
            'Status Validare',
            'Motiv Validare',
            'Mesaj Validare',
            'Data',
            'Ora',
            'Latitudine',
            'Longitudine',
            'Distanta (m)',
        ];

        let studentsToExport = filteredStudents;
        if (operatorId) {
            studentsToExport = filteredStudents.filter((student) => student.operatorId === operatorId);
        }

        const rows = studentsToExport.map((student) => {
            const attendance = attendancesByStudentId.get(student.id);
            const statusInfo = studentStatusInfoById.get(student.id);
            const operator = operators.find((entry) => entry.id === student.operatorId);

            return [
                student.full_name,
                student.className || '',
                student.specialization || '',
                operator?.name || '',
                attendance?.validationStatus || statusInfo?.dashboardStatus || 'PENDING',
                attendance?.validationReason || statusInfo?.reason || '',
                attendance?.validationMessage || getStatusMessageForExport(statusInfo),
                selectedDate,
                attendance ? format(new Date(attendance.timestamp), 'HH:mm:ss') : '',
                attendance ? attendance.lat.toFixed(6) : '',
                attendance ? attendance.lng.toFixed(6) : '',
                attendance ? attendance.distanceMeters : '',
            ];
        });

        const csv = [headers, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        const operatorName = operatorId
            ? operators.find((entry) => entry.id === operatorId)?.name || 'operator'
            : 'toate';
        link.download = `prezenta_${selectedDate}_${operatorName}.csv`;
        link.click();
    };

    const handleExportKpiCsv = () => {
        const headers = ['Tip', 'Nume', 'Planificate', 'Prezente', 'Absente', 'Pending', 'Rata (%)', 'Interval'];
        const rangeLabel = `${reportRange.startDateKey} - ${reportRange.endDateKey}`;

        const rows = [
            [
                'TOTAL',
                'Toate',
                kpiReport.summary.expected,
                kpiReport.summary.present,
                kpiReport.summary.absent,
                kpiReport.summary.pending,
                kpiReport.summary.rate.toFixed(1),
                rangeLabel,
            ],
            ...kpiReport.byClass.map((entry) => ([
                'CLASA',
                entry.name,
                entry.expected,
                entry.present,
                entry.absent,
                entry.pending,
                entry.rate.toFixed(1),
                rangeLabel,
            ])),
            ...kpiReport.byOperator.map((entry) => ([
                'OPERATOR',
                entry.name,
                entry.expected,
                entry.present,
                entry.absent,
                entry.pending,
                entry.rate.toFixed(1),
                rangeLabel,
            ])),
        ];

        const csv = [headers, ...rows]
            .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
            .join('\n');

        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `raport_kpi_${reportRange.startDateKey}_${reportRange.endDateKey}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
    };

    return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-6">
            <div className="max-w-full mx-auto space-y-6">
                <DashboardHeader
                    totalStudents={totalStudents}
                    presentCount={presentCount}
                    absentCount={absentCount}
                    pendingCount={pendingCount}
                    setAddStudentModalOpen={setAddStudentModalOpen}
                />

                <DashboardCharts
                    weekAttendances={weekAttendances}
                    presentCount={presentCount}
                    absentCount={absentCount}
                    pendingCount={pendingCount}
                    operatorDistribution={operatorDistribution}
                    classDistribution={classDistribution}
                />

                <DashboardFilters
                    selectedPeriod={selectedPeriod}
                    setSelectedPeriod={setSelectedPeriod}
                    periods={periods}
                    selectedDate={selectedDate}
                    setSelectedDate={setSelectedDate}
                    selectedOperator={selectedOperator}
                    setSelectedOperator={setSelectedOperator}
                    operators={operators}
                    selectedClass={selectedClass}
                    setSelectedClass={setSelectedClass}
                    classes={classes}
                    selectedValidationStatus={selectedValidationStatus}
                    setSelectedValidationStatus={setSelectedValidationStatus}
                    validationStatuses={validationStatuses}
                    selectedValidationReason={selectedValidationReason}
                    setSelectedValidationReason={setSelectedValidationReason}
                    validationReasons={validationReasons}
                    searchTerm={searchTerm}
                    setSearchTerm={setSearchTerm}
                    handleExportCSV={handleExportCSV}
                />

                <DashboardKpiReport
                    reportRangeLabel={reportRange.label}
                    summary={kpiReport.summary}
                    byClass={kpiReport.byClass}
                    byOperator={kpiReport.byOperator}
                    onExportCsv={handleExportKpiCsv}
                />

                <DashboardStudentLists
                    groupedStudents={groupedStudents}
                    operators={operators}
                    attendancesByStudentId={attendancesByStudentId}
                    studentStatusInfoById={studentStatusInfoById}
                    handleExportCSV={handleExportCSV}
                    handleStudentClick={handleStudentClick}
                />

                <DashboardAuditTrail logs={auditLogs} />
            </div>

            <AttendanceDetailsModal
                student={selectedStudent}
                attendance={selectedAttendance}
                operator={selectedOperatorData}
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
            />

            <AddStudentsModal
                isOpen={addStudentModalOpen}
                setIsOpen={setAddStudentModalOpen}
                newStudents={newStudents}
                setNewStudents={setNewStudents}
                handleAddStudents={handleAddStudents}
                isSubmitting={isAddingStudents}
            />

            <CredentialsModal
                isOpen={credentialsModalOpen}
                setIsOpen={setCredentialsModalOpen}
                generatedCredentials={generatedCredentials}
                handleExportCredentials={handleExportCredentials}
            />
        </div>
    );
}
