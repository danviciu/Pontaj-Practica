import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function resolveRedirectTarget(rawFromUrl) {
    if (!rawFromUrl) return '/';
    try {
        const parsed = new URL(rawFromUrl, window.location.origin);
        if (parsed.origin !== window.location.origin) {
            return '/';
        }
        return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
    } catch (error) {
        return '/';
    }
}

export default function Login() {
    const [searchParams] = useSearchParams();
    const [mode, setMode] = useState('login'); // 'login' | 'forgot'
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [notice, setNotice] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const redirectTarget = useMemo(
        () => resolveRedirectTarget(searchParams.get('from_url')),
        [searchParams]
    );

    async function handleSubmit(event) {
        event.preventDefault();
        setErrorMessage('');
        setNotice('');
        setIsSubmitting(true);
        try {
            await base44.auth.loginViaEmailPassword({ email, password });
            window.location.assign(redirectTarget);
        } catch (error) {
            setErrorMessage(error?.message || 'Autentificare esuata.');
        } finally {
            setIsSubmitting(false);
        }
    }

    async function handleForgot(event) {
        event.preventDefault();
        setErrorMessage('');
        setNotice('');
        setIsSubmitting(true);
        try {
            await base44.auth.resetPasswordRequest(email);
            setNotice('Daca exista un cont cu acest email, vei primi un link de resetare. Verifica si folderul Spam.');
        } catch (error) {
            // Backend always returns success; treat anything else as a soft error.
            setNotice('Daca exista un cont cu acest email, vei primi un link de resetare.');
        } finally {
            setIsSubmitting(false);
        }
    }

    const isForgot = mode === 'forgot';

    return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
            <Card className="w-full max-w-md shadow-lg">
                <CardHeader>
                    <CardTitle>{isForgot ? 'Resetare parola' : 'Autentificare'}</CardTitle>
                    <CardDescription>
                        {isForgot
                            ? 'Introdu emailul contului si iti trimitem un link de resetare.'
                            : 'Introdu emailul si parola contului tau.'}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={isForgot ? handleForgot : handleSubmit} className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                autoComplete="username"
                                required
                            />
                        </div>
                        {!isForgot && (
                            <div className="space-y-2">
                                <Label htmlFor="password">Parola</Label>
                                <Input
                                    id="password"
                                    type="password"
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    autoComplete="current-password"
                                    required
                                />
                            </div>
                        )}
                        {errorMessage && (
                            <p className="text-sm text-red-600">{errorMessage}</p>
                        )}
                        {notice && (
                            <p className="text-sm text-green-700">{notice}</p>
                        )}
                        <Button type="submit" className="w-full" disabled={isSubmitting}>
                            {isSubmitting
                                ? 'Se proceseaza...'
                                : (isForgot ? 'Trimite link de resetare' : 'Intra in aplicatie')}
                        </Button>
                    </form>
                    <div className="mt-4 text-center">
                        <button
                            type="button"
                            className="text-sm text-blue-600 hover:text-blue-800 underline"
                            onClick={() => {
                                setErrorMessage('');
                                setNotice('');
                                setMode(isForgot ? 'login' : 'forgot');
                            }}
                        >
                            {isForgot ? 'Inapoi la autentificare' : 'Am uitat parola'}
                        </button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
