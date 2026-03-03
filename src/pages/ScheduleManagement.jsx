import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Plus, Calendar, Clock, Edit2, Trash2, Building2 } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';

const DAYS_OF_WEEK = [
    { value: 'monday', label: 'Luni' },
    { value: 'tuesday', label: 'Marți' },
    { value: 'wednesday', label: 'Miercuri' },
    { value: 'thursday', label: 'Joi' },
    { value: 'friday', label: 'Vineri' },
    { value: 'saturday', label: 'Sâmbătă' },
    { value: 'sunday', label: 'Duminică' },
];

export default function ScheduleManagement() {
    const queryClient = useQueryClient();
    const [modalOpen, setModalOpen] = useState(false);
    const [editingSchedule, setEditingSchedule] = useState(null);
    const [formData, setFormData] = useState({
        operatorId: '',
        className: '',
        daysOfWeek: [],
        startTime: '08:00',
        endTime: '16:00',
        isActive: true,
    });

    const { data: schedules = [] } = useQuery({
        queryKey: ['schedules'],
        queryFn: () => base44.entities.Schedule.list('-created_date', 100),
    });

    const { data: operators = [] } = useQuery({
        queryKey: ['operators'],
        queryFn: () => base44.entities.Operator.list('-created_date', 100),
    });

    const { data: students = [] } = useQuery({
        queryKey: ['students'],
        queryFn: async () => {
            const users = await base44.entities.User.list('-created_date', 500);
            return users.filter((u) => u.role === 'user' || !u.role);
        },
    });

    const createMutation = useMutation({
        mutationFn: (data) => {
            const operator = operators.find((o) => o.id === data.operatorId);
            return base44.entities.Schedule.create({
                ...data,
                operatorName: operator?.name || '',
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schedules'] });
            setModalOpen(false);
            resetForm();
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => {
            const operator = operators.find((o) => o.id === data.operatorId);
            return base44.entities.Schedule.update(id, {
                ...data,
                operatorName: operator?.name || '',
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schedules'] });
            setModalOpen(false);
            resetForm();
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => base44.entities.Schedule.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['schedules'] });
        },
    });

    const resetForm = () => {
        setFormData({
            operatorId: '',
            className: '',
            daysOfWeek: [],
            startTime: '08:00',
            endTime: '16:00',
            isActive: true,
        });
        setEditingSchedule(null);
    };

    const handleOpenModal = (schedule = null) => {
        if (schedule) {
            setEditingSchedule(schedule);
            setFormData({
                operatorId: schedule.operatorId,
                className: schedule.className || '',
                daysOfWeek: schedule.daysOfWeek || [],
                startTime: schedule.startTime,
                endTime: schedule.endTime,
                isActive: schedule.isActive ?? true,
            });
        } else {
            resetForm();
        }
        setModalOpen(true);
    };

    const handleSubmit = () => {
        if (editingSchedule) {
            updateMutation.mutate({ id: editingSchedule.id, data: formData });
        } else {
            createMutation.mutate(formData);
        }
    };

    const toggleDay = (day) => {
        setFormData((prev) => ({
            ...prev,
            daysOfWeek: prev.daysOfWeek.includes(day)
                ? prev.daysOfWeek.filter((d) => d !== day)
                : [...prev.daysOfWeek, day],
        }));
    };

    // Grupare programe pe operatori
    const groupedSchedules = schedules.reduce((acc, schedule) => {
        const opId = schedule.operatorId;
        if (!acc[opId]) acc[opId] = [];
        acc[opId].push(schedule);
        return acc;
    }, {});

    const classes = [...new Set(students.map((s) => s.className).filter(Boolean))];

    return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Program Practică</h1>
                        <p className="text-gray-500 mt-1">Gestionează orarul pentru fiecare operator</p>
                    </div>
                    <Button onClick={() => handleOpenModal()} className="bg-blue-600 hover:bg-blue-700">
                        <Plus className="h-4 w-4 mr-2" />
                        Adaugă Program
                    </Button>
                </div>

                {/* Schedules by Operator */}
                <div className="space-y-6">
                    {operators.map((operator) => {
                        const operatorSchedules = groupedSchedules[operator.id] || [];
                        const studentCount = students.filter((s) => s.operatorId === operator.id).length;

                        return (
                            <Card key={operator.id}>
                                <CardHeader>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Building2 className="h-5 w-5 text-blue-600" />
                                            <div>
                                                <CardTitle className="text-lg">{operator.name}</CardTitle>
                                                <p className="text-sm text-gray-500 mt-1">
                                                    {studentCount} elev{studentCount !== 1 ? 'i' : ''}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    {operatorSchedules.length > 0 ? (
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {operatorSchedules.map((schedule) => (
                                                <Card key={schedule.id} className="bg-gray-50">
                                                    <CardContent className="pt-4 space-y-3">
                                                        <div className="flex items-start justify-between">
                                                            <div className="flex-1">
                                                                <Badge variant="outline" className="mb-2">
                                                                    {schedule.className || 'Toate Clasele'}
                                                                </Badge>
                                                                <div className="space-y-2 text-sm">
                                                                    <div className="flex items-center gap-2 text-gray-600">
                                                                        <Clock className="h-4 w-4" />
                                                                        <span>
                                                                            {schedule.startTime} - {schedule.endTime}
                                                                        </span>
                                                                    </div>
                                                                    <div className="flex items-center gap-2 text-gray-600">
                                                                        <Calendar className="h-4 w-4" />
                                                                        <div className="flex flex-wrap gap-1">
                                                                            {schedule.daysOfWeek?.map((day) => (
                                                                                <Badge key={day} variant="secondary" className="text-xs">
                                                                                    {DAYS_OF_WEEK.find((d) => d.value === day)?.label}
                                                                                </Badge>
                                                                            ))}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-2 pt-2 border-t">
                                                            <Button
                                                                variant="outline"
                                                                size="sm"
                                                                onClick={() => handleOpenModal(schedule)}
                                                                className="flex-1"
                                                            >
                                                                <Edit2 className="h-3 w-3 mr-1" />
                                                                Editează
                                                            </Button>
                                                            <Button
                                                                variant="destructive"
                                                                size="sm"
                                                                onClick={() => {
                                                                    if (confirm('Sigur vrei să ștergi acest program?')) {
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
                                    ) : (
                                        <p className="text-center text-gray-500 py-4">
                                            Niciun program configurat pentru acest operator
                                        </p>
                                    )}
                                </CardContent>
                            </Card>
                        );
                    })}
                </div>
            </div>

            {/* Add/Edit Modal */}
            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>
                            {editingSchedule ? 'Editează Program' : 'Adaugă Program Nou'}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="operator">Operator Economic *</Label>
                            <Select
                                value={formData.operatorId}
                                onValueChange={(value) => setFormData({ ...formData, operatorId: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Selectează operator" />
                                </SelectTrigger>
                                <SelectContent>
                                    {operators
                                        .filter((o) => o.isActive)
                                        .map((op) => (
                                            <SelectItem key={op.id} value={op.id}>
                                                {op.name}
                                            </SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="className">Clasă (opțional)</Label>
                            <Select
                                value={formData.className}
                                onValueChange={(value) =>
                                    setFormData({
                                        ...formData,
                                        className: value === 'all_classes' ? '' : value
                                    })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Toate clasele" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all_classes">Toate Clasele</SelectItem>
                                    {classes.map((cls) => (
                                        <SelectItem key={cls} value={cls}>
                                            {cls}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label>Zile Lucru *</Label>
                            <div className="grid grid-cols-2 gap-2">
                                {DAYS_OF_WEEK.map((day) => (
                                    <div key={day.value} className="flex items-center space-x-2">
                                        <Checkbox
                                            id={day.value}
                                            checked={formData.daysOfWeek.includes(day.value)}
                                            onCheckedChange={() => toggleDay(day.value)}
                                        />
                                        <Label htmlFor={day.value} className="cursor-pointer">
                                            {day.label}
                                        </Label>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="startTime">Ora Început *</Label>
                                <Input
                                    id="startTime"
                                    type="time"
                                    value={formData.startTime}
                                    onChange={(e) => setFormData({ ...formData, startTime: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="endTime">Ora Final *</Label>
                                <Input
                                    id="endTime"
                                    type="time"
                                    value={formData.endTime}
                                    onChange={(e) => setFormData({ ...formData, endTime: e.target.value })}
                                />
                            </div>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalOpen(false)}>
                            Anulează
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={
                                !formData.operatorId ||
                                formData.daysOfWeek.length === 0 ||
                                !formData.startTime ||
                                !formData.endTime
                            }
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            {editingSchedule ? 'Salvează' : 'Adaugă'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
