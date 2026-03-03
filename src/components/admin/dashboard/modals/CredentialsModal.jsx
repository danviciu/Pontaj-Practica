import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

export default function CredentialsModal({
    isOpen,
    setIsOpen,
    generatedCredentials,
    handleExportCredentials
}) {
    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Credențiale Generate</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <p className="text-sm text-yellow-800">
                            <strong>Important:</strong> Salvează aceste credențiale! Distribuie-le elevilor pentru autentificare.
                        </p>
                    </div>

                    {Object.entries(
                        generatedCredentials.reduce((acc, cred) => {
                            if (!acc[cred.className]) acc[cred.className] = [];
                            acc[cred.className].push(cred);
                            return acc;
                        }, {})
                    ).map(([className, creds]) => (
                        <div key={className} className="space-y-2">
                            <h3 className="font-semibold text-lg">Clasa {className}</h3>
                            <div className="space-y-2">
                                {creds.map((cred, index) => (
                                    <div key={index} className="p-3 bg-gray-50 rounded-lg grid grid-cols-4 gap-2 text-sm">
                                        <div>
                                            <span className="text-gray-500">Nume:</span>
                                            <p className="font-medium">{cred.fullName}</p>
                                        </div>
                                        <div>
                                            <span className="text-gray-500">Username:</span>
                                            <p className="font-mono font-medium">{cred.username}</p>
                                        </div>
                                        <div>
                                            <span className="text-gray-500">Parolă:</span>
                                            <p className="font-mono font-medium">{cred.password}</p>
                                        </div>
                                        <div>
                                            <span className="text-gray-500">Email:</span>
                                            <p className="font-mono text-xs">{cred.email}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <DialogFooter>
                    <Button
                        onClick={handleExportCredentials}
                        className="bg-green-600 hover:bg-green-700"
                    >
                        <Download className="h-4 w-4 mr-2" />
                        Exportă în CSV
                    </Button>
                    <Button onClick={() => setIsOpen(false)}>
                        Închide
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
