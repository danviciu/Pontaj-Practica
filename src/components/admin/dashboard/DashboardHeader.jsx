import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Users, CheckCircle, XCircle, Clock3, UserPlus } from 'lucide-react';

export default function DashboardHeader({
    totalStudents,
    presentCount,
    absentCount,
    pendingCount,
    setAddStudentModalOpen,
}) {
    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">Dashboard Pontaj Practica</h1>
                    <p className="text-gray-500 mt-1">Monitorizare in timp real</p>
                </div>
                <Button onClick={() => setAddStudentModalOpen(true)} className="bg-blue-600 hover:bg-blue-700">
                    <UserPlus className="h-4 w-4 mr-2" />
                    Adauga Elevi
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-500">Total Elevi</p>
                                <p className="text-3xl font-bold mt-1">{totalStudents}</p>
                            </div>
                            <Users className="h-10 w-10 text-blue-600" />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-500">Prezenti</p>
                                <p className="text-3xl font-bold mt-1 text-green-600">{presentCount}</p>
                            </div>
                            <CheckCircle className="h-10 w-10 text-green-600" />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-500">Absenti</p>
                                <p className="text-3xl font-bold mt-1 text-red-600">{absentCount}</p>
                            </div>
                            <XCircle className="h-10 w-10 text-red-600" />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-gray-500">Pending</p>
                                <p className="text-3xl font-bold mt-1 text-amber-600">{pendingCount}</p>
                            </div>
                            <Clock3 className="h-10 w-10 text-amber-600" />
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
