import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

export default function UserNotRegisteredError() {
    const { logout } = useAuth();

    return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
            <Card className="max-w-md w-full shadow-lg">
                <CardHeader className="text-center pb-2">
                    <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <span className="text-2xl">🚫</span>
                    </div>
                    <CardTitle className="text-2xl text-red-600">Acces Respins</CardTitle>
                    <CardDescription className="text-base mt-2">
                        Contul dumneavoastră nu este asimilat ca elev sau operator în sistem.
                    </CardDescription>
                </CardHeader>
                <CardContent className="text-center space-y-6 pt-4">
                    <div className="bg-slate-100 p-4 rounded-lg text-sm text-slate-600">
                        Dacă credeți că aceasta este o eroare, vă rugăm să contactați administratorul platformei pentru a vă asocia contul corespunzător.
                    </div>

                    <Button
                        onClick={logout}
                        variant="default"
                        className="w-full sm:w-auto"
                    >
                        <LogOut className="w-4 h-4 mr-2" />
                        Deconectare și revenire la login
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
