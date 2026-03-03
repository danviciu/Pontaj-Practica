
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Calendar, Clock, Edit2, Plus, Send, Trash2, Users } from 'lucide-react';
import { format } from 'date-fns';
import { ro } from 'date-fns/locale';
import { base44 } from '@/api/base44Client';
import {
  createClassCatalogItem,
  deleteClassCatalogItem,
  listClassCatalog,
  normalizeClassName,
  updateClassCatalogItem,
} from '@/lib/class-catalog';
import { logAuditEvent } from '@/lib/audit-log';
import {
  createEmptyDeliveryStats,
  getReminderCapabilities,
  mergeDeliveryResult,
  sendReminderToStudent,
} from '@/lib/reminders';
import { toast } from '@/components/ui/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const UNASSIGNED_OPERATOR = '__unassigned__';
const CLASS_REMINDER_CONFIG_KEY = 'pontaj.class.reminder.config.v1';
const CLASS_REMINDER_LAST_SENT_KEY = 'pontaj.class.reminder.lastSent.v1';

const DAYS_MAP = {
  monday: 'Luni',
  tuesday: 'Marti',
  wednesday: 'Miercuri',
  thursday: 'Joi',
  friday: 'Vineri',
  saturday: 'Sambata',
  sunday: 'Duminica',
};

const DEFAULT_REMINDER_SETTINGS = {
  enabled: false,
  reminderTime: '09:00',
  channels: {
    email: true,
    push: false,
    sms: false,
  },
  onlyAbsent: true,
};

function readJsonStorage(key, fallbackValue) {
  if (typeof window === 'undefined') return fallbackValue;
  try {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) return fallbackValue;
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : fallbackValue;
  } catch (error) {
    return fallbackValue;
  }
}

