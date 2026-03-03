import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { UserCircle, GraduationCap, Building2, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';

export default function OnboardingSetup() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [user, setUser] = useState(null);
    const [formData, setFormData] = useState({
        full_name: '',
        className: '',
        specialization: '',
        operatorId: '',
    });

    useEffect(() => {
        async function loadUser() {
            const currentUser = await base44.auth.me();
            setUser(currentUser);
            setFormData({
                full_name: currentUser.full_name || '',
                className: currentUser.className || '',
                specialization: currentUser.specialization || '',
                operatorId: currentUser.operatorId || '',
            });
        }
        loadUser();
    }, []);

    const { data: operators = [] } = useQuery({
        queryKey: ['operators'],
        queryFn: () => base44.entities.Operator.list('-created_date', 100),
    });

    const updateMutation = useMutation({
        mutationFn: (data) => base44.auth.updateMe(data),
        onSuccess: () => {
            queryClient.invalidateQueries();
            navigate(createPageUrl('StudentHome'));
        },
    });

    const handleSubmit = (e) => {
        e.preventDefault();
        updateMutation.mutate(formData);
    };

    if (!user) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
            <Card className="w-full max-w-2xl shadow-xl">
                <CardHeader className="text-center pb-6">
                    <div className="flex justify-center mb-4">
                        <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center">
                            <GraduationCap className="h-8 w-8 text-white" />
                        </div>
                    </div>
                    <CardTitle className="text-2xl">Configurare Profil</CardTitle>
                    <p className="text-gray-500 mt-2">
                        Completează informațiile pentru a continua
                    </p>
                </CardHeader>

                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        {/* Nume Prenume */}
                        <div className="space-y-2">
                            <Label htmlFor="full_name" className="flex items-center gap-2">
                                <UserCircle className="h-4 w-4 text-blue-600" />
                                Nume și Prenume *
                            </Label>
                            <Input
                                id="full_name"
                                value={formData.full_name}
                                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                                placeholder="Ex: Popescu Ion"
                                required
                            />
                        </div>

                        {/* Clasa */}
                        <div className="space-y-2">
                            <Label htmlFor="className" className="flex items-center gap-2">
                                <GraduationCap className="h-4 w-4 text-blue-600" />
                                Clasa *
                            </Label>
                            <Input
                                id="className"
                                value={formData.className}
                                onChange={(e) => setFormData({ ...formData, className: e.target.value })}
                                placeholder="Ex: 9LM, 10A, 11E"
                                required
                            />
                        </div>

                        {/* Specializarea */}
                        <div className="space-y-2">
                            <Label htmlFor="specialization" className="flex items-center gap-2">
                                <CheckCircle className="h-4 w-4 text-blue-600" />
                                Specializarea *
                            </Label>
                            <Input
                                id="specialization"
                                value={formData.specialization}
                                onChange={(e) =>
                                    setFormData({ ...formData, specialization: e.target.value })
                                }
                                placeholder="Ex: Mecatronică, Electronică, Informatică"
                                required
                            />
                        </div>

                        {/* Operator Economic */}
                        <div className="space-y-2">
                            <Label htmlFor="operator" className="flex items-center gap-2">
                                <Building2 className="h-4 w-4 text-blue-600" />
                                Operator Economic (opțional)
                            </Label>
                            <Select
                                value={formData.operatorId}
                                onValueChange={(value) =>
                                    setFormData({
                                        ...formData,
                                        operatorId: value === 'unassigned' ? '' : value
                                    })
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Selectează operator (opțional)" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="unassigned">Niciunul (voi alege mai târziu)</SelectItem>
                                    {operators
                                        .filter((o) => o.isActive)
                                        .map((op) => (
                                            <SelectItem key={op.id} value={op.id}>
                                                {op.name}
                                            </SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-gray-500">
                                Poți selecta locul de practică acum sau mai târziu
                            </p>
                        </div>

                        {/* Submit Button */}
                        <div className="pt-4">
                            <Button
                                type="submit"
                                disabled={
                                    !formData.full_name ||
                                    !formData.className ||
                                    !formData.specialization ||
                                    updateMutation.isPending
                                }
                                className="w-full bg-blue-600 hover:bg-blue-700 h-12 text-lg font-semibold"
                            >
                                {updateMutation.isPending ? 'Se salvează...' : 'Continuă'}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
