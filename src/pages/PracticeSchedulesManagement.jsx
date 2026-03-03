import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { ro } from 'date-fns/locale';
import { Calendar, Clock, Edit2, Plus, Trash2, Users } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

export default function PracticeSchedulesManagement() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [modalOpen, setModalOpen] = useState(false);
    const [editingSchedule, setEditingSchedule] = useState(null);
    const [formData, setFormData] = useState(EMPTY_FORM);
    const [studentSearch, setStudentSearch] = useState('');

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

                                <div className="flex gap-2 pt-2 border-t">
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
