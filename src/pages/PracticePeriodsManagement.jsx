import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ro } from 'date-fns/locale';
import { Calendar, CheckCircle, Edit2, Plus, Trash2, XCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';

const EMPTY_FORM = {
    name: '',
    startDate: '',
    endDate: '',
    checkinStartTime: '',
    checkinEndTime: '',
    className: '',
    operatorId: '',
    description: '',
    isActive: true,
};

export default function PracticePeriodsManagement() {
    const queryClient = useQueryClient();
    const [modalOpen, setModalOpen] = useState(false);
    const [editingPeriod, setEditingPeriod] = useState(null);
    const [formData, setFormData] = useState(EMPTY_FORM);

    const { data: periods = [] } = useQuery({
        queryKey: ['periods'],
        queryFn: () => base44.entities.PracticePeriod.list('-created_date', 100),
    });

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

    const createMutation = useMutation({
        mutationFn: (data) => base44.entities.PracticePeriod.create(data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['periods'] });
            setModalOpen(false);
            resetForm();
            toast({ title: 'Perioada adaugata', description: 'Regula de pontaj a fost salvata.' });
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => base44.entities.PracticePeriod.update(id, data),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['periods'] });
            setModalOpen(false);
            resetForm();
            toast({ title: 'Perioada actualizata', description: 'Modificarile au fost salvate.' });
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => base44.entities.PracticePeriod.delete(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['periods'] }),
    });

    function resetForm() {
        setFormData(EMPTY_FORM);
        setEditingPeriod(null);
    }

    function handleOpenModal(period = null) {
        if (period) {
            setEditingPeriod(period);
            setFormData({
                name: period.name || '',
                startDate: period.startDate || '',
                endDate: period.endDate || '',
                checkinStartTime: period.checkinStartTime || '',
                checkinEndTime: period.checkinEndTime || '',
                className: period.className || '',
                operatorId: period.operatorId || '',
                description: period.description || '',
                isActive: period.isActive !== false,
            });
        } else {
            resetForm();
        }
        setModalOpen(true);
    }

    function handleSubmit() {
        if (!formData.operatorId) {
            toast({
                variant: 'destructive',
                title: 'Operator obligatoriu',
                description: 'Selecteaza operatorul pentru aceasta perioada de practica.',
            });
            return;
        }

        if (Boolean(formData.checkinStartTime) !== Boolean(formData.checkinEndTime)) {
            toast({
                variant: 'destructive',
                title: 'Interval orar incomplet',
                description: 'Completeaza ambele ore de pontaj sau lasa ambele campuri goale.',
            });
            return;
        }

        const payload = {
            ...formData,
            checkinStartTime: formData.checkinStartTime || undefined,
            checkinEndTime: formData.checkinEndTime || undefined,
            className: formData.className || undefined,
            operatorId: formData.operatorId || undefined,
            description: formData.description || undefined,
        };

        if (editingPeriod) {
            updateMutation.mutate({ id: editingPeriod.id, data: payload });
        } else {
            createMutation.mutate(payload);
        }
    }

    const classes = [...new Set(students.map((entry) => entry.className).filter(Boolean))];

    function isCurrentlyActive(period) {
        const today = new Date().toISOString().split('T')[0];
        return period.isActive !== false && today >= period.startDate && today <= period.endDate;
    }

    return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-6">
            <div className="max-w-7xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Perioade practica</h1>
                        <p className="text-gray-500 mt-1">Setezi data, clasa/operator si intervalul orar de pontaj.</p>
                    </div>
                    <Button onClick={() => handleOpenModal()} className="bg-blue-600 hover:bg-blue-700">
                        <Plus className="h-4 w-4 mr-2" />
                        Adauga perioada
                    </Button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {periods.map((period) => {
                        const operator = operators.find((entry) => entry.id === period.operatorId);
                        const activeNow = isCurrentlyActive(period);

                        return (
                            <Card key={period.id} className={`${activeNow ? 'border-2 border-green-500' : ''}`}>
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <Calendar className="h-4 w-4 text-blue-600" />
                                        {period.name}
                                    </CardTitle>
                                    <div className="flex gap-2">
                                        {activeNow && (
                                            <Badge className="bg-green-600">
                                                <CheckCircle className="h-3 w-3 mr-1" />
                                                Activa acum
                                            </Badge>
                                        )}
                                        {period.isActive === false && (
                                            <Badge variant="secondary">
                                                <XCircle className="h-3 w-3 mr-1" />
                                                Inactiva
                                            </Badge>
                                        )}
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    <div className="text-sm space-y-1">
                                        <p>
                                            <span className="text-gray-500">Interval data:</span>{' '}
                                            <span className="font-medium">
                                                {format(new Date(period.startDate), 'd MMM yyyy', { locale: ro })} - {format(new Date(period.endDate), 'd MMM yyyy', { locale: ro })}
                                            </span>
                                        </p>
                                        <p>
                                            <span className="text-gray-500">Interval pontaj:</span>{' '}
                                            <span className="font-medium">
                                                {period.checkinStartTime && period.checkinEndTime
                                                    ? `${period.checkinStartTime} - ${period.checkinEndTime}`
                                                    : 'Conform programului clasei'}
                                            </span>
                                        </p>
                                    </div>

                                    {(period.className || operator) && (
                                        <div className="pt-2 border-t flex flex-wrap gap-2">
                                            {period.className && <Badge variant="outline">Clasa {period.className}</Badge>}
                                            {operator && <Badge variant="outline">{operator.name}</Badge>}
                                        </div>
                                    )}

                                    {period.description && (
                                        <p className="text-xs text-gray-600 pt-2 border-t">{period.description}</p>
                                    )}

                                    <div className="pt-2 border-t flex gap-2">
                                        <Button size="sm" variant="outline" className="flex-1" onClick={() => handleOpenModal(period)}>
                                            <Edit2 className="h-3 w-3 mr-1" />
                                            Editeaza
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="destructive"
                                            onClick={() => {
                                                if (window.confirm('Stergi aceasta perioada?')) {
                                                    deleteMutation.mutate(period.id);
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

                {periods.length === 0 && (
                    <Card>
                        <CardContent className="py-12 text-center text-gray-500">
                            Nicio perioada configurata.
                        </CardContent>
                    </Card>
                )}
            </div>

            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>{editingPeriod ? 'Editeaza perioada' : 'Adauga perioada noua'}</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Nume perioada *</Label>
                            <Input
                                value={formData.name}
                                onChange={(event) => setFormData((prev) => ({ ...prev, name: event.target.value }))}
                                placeholder="Ex: Practica comasata Magnicom"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Data inceput *</Label>
                                <Input
                                    type="date"
                                    value={formData.startDate}
                                    onChange={(event) => setFormData((prev) => ({ ...prev, startDate: event.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Data final *</Label>
                                <Input
                                    type="date"
                                    value={formData.endDate}
                                    onChange={(event) => setFormData((prev) => ({ ...prev, endDate: event.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Ora inceput pontaj (optional)</Label>
                                <Input
                                    type="time"
                                    value={formData.checkinStartTime}
                                    onChange={(event) => setFormData((prev) => ({ ...prev, checkinStartTime: event.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Ora final pontaj (optional)</Label>
                                <Input
                                    type="time"
                                    value={formData.checkinEndTime}
                                    onChange={(event) => setFormData((prev) => ({ ...prev, checkinEndTime: event.target.value }))}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>Clasa (optional)</Label>
                                <Select
                                    value={formData.className}
                                    onValueChange={(value) => setFormData((prev) => ({ ...prev, className: value === 'all_classes' ? '' : value }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Toate clasele" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all_classes">Toate clasele</SelectItem>
                                        {classes.map((className) => (
                                            <SelectItem key={className} value={className}>
                                                {className}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            <div className="space-y-2">
                                <Label>Operator *</Label>
                                <Select
                                    value={formData.operatorId}
                                    onValueChange={(value) => setFormData((prev) => ({ ...prev, operatorId: value }))}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecteaza operatorul" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {operators.filter((operator) => operator.isActive !== false).map((operator) => (
                                            <SelectItem key={operator.id} value={operator.id}>
                                                {operator.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Descriere (optional)</Label>
                            <Textarea
                                value={formData.description}
                                onChange={(event) => setFormData((prev) => ({ ...prev, description: event.target.value }))}
                                rows={3}
                                placeholder="Ex: 23-27.03, 09:00-13:00, prezenta strict in interval."
                            />
                        </div>

                        <div className="flex items-center justify-between p-3 rounded-lg bg-gray-50">
                            <Label className="cursor-pointer">Perioada activa</Label>
                            <Switch
                                checked={formData.isActive}
                                onCheckedChange={(checked) => setFormData((prev) => ({ ...prev, isActive: checked }))}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalOpen(false)}>
                            Renunta
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={
                                !formData.name
                                || !formData.startDate
                                || !formData.endDate
                                || !formData.operatorId
                                || (Boolean(formData.checkinStartTime) !== Boolean(formData.checkinEndTime))
                            }
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            {editingPeriod ? 'Salveaza' : 'Adauga'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
