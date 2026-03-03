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
import { Plus, Calendar, Edit2, Trash2, Users } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { format } from 'date-fns';
import { ro } from 'date-fns/locale';

export default function ClassPracticePlansManagement() {
    const queryClient = useQueryClient();
    const [modalOpen, setModalOpen] = useState(false);
    const [editingPlan, setEditingPlan] = useState(null);
    const [formData, setFormData] = useState({
        className: '',
        scheduleId: '',
        validFrom: '',
        validTo: '',
        priority: 10,
    });

    const { data: plans = [] } = useQuery({
        queryKey: ['classPracticePlans'],
        queryFn: () => base44.entities.ClassPracticePlan.list('-priority', 100),
    });

    const { data: schedules = [] } = useQuery({
        queryKey: ['practiceSchedules'],
        queryFn: () => base44.entities.PracticeSchedule.list('-created_date', 100),
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
            const schedule = schedules.find(s => s.id === data.scheduleId);
            return base44.entities.ClassPracticePlan.create({
                ...data,
                scheduleName: schedule?.name || '',
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['classPracticePlans'] });
            setModalOpen(false);
            resetForm();
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => {
            const schedule = schedules.find(s => s.id === data.scheduleId);
            return base44.entities.ClassPracticePlan.update(id, {
                ...data,
                scheduleName: schedule?.name || '',
            });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['classPracticePlans'] });
            setModalOpen(false);
            resetForm();
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => base44.entities.ClassPracticePlan.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['classPracticePlans'] });
        },
    });

    const resetForm = () => {
        setFormData({
            className: '',
            scheduleId: '',
            validFrom: '',
            validTo: '',
            priority: 10,
        });
        setEditingPlan(null);
    };

    const handleOpenModal = (plan = null) => {
        if (plan) {
            setEditingPlan(plan);
            setFormData({
                className: plan.className,
                scheduleId: plan.scheduleId,
                validFrom: plan.validFrom,
                validTo: plan.validTo,
                priority: plan.priority || 10,
            });
        } else {
            resetForm();
        }
        setModalOpen(true);
    };

    const handleSubmit = () => {
        if (editingPlan) {
            updateMutation.mutate({ id: editingPlan.id, data: formData });
        } else {
            createMutation.mutate(formData);
        }
    };

    const classes = [...new Set(students.map((s) => s.className).filter(Boolean))];

    const groupedPlans = plans.reduce((acc, plan) => {
        if (!acc[plan.className]) acc[plan.className] = [];
        acc[plan.className].push(plan);
        return acc;
    }, {});

    return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Planuri Practică pe Clase</h1>
                        <p className="text-gray-500 mt-1">Atribuie programe de practică pentru fiecare clasă</p>
                    </div>
                    <Button onClick={() => handleOpenModal()} className="bg-blue-600 hover:bg-blue-700">
                        <Plus className="h-4 w-4 mr-2" />
                        Adaugă Plan
                    </Button>
                </div>

                <div className="space-y-6">
                    {Object.entries(groupedPlans).map(([className, classPlans]) => (
                        <Card key={className}>
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <Users className="h-5 w-5 text-blue-600" />
                                        <div>
                                            <CardTitle className="text-lg">Clasa {className}</CardTitle>
                                            <p className="text-sm text-gray-500 mt-1">
                                                {classPlans.length} plan{classPlans.length !== 1 ? 'uri' : ''} definit{classPlans.length !== 1 ? 'e' : ''}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {classPlans.map((plan) => {
                                        const schedule = schedules.find(s => s.id === plan.scheduleId);
                                        return (
                                            <Card key={plan.id} className="bg-gray-50">
                                                <CardContent className="pt-4 space-y-3">
                                                    <div>
                                                        <div className="flex items-center justify-between mb-2">
                                                            <Badge className="bg-blue-600">
                                                                Prioritate: {plan.priority || 10}
                                                            </Badge>
                                                        </div>
                                                        <p className="font-semibold">{plan.scheduleName}</p>
                                                        {schedule && (
                                                            <p className="text-xs text-gray-600 mt-1">
                                                                Pontaj: {schedule.checkinStartTime} - {schedule.checkinEndTime}
                                                            </p>
                                                        )}
                                                    </div>

                                                    <div className="text-sm text-gray-600">
                                                        <div className="flex items-center gap-1">
                                                            <Calendar className="h-3 w-3" />
                                                            <span>
                                                                {format(new Date(plan.validFrom), 'dd MMM', { locale: ro })} - {format(new Date(plan.validTo), 'dd MMM yyyy', { locale: ro })}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    <div className="flex gap-2 pt-2 border-t">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => handleOpenModal(plan)}
                                                            className="flex-1"
                                                        >
                                                            <Edit2 className="h-3 w-3 mr-1" />
                                                            Editează
                                                        </Button>
                                                        <Button
                                                            variant="destructive"
                                                            size="sm"
                                                            onClick={() => {
                                                                if (confirm('Sigur vrei să ștergi acest plan?')) {
                                                                    deleteMutation.mutate(plan.id);
                                                                }
                                                            }}
                                                        >
                                                            <Trash2 className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                </CardContent>
                                            </Card>
                                        );
                                    })}
                                </div>
                            </CardContent>
                        </Card>
                    ))}

                    {Object.keys(groupedPlans).length === 0 && (
                        <Card>
                            <CardContent className="py-12 text-center text-gray-500">
                                Niciun plan de practică definit pentru clase
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>

            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>
                            {editingPlan ? 'Editează Plan' : 'Adaugă Plan Nou'}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="className">Clasă *</Label>
                            <Select
                                value={formData.className}
                                onValueChange={(value) => setFormData({ ...formData, className: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Selectează clasa" />
                                </SelectTrigger>
                                <SelectContent>
                                    {classes.map((cls) => (
                                        <SelectItem key={cls} value={cls}>
                                            {cls}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="schedule">Program Practică *</Label>
                            <Select
                                value={formData.scheduleId}
                                onValueChange={(value) => setFormData({ ...formData, scheduleId: value })}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Selectează programul" />
                                </SelectTrigger>
                                <SelectContent>
                                    {schedules.filter(s => s.isActive).map((schedule) => (
                                        <SelectItem key={schedule.id} value={schedule.id}>
                                            {schedule.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="validFrom">Valabil De La *</Label>
                                <Input
                                    id="validFrom"
                                    type="date"
                                    value={formData.validFrom}
                                    onChange={(e) => setFormData({ ...formData, validFrom: e.target.value })}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="validTo">Valabil Până La *</Label>
                                <Input
                                    id="validTo"
                                    type="date"
                                    value={formData.validTo}
                                    onChange={(e) => setFormData({ ...formData, validTo: e.target.value })}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="priority">Prioritate (valoare mai mare = prioritate mai înaltă)</Label>
                            <Input
                                id="priority"
                                type="number"
                                value={formData.priority}
                                onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 10 })}
                                placeholder="10"
                            />
                            <p className="text-xs text-gray-500">
                                Folosește prioritate mai mare pentru perioade speciale (ex: practică comasată)
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalOpen(false)}>
                            Anulează
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={
                                !formData.className ||
                                !formData.scheduleId ||
                                !formData.validFrom ||
                                !formData.validTo
                            }
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            {editingPlan ? 'Salvează' : 'Adaugă'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}