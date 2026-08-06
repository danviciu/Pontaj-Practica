import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function ResetPassword() {
    const [searchParams] = useSearchParams();
    const token = useMemo(() => searchParams.get('token') || '', [searchParams]);
    const uid = useMemo(() => searchParams.get('uid') || '', [searchParams]);

    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [done, setDone] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const missingParams = !token || !uid;

    async function handleSubmit(event) {
        event.preventDefault();
        setErrorMessage('');
        if (newPassword.length < 6) {
            setErrorMessage('Parola trebuie sa aiba minim 6 caractere.');
            return;
        }
        if (newPassword !== confirmPassword) {
            setErrorMessage('Parolele nu coincid.');
            return;
        }
        setIsSubmitting(true);
        try {
            await base44.auth.resetPasswordConfirm({ uid, token, newPassword });
            setDone(true);
        } catch (error) {
            setErrorMessage(error?.message || 'Link de resetare invalid sau expirat.');
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
            <Card className="w-full max-w-md shadow-lg">
                <CardHeader>
                    <CardTitle>Seteaza o parola noua</CardTitle>
                    <CardDescription>
                        {done
                            ? 'Parola a fost schimbata.'
                            : 'Alege o parola noua pentru contul tau.'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {done ? (
                        <div className="space-y-4">
                            <p className="text-sm text-green-700">
                                Parola a fost actualizata. Te poti autentifica acum.
                            </p>
                            <Button className="w-full" onClick={() => window.location.assign('/Login')}>
                                Mergi la autentificare
                            </Button>
                        </div>
                    ) : missingParams ? (
                        <div className="space-y-4">
                            <p className="text-sm text-red-600">
                                Link de resetare incomplet. Deschide linkul din emailul primit sau cere unul nou.
                            </p>
                            <Button
                                variant="outline"
                                className="w-full"
                                onClick={() => window.location.assign('/Login')}
                            >
                                Inapoi la autentificare
                            </Button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="newPassword">Parola noua</Label>
                                <Input
                                    id="newPassword"
                                    type="password"
                                    value={newPassword}
                                    onChange={(event) => setNewPassword(event.target.value)}
                                    autoComplete="new-password"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="confirmPassword">Confirma parola</Label>
                                <Input
                                    id="confirmPassword"
                                    type="password"
                                    value={confirmPassword}
                                    onChange={(event) => setConfirmPassword(event.target.value)}
                                    autoComplete="new-password"
                                    required
                                />
                            </div>
                            {errorMessage && (
                                <p className="text-sm text-red-600">{errorMessage}</p>
                            )}
                            <Button type="submit" className="w-full" disabled={isSubmitting}>
                                {isSubmitting ? 'Se salveaza...' : 'Salveaza parola'}
                            </Button>
                        </form>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
