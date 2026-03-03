import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Plus, Building2, MapPin, Edit2, Trash2, CheckCircle, XCircle } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';

export default function OperatorsManagement() {
    const queryClient = useQueryClient();
    const [modalOpen, setModalOpen] = useState(false);
    const [editingOperator, setEditingOperator] = useState(null);
    const [formData, setFormData] = useState({
        name: '',
        address: '',
        lat: '',
        lng: '',
        radiusMeters: 200,
        isActive: true,
    });

    const { data: operators = [] } = useQuery({
        queryKey: ['operators'],
        queryFn: () => base44.entities.Operator.list('-created_date', 100),
    });

    const createMutation = useMutation({
        mutationFn: (data) => base44.entities.Operator.create(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['operators'] });
            setModalOpen(false);
            resetForm();
        },
    });

    const updateMutation = useMutation({
        mutationFn: ({ id, data }) => base44.entities.Operator.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['operators'] });
            setModalOpen(false);
            resetForm();
        },
    });

    const deleteMutation = useMutation({
        mutationFn: (id) => base44.entities.Operator.delete(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['operators'] });
        },
    });

    const resetForm = () => {
        setFormData({
            name: '',
            address: '',
            lat: '',
            lng: '',
            radiusMeters: 200,
            isActive: true,
        });
        setEditingOperator(null);
    };

    const handleOpenModal = (operator = null) => {
        if (operator) {
            setEditingOperator(operator);
            setFormData({
                name: operator.name,
                address: operator.address || '',
                lat: operator.lat,
                lng: operator.lng,
                radiusMeters: operator.radiusMeters || 200,
                isActive: operator.isActive ?? true,
            });
        } else {
            resetForm();
        }
        setModalOpen(true);
    };

    const handleSubmit = () => {
        const data = {
            ...formData,
            lat: parseFloat(formData.lat),
            lng: parseFloat(formData.lng),
            radiusMeters: parseInt(formData.radiusMeters),
        };

        if (editingOperator) {
            updateMutation.mutate({ id: editingOperator.id, data });
        } else {
            createMutation.mutate(data);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-6">
            <div className="max-w-6xl mx-auto space-y-6">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Operatori Economici</h1>
                        <p className="text-gray-500 mt-1">Gestionează locurile de practică</p>
                    </div>
                    <Button onClick={() => handleOpenModal()} className="bg-blue-600 hover:bg-blue-700">
                        <Plus className="h-4 w-4 mr-2" />
                        Adaugă Operator
                    </Button>
                </div>

                {/* Operators List */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {operators.map((operator) => (
                        <Card key={operator.id} className="hover:shadow-lg transition-shadow">
                            <CardHeader className="pb-3">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-3 flex-1">
                                        <Building2 className="h-5 w-5 text-blue-600 mt-1" />
                                        <div className="flex-1">
                                            <CardTitle className="text-base">{operator.name}</CardTitle>
                                            <Badge
                                                variant={operator.isActive ? 'default' : 'secondary'}
                                                className="mt-2"
                                            >
                                                {operator.isActive ? (
                                                    <>
                                                        <CheckCircle className="h-3 w-3 mr-1" /> Activ
                                                    </>
                                                ) : (
                                                    <>
                                                        <XCircle className="h-3 w-3 mr-1" /> Inactiv
                                                    </>
                                                )}
                                            </Badge>
                                        </div>
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {operator.address && (
                                    <div className="flex items-start gap-2 text-sm text-gray-600">
                                        <MapPin className="h-4 w-4 mt-0.5 flex-shrink-0" />
                                        <span>{operator.address}</span>
                                    </div>
                                )}

                                <div className="text-xs text-gray-500 space-y-1 pt-2 border-t">
                                    <p>Coordonate: {operator.lat.toFixed(4)}, {operator.lng.toFixed(4)}</p>
                                    <p>Rază: {operator.radiusMeters}m</p>
                                </div>

                                <div className="flex gap-2 pt-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleOpenModal(operator)}
                                        className="flex-1"
                                    >
                                        <Edit2 className="h-3 w-3 mr-1" />
                                        Editează
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        size="sm"
                                        onClick={() => {
                                            if (confirm('Sigur vrei să ștergi acest operator?')) {
                                                deleteMutation.mutate(operator.id);
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

                {operators.length === 0 && (
                    <Card>
                        <CardContent className="py-12 text-center text-gray-500">
                            Niciun operator adăugat încă. Apasă butonul de mai sus pentru a adăuga primul operator.
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Add/Edit Modal */}
            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {editingOperator ? 'Editează Operator' : 'Adaugă Operator Nou'}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Nume Operator *</Label>
                            <Input
                                id="name"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                placeholder="Ex: SC Tehno SRL"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="address">Adresă</Label>
                            <Input
                                id="address"
                                value={formData.address}
                                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                                placeholder="Ex: Str. Principală nr. 123"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="lat">Latitudine *</Label>
                                <Input
                                    id="lat"
                                    type="number"
                                    step="any"
                                    value={formData.lat}
                                    onChange={(e) => setFormData({ ...formData, lat: e.target.value })}
                                    placeholder="Ex: 45.123456"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="lng">Longitudine *</Label>
                                <Input
                                    id="lng"
                                    type="number"
                                    step="any"
                                    value={formData.lng}
                                    onChange={(e) => setFormData({ ...formData, lng: e.target.value })}
                                    placeholder="Ex: 25.123456"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="radius">Rază Permisă (metri)</Label>
                            <Input
                                id="radius"
                                type="number"
                                value={formData.radiusMeters}
                                onChange={(e) => setFormData({ ...formData, radiusMeters: e.target.value })}
                                placeholder="200"
                            />
                        </div>

                        <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                            <Label htmlFor="active" className="cursor-pointer">Operator Activ</Label>
                            <Switch
                                id="active"
                                checked={formData.isActive}
                                onCheckedChange={(checked) => setFormData({ ...formData, isActive: checked })}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalOpen(false)}>
                            Anulează
                        </Button>
                        <Button
                            onClick={handleSubmit}
                            disabled={!formData.name || !formData.lat || !formData.lng}
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            {editingOperator ? 'Salvează' : 'Adaugă'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}