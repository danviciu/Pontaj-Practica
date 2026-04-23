import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { eachDayOfInterval, format, parseISO } from 'date-fns';
import { ro } from 'date-fns/locale';
import { Calendar, Clock, Download, Edit2, Eye, Loader2, Plus, Trash2, Users } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';

const DAYS_OF_WEEK = [
    { value: 'monday', label: 'Luni' },
    { value: 'tuesday', label: 'Marti' },
    { value: 'wednesday', label: 'Miercuri' },
    { value: 'thursday', label: 'Joi' },
    { value: 'friday', label: 'Vineri' },
    { value: 'saturday', label: 'Sambata' },
    { value: 'sunday', label: 'Duminica' },
];

const ALL_CLASSES = '__all_classes__';
const ALL_OPERATORS = '__all_operators__';

const EMPTY_FORM = {
    name: '',
    scheduleType: 'weekly',
    daysOfWeek: [],
    checkinStartTime: '07:30',
    checkinEndTime: '09:00',
    validFrom: '',
    validTo: '',
    className: '',
    operatorId: '',
    studentUserIds: [],
    isActive: true,
};

const PRESENT_VALIDATION_STATUSES = new Set(['VALIDA', 'CORECTATA_MANUAL']);

const DAY_INDEX_BY_VALUE = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
};

const REPORT_STATUS_META = {
    PREZENT: { label: 'Prezent', shortLabel: 'P', className: 'bg-emerald-100 text-emerald-700' },
    ABSENT_MOTIVAT: { label: 'Absent motivat', shortLabel: 'AM', className: 'bg-blue-100 text-blue-700' },
    ABSENT: { label: 'Absent', shortLabel: 'A', className: 'bg-red-100 text-red-700' },
    IN_ASTEPTARE: { label: 'In asteptare', shortLabel: 'IP', className: 'bg-amber-100 text-amber-700' },
    NEPONTAT: { label: 'Nepontat', shortLabel: 'N', className: 'bg-gray-100 text-gray-700' },
};

function getStatusMeta(code) {
    return REPORT_STATUS_META[code] || REPORT_STATUS_META.NEPONTAT;
}

function getAttendanceStatusCode(attendance) {
    if (!attendance) return 'NEPONTAT';

    const validationStatus = attendance.validationStatus || '';
    const validationReason = attendance.validationReason || '';

    if (PRESENT_VALIDATION_STATUSES.has(validationStatus)) {
        return 'PREZENT';
    }
    if (validationReason === 'ABSENTA_MOTIVATA' || attendance.status === 'absent_justified') {
        return 'ABSENT_MOTIVAT';
    }
    if (validationStatus === 'IN_ASTEPTARE') {
        return 'IN_ASTEPTARE';
    }
    return 'ABSENT';
}

function listScheduleDateKeys(schedule) {
    if (!schedule?.validFrom || !schedule?.validTo) return [];

    const start = parseISO(`${schedule.validFrom}`);
    const end = parseISO(`${schedule.validTo}`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
        return [];
    }

    const selectedDayIndexes = new Set(
        (Array.isArray(schedule.daysOfWeek) ? schedule.daysOfWeek : [])
            .map((day) => DAY_INDEX_BY_VALUE[day])
            .filter((dayIndex) => typeof dayIndex === 'number')
    );
    const hasDayFilter = selectedDayIndexes.size > 0;

    return eachDayOfInterval({ start, end })
        .filter((dateValue) => !hasDayFilter || selectedDayIndexes.has(dateValue.getDay()))
        .map((dateValue) => format(dateValue, 'yyyy-MM-dd'));
}

function getStudentsForSchedule(schedule, students) {
    let scopedStudents = students.filter((student) => student.isActive !== false);
    const selectedStudentIds = new Set(Array.isArray(schedule?.studentUserIds) ? schedule.studentUserIds : []);

    if (selectedStudentIds.size > 0) {
        scopedStudents = scopedStudents.filter((student) => selectedStudentIds.has(student.id));
    } else {
        if (schedule?.className) {
            scopedStudents = scopedStudents.filter((student) => student.className === schedule.className);
        }
        if (schedule?.operatorId) {
            scopedStudents = scopedStudents.filter((student) => student.operatorId === schedule.operatorId);
        }
    }

    return scopedStudents.sort((left, right) => (
        String(left.full_name || '').localeCompare(String(right.full_name || ''))
    ));
}

