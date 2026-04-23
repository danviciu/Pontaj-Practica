import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Shield } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';

const EMPTY_FORM = {
    id: '',
    full_name: '',
    email: '',
    password: '',
};

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function formatDate(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '-';
    return parsed.toLocaleDateString('ro-RO');
}

export default function AdminsManagement() {
    const queryClient = useQueryClient();
    const [modalOpen, setModalOpen] = useState(false);
    const [adminForm, setAdminForm] = useState(EMPTY_FORM);

    const { data: currentUser } = useQuery({
        queryKey: ['currentUser'],
        queryFn: () => base44.auth.me(),
    });

    const adminAccounts = useMemo(() => {
        if (!currentUser || currentUser.role !== 'admin') {
            return [];
        }
        return [currentUser];
    }, [currentUser]);

    const saveAdminMutation = useMutation({
        mutationFn: async (form) => {
            if (!currentUser?.id) {
                throw new Error('Contul curent nu a putut fi identificat. Reincarca pagina.');
            }

            if (!form.id || form.id !== currentUser.id) {
                throw new Error('Poti modifica doar propriul cont de administrator.');
            }

            const payload = {
                role: 'admin',
                full_name: String(form.full_name || '').trim(),
                email: normalizeEmail(form.email),
            };

            if (!payload.full_name) {
                throw new Error('Numele administratorului este obligatoriu.');
            }

            if (!payload.email) {
                throw new Error('Email-ul administratorului este obligatoriu.');
            }

            if (form.password) {
                if (String(form.password).length < 6) {
                    throw new Error('Parola trebuie sa aiba cel putin 6 caractere.');
                }
                payload.password = form.password;
            }

            return base44.entities.User.update(form.id, payload);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['currentUser'] });
            queryClient.invalidateQueries({ queryKey: ['students'] });
            setModalOpen(false);
            setAdminForm(EMPTY_FORM);
            toast({
                title: 'Cont administrator actualizat',
                description: 'Modificarile au fost salvate.',
            });
        },
        onError: (error) => {
            toast({
                title: 'Nu am putut salva modificarile',
                description: error?.message || 'A aparut o eroare.',
                variant: 'destructive',
            });
        },
    });

    function openEditModal(admin) {
        setAdminForm({
            id: admin.id,
            full_name: admin.full_name || '',
            email: admin.email || '',
            password: '',
        });
        setModalOpen(true);
    }

    return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-6">
            <div className="max-w-4xl mx-auto space-y-6">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Administratori</h1>
                    <p className="text-gray-500 mt-1">Fiecare administrator isi poate vedea si edita doar propriul cont.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {adminAccounts.map((admin) => (
                        <Card key={admin.id} className="hover:shadow-md transition-shadow">
                            <CardHeader className="pb-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-start gap-2">
                                        <Shield className="h-5 w-5 mt-0.5 text-blue-600" />
                                        <div>
                                            <CardTitle className="text-base">{admin.full_name || '-'}</CardTitle>
                                            <p className="text-xs text-gray-500 mt-1">{admin.email || '-'}</p>
                                        </div>
                                    </div>
                                    <Badge variant={admin.isActive === false ? 'secondary' : 'default'}>
                                        {admin.isActive === false ? 'Inactiv' : 'Activ'}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <p className="text-xs text-gray-500">
                                    Creat la: {formatDate(admin.created_date)}
                                </p>
                                <p className="text-xs text-blue-700 bg-blue-50 px-2 py-1 rounded-md inline-block">
                                    Contul curent
                                </p>
                                <div className="flex gap-2 pt-1">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="flex-1"
                                        onClick={() => openEditModal(admin)}
                                    >
                                        <Pencil className="h-3 w-3 mr-1" />
                                        Editeaza
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {adminAccounts.length === 0 && (
                    <Card>
                        <CardContent className="py-10 text-center text-gray-500">
                            Contul de administrator nu a putut fi incarcat.
                        </CardContent>
                    </Card>
                )}
            </div>

            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Editeaza contul meu de administrator</DialogTitle>
                        <DialogDescription>
                            Poti lasa parola goala daca nu vrei sa o modifici.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="adminName">Nume complet *</Label>
                            <Input
                                id="adminName"
                                value={adminForm.full_name}
                                onChange={(event) => setAdminForm((prev) => ({ ...prev, full_name: event.target.value }))}
                                placeholder="Ex: Popescu Maria"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="adminEmail">Email *</Label>
                            <Input
                                id="adminEmail"
                                type="email"
                                value={adminForm.email}
                                onChange={(event) => setAdminForm((prev) => ({ ...prev, email: event.target.value }))}
                                placeholder="admin@exemplu.ro"
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="adminPassword">Parola noua (optional)</Label>
                            <Input
                                id="adminPassword"
                                type="password"
                                value={adminForm.password}
                                onChange={(event) => setAdminForm((prev) => ({ ...prev, password: event.target.value }))}
                                placeholder="Lasa gol pentru a pastra parola curenta"
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalOpen(false)}>
                            Renunta
                        </Button>
                        <Button
                            onClick={() => saveAdminMutation.mutate(adminForm)}
                            disabled={saveAdminMutation.isPending}
                            className="bg-blue-600 hover:bg-blue-700"
                        >
                            {saveAdminMutation.isPending ? 'Se salveaza...' : 'Salveaza'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
