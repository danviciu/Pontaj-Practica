import React from 'react';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
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
    handleAddStudents,
    isSubmitting = false,
}) {
    return (
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Adauga Elevi Noi</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    {newStudents.map((student, index) => (
                        <div key={index} className="grid grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
                            <div className="space-y-2">
                                <Label>Nume Complet *</Label>
                                <Input
                                    value={student.fullName}
                                    onChange={(event) => {
                                        const updated = [...newStudents];
                                        updated[index].fullName = event.target.value;
                                        setNewStudents(updated);
                                    }}
                                    placeholder="Ex: Popescu Ion"
                                    disabled={isSubmitting}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Clasa *</Label>
                                <Input
                                    value={student.className}
                                    onChange={(event) => {
                                        const updated = [...newStudents];
                                        updated[index].className = event.target.value;
                                        setNewStudents(updated);
                                    }}
                                    placeholder="Ex: 9LM"
                                    disabled={isSubmitting}
                                />
                            </div>
                        </div>
                    ))}

                    <Button
                        variant="outline"
                        onClick={() => setNewStudents([...newStudents, { fullName: '', className: '' }])}
                        className="w-full"
                        disabled={isSubmitting}
                    >
                        <UserPlus className="h-4 w-4 mr-2" />
                        Adauga Inca un Elev
                    </Button>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isSubmitting}>
                        Anuleaza
                    </Button>
                    <Button
                        onClick={handleAddStudents}
                        disabled={isSubmitting || newStudents.every((entry) => !entry.fullName || !entry.className)}
                        className="bg-blue-600 hover:bg-blue-700"
                    >
                        {isSubmitting ? 'Se creeaza conturile...' : 'Genereaza Credentiale'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