function sanitizeFilePart(value) {
    return String(value || 'program')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

export default function PracticeSchedulesManagement() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [modalOpen, setModalOpen] = useState(false);
    const [reportModalOpen, setReportModalOpen] = useState(false);
    const [editingSchedule, setEditingSchedule] = useState(null);
    const [formData, setFormData] = useState(EMPTY_FORM);
    const [studentSearch, setStudentSearch] = useState('');
    const [selectedScheduleReport, setSelectedScheduleReport] = useState(null);
    const [isLoadingReportScheduleId, setIsLoadingReportScheduleId] = useState('');
    const [isExportingReportScheduleId, setIsExportingReportScheduleId] = useState('');
    const [reportErrorMessage, setReportErrorMessage] = useState('');

    const { data: schedules = [] } = useQuery({
        queryKey: ['practiceSchedules'],
        queryFn: () => base44.entities.PracticeSchedule.list('-created_date', 100),
    });

    const { data: operators = [] } = useQuery({
        queryKey: ['operators'],
        queryFn: () => base44.entities.Operator.list('name', 200),
    });

    const { data: students = [] } = useQuery({
        queryKey: ['students'],
        queryFn: async () => {
            const users = await base44.entities.User.list('-created_date', 1000);
            return users.filter((entry) => entry.role === 'user' || !entry.role);
        },
    });

    const classes = useMemo(() => {
        return [...new Set(students.map((entry) => entry.className).filter(Boolean))].sort((left, right) => left.localeCompare(right));
    }, [students]);

    const studentsForAssignment = useMemo(() => {
        const classFiltered = formData.className
            ? students.filter((entry) => entry.className === formData.className)
            : students;

        const search = studentSearch.trim().toLowerCase();
        if (!search) return classFiltered;

        return classFiltered.filter((entry) => (
            String(entry.full_name || '').toLowerCase().includes(search)
            || String(entry.email || '').toLowerCase().includes(search)
        ));
    }, [students, formData.className, studentSearch]);

    const createMutation = useMutation({
        mutationFn: (data) => base44.entities.PracticeSchedule.create(data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['practiceSchedules'] });
            setModalOpen(false);
            resetForm();
            toast({ title: 'Program adaugat', description: 'Programul a fost salvat.' });
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => base44.entities.PracticeSchedule.update(id, data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['practiceSchedules'] });
            setModalOpen(false);
            resetForm();
            toast({ title: 'Program actualizat', description: 'Modificarile au fost salvate.' });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => base44.entities.PracticeSchedule.delete(id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['practiceSchedules'] });
        },
    });

    function resetForm() {
        setFormData(EMPTY_FORM);
        setEditingSchedule(null);
        setStudentSearch('');
    }

    function handleOpenModal(schedule = null) {
        if (schedule) {
            setEditingSchedule(schedule);
            setFormData({
                name: schedule.name || '',
                scheduleType: schedule.scheduleType || 'weekly',
                daysOfWeek: schedule.daysOfWeek || [],
                checkinStartTime: schedule.checkinStartTime || '07:30',
                checkinEndTime: schedule.checkinEndTime || '09:00',
                validFrom: schedule.validFrom || '',
                validTo: schedule.validTo || '',
                className: schedule.className || '',
                operatorId: schedule.operatorId || '',
                studentUserIds: schedule.studentUserIds || [],
                isActive: schedule.isActive !== false,
            });
        } else {
            resetForm();
        }
        setModalOpen(true);
    }

    function toggleDay(day) {
        setFormData((prev) => ({
            ...prev,
            daysOfWeek: prev.daysOfWeek.includes(day)
                ? prev.daysOfWeek.filter((entry) => entry !== day)
                : [...prev.daysOfWeek, day],
        }));
    }

    function toggleStudent(studentId) {
        setFormData((prev) => ({
            ...prev,
            studentUserIds: prev.studentUserIds.includes(studentId)
                ? prev.studentUserIds.filter((entry) => entry !== studentId)
                : [...prev.studentUserIds, studentId],
        }));
    }

    function handleToggleSelectAllStudents() {
        const candidateIds = studentsForAssignment.map((entry) => entry.id);
        const allSelected = candidateIds.every((id) => formData.studentUserIds.includes(id));

        setFormData((prev) => ({
            ...prev,
            studentUserIds: allSelected
                ? prev.studentUserIds.filter((id) => !candidateIds.includes(id))
                : [...new Set([...prev.studentUserIds, ...candidateIds])],
        }));
    }

    function goToPage(pageName) {
        setModalOpen(false);
        navigate(createPageUrl(pageName));
    }

    function handleSubmit() {
        if (formData.checkinStartTime > formData.checkinEndTime) {
            toast({
                variant: 'destructive',
                title: 'Interval orar invalid',
                description: 'Ora de inceput trebuie sa fie mai mica sau egala cu ora de final.',
            });
            return;
        }

        const payload = {
            ...formData,
            className: formData.className || undefined,
            operatorId: formData.operatorId || undefined,
            studentUserIds: formData.studentUserIds.length > 0 ? formData.studentUserIds : undefined,
        };

        if (editingSchedule) {
            updateMutation.mutate({ id: editingSchedule.id, data: payload });
        } else {
            createMutation.mutate(payload);
        }
    }

    const operatorsById = useMemo(() => {
        const map = new Map();
        operators.forEach((entry) => {
            map.set(entry.id, entry);
        });
        return map;
    }, [operators]);

    async function buildScheduleReport(schedule) {
        const dateKeys = listScheduleDateKeys(schedule);
        const scopedStudents = getStudentsForSchedule(schedule, students);
        const studentIdSet = new Set(scopedStudents.map((student) => student.id));

        const attendanceByStudentDate = new Map();
        if (dateKeys.length > 0 && studentIdSet.size > 0) {
            const attendancesByDay = await Promise.all(
                dateKeys.map((dateKey) => base44.entities.Attendance.filter({ dateKey }, '-created_date', 1000))
            );

            attendancesByDay.flat().forEach((attendance) => {
                if (!studentIdSet.has(attendance.studentUserId)) return;
                const mapKey = `${attendance.dateKey}|${attendance.studentUserId}`;
                if (!attendanceByStudentDate.has(mapKey)) {
                    attendanceByStudentDate.set(mapKey, attendance);
                }
            });
        }

        const studentRows = scopedStudents.map((student) => {
            const entries = dateKeys.map((dateKey) => {
                const attendance = attendanceByStudentDate.get(`${dateKey}|${student.id}`) || null;
                const statusCode = getAttendanceStatusCode(attendance);
                return {
                    dateKey,
                    attendance,
                    statusCode,
                };
            });

            const statusCounts = entries.reduce((accumulator, entry) => {
                accumulator[entry.statusCode] = (accumulator[entry.statusCode] || 0) + 1;
                return accumulator;
            }, {
                PREZENT: 0,
                ABSENT_MOTIVAT: 0,
                ABSENT: 0,
                IN_ASTEPTARE: 0,
                NEPONTAT: 0,
            });

            const expectedDays = dateKeys.length;
            const presenceRate = expectedDays > 0
                ? (statusCounts.PREZENT / expectedDays) * 100
                : 0;

            return {
                student,
                entries,
                statusCounts,
                expectedDays,
                presenceRate,
            };
        });

        const summary = studentRows.reduce((accumulator, row) => {
            accumulator.students += 1;
            accumulator.expected += row.expectedDays;
            accumulator.present += row.statusCounts.PREZENT;
            accumulator.justifiedAbsent += row.statusCounts.ABSENT_MOTIVAT;
            accumulator.absent += row.statusCounts.ABSENT;
            accumulator.pending += row.statusCounts.IN_ASTEPTARE;
            accumulator.notMarked += row.statusCounts.NEPONTAT;
            return accumulator;
        }, {
            students: 0,
            expected: 0,
            present: 0,
            justifiedAbsent: 0,
            absent: 0,
            pending: 0,
            notMarked: 0,
        });

        return {
            schedule,
            dateKeys,
            studentRows,
            summary,
        };
    }

    async function exportScheduleReportExcel(report) {
        if (!report) return;

        const xlsxModule = await import('xlsx');
        const XLSX = xlsxModule.default || xlsxModule;

        const workbook = XLSX.utils.book_new();
        const periodLabel = `${report.schedule?.validFrom || '-'} - ${report.schedule?.validTo || '-'}`;

        const summaryRows = [
            ['Raport prezenta practica'],
            ['Program', report.schedule?.name || '-'],
            ['Perioada', periodLabel],
            [],
            ['Elev', 'Clasa', 'Operator', 'Zile', 'Prezente', 'Absente motivate', 'Absente', 'In asteptare', 'Nepontat', 'Rata prezenta (%)'],
            ...report.studentRows.map((row) => {
                const operatorName = operatorsById.get(row.student.operatorId || report.schedule.operatorId)?.name || '';
                return [
                    row.student.full_name || '',
                    row.student.className || '',
                    operatorName,
                    row.expectedDays,
                    row.statusCounts.PREZENT,
                    row.statusCounts.ABSENT_MOTIVAT,
                    row.statusCounts.ABSENT,
                    row.statusCounts.IN_ASTEPTARE,
                    row.statusCounts.NEPONTAT,
                    Number(row.presenceRate.toFixed(2)),
                ];
            }),
            [],
            ['TOTAL', '', '', report.summary.expected, report.summary.present, report.summary.justifiedAbsent, report.summary.absent, report.summary.pending, report.summary.notMarked, report.summary.expected > 0 ? Number(((report.summary.present / report.summary.expected) * 100).toFixed(2)) : 0],
        ];

        const matrixHeaderDates = report.dateKeys.map((dateKey) => {
            const dateValue = new Date(`${dateKey}T00:00:00`);
            return Number.isNaN(dateValue.getTime())
                ? dateKey
                : format(dateValue, 'dd.MM (EEE)', { locale: ro });
        });

        const matrixRows = [
            ['Elev', 'Clasa', 'Operator', ...matrixHeaderDates, 'P', 'AM', 'A', 'IP', 'N'],
            ...report.studentRows.map((row) => {
                const operatorName = operatorsById.get(row.student.operatorId || report.schedule.operatorId)?.name || '';
                return [
                    row.student.full_name || '',
                    row.student.className || '',
                    operatorName,
                    ...row.entries.map((entry) => getStatusMeta(entry.statusCode).shortLabel),
                    row.statusCounts.PREZENT,
                    row.statusCounts.ABSENT_MOTIVAT,
                    row.statusCounts.ABSENT,
                    row.statusCounts.IN_ASTEPTARE,
                    row.statusCounts.NEPONTAT,
                ];
            }),
        ];

        const detailsRows = [
            ['Program', 'Perioada start', 'Perioada final', 'Data', 'Elev', 'Clasa', 'Operator', 'Status', 'Motiv', 'Mesaj', 'Ora pontaj'],
        ];

        report.studentRows.forEach((row) => {
            const operatorName = operatorsById.get(row.student.operatorId || report.schedule.operatorId)?.name || '';
            row.entries.forEach((entry) => {
                const statusMeta = getStatusMeta(entry.statusCode);
                detailsRows.push([
                    report.schedule.name || '',
                    report.schedule.validFrom || '',
                    report.schedule.validTo || '',
                    entry.dateKey,
                    row.student.full_name || '',
                    row.student.className || '',
                    operatorName,
                    statusMeta.label,
                    entry.attendance?.validationReason || '',
                    entry.attendance?.validationMessage || '',
                    entry.attendance?.timestamp ? format(new Date(entry.attendance.timestamp), 'HH:mm:ss') : '',
                ]);
            });
        });

        const legendRows = [
            ['Cod', 'Descriere'],
            ['P', 'Prezent'],
            ['AM', 'Absent motivat'],
            ['A', 'Absent'],
            ['IP', 'In asteptare'],
            ['N', 'Nepontat'],
        ];

        const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
        summarySheet['!cols'] = [
            { wch: 34 }, { wch: 12 }, { wch: 24 }, { wch: 10 }, { wch: 10 },
            { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 14 },
        ];

        const matrixSheet = XLSX.utils.aoa_to_sheet(matrixRows);
        matrixSheet['!cols'] = [
            { wch: 34 },
            { wch: 12 },
            { wch: 24 },
            ...report.dateKeys.map(() => ({ wch: 12 })),
            { wch: 6 },
            { wch: 6 },
            { wch: 6 },
            { wch: 6 },
            { wch: 6 },
        ];

        const detailsSheet = XLSX.utils.aoa_to_sheet(detailsRows);
        detailsSheet['!cols'] = [
            { wch: 24 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 34 },
            { wch: 12 }, { wch: 24 }, { wch: 16 }, { wch: 20 }, { wch: 40 }, { wch: 12 },
        ];

        const legendSheet = XLSX.utils.aoa_to_sheet(legendRows);
        legendSheet['!cols'] = [{ wch: 8 }, { wch: 22 }];

        XLSX.utils.book_append_sheet(workbook, summarySheet, 'Centralizator');
        XLSX.utils.book_append_sheet(workbook, matrixSheet, 'Matrice prezenta');
        XLSX.utils.book_append_sheet(workbook, detailsSheet, 'Detaliat');
        XLSX.utils.book_append_sheet(workbook, legendSheet, 'Legenda');

        const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([data], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        });
        const link = document.createElement('a');
        const filename = [
            'prezenta',
            sanitizeFilePart(report.schedule?.name || 'program'),
            report.schedule?.validFrom || 'start',
            report.schedule?.validTo || 'end',
        ].join('_');

        link.href = URL.createObjectURL(blob);
        link.download = `${filename}.xlsx`;
        link.click();
        URL.revokeObjectURL(link.href);
    }

    async function handleOpenReport(schedule) {
        setReportModalOpen(true);
        setSelectedScheduleReport(null);
        setReportErrorMessage('');
        setIsLoadingReportScheduleId(schedule.id);

        try {
            const report = await buildScheduleReport(schedule);
            setSelectedScheduleReport(report);
        } catch (error) {
            setReportErrorMessage(error?.message || 'Nu am putut incarca raportul de prezenta.');
            toast({
                title: 'Raport indisponibil',
                description: error?.message || 'Incearca din nou.',
                variant: 'destructive',
            });
        } finally {
            setIsLoadingReportScheduleId('');
        }
    }

    async function handleExportScheduleReport(schedule) {
        setIsExportingReportScheduleId(schedule.id);
        try {
            const report = await buildScheduleReport(schedule);
            await exportScheduleReportExcel(report);
            toast({
                title: 'Raport descarcat',
                description: `Fisierul Excel pentru perioada ${schedule.validFrom} - ${schedule.validTo} a fost generat.`,
            });
        } catch (error) {
            toast({
                title: 'Nu am putut genera fisierul Excel',
                description: error?.message || 'Incearca din nou.',
                variant: 'destructive',
            });
        } finally {
            setIsExportingReportScheduleId('');
        }
    }

    async function handleExportCurrentReport() {
        if (!selectedScheduleReport) return;
        const scheduleId = selectedScheduleReport.schedule?.id || 'report_modal';
        setIsExportingReportScheduleId(scheduleId);
        try {
            await exportScheduleReportExcel(selectedScheduleReport);
            toast({
                title: 'Raport descarcat',
                description: `Fisierul Excel pentru perioada ${selectedScheduleReport.schedule?.validFrom || '-'} - ${selectedScheduleReport.schedule?.validTo || '-'} a fost generat.`,
            });
        } catch (error) {
            toast({
                title: 'Nu am putut genera fisierul Excel',
                description: error?.message || 'Incearca din nou.',
                variant: 'destructive',
            });
        } finally {
            setIsExportingReportScheduleId('');
        }
    }

    function handleCloseReportModal(open) {
        setReportModalOpen(open);
        if (!open) {
            setSelectedScheduleReport(null);
            setReportErrorMessage('');
        }
    }

    return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Programe practica</h1>
                        <p className="text-gray-500 mt-1">Configurezi zile, intervale si asocierea cu clasa/elevi/operator.</p>
                    </div>
                    <Button onClick={() => handleOpenModal()} className="bg-blue-600 hover:bg-blue-700">
                        <Plus className="h-4 w-4 mr-2" />
                        Adauga program
                    </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {schedules.map((schedule) => (
                        <Card key={schedule.id} className={schedule.isActive === false ? 'opacity-60' : ''}>
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <Calendar className="h-4 w-4 text-blue-600" />
                                    {schedule.name}
                                </CardTitle>
                                {schedule.isActive === false && (
                                    <Badge variant="secondary" className="w-fit">Inactiv</Badge>
                                )}
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="space-y-1 text-sm text-gray-600">
                                    <p className="flex items-center gap-2">
                                        <Clock className="h-4 w-4" />
                                        Pontaj: {schedule.checkinStartTime} - {schedule.checkinEndTime}
                                    </p>
                                    <p>
                                        <span className="font-medium">Perioada:</span>{' '}
                                        {format(new Date(schedule.validFrom), 'dd MMM', { locale: ro })} - {format(new Date(schedule.validTo), 'dd MMM yyyy', { locale: ro })}
                                    </p>
                                </div>

                                <div className="pt-2 border-t flex flex-wrap gap-1">
                                    {schedule.daysOfWeek?.map((day) => (
                                        <Badge key={day} variant="outline" className="text-xs">
                                            {DAYS_OF_WEEK.find((entry) => entry.value === day)?.label || day}
                                        </Badge>
                                    ))}
                                </div>

                                <div className="pt-2 border-t flex flex-wrap gap-1">
                                    {schedule.className && <Badge variant="outline">Clasa {schedule.className}</Badge>}
                                    {schedule.operatorId && <Badge variant="outline">{operatorsById.get(schedule.operatorId)?.name || 'Operator'}</Badge>}
                                    {Array.isArray(schedule.studentUserIds) && schedule.studentUserIds.length > 0 && (
                                        <Badge variant="outline" className="flex items-center gap-1">
                                            <Users className="h-3 w-3" />
                                            {schedule.studentUserIds.length} elevi
                                        </Badge>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="w-full"
                                        onClick={() => handleOpenReport(schedule)}
                                        disabled={isLoadingReportScheduleId === schedule.id}
                                    >
                                        {isLoadingReportScheduleId === schedule.id ? (
                                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                        ) : (
                                            <Eye className="h-3 w-3 mr-1" />
                                        )}
                                        Vezi prezenta
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="w-full"
                                        onClick={() => handleExportScheduleReport(schedule)}
                                        disabled={isExportingReportScheduleId === schedule.id}
                                    >
                                        {isExportingReportScheduleId === schedule.id ? (
                                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                        ) : (
                                            <Download className="h-3 w-3 mr-1" />
                                        )}
                                        Descarca Excel
                                    </Button>
                                </div>

                                <div className="flex gap-2">
                                    <Button variant="outline" size="sm" className="flex-1" onClick={() => handleOpenModal(schedule)}>
                                        <Edit2 className="h-3 w-3 mr-1" />
                                        Editeaza
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => {
                                            if (window.confirm('Sigur vrei sa stergi acest program?')) {
                                                deleteMutation.mutate(schedule.id);
                                            }
                                        }}
                                    >
                                        <Trash2 className="h-3 w-3" />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {schedules.length === 0 && (
                    <Card>
                        <CardContent className="py-12 text-center text-gray-500">
                            Niciun program de practica definit.
                        </CardContent>
                    </Card>
                )}
            </div>

            <Dialog open={reportModalOpen} onOpenChange={handleCloseReportModal}>
                <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>
                            {selectedScheduleReport?.schedule?.name
                                ? `Prezenta perioada: ${selectedScheduleReport.schedule.name}`
                                : 'Prezenta perioada de practica'}
                        </DialogTitle>
                        <DialogDescription>
                            {selectedScheduleReport?.schedule
                                ? `${selectedScheduleReport.schedule.validFrom || '-'} - ${selectedScheduleReport.schedule.validTo || '-'}`
                                : 'Vizualizare si export prezenta pentru perioada selectata.'}
                        </DialogDescription>
                    </DialogHeader>

                    {isLoadingReportScheduleId && (
                        <div className="py-10 text-center text-gray-500 flex items-center justify-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Se incarca prezenta pentru perioada selectata...
                        </div>
                    )}

                    {!isLoadingReportScheduleId && reportErrorMessage && (
                        <div className="py-10 text-center text-red-600">
                            {reportErrorMessage}
                        </div>
                    )}

                    {!isLoadingReportScheduleId && !reportErrorMessage && selectedScheduleReport && (
                        <div className="space-y-4">
                            <div className="flex flex-wrap gap-2">
                                <Badge variant="secondary">Elevi: {selectedScheduleReport.summary.students}</Badge>
                                <Badge variant="secondary">Zile: {selectedScheduleReport.dateKeys.length}</Badge>
                                <Badge variant="secondary">Total puncte: {selectedScheduleReport.summary.expected}</Badge>
                                <Badge variant="secondary">Prezente: {selectedScheduleReport.summary.present}</Badge>
                                <Badge variant="secondary">Absente motivate: {selectedScheduleReport.summary.justifiedAbsent}</Badge>
                                <Badge variant="secondary">Absente: {selectedScheduleReport.summary.absent}</Badge>
                                <Badge variant="secondary">In asteptare: {selectedScheduleReport.summary.pending}</Badge>
                                <Badge variant="secondary">Nepontat: {selectedScheduleReport.summary.notMarked}</Badge>
                            </div>

                            {(selectedScheduleReport.dateKeys.length === 0 || selectedScheduleReport.studentRows.length === 0) ? (
                                <Card>
                                    <CardContent className="py-8 text-center text-gray-500">
                                        Nu exista date suficiente pentru raport (zile configurate sau elevi asociati).
                                    </CardContent>
                                </Card>
                            ) : (
                                <div className="border rounded-lg overflow-auto">
                                    <table className="min-w-full text-sm">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="text-left p-2 sticky left-0 bg-gray-50 z-10">Elev</th>
                                                {selectedScheduleReport.dateKeys.map((dateKey) => (
                                                    <th key={dateKey} className="text-center p-2 whitespace-nowrap">
                                                        {format(new Date(`${dateKey}T00:00:00`), 'dd MMM', { locale: ro })}
                                                    </th>
                                                ))}
                                                <th className="text-center p-2">P</th>
                                                <th className="text-center p-2">AM</th>
                                                <th className="text-center p-2">A</th>
                                                <th className="text-center p-2">IP</th>
                                                <th className="text-center p-2">N</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {selectedScheduleReport.studentRows.map((row) => (
                                                <tr key={row.student.id} className="border-t">
                                                    <td className="p-2 sticky left-0 bg-white z-10">
                                                        <p className="font-medium text-gray-900">{row.student.full_name || '-'}</p>
                                                        <p className="text-xs text-gray-500">{row.student.className || '-'}</p>
                                                    </td>
                                                    {row.entries.map((entry) => {
                                                        const statusMeta = getStatusMeta(entry.statusCode);
                                                        return (
                                                            <td key={`${row.student.id}_${entry.dateKey}`} className="p-2 text-center">
                                                                <span
                                                                    title={`${entry.dateKey} - ${statusMeta.label}`}
                                                                    className={`inline-flex min-w-8 justify-center rounded px-2 py-1 text-xs font-medium ${statusMeta.className}`}
                                                                >
                                                                    {statusMeta.shortLabel}
                                                                </span>
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="p-2 text-center font-medium">{row.statusCounts.PREZENT}</td>
                                                    <td className="p-2 text-center font-medium">{row.statusCounts.ABSENT_MOTIVAT}</td>
                                                    <td className="p-2 text-center font-medium">{row.statusCounts.ABSENT}</td>
                                                    <td className="p-2 text-center font-medium">{row.statusCounts.IN_ASTEPTARE}</td>
                                                    <td className="p-2 text-center font-medium">{row.statusCounts.NEPONTAT}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}

                            <div className="text-xs text-gray-500">
                                Legenda: P = prezent, AM = absent motivat, A = absent, IP = in asteptare, N = nepontat.
                            </div>
                        </div>
                    )}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => handleCloseReportModal(false)}>
                            Inchide
                        </Button>
                        <Button
                            onClick={handleExportCurrentReport}
                            disabled={!selectedScheduleReport || Boolean(isLoadingReportScheduleId) || Boolean(isExportingReportScheduleId)}
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            {isExportingReportScheduleId ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                                <Download className="h-4 w-4 mr-2" />
                            )}
                            Descarca Excel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingSchedule ? 'Editeaza Program' : 'Adauga Program Nou'}</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <Button type="button" variant="outline" onClick={() => goToPage('ClassManagement')}>Adauga clasa</Button>
                            <Button type="button" variant="outline" onClick={() => goToPage('StudentsManagement')}>Adauga elevi</Button>
                            <Button type="button" variant="outline" onClick={() => goToPage('OperatorsManagement')}>Adauga operator</Button>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="name">Nume Program *</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
                                placeholder="Ex: Practica comasata"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label>Zile Practica *</Label>
                            <div className="grid grid-cols-2 gap-2">
                                {DAYS_OF_WEEK.map((day) => (
                                    <div key={day.value} className="flex items-center space-x-2">
                                        <Checkbox
                                            id={day.value}
                                            checked={formData.daysOfWeek.includes(day.value)}
                                            onCheckedChange={() => toggleDay(day.value)}
                                        />
                                        <Label htmlFor={day.value} className="cursor-pointer">{day.label}</Label>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="checkinStart">Inceput Pontaj *</Label>
                                <Input
                                    id="checkinStart"
                                    type="time"
                                    value={formData.checkinStartTime}
                                    onChange={(event) => setFormData((prev) => ({ ...prev, checkinStartTime: event.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="checkinEnd">Final Pontaj *</Label>
                                <Input
                                    id="checkinEnd"
                                    type="time"
                                    value={formData.checkinEndTime}
                                    onChange={(event) => setFormData((prev) => ({ ...prev, checkinEndTime: event.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="validFrom">Valabil De La *</Label>
                                <Input
                                    id="validFrom"
                                    type="date"
                                    value={formData.validFrom}
                                    onChange={(event) => setFormData((prev) => ({ ...prev, validFrom: event.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="validTo">Valabil Pana La *</Label>
                                <Input
                                    id="validTo"
                                    type="date"
                                    value={formData.validTo}
                                    onChange={(event) => setFormData((prev) => ({ ...prev, validTo: event.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Clasa asociata</Label>
                                <Select
                                    value={formData.className || ALL_CLASSES}
                                    onValueChange={(value) => setFormData((prev) => ({ ...prev, className: value === ALL_CLASSES ? '' : value }))}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={ALL_CLASSES}>Toate clasele</SelectItem>
                                        {classes.map((className) => (
                                            <SelectItem key={className} value={className}>{className}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Operator asociat</Label>
                                <Select
                                    value={formData.operatorId || ALL_OPERATORS}
                                    onValueChange={(value) => setFormData((prev) => ({ ...prev, operatorId: value === ALL_OPERATORS ? '' : value }))}
                                >
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={ALL_OPERATORS}>Toti operatorii</SelectItem>
                                        {operators.filter((operator) => operator.isActive !== false).map((operator) => (
                                            <SelectItem key={operator.id} value={operator.id}>{operator.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label>Elevi asociati (optional)</Label>
                                <Button type="button" variant="outline" size="sm" onClick={handleToggleSelectAllStudents}>
                                    Selecteaza toti cei filtrati
                                </Button>
                            </div>
                            <Input
                                placeholder="Cauta elev..."
                                value={studentSearch}
                                onChange={(event) => setStudentSearch(event.target.value)}
                            />
                            <div className="max-h-44 overflow-y-auto border rounded-lg p-3 space-y-2">
                                {studentsForAssignment.length === 0 && (
                                    <p className="text-sm text-gray-500">Nu exista elevi pentru filtrul curent.</p>
                                )}
                                {studentsForAssignment.map((student) => (
                                    <div key={student.id} className="flex items-center gap-2">
                                        <Checkbox
                                            id={`student-${student.id}`}
                                            checked={formData.studentUserIds.includes(student.id)}
                                            onCheckedChange={() => toggleStudent(student.id)}
                                        />
                                        <Label htmlFor={`student-${student.id}`} className="cursor-pointer text-sm">
                                            {student.full_name} {student.className ? `(${student.className})` : ''}
                                        </Label>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <Label htmlFor="active" className="cursor-pointer">Program Activ</Label>
                            <Switch
                                id="active"
                                checked={formData.isActive}
                                onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, isActive: checked }))}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalOpen(false)}>Anuleaza</Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={
                                !formData.name
                                || formData.daysOfWeek.length === 0
                                || !formData.checkinStartTime
                                || !formData.checkinEndTime
                                || !formData.validFrom
                                || !formData.validTo
                            }
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            {editingSchedule ? 'Salveaza' : 'Adauga'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
