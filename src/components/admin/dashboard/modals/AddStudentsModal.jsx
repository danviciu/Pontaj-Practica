import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { UserPlus } from 'lucide-react';

export default function AddStudentsModal({
    isOpen,
    setIsOpen,
    newStudents,
    setNewStudents,
    handleAddStudents
}) {
    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Adaugă Elevi Noi</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {newStudents.map((student, index) => (
                        <div key={index} className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
                            <div className="space-y-2">
                                <Label>Nume Complet *</Label>
                                <Input
                                    value={student.fullName}
                                    onChange={(e) => {
                                        const updated = [...newStudents];
                                        updated[index].fullName = e.target.value;
                                        setNewStudents(updated);
                                    }}
                                    placeholder="Ex: Popescu Ion"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Clasă *</Label>
                                <Input
                                    value={student.className}
                                    onChange={(e) => {
                                        const updated = [...newStudents];
                                        updated[index].className = e.target.value;
                                        setNewStudents(updated);
                                    }}
                                    placeholder="Ex: 9LM"
                                />
                            </div>
                        </div>
                    ))}

                    <Button
                        variant="outline"
                        onClick={() => setNewStudents([...newStudents, { fullName: '', className: '' }])}
                        className="w-full"
                    >
                        <UserPlus className="h-4 w-4 mr-2" />
                        Adaugă Încă un Elev
                    </Button>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsOpen(false)}>
                        Anulează
                    </Button>
                    <Button
                        onClick={handleAddStudents}
                        disabled={newStudents.every(s => !s.fullName || !s.className)}
                        className="bg-blue-600 hover:bg-blue-700"
                    >
                        Generează Credențiale
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