function writeJsonStorage(key, value) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Cannot persist ${key}:`, error);
  }
}

function timeStringToMinutes(value) {
  if (!value || typeof value !== 'string') return null;
  const [hoursRaw, minutesRaw] = value.split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

export default function ClassManagement() {
  const queryClient = useQueryClient();

  const [selectedClass, setSelectedClass] = useState('');

  const [classDialogOpen, setClassDialogOpen] = useState(false);
  const [classDialogMode, setClassDialogMode] = useState('create');
  const [classForm, setClassForm] = useState({
    name: '',
    specialization: '',
    defaultOperatorId: UNASSIGNED_OPERATOR,
    isActive: true,
  });

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteMode, setDeleteMode] = useState('clear');
  const [targetClassForMove, setTargetClassForMove] = useState('');

  const [planModalOpen, setPlanModalOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState(null);
  const [planForm, setPlanForm] = useState({ scheduleId: '', validFrom: '', validTo: '', priority: 10 });

  const [reminderStatus, setReminderStatus] = useState({
    sending: false,
    sent: false,
    count: 0,
    stats: createEmptyDeliveryStats(),
    error: '',
  });
  const [reminderConfigByClass, setReminderConfigByClass] = useState({});

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: students = [] } = useQuery({
    queryKey: ['students'],
    queryFn: async () => {
      const users = await base44.entities.User.list('-created_date', 1000);
      return users.filter((entry) => entry.role === 'user' || !entry.role);
    },
  });

  const { data: operators = [] } = useQuery({
    queryKey: ['operators'],
    queryFn: () => base44.entities.Operator.list('name', 200),
  });

  const { data: schedules = [] } = useQuery({
    queryKey: ['practiceSchedules'],
    queryFn: () => base44.entities.PracticeSchedule.list('name', 200),
  });

  const { data: plans = [] } = useQuery({
    queryKey: ['classPracticePlans'],
    queryFn: () => base44.entities.ClassPracticePlan.list('-priority', 500),
  });

  const { data: todayAttendances = [] } = useQuery({
    queryKey: ['todayAttendances'],
    queryFn: () => base44.entities.Attendance.filter({ dateKey: new Date().toISOString().split('T')[0] }, '-created_date', 1000),
  });

  const { data: classCatalog = [] } = useQuery({
    queryKey: ['classCatalog'],
    queryFn: listClassCatalog,
  });

  const classCatalogByName = useMemo(() => {
    const map = new Map();
    classCatalog.forEach((entry) => {
      if (entry.name) map.set(normalizeClassName(entry.name), entry);
    });
    return map;
  }, [classCatalog]);

  const classes = useMemo(() => {
    const set = new Set();
    students.forEach((student) => {
      if (student.className) set.add(normalizeClassName(student.className));
    });
    plans.forEach((plan) => {
      if (plan.className) set.add(normalizeClassName(plan.className));
    });
    classCatalog.forEach((entry) => {
      if (entry.name) set.add(normalizeClassName(entry.name));
    });
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [students, plans, classCatalog]);

  useEffect(() => {
    const savedConfig = readJsonStorage(CLASS_REMINDER_CONFIG_KEY, {});
    setReminderConfigByClass(savedConfig);
  }, []);

  useEffect(() => {
    writeJsonStorage(CLASS_REMINDER_CONFIG_KEY, reminderConfigByClass);
  }, [reminderConfigByClass]);

  const reminderConfig = selectedClass
    ? {
      ...DEFAULT_REMINDER_SETTINGS,
      ...(reminderConfigByClass[selectedClass] || {}),
      channels: {
        ...DEFAULT_REMINDER_SETTINGS.channels,
        ...(reminderConfigByClass[selectedClass]?.channels || {}),
      },
    }
    : DEFAULT_REMINDER_SETTINGS;

  const reminderCapabilities = useMemo(() => getReminderCapabilities(), []);

  useEffect(() => {
    if (!selectedClass && classes.length > 0) {
      setSelectedClass(classes[0]);
      return;
    }
    if (selectedClass && !classes.includes(selectedClass)) {
      setSelectedClass(classes[0] || '');
    }
  }, [classes, selectedClass]);

  const classStudents = students.filter((entry) => normalizeClassName(entry.className) === selectedClass);
  const classPlans = plans.filter((entry) => normalizeClassName(entry.className) === selectedClass);

  const absentStudents = classStudents.filter(
    (student) => student.isActive !== false && !todayAttendances.some((attendance) => attendance.studentUserId === student.id)
  );
  const presentCount = classStudents.length - absentStudents.length;

  function updateReminderConfig(partial) {
    if (!selectedClass) return;
    setReminderConfigByClass((prev) => ({
      ...prev,
      [selectedClass]: {
        ...DEFAULT_REMINDER_SETTINGS,
        ...(prev[selectedClass] || {}),
        channels: {
          ...DEFAULT_REMINDER_SETTINGS.channels,
          ...(prev[selectedClass]?.channels || {}),
          ...(partial.channels || {}),
        },
        ...partial,
      },
    }));
  }

  async function refreshClassData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['students'] }),
      queryClient.invalidateQueries({ queryKey: ['classPracticePlans'] }),
      queryClient.invalidateQueries({ queryKey: ['classCatalog'] }),
      queryClient.invalidateQueries({ queryKey: ['todayAttendances'] }),
    ]);
  }

  async function renameClassEverywhere(oldClassName, newClassName) {
    const affectedStudents = students.filter((student) => normalizeClassName(student.className) === oldClassName);
    const affectedPlans = plans.filter((plan) => normalizeClassName(plan.className) === oldClassName);
    const affectedAttendances = await base44.entities.Attendance.filter({ className: oldClassName }, '-created_date', 2000);

    await Promise.all(affectedStudents.map((student) => base44.entities.User.update(student.id, { className: newClassName })));
    await Promise.all(affectedPlans.map((plan) => base44.entities.ClassPracticePlan.update(plan.id, { className: newClassName })));
    await Promise.all(affectedAttendances.map((attendance) => base44.entities.Attendance.update(attendance.id, { className: newClassName })));
  }
  const saveClassMutation = useMutation({
    mutationFn: async () => {
      const normalizedName = normalizeClassName(classForm.name);
      if (!normalizedName) throw new Error('Numele clasei este obligatoriu.');

      const payload = {
        name: normalizedName,
        specialization: classForm.specialization,
        defaultOperatorId: classForm.defaultOperatorId === UNASSIGNED_OPERATOR ? '' : classForm.defaultOperatorId,
        isActive: classForm.isActive,
      };

      if (classDialogMode === 'create') {
        const existing = classCatalogByName.get(normalizedName);
        if (existing?.id) {
          await updateClassCatalogItem(existing.id, payload);
        } else {
          await createClassCatalogItem(payload);
        }
        setSelectedClass(normalizedName);
        return {
          action: existing?.id ? 'CLASS_UPDATE' : 'CLASS_CREATE',
          className: normalizedName,
          previousClassName: '',
        };
      }

      if (!selectedClass) throw new Error('Nu exista clasa selectata.');
      if (normalizedName !== selectedClass && classes.includes(normalizedName)) {
        throw new Error('Exista deja o clasa cu acest nume.');
      }

      if (normalizedName !== selectedClass) {
        await renameClassEverywhere(selectedClass, normalizedName);
      }

      const existing = classCatalogByName.get(selectedClass);
      if (existing?.id) {
        await updateClassCatalogItem(existing.id, payload);
      } else {
        await createClassCatalogItem(payload);
      }

      setSelectedClass(normalizedName);
      return {
        action: 'CLASS_UPDATE',
        className: normalizedName,
        previousClassName: selectedClass,
      };
    },
    onSuccess: async (result) => {
      await refreshClassData();
      await queryClient.invalidateQueries({ queryKey: ['auditLogs'] });
      await logAuditEvent({
        action: result?.action || 'CLASS_UPDATE',
        entityType: 'Classroom',
        entityId: result?.className || selectedClass,
        actorName: currentUser?.full_name || 'Admin',
        actorEmail: currentUser?.email || '',
        details: result?.previousClassName && result.previousClassName !== result.className
          ? `Redenumire clasa ${result.previousClassName} -> ${result.className}`
          : `Salvare clasa ${result?.className || selectedClass}`,
      });
      setClassDialogOpen(false);
      toast({ title: 'Clasa salvata', description: 'Modificarile au fost aplicate.' });
    },
  });

  const deleteClassMutation = useMutation({
    mutationFn: async () => {
      if (!selectedClass) throw new Error('Nu exista clasa selectata.');

      const nextClass = normalizeClassName(targetClassForMove);
      if (deleteMode === 'move' && !nextClass) {
        throw new Error('Selecteaza clasa tinta pentru mutare.');
      }

      const studentsToUpdate = students.filter((student) => normalizeClassName(student.className) === selectedClass);
      const plansToDelete = plans.filter((plan) => normalizeClassName(plan.className) === selectedClass);

      if (deleteMode === 'move') {
        await Promise.all(studentsToUpdate.map((student) => base44.entities.User.update(student.id, { className: nextClass })));
        if (!classes.includes(nextClass)) {
          await createClassCatalogItem({ name: nextClass });
        }
      } else {
        await Promise.all(studentsToUpdate.map((student) => base44.entities.User.update(student.id, { className: '' })));
      }

      await Promise.all(plansToDelete.map((plan) => base44.entities.ClassPracticePlan.delete(plan.id)));

      const catalogEntry = classCatalogByName.get(selectedClass);
      if (catalogEntry?.id) {
        await deleteClassCatalogItem(catalogEntry.id);
      }

      setSelectedClass(deleteMode === 'move' ? nextClass : '');
      return {
        className: selectedClass,
        movedTo: deleteMode === 'move' ? nextClass : '',
        studentsCount: studentsToUpdate.length,
        plansCount: plansToDelete.length,
      };
    },
    onSuccess: async (result) => {
      await refreshClassData();
      await queryClient.invalidateQueries({ queryKey: ['auditLogs'] });
      await logAuditEvent({
        action: 'CLASS_DELETE',
        entityType: 'Classroom',
        entityId: result?.className || selectedClass,
        actorName: currentUser?.full_name || 'Admin',
        actorEmail: currentUser?.email || '',
        details: result?.movedTo
          ? `Stearsa clasa ${result.className}; elevii mutati in ${result.movedTo}; planuri sterse=${result.plansCount}`
          : `Stearsa clasa ${result?.className}; elevi decuplati=${result?.studentsCount}; planuri sterse=${result?.plansCount}`,
      });
      setDeleteDialogOpen(false);
      setDeleteMode('clear');
      setTargetClassForMove('');
      toast({ title: 'Clasa stearsa', description: 'Datele au fost actualizate.' });
    },
  });

  const savePlanMutation = useMutation({
    mutationFn: async () => {
      if (!selectedClass) throw new Error('Selecteaza o clasa.');
      if (!planForm.scheduleId || !planForm.validFrom || !planForm.validTo) throw new Error('Completeaza toate campurile obligatorii.');

      const schedule = schedules.find((entry) => entry.id === planForm.scheduleId);
      const payload = {
        className: selectedClass,
        scheduleId: planForm.scheduleId,
        scheduleName: schedule?.name || '',
        validFrom: planForm.validFrom,
        validTo: planForm.validTo,
        priority: Number(planForm.priority) || 10,
      };

      if (editingPlan) {
        await base44.entities.ClassPracticePlan.update(editingPlan.id, payload);
      } else {
        await base44.entities.ClassPracticePlan.create(payload);
      }
      return {
        action: editingPlan ? 'CLASS_PLAN_UPDATE' : 'CLASS_PLAN_CREATE',
        className: selectedClass,
        scheduleId: planForm.scheduleId,
        validFrom: planForm.validFrom,
        validTo: planForm.validTo,
      };
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ['classPracticePlans'] });
      await queryClient.invalidateQueries({ queryKey: ['auditLogs'] });
      await logAuditEvent({
        action: result?.action || 'CLASS_PLAN_UPDATE',
        entityType: 'ClassPracticePlan',
        entityId: result?.className || selectedClass,
        actorName: currentUser?.full_name || 'Admin',
        actorEmail: currentUser?.email || '',
        details: `Plan clasa ${result?.className || selectedClass}: schedule=${result?.scheduleId}, ${result?.validFrom} - ${result?.validTo}`,
      });
      setPlanModalOpen(false);
      setEditingPlan(null);
      setPlanForm({ scheduleId: '', validFrom: '', validTo: '', priority: 10 });
      toast({ title: 'Plan salvat', description: 'Programul clasei a fost actualizat.' });
    },
  });

  const deletePlanMutation = useMutation({
    mutationFn: (planId) => base44.entities.ClassPracticePlan.delete(planId),
    onSuccess: async (_, planId) => {
      await queryClient.invalidateQueries({ queryKey: ['classPracticePlans'] });
      await queryClient.invalidateQueries({ queryKey: ['auditLogs'] });
      await logAuditEvent({
        action: 'CLASS_PLAN_DELETE',
        entityType: 'ClassPracticePlan',
        entityId: String(planId || ''),
        actorName: currentUser?.full_name || 'Admin',
        actorEmail: currentUser?.email || '',
        details: `Sters plan de practica pentru clasa ${selectedClass || '-'}`,
      });
    },
  });

  function openCreateClassDialog() {
    setClassDialogMode('create');
    setClassForm({ name: '', specialization: '', defaultOperatorId: UNASSIGNED_OPERATOR, isActive: true });
    setClassDialogOpen(true);
  }

  function openRenameClassDialog() {
    if (!selectedClass) return;
    const metadata = classCatalogByName.get(selectedClass);
    setClassDialogMode('rename');
    setClassForm({
      name: selectedClass,
      specialization: metadata?.specialization || '',
      defaultOperatorId: metadata?.defaultOperatorId || UNASSIGNED_OPERATOR,
      isActive: metadata?.isActive !== false,
    });
    setClassDialogOpen(true);
  }

  function openDeleteClassDialog() {
    if (!selectedClass) return;
    setDeleteMode('clear');
    setTargetClassForMove('');
    setDeleteDialogOpen(true);
  }

  function openPlanModal(plan = null) {
    if (plan) {
      setEditingPlan(plan);
      setPlanForm({
        scheduleId: plan.scheduleId,
        validFrom: plan.validFrom,
        validTo: plan.validTo,
        priority: plan.priority || 10,
      });
    } else {
      setEditingPlan(null);
      setPlanForm({ scheduleId: '', validFrom: '', validTo: '', priority: 10 });
    }
    setPlanModalOpen(true);
  }

  async function handleSendReminders(trigger = 'manual') {
    if (!selectedClass) return;
    setReminderStatus({
      sending: true,
      sent: false,
      count: 0,
      stats: createEmptyDeliveryStats(),
      error: '',
    });

    const targets = reminderConfig.onlyAbsent
      ? absentStudents
      : classStudents.filter((student) => student.isActive !== false);
    const deliveryStats = createEmptyDeliveryStats();
    const sentDetails = [];
    const reminderBody = `Buna!\n\nReminder prezenta astazi (${format(new Date(), 'd MMMM yyyy', { locale: ro })}).\n\nTe rugam sa accesezi aplicatia si sa marchezi prezenta in intervalul permis.`;

    try {
      for (const student of targets) {
        const deliveryResult = await sendReminderToStudent({
          student,
          channels: reminderConfig.channels,
          subject: 'Reminder prezenta practica',
          title: 'Reminder prezenta practica',
          body: reminderBody,
        });
        mergeDeliveryResult(deliveryStats, deliveryResult);
        sentDetails.push(deliveryResult);
      }

      const todayKey = new Date().toISOString().split('T')[0];
      const sentMap = readJsonStorage(CLASS_REMINDER_LAST_SENT_KEY, {});
      sentMap[selectedClass] = {
        dateKey: todayKey,
        trigger,
        sentAt: new Date().toISOString(),
        channels: reminderConfig.channels,
        stats: deliveryStats,
        details: sentDetails,
      };
      writeJsonStorage(CLASS_REMINDER_LAST_SENT_KEY, sentMap);

      await logAuditEvent({
        action: trigger === 'auto' ? 'CLASS_REMINDER_AUTO_SEND' : 'CLASS_REMINDER_MANUAL_SEND',
        entityType: 'Classroom',
        entityId: selectedClass,
        actorName: currentUser?.full_name || 'Admin',
        actorEmail: currentUser?.email || '',
        details: `Reminder ${selectedClass}: notificati=${deliveryStats.recipients.notified}/${deliveryStats.recipients.total}; email(sent=${deliveryStats.channels.email.sent},err=${deliveryStats.channels.email.error},missing=${deliveryStats.channels.email.missing_contact}); sms(sent=${deliveryStats.channels.sms.sent},err=${deliveryStats.channels.sms.error},missing=${deliveryStats.channels.sms.missing_contact}); push(sent=${deliveryStats.channels.push.sent},err=${deliveryStats.channels.push.error},missing=${deliveryStats.channels.push.missing_contact})`,
      });
      await queryClient.invalidateQueries({ queryKey: ['auditLogs'] });

      setReminderStatus({
        sending: false,
        sent: true,
        count: deliveryStats.recipients.notified,
        stats: deliveryStats,
        error: '',
      });
      setTimeout(() => setReminderStatus((prev) => ({ ...prev, sent: false })), 5000);
    } catch (error) {
      setReminderStatus({
        sending: false,
        sent: false,
        count: 0,
        stats: deliveryStats,
        error: error?.message || 'Eroare la trimiterea reminderelor.',
      });
      toast({
        title: 'Reminder esuat',
        description: error?.message || 'A aparut o eroare la trimiterea reminderelor.',
        variant: 'destructive',
      });
    }
  }

  useEffect(() => {
    if (!selectedClass || !reminderConfig.enabled || reminderStatus.sending) return;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const reminderMinutes = timeStringToMinutes(reminderConfig.reminderTime);
    if (reminderMinutes === null || nowMinutes < reminderMinutes) return;

    const todayKey = now.toISOString().split('T')[0];
    const sentMap = readJsonStorage(CLASS_REMINDER_LAST_SENT_KEY, {});
    const classMarker = sentMap[selectedClass];
    if (classMarker?.dateKey === todayKey) return;

    handleSendReminders('auto').catch((error) => {
      console.error('Auto reminder failed:', error);
    });
  }, [
    selectedClass,
    reminderConfig.enabled,
    reminderConfig.reminderTime,
    reminderConfig.onlyAbsent,
    reminderConfig.channels.email,
    reminderConfig.channels.sms,
    reminderConfig.channels.push,
    reminderStatus.sending,
    absentStudents.length,
    classStudents.length,
  ]);
  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Gestionare clase</h1>
            <p className="text-gray-500 mt-1">Adaugare, redenumire, stergere clase si administrarea elevilor pe clasa.</p>
          </div>

          <div className="flex gap-2 flex-wrap">
            <div className="w-64">
              <Select value={selectedClass || ''} onValueChange={setSelectedClass}>
                <SelectTrigger><SelectValue placeholder="Selecteaza clasa..." /></SelectTrigger>
                <SelectContent>
                  {classes.map((className) => (<SelectItem key={className} value={className}>{className}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={openCreateClassDialog}><Plus className="h-4 w-4 mr-2" />Adauga clasa</Button>
            <Button variant="outline" onClick={openRenameClassDialog} disabled={!selectedClass}><Edit2 className="h-4 w-4 mr-2" />Modifica clasa</Button>
            <Button variant="destructive" onClick={openDeleteClassDialog} disabled={!selectedClass}><Trash2 className="h-4 w-4 mr-2" />Sterge clasa</Button>
          </div>
        </div>

        {!selectedClass && (
          <Card>
            <CardContent className="py-16 text-center text-gray-500">
              Nu exista clase configurate. Adauga prima clasa din butonul "Adauga clasa".
            </CardContent>
          </Card>
        )}

        {selectedClass && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card><CardContent className="pt-4"><p className="text-sm text-gray-500">Total elevi</p><p className="text-3xl font-bold">{classStudents.length}</p></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-sm text-gray-500">Prezenti azi</p><p className="text-3xl font-bold text-green-600">{presentCount}</p></CardContent></Card>
              <Card><CardContent className="pt-4"><p className="text-sm text-gray-500">Absenti azi</p><p className="text-3xl font-bold text-red-600">{absentStudents.length}</p></CardContent></Card>
            </div>

            <Tabs defaultValue="students">
              <TabsList>
                <TabsTrigger value="students"><Users className="h-4 w-4 mr-2" />Elevi ({classStudents.length})</TabsTrigger>
                <TabsTrigger value="plans"><Calendar className="h-4 w-4 mr-2" />Programe ({classPlans.length})</TabsTrigger>
                <TabsTrigger value="reminders"><Bell className="h-4 w-4 mr-2" />Notificari</TabsTrigger>
              </TabsList>

              <TabsContent value="students">
                <Card>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Nume</TableHead>
                            <TableHead>Email</TableHead>
                            <TableHead>Telefon</TableHead>
                            <TableHead>Specializare</TableHead>
                            <TableHead>Operator</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Azi</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {classStudents.map((student) => {
                            const operator = operators.find((entry) => entry.id === student.operatorId);
                            const isPresent = todayAttendances.some((attendance) => attendance.studentUserId === student.id);
                            return (
                              <TableRow key={student.id}>
                                <TableCell className="font-medium">{student.full_name}</TableCell>
                                <TableCell>{student.email || '-'}</TableCell>
                                <TableCell>{student.phoneNumber || student.phone || '-'}</TableCell>
                                <TableCell>{student.specialization || '-'}</TableCell>
                                <TableCell>{operator?.name || 'Nealocat'}</TableCell>
                                <TableCell><Badge variant={student.isActive === false ? 'secondary' : 'default'}>{student.isActive === false ? 'Inactiv' : 'Activ'}</Badge></TableCell>
                                <TableCell><div className={`w-3 h-3 rounded-full ${isPresent ? 'bg-green-500' : 'bg-red-400'}`} /></TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                    {classStudents.length === 0 && (<div className="py-10 text-center text-gray-500">Nu exista elevi in clasa {selectedClass}.</div>)}
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="plans">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle>Programe practica - Clasa {selectedClass}</CardTitle>
                      <Button onClick={() => openPlanModal()} className="bg-blue-600 hover:bg-blue-700"><Plus className="h-4 w-4 mr-2" />Adauga program</Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {classPlans.sort((a, b) => (b.priority || 10) - (a.priority || 10)).map((plan) => {
                        const schedule = schedules.find((entry) => entry.id === plan.scheduleId);
                        const today = new Date().toISOString().split('T')[0];
                        const isActive = today >= plan.validFrom && today <= plan.validTo;

                        return (
                          <div key={plan.id} className="flex items-center justify-between p-4 rounded-lg border bg-white">
                            <div className="space-y-1">
                              <div className="flex items-center gap-3">
                                <span className="font-semibold">{plan.scheduleName || schedule?.name || 'Program'}</span>
                                <Badge className="bg-blue-600">Prioritate {plan.priority || 10}</Badge>
                                {isActive && <Badge className="bg-green-600">Activ acum</Badge>}
                              </div>
                              <div className="flex items-center gap-4 text-sm text-gray-600 flex-wrap">
                                <span><Calendar className="h-3 w-3 inline mr-1" />{format(new Date(plan.validFrom), 'dd MMM', { locale: ro })} - {format(new Date(plan.validTo), 'dd MMM yyyy', { locale: ro })}</span>
                                {schedule && <span><Clock className="h-3 w-3 inline mr-1" />Pontaj: {schedule.checkinStartTime} - {schedule.checkinEndTime}</span>}
                              </div>
                              {schedule?.daysOfWeek?.length > 0 && (
                                <div className="flex gap-1 flex-wrap">
                                  {schedule.daysOfWeek.map((day) => (<Badge key={day} variant="outline" className="text-xs">{DAYS_MAP[day] || day}</Badge>))}
                                </div>
                              )}
                            </div>
                            <div className="flex gap-2">
                              <Button variant="outline" size="sm" onClick={() => openPlanModal(plan)}><Edit2 className="h-3 w-3" /></Button>
                              <Button variant="destructive" size="sm" onClick={() => deletePlanMutation.mutate(plan.id)}><Trash2 className="h-3 w-3" /></Button>
                            </div>
                          </div>
                        );
                      })}
                      {classPlans.length === 0 && (<p className="text-center text-gray-500 py-8">Nu exista programe definite pentru clasa {selectedClass}.</p>)}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="reminders">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5 text-blue-600" />Notificari prezenta - Clasa {selectedClass}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                      <p className="text-sm text-blue-900">
                        Poti activa reminder automat pe clasa. Trimiterea automata ruleaza o data pe zi dupa ora setata.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-lg border p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="cursor-pointer">Reminder automat activ</Label>
                          <Switch
                            checked={reminderConfig.enabled}
                            onCheckedChange={(checked) => updateReminderConfig({ enabled: checked })}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Ora trimitere</Label>
                          <Input
                            type="time"
                            value={reminderConfig.reminderTime}
                            onChange={(event) => updateReminderConfig({ reminderTime: event.target.value })}
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="onlyAbsent"
                            checked={reminderConfig.onlyAbsent}
                            onCheckedChange={(checked) => updateReminderConfig({ onlyAbsent: checked === true })}
                          />
                          <Label htmlFor="onlyAbsent" className="cursor-pointer">Trimite doar elevilor absenti</Label>
                        </div>
                      </div>

                      <div className="rounded-lg border p-3 space-y-2">
                        <Label>Canale reminder</Label>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="channel-email"
                            checked={reminderConfig.channels.email}
                            onCheckedChange={(checked) => updateReminderConfig({ channels: { email: checked === true } })}
                          />
                          <Label htmlFor="channel-email" className="cursor-pointer">
                            Email {reminderCapabilities.sources?.email === 'core' ? '(Core)' : '(provider lipsa)'}
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="channel-push"
                            checked={reminderConfig.channels.push}
                            onCheckedChange={(checked) => updateReminderConfig({ channels: { push: checked === true } })}
                          />
                          <Label htmlFor="channel-push" className="cursor-pointer">
                            Push {reminderCapabilities.sources?.push === 'core' ? '(Core)' : reminderCapabilities.sources?.push === 'functions' ? '(Functions)' : '(provider lipsa)'}
                          </Label>
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="channel-sms"
                            checked={reminderConfig.channels.sms}
                            onCheckedChange={(checked) => updateReminderConfig({ channels: { sms: checked === true } })}
                          />
                          <Label htmlFor="channel-sms" className="cursor-pointer">
                            SMS {reminderCapabilities.sources?.sms === 'core' ? '(Core)' : reminderCapabilities.sources?.sms === 'functions' ? '(Functions)' : '(provider lipsa)'}
                          </Label>
                        </div>
                        <p className="text-xs text-gray-500 pt-1">
                          Canalele fara provider configurat vor fi marcate "not_configured" in raportul de livrare.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium">Elevi absenti azi ({absentStudents.length}):</p>
                      <div className="space-y-2">
                        {absentStudents.map((student) => (
                          <div key={student.id} className="flex items-center justify-between p-3 bg-red-50 rounded-lg">
                            <span className="font-medium text-sm">{student.full_name}</span>
                            <span className="text-xs text-gray-500">{student.email || student.phone || student.phoneNumber || '-'}</span>
                          </div>
                        ))}
                        {absentStudents.length === 0 && (<p className="text-sm text-green-700 text-center py-4">Toti elevii sunt prezenti astazi.</p>)}
                      </div>
                    </div>

                    {reminderStatus.error && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        {reminderStatus.error}
                      </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <Card>
                        <CardContent className="pt-4">
                          <p className="text-xs text-gray-500">Email trimise</p>
                          <p className="text-xl font-semibold text-blue-700">{reminderStatus.stats.channels.email.sent}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <p className="text-xs text-gray-500">SMS trimise</p>
                          <p className="text-xl font-semibold text-blue-700">{reminderStatus.stats.channels.sms.sent}</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-4">
                          <p className="text-xs text-gray-500">Push trimise</p>
                          <p className="text-xl font-semibold text-blue-700">{reminderStatus.stats.channels.push.sent}</p>
                        </CardContent>
                      </Card>
                    </div>

                    <div className="text-xs text-gray-600 space-y-1">
                      <p>
                        Email: missing={reminderStatus.stats.channels.email.missing_contact}, not_configured={reminderStatus.stats.channels.email.not_configured}, error={reminderStatus.stats.channels.email.error}
                      </p>
                      <p>
                        SMS: missing={reminderStatus.stats.channels.sms.missing_contact}, not_configured={reminderStatus.stats.channels.sms.not_configured}, error={reminderStatus.stats.channels.sms.error}
                      </p>
                      <p>
                        Push: missing={reminderStatus.stats.channels.push.missing_contact}, not_configured={reminderStatus.stats.channels.push.not_configured}, error={reminderStatus.stats.channels.push.error}
                      </p>
                    </div>

                    <Button
                      onClick={() => handleSendReminders('manual')}
                      disabled={reminderStatus.sending || (!reminderConfig.channels.email && !reminderConfig.channels.push && !reminderConfig.channels.sms)}
                      className="w-full bg-orange-500 hover:bg-orange-600"
                    >
                      {reminderStatus.sending
                        ? 'Se trimit...'
                        : reminderStatus.sent
                          ? `Trimis la ${reminderStatus.count} elevi!`
                          : <><Send className="h-4 w-4 mr-2" />Trimite reminder acum</>}
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <Dialog open={classDialogOpen} onOpenChange={setClassDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{classDialogMode === 'create' ? 'Adauga clasa' : `Modifica clasa ${selectedClass}`}</DialogTitle>
            <DialogDescription>
              In modul modificare, redenumirea clasei actualizeaza automat elevii, planurile si istoricul de prezenta.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nume clasa *</Label>
              <Input value={classForm.name} onChange={(event) => setClassForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Ex: 10A" />
            </div>
            <div className="space-y-2">
              <Label>Specializare implicita</Label>
              <Input value={classForm.specialization} onChange={(event) => setClassForm((prev) => ({ ...prev, specialization: event.target.value }))} placeholder="Ex: Informatica" />
            </div>
            <div className="space-y-2">
              <Label>Operator implicit</Label>
              <Select value={classForm.defaultOperatorId} onValueChange={(value) => setClassForm((prev) => ({ ...prev, defaultOperatorId: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED_OPERATOR}>Fara operator implicit</SelectItem>
                  {operators.map((operator) => (<SelectItem key={operator.id} value={operator.id}>{operator.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setClassDialogOpen(false)}>Renunta</Button>
            <Button onClick={() => saveClassMutation.mutate()} disabled={saveClassMutation.isPending || !classForm.name.trim()} className="bg-blue-600 hover:bg-blue-700">
              {saveClassMutation.isPending ? 'Se salveaza...' : 'Salveaza clasa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Sterge clasa {selectedClass}</DialogTitle>
            <DialogDescription>
              Clasa are {classStudents.length} elevi si {classPlans.length} planuri active. Alege ce se intampla cu elevii.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Actiune pentru elevi</Label>
              <Select value={deleteMode} onValueChange={setDeleteMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="clear">Pastreaza elevii, fara clasa</SelectItem>
                  <SelectItem value="move">Muta elevii in alta clasa</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {deleteMode === 'move' && (
              <div className="space-y-2">
                <Label>Clasa tinta *</Label>
                <Select value={targetClassForMove} onValueChange={setTargetClassForMove}>
                  <SelectTrigger><SelectValue placeholder="Selecteaza clasa tinta" /></SelectTrigger>
                  <SelectContent>
                    {classes.filter((className) => className !== selectedClass).map((className) => (
                      <SelectItem key={className} value={className}>{className}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Renunta</Button>
            <Button variant="destructive" onClick={() => deleteClassMutation.mutate()} disabled={deleteClassMutation.isPending || (deleteMode === 'move' && !targetClassForMove)}>
              {deleteClassMutation.isPending ? 'Se sterge...' : 'Sterge clasa'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={planModalOpen} onOpenChange={setPlanModalOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingPlan ? 'Modifica program' : `Adauga program - Clasa ${selectedClass}`}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Program practica *</Label>
              <Select value={planForm.scheduleId} onValueChange={(value) => setPlanForm((prev) => ({ ...prev, scheduleId: value }))}>
                <SelectTrigger><SelectValue placeholder="Selecteaza programul" /></SelectTrigger>
                <SelectContent>
                  {schedules.filter((schedule) => schedule.isActive !== false).map((schedule) => (
                    <SelectItem key={schedule.id} value={schedule.id}>{schedule.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Valabil de la *</Label>
                <Input type="date" value={planForm.validFrom} onChange={(event) => setPlanForm((prev) => ({ ...prev, validFrom: event.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Valabil pana la *</Label>
                <Input type="date" value={planForm.validTo} onChange={(event) => setPlanForm((prev) => ({ ...prev, validTo: event.target.value }))} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Prioritate</Label>
              <Input type="number" value={planForm.priority} onChange={(event) => setPlanForm((prev) => ({ ...prev, priority: parseInt(event.target.value, 10) || 10 }))} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setPlanModalOpen(false)}>Renunta</Button>
            <Button onClick={() => savePlanMutation.mutate()} disabled={savePlanMutation.isPending} className="bg-blue-600 hover:bg-blue-700">
              {savePlanMutation.isPending ? 'Se salveaza...' : 'Salveaza programul'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
