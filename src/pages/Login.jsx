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
    const [email, setEmail] = useState('admin.demo@local.test');
    const [password, setPassword] = useState('admin123');
    const [errorMessage, setErrorMessage] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const redirectTarget = useMemo(
        () => resolveRedirectTarget(searchParams.get('from_url')),
        [searchParams]
    );

    async function handleSubmit(event) {
        event.preventDefault();
        setErrorMessage('');
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

    return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
            <Card className="w-full max-w-md shadow-lg">
                <CardHeader>
                    <CardTitle>Autentificare</CardTitle>
                    <CardDescription>
                        Introdu contul utilizatorului pentru testare (admin sau elev).
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={handleSubmit} className="space-y-4">
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
                        {errorMessage && (
                            <p className="text-sm text-red-600">{errorMessage}</p>
                        )}
                        <Button type="submit" className="w-full" disabled={isSubmitting}>
                            {isSubmitting ? 'Se autentifica...' : 'Intra in aplicatie'}
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
