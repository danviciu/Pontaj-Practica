
import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, KeyRound, Mail, Pencil, Plus, Search, Trash2, Upload, UserPlus } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { createClassCatalogItem, listClassCatalog } from '@/lib/class-catalog';
import { parseStudentsFile } from '@/lib/student-import';
import { logAuditEvent } from '@/lib/audit-log';
import { toast } from '@/components/ui/use-toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import CredentialsModal from '@/components/admin/dashboard/modals/CredentialsModal';

const ALL_VALUE = 'all';
const UNASSIGNED_OPERATOR = '__unassigned__';
const STUDENT_FORM_DRAFT_KEY = 'studentsManagement.studentFormDraft.v1';
const IMPORT_OPTIONS_DRAFT_KEY = 'studentsManagement.importOptionsDraft.v1';

const IMPORT_ACTIONS = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  SKIP: 'SKIP',
  INVALID: 'INVALID',
};

const EMPTY_STUDENT_FORM = {
  id: '',
  full_name: '',
  email: '',
  phoneNumber: '',
  pushToken: '',
  className: '',
  specialization: '',
  operatorId: UNASSIGNED_OPERATOR,
  isActive: true,
};

function normalizeClassName(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePhoneNumber(value) {
  return String(value || '').trim().replace(/[\s-]/g, '');
}

function stripDiacritics(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let index = 0; index < 8; index += 1) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

function generateUsername(fullName, reservedUsernames) {
  const normalized = stripDiacritics(String(fullName || '')).toLowerCase();
  const sections = normalized
    .split(/[-â€“]/)
    .map((section) => section.trim())
    .filter(Boolean);
  const tailSection = sections[sections.length - 1] || normalized;
  const tokens = tailSection.split(/\s+/).filter(Boolean);
  const baseTokens = normalized.split(/\s+/).filter(Boolean);

  const firstInitial = (baseTokens[0] || 'u').replace(/[^a-z0-9]/g, '').charAt(0) || 'u';
  const tailName = (tokens[tokens.length - 1] || baseTokens[baseTokens.length - 1] || 'elev').replace(/[^a-z0-9]/g, '');
  const base = `${firstInitial}${tailName}`.slice(0, 24) || `user${Math.floor(Math.random() * 1000)}`;

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const suffix = Math.floor(Math.random() * 1000);
    const candidate = `${base}${suffix}`;
    if (!reservedUsernames.has(candidate)) {
      reservedUsernames.add(candidate);
      return candidate;
    }
  }

  const fallback = `${base}${Date.now().toString().slice(-4)}`;
  reservedUsernames.add(fallback);
  return fallback;
}

function buildStudentPayload(form) {
  return {
    role: 'user',
    full_name: String(form.full_name || '').trim(),
    email: normalizeEmail(form.email),
    phoneNumber: normalizePhoneNumber(form.phoneNumber),
    pushToken: String(form.pushToken || '').trim(),
    className: normalizeClassName(form.className),
    specialization: String(form.specialization || '').trim(),
    operatorId: form.operatorId === UNASSIGNED_OPERATOR ? '' : form.operatorId,
    isActive: form.isActive !== false,
  };
}

function readDraft(key, fallbackValue) {
  try {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) return fallbackValue;
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === 'object' ? parsed : fallbackValue;
  } catch (error) {
    return fallbackValue;
  }
}

function writeDraft(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Cannot persist draft: ${key}`, error);
  }
}

function clearDraft(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn(`Cannot clear draft: ${key}`, error);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callWithRetry(action, maxAttempts = 2) {
  let latestError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      latestError = error;
      if (attempt < maxAttempts) {
        await delay(600 * attempt);
      }
    }
  }
  throw latestError;
}

function analyzeImportRows(preview, students, importOptions) {
  const existingByEmail = new Map(
    students.filter((student) => Boolean(student.email)).map((student) => [normalizeEmail(student.email), student])
  );
  const seenKeys = new Set();

  const rows = preview.students.map((student, index) => {
    const fullName = String(student.full_name || '').trim();
    const email = normalizeEmail(student.email);
    const phoneNumber = normalizePhoneNumber(student.phoneNumber || student.phone);
    const pushToken = String(student.pushToken || student.deviceToken || '').trim();
    const className = normalizeClassName(student.className || importOptions.defaultClassName);
    const identityKey = `${email || 'no-email'}|${fullName.toLowerCase()}|${className || 'no-class'}`;
    const duplicateInFile = seenKeys.has(identityKey);
    if (!duplicateInFile) seenKeys.add(identityKey);

    if (!fullName) {
      return {
        id: `${index}_invalid_name`,
        source: student,
        action: IMPORT_ACTIONS.INVALID,
        issue: 'Lipseste numele elevului.',
      };
    }

    if (duplicateInFile) {
      return {
        id: `${index}_duplicate`,
        source: student,
        action: IMPORT_ACTIONS.SKIP,
        issue: 'Duplicat in acelasi fisier.',
      };
    }

    const existing = email ? existingByEmail.get(email) : null;
    if (existing && !importOptions.updateExisting) {
      return {
        id: `${index}_skip_existing`,
        source: student,
        action: IMPORT_ACTIONS.SKIP,
        issue: 'Email existent, iar actualizarea elevilor existenti este dezactivata.',
      };
    }

    let warningWithoutEmail = '';
    if (!email && !importOptions.generateCredentials) {
      warningWithoutEmail = 'Fara email si fara generare credentiale automate.';
    }
    if (!email && !phoneNumber && !pushToken && !warningWithoutEmail) {
      warningWithoutEmail = 'Elevul nu are date de contact (email/telefon/push token).';
    }

    return {
      id: `${index}_${existing ? 'update' : 'create'}`,
      source: student,
      action: existing ? IMPORT_ACTIONS.UPDATE : IMPORT_ACTIONS.CREATE,
      issue: warningWithoutEmail,
      existingStudentId: existing?.id || '',
    };
  });

  const skippedFromParser = preview.skipped.map((issue, index) => ({
    id: `parser_skip_${index}`,
    source: null,
    action: IMPORT_ACTIONS.INVALID,
    issue: issue?.reason || 'Rand invalid in fisierul importat.',
    raw: issue?.raw,
    line: issue?.line,
  }));

  const allRows = [...rows, ...skippedFromParser];
  const summary = {
    totalRows: allRows.length,
    create: allRows.filter((entry) => entry.action === IMPORT_ACTIONS.CREATE).length,
    update: allRows.filter((entry) => entry.action === IMPORT_ACTIONS.UPDATE).length,
    skip: allRows.filter((entry) => entry.action === IMPORT_ACTIONS.SKIP).length,
    invalid: allRows.filter((entry) => entry.action === IMPORT_ACTIONS.INVALID).length,
    actionable: allRows.filter((entry) => [IMPORT_ACTIONS.CREATE, IMPORT_ACTIONS.UPDATE].includes(entry.action)).length,
  };

  return { rows: allRows, summary };
}

function getImportActionLabel(action) {
  if (action === IMPORT_ACTIONS.CREATE) return 'Creeaza';
  if (action === IMPORT_ACTIONS.UPDATE) return 'Actualizeaza';
  if (action === IMPORT_ACTIONS.SKIP) return 'Sare';
  return 'Invalid';
}

function getImportActionBadgeVariant(action) {
  if (action === IMPORT_ACTIONS.CREATE || action === IMPORT_ACTIONS.UPDATE) return 'default';
  if (action === IMPORT_ACTIONS.SKIP) return 'secondary';
  return 'destructive';
}

export default function StudentsManagement() {
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState('');
  const [filterClass, setFilterClass] = useState(ALL_VALUE);
  const [filterOperator, setFilterOperator] = useState(ALL_VALUE);
  const [filterSpecialization, setFilterSpecialization] = useState(ALL_VALUE);
  const [filterStatus, setFilterStatus] = useState(ALL_VALUE);

  const [studentModalOpen, setStudentModalOpen] = useState(false);
  const [studentForm, setStudentForm] = useState(EMPTY_STUDENT_FORM);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [isParsingFile, setIsParsingFile] = useState(false);
  const [importPreview, setImportPreview] = useState({ fileName: '', students: [], skipped: [] });
  const [importOptions, setImportOptions] = useState({
    updateExisting: true,
    generateCredentials: true,
    defaultClassName: '',
    defaultSpecialization: '',
    defaultOperatorId: UNASSIGNED_OPERATOR,
    defaultIsActive: true,
  });
  const [generatedCredentials, setGeneratedCredentials] = useState([]);
  const [credentialsModalOpen, setCredentialsModalOpen] = useState(false);
  const [draftsInitialized, setDraftsInitialized] = useState(false);
  const [credentialsManagerOpen, setCredentialsManagerOpen] = useState(false);
  const [credentialsManagerStudent, setCredentialsManagerStudent] = useState(null);
  const [credentialsActionLoading, setCredentialsActionLoading] = useState('');

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

  const { data: classCatalog = [] } = useQuery({
    queryKey: ['classCatalog'],
    queryFn: listClassCatalog,
  });

  useEffect(() => {
    const studentDraft = readDraft(STUDENT_FORM_DRAFT_KEY, null);
    const importDraft = readDraft(IMPORT_OPTIONS_DRAFT_KEY, null);

    if (studentDraft && typeof studentDraft === 'object') {
      setStudentForm((prev) => ({
        ...prev,
        ...studentDraft,
      }));
    }

    if (importDraft && typeof importDraft === 'object') {
      setImportOptions((prev) => ({
        ...prev,
        ...importDraft,
      }));
    }

    setDraftsInitialized(true);
  }, []);

  useEffect(() => {
    if (!draftsInitialized || !studentModalOpen) return;
    writeDraft(STUDENT_FORM_DRAFT_KEY, studentForm);
  }, [studentForm, studentModalOpen, draftsInitialized]);

  useEffect(() => {
    if (!draftsInitialized || !importModalOpen) return;
    writeDraft(IMPORT_OPTIONS_DRAFT_KEY, importOptions);
  }, [importOptions, importModalOpen, draftsInitialized]);

  const classes = useMemo(() => {
    const set = new Set();
    students.forEach((student) => {
      if (student.className) set.add(normalizeClassName(student.className));
    });
    classCatalog.forEach((entry) => {
      if (entry.name) set.add(normalizeClassName(entry.name));
    });
    return [...set].sort((left, right) => left.localeCompare(right));
  }, [students, classCatalog]);

  const specializations = useMemo(
    () => [...new Set(students.map((entry) => entry.specialization).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [students]
  );

  const importAnalysis = useMemo(
    () => analyzeImportRows(importPreview, students, importOptions),
    [importPreview, students, importOptions]
  );

  const filteredStudents = useMemo(() => {
    return students.filter((student) => {
      const search = searchTerm.toLowerCase().trim();
      if (search) {
        const fields = [student.full_name, student.email, student.phoneNumber, student.phone, student.pushToken, student.className]
          .map((value) => String(value || '').toLowerCase());
        if (!fields.some((value) => value.includes(search))) return false;
      }
      if (filterClass !== ALL_VALUE && normalizeClassName(student.className) !== filterClass) return false;
      if (filterOperator !== ALL_VALUE) {
        if (filterOperator === UNASSIGNED_OPERATOR && student.operatorId) return false;
        if (filterOperator !== UNASSIGNED_OPERATOR && student.operatorId !== filterOperator) return false;
      }
      if (filterSpecialization !== ALL_VALUE && student.specialization !== filterSpecialization) return false;
      if (filterStatus === 'active' && student.isActive === false) return false;
      if (filterStatus === 'inactive' && student.isActive !== false) return false;
      return true;
    });
  }, [students, searchTerm, filterClass, filterOperator, filterSpecialization, filterStatus]);

  const saveStudentMutation = useMutation({
    mutationFn: async (form) => {
      const payload = buildStudentPayload(form);
      if (!payload.full_name) throw new Error('Numele elevului este obligatoriu.');

      if (form.id) {
        return callWithRetry(() => base44.entities.User.update(form.id, payload), 2);
      }

      if (payload.email) {
        try {
          const invited = await callWithRetry(() => base44.users.inviteUser(payload.email, 'user'), 2);
          if (invited?.id) {
            return callWithRetry(() => base44.entities.User.update(invited.id, payload), 2);
          }
        } catch (error) {
          console.warn('Invite failed, fallback to create:', error);
        }
      }

      return callWithRetry(() => base44.entities.User.create(payload), 2);
    },
    onSuccess: async (savedStudent, form) => {
      if (form.className) {
        try {
          await createClassCatalogItem({ name: form.className });
        } catch (error) {
          console.warn('Class catalog sync failed:', error);
        }
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['students'] }),
        queryClient.invalidateQueries({ queryKey: ['classCatalog'] }),
        queryClient.invalidateQueries({ queryKey: ['auditLogs'] }),
      ]);

      await logAuditEvent({
        action: form.id ? 'STUDENT_UPDATE' : 'STUDENT_CREATE',
        entityType: 'User',
        entityId: savedStudent?.id || form.id || '',
        actorName: currentUser?.full_name || 'Admin',
        actorEmail: currentUser?.email || '',
        details: `${form.id ? 'Actualizat' : 'Creat'} elevul ${form.full_name || '-'}`,
      });

      setStudentModalOpen(false);
      setStudentForm(EMPTY_STUDENT_FORM);
      clearDraft(STUDENT_FORM_DRAFT_KEY);
      toast({
        title: form.id ? 'Elev actualizat' : 'Elev adaugat',
        description: form.id ? 'Modificarile au fost salvate.' : 'Elevul a fost creat cu succes.',
      });
    },
    onError: (error) => {
      toast({
        title: 'Nu am putut salva elevul',
        description: error?.message || 'A aparut o eroare API. Incearca din nou.',
        variant: 'destructive',
      });
    },
  });

  const deleteStudentMutation = useMutation({
    mutationFn: async (student) => {
      try {
        return await callWithRetry(() => base44.entities.User.delete(student.id), 2);
      } catch (error) {
        await callWithRetry(() => base44.entities.User.update(student.id, { isActive: false }), 2);
        return { deactivated: true };
      }
    },
    onSuccess: async (result, student) => {
      await queryClient.invalidateQueries({ queryKey: ['students'] });
      await queryClient.invalidateQueries({ queryKey: ['auditLogs'] });
      await logAuditEvent({
        action: result?.deactivated ? 'STUDENT_DEACTIVATE' : 'STUDENT_DELETE',
        entityType: 'User',
        entityId: student.id,
        actorName: currentUser?.full_name || 'Admin',
        actorEmail: currentUser?.email || '',
        details: `${result?.deactivated ? 'Dezactivat' : 'Sters'} elevul ${student.full_name || '-'}`,
      });
      toast({
        title: result?.deactivated ? 'Elev dezactivat' : 'Elev eliminat',
        description: result?.deactivated
          ? `${student.full_name} nu a putut fi sters, a fost marcat inactiv.`
          : `${student.full_name} a fost eliminat.`,
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (importAnalysis.summary.actionable === 0) {
        throw new Error('Nu exista randuri procesabile. Verifica preview-ul si optiunile de import.');
      }

      const existingByEmail = new Map(
        students.filter((student) => Boolean(student.email)).map((student) => [normalizeEmail(student.email), student])
      );
      const reservedUsernames = new Set(
        students
          .map((student) => normalizeEmail(student.email || '').split('@')[0])
          .filter(Boolean)
      );

      const discoveredClasses = new Set();
      const report = {
        created: 0,
        updated: 0,
        skipped: importAnalysis.summary.skip,
        invalid: importAnalysis.summary.invalid,
        failed: 0,
        credentials: [],
      };

      for (const row of importAnalysis.rows) {
        if (![IMPORT_ACTIONS.CREATE, IMPORT_ACTIONS.UPDATE].includes(row.action)) {
          continue;
        }
        const importedStudent = row.source;
        const prepared = buildStudentPayload({
          ...importedStudent,
          className: importedStudent.className || importOptions.defaultClassName,
          specialization: importedStudent.specialization || importOptions.defaultSpecialization,
          operatorId: importedStudent.operatorId || importOptions.defaultOperatorId,
          isActive: importOptions.defaultIsActive,
        });

        if (!prepared.full_name) {
          report.skipped += 1;
          continue;
        }

        let generatedPassword = '';
        if (!prepared.email && importOptions.generateCredentials) {
          const username = generateUsername(prepared.full_name, reservedUsernames);
          const password = generatePassword();
          generatedPassword = password;
          prepared.email = `${username}@practica.local`;
          prepared.password = password;
          report.credentials.push({
            fullName: prepared.full_name,
            className: prepared.className || importOptions.defaultClassName || '-',
            username,
            password,
            email: prepared.email,
          });
        }

        const emailKey = normalizeEmail(prepared.email);
        const existing = row.existingStudentId
          ? students.find((student) => student.id === row.existingStudentId)
          : (emailKey ? existingByEmail.get(emailKey) : null);

        try {
          if (existing) {
            await callWithRetry(() => base44.entities.User.update(existing.id, prepared), 2);
            report.updated += 1;
          } else {
            if (generatedPassword) {
              await callWithRetry(() => base44.entities.User.create(prepared), 2);
            } else if (prepared.email) {
              try {
                const invited = await callWithRetry(() => base44.users.inviteUser(prepared.email, 'user'), 2);
                if (invited?.id) {
                  await callWithRetry(() => base44.entities.User.update(invited.id, prepared), 2);
                } else {
                  await callWithRetry(() => base44.entities.User.create(prepared), 2);
                }
              } catch (inviteError) {
                console.warn('Invite failed on import, fallback to create:', inviteError);
                await callWithRetry(() => base44.entities.User.create(prepared), 2);
              }
            } else {
              await callWithRetry(() => base44.entities.User.create(prepared), 2);
            }

            if (emailKey) existingByEmail.set(emailKey, prepared);
            report.created += 1;
          }

          if (prepared.className) discoveredClasses.add(prepared.className);
        } catch (error) {
          report.failed += 1;
        }
      }

      for (const className of discoveredClasses) {
        try {
          await createClassCatalogItem({ name: className });
        } catch (error) {
          console.warn('Class catalog sync failed:', error);
        }
      }

      return report;
    },
    onSuccess: async (report) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['students'] }),
        queryClient.invalidateQueries({ queryKey: ['classCatalog'] }),
        queryClient.invalidateQueries({ queryKey: ['auditLogs'] }),
      ]);

      setImportModalOpen(false);
      setImportPreview({ fileName: '', students: [], skipped: [] });
      setImportOptions({
        updateExisting: true,
        generateCredentials: true,
        defaultClassName: '',
        defaultSpecialization: '',
        defaultOperatorId: UNASSIGNED_OPERATOR,
        defaultIsActive: true,
      });
      clearDraft(IMPORT_OPTIONS_DRAFT_KEY);

      await logAuditEvent({
        action: 'STUDENT_IMPORT',
        entityType: 'User',
        entityId: '',
        actorName: currentUser?.full_name || 'Admin',
        actorEmail: currentUser?.email || '',
        details: `Import elevi: creati=${report.created}, actualizati=${report.updated}, sariti=${report.skipped}, invalide=${report.invalid}, erori=${report.failed}`,
      });

      if (report.credentials.length > 0) {
        setGeneratedCredentials(report.credentials);
        setCredentialsModalOpen(true);
      }
      toast({
        title: 'Import finalizat',
        description: `Creati: ${report.created} | Actualizati: ${report.updated} | Sariti: ${report.skipped} | Invalide: ${report.invalid} | Erori API: ${report.failed} | Credentiale: ${report.credentials.length}`,
        variant: report.failed > 0 ? 'destructive' : 'default',
      });
    },
    onError: (error) => {
      toast({
        title: 'Import esuat',
        description: error?.message || 'Nu am putut procesa importul. Incearca din nou.',
        variant: 'destructive',
      });
    },
  });

  function openCreateStudentModal() {
    const draftForm = readDraft(STUDENT_FORM_DRAFT_KEY, null);
    setStudentForm(draftForm && !draftForm.id ? { ...EMPTY_STUDENT_FORM, ...draftForm } : EMPTY_STUDENT_FORM);
    setStudentModalOpen(true);
  }

  function openEditStudentModal(student) {
    setStudentForm({
      id: student.id,
      full_name: student.full_name || '',
      email: student.email || '',
      phoneNumber: student.phoneNumber || student.phone || '',
      pushToken: student.pushToken || student.deviceToken || '',
      className: student.className || '',
      specialization: student.specialization || '',
      operatorId: student.operatorId || UNASSIGNED_OPERATOR,
      isActive: student.isActive !== false,
    });
    clearDraft(STUDENT_FORM_DRAFT_KEY);
    setStudentModalOpen(true);
  }

  function handleDeleteStudent(student) {
    const confirmed = window.confirm(`Stergi elevul "${student.full_name}"?`);
    if (confirmed) deleteStudentMutation.mutate(student);
  }

  function openImportModal() {
    const draft = readDraft(IMPORT_OPTIONS_DRAFT_KEY, null);
    if (draft && typeof draft === 'object') {
      setImportOptions((prev) => ({ ...prev, ...draft }));
    }
    setImportModalOpen(true);
  }

  function openCredentialsManager(student) {
    setCredentialsManagerStudent(student);
    setCredentialsManagerOpen(true);
  }

  async function handleSendResetPassword(student) {
    if (!student?.email) {
      toast({
        title: 'Email lipsa',
        description: 'Elevul nu are email configurat pentru resetare parola.',
        variant: 'destructive',
      });
      return;
    }

    setCredentialsActionLoading('reset');
    try {
      await callWithRetry(() => base44.auth.resetPasswordRequest(student.email), 2);
      await logAuditEvent({
        action: 'STUDENT_RESET_PASSWORD_REQUEST',
        entityType: 'User',
        entityId: student.id,
        actorName: currentUser?.full_name || 'Admin',
        actorEmail: currentUser?.email || '',
        details: `Reset parola solicitat pentru ${student.full_name || student.email}`,
      });
      await queryClient.invalidateQueries({ queryKey: ['auditLogs'] });
      toast({
        title: 'Reset parola trimis',
        description: `Email de reset trimis catre ${student.email}.`,
      });
    } catch (error) {
      toast({
        title: 'Reset parola esuat',
        description: error?.message || 'Nu am putut trimite emailul de resetare.',
        variant: 'destructive',
      });
    } finally {
      setCredentialsActionLoading('');
    }
  }

  async function handleResendInvite(student) {
    if (!student?.email) {
      toast({
        title: 'Email lipsa',
        description: 'Elevul nu are email configurat pentru invitatie.',
        variant: 'destructive',
      });
      return;
    }

    const inviteFn = base44.auth?.inviteUser
      ? (email) => base44.auth.inviteUser(email, 'user')
      : (email) => base44.users.inviteUser(email, 'user');

    setCredentialsActionLoading('invite');
    try {
      await callWithRetry(() => inviteFn(student.email), 2);
      await logAuditEvent({
        action: 'STUDENT_RESEND_INVITE',
        entityType: 'User',
        entityId: student.id,
        actorName: currentUser?.full_name || 'Admin',
        actorEmail: currentUser?.email || '',
        details: `Invitatie retrimisa catre ${student.email}`,
      });
      await queryClient.invalidateQueries({ queryKey: ['auditLogs'] });
      toast({
        title: 'Invitatie retrimisa',
        description: `Invitatia a fost retrimisa catre ${student.email}.`,
      });
    } catch (error) {
      toast({
        title: 'Invitatie esuata',
        description: error?.message || 'Nu am putut retrimite invitatia.',
        variant: 'destructive',
      });
    } finally {
      setCredentialsActionLoading('');
    }
  }

  async function handleRegenerateUsername(student) {
    if (!student?.id) return;

    const reservedUsernames = new Set(
      students
        .map((entry) => normalizeEmail(entry.email || '').split('@')[0])
        .filter(Boolean)
    );

    setCredentialsActionLoading('regenerate');
    try {
      const username = generateUsername(student.full_name, reservedUsernames);
      const newEmail = `${username}@practica.local`;
      await callWithRetry(() => base44.entities.User.update(student.id, { email: newEmail }), 2);

      const inviteFn = base44.auth?.inviteUser
        ? (email) => base44.auth.inviteUser(email, 'user')
        : (email) => base44.users.inviteUser(email, 'user');

      try {
        await callWithRetry(() => inviteFn(newEmail), 2);
      } catch (inviteError) {
        console.warn('Invite skipped during username regeneration:', inviteError);
      }

      await queryClient.invalidateQueries({ queryKey: ['students'] });
      await queryClient.invalidateQueries({ queryKey: ['auditLogs'] });
      await logAuditEvent({
        action: 'STUDENT_REGENERATE_USERNAME',
        entityType: 'User',
        entityId: student.id,
        actorName: currentUser?.full_name || 'Admin',
        actorEmail: currentUser?.email || '',
        details: `Username regenerat pentru ${student.full_name || '-'}: ${username}`,
      });

      setGeneratedCredentials([{
        fullName: student.full_name,
        className: student.className || '-',
        username,
        password: 'Setata prin link-ul primit pe email',
        email: newEmail,
      }]);
      setCredentialsModalOpen(true);

      setCredentialsManagerStudent((prev) => (prev ? { ...prev, email: newEmail } : prev));
      toast({
        title: 'Username regenerat',
        description: `Noul username este ${username}.`,
      });
    } catch (error) {
      toast({
        title: 'Regenerare esuata',
        description: error?.message || 'Nu am putut regenera username-ul.',
        variant: 'destructive',
      });
    } finally {
      setCredentialsActionLoading('');
    }
  }

  function handleExportCSV() {
    const headers = ['Nume', 'Email', 'Telefon', 'Clasa', 'Specializare', 'Operator', 'Status'];
    const rows = filteredStudents.map((student) => {
      const operator = operators.find((entry) => entry.id === student.operatorId);
      return [
        student.full_name || '',
        student.email || '',
        student.phoneNumber || student.phone || '',
        student.className || '',
        student.specialization || '',
        operator?.name || 'Nealocat',
        student.isActive === false ? 'Inactiv' : 'Activ',
      ];
    });

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `elevi_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function handleDownloadImportTemplate() {
    try {
      const xlsxModule = await import('xlsx');
      const XLSX = xlsxModule.default || xlsxModule;

      const studentsRows = [
        ['Nume complet', 'Email', 'Telefon', 'Push Token', 'Clasa', 'Specializare'],
        ['Popescu Ana', 'ana.popescu@scoala.ro', '+40744111222', '', '10A', 'Informatica'],
        ['Ionescu Mihai', 'mihai.ionescu@scoala.ro', '+40755122334', '', '10A', 'Informatica'],
      ];

      const instructionsRows = [
        ['Instructiuni import elevi'],
        ['1. Completeaza datele in foaia "Elevi".'],
        ['2. Coloana "Nume complet" este obligatorie.'],
        ['3. Emailul este recomandat si ajuta la actualizare/evitare duplicate.'],
        ['4. Telefonul este optional, dar util pentru canalele SMS.'],
        ['5. Push Token este optional, dar util pentru canalele push.'],
        ['6. Clasa si Specializare pot fi lasate goale si completate din optiunile de import.'],
        ['7. Nu modifica numele coloanelor din primul rand.'],
      ];

      const workbook = XLSX.utils.book_new();
      const studentsSheet = XLSX.utils.aoa_to_sheet(studentsRows);
      studentsSheet['!cols'] = [{ wch: 28 }, { wch: 32 }, { wch: 16 }, { wch: 24 }, { wch: 12 }, { wch: 22 }];

      const instructionsSheet = XLSX.utils.aoa_to_sheet(instructionsRows);
      instructionsSheet['!cols'] = [{ wch: 100 }];

      XLSX.utils.book_append_sheet(workbook, studentsSheet, 'Elevi');
      XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructiuni');

      const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'template_import_elevi.xlsx';
      link.click();
      URL.revokeObjectURL(url);

      toast({
        title: 'Template descarcat',
        description: 'Completeaza fisierul si importa-l din acelasi ecran.',
      });
    } catch (error) {
      toast({
        title: 'Nu am putut genera template-ul',
        description: error?.message || 'A aparut o eroare la generarea fisierului.',
        variant: 'destructive',
      });
    }
  }

  async function handleImportFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsParsingFile(true);
    try {
      const parsed = await parseStudentsFile(file);
      setImportPreview({ fileName: file.name, students: parsed.students, skipped: parsed.skipped });
    } catch (error) {
      toast({
        title: 'Import indisponibil',
        description: error?.message || 'Fisierul nu a putut fi procesat.',
        variant: 'destructive',
      });
      setImportPreview({ fileName: '', students: [], skipped: [] });
    } finally {
      setIsParsingFile(false);
      event.target.value = '';
    }
  }

  function handleExportCredentials() {
    const headers = ['Nume Complet', 'Clasa', 'Username', 'Parola', 'Email'];
    const rows = generatedCredentials.map((credential) => [
      credential.fullName,
      credential.className,
      credential.username,
      credential.password,
      credential.email,
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `credentiale_elevi_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      <div className="max-w-full mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Gestionare elevi</h1>
            <p className="text-gray-500 mt-1">{filteredStudents.length} elevi afisati din {students.length}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleExportCSV}><Download className="h-4 w-4 mr-2" />Export CSV</Button>
            <Button variant="outline" onClick={handleDownloadImportTemplate}><Download className="h-4 w-4 mr-2" />Template import</Button>
            <Button variant="outline" onClick={openImportModal}><Upload className="h-4 w-4 mr-2" />Import lista</Button>
            <Button onClick={openCreateStudentModal} className="bg-blue-600 hover:bg-blue-700"><UserPlus className="h-4 w-4 mr-2" />Adauga elev</Button>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="space-y-2">
                <Label>Cautare</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input className="pl-9" placeholder="Nume, email, telefon, push token, clasa..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Clasa</Label>
                <Select value={filterClass} onValueChange={setFilterClass}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_VALUE}>Toate clasele</SelectItem>
                    {classes.map((className) => (<SelectItem key={className} value={className}>{className}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Operator</Label>
                <Select value={filterOperator} onValueChange={setFilterOperator}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_VALUE}>Toti</SelectItem>
                    <SelectItem value={UNASSIGNED_OPERATOR}>Nealocat</SelectItem>
                    {operators.map((operator) => (<SelectItem key={operator.id} value={operator.id}>{operator.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Specializare</Label>
                <Select value={filterSpecialization} onValueChange={setFilterSpecialization}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_VALUE}>Toate</SelectItem>
                    {specializations.map((specialization) => (<SelectItem key={specialization} value={specialization}>{specialization}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_VALUE}>Toate</SelectItem>
                    <SelectItem value="active">Activi</SelectItem>
                    <SelectItem value="inactive">Inactivi</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[220px]">Nume</TableHead>
                    <TableHead className="w-[220px]">Email</TableHead>
                    <TableHead className="w-[150px]">Telefon</TableHead>
                    <TableHead className="w-[110px]">Clasa</TableHead>
                    <TableHead className="w-[160px]">Specializare</TableHead>
                    <TableHead className="w-[180px]">Operator</TableHead>
                    <TableHead className="w-[100px]">Status</TableHead>
                    <TableHead className="w-[150px] text-right">Actiuni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStudents.map((student) => {
                    const operator = operators.find((entry) => entry.id === student.operatorId);
                    return (
                      <TableRow key={student.id}>
                        <TableCell className="font-medium">{student.full_name || '-'}</TableCell>
                        <TableCell>{student.email || '-'}</TableCell>
                        <TableCell>{student.phoneNumber || student.phone || '-'}</TableCell>
                        <TableCell><Badge variant="outline">{student.className || '-'}</Badge></TableCell>
                        <TableCell>{student.specialization || '-'}</TableCell>
                        <TableCell>{operator?.name || 'Nealocat'}</TableCell>
                        <TableCell><Badge variant={student.isActive === false ? 'secondary' : 'default'}>{student.isActive === false ? 'Inactiv' : 'Activ'}</Badge></TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEditStudentModal(student)} className="h-8 w-8"><Pencil className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => openCredentialsManager(student)} className="h-8 w-8 text-blue-600 hover:text-blue-700"><KeyRound className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDeleteStudent(student)} className="h-8 w-8 text-red-600 hover:text-red-700"><Trash2 className="h-4 w-4" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {filteredStudents.length === 0 && (<div className="py-12 text-center text-gray-500">Nu exista elevi pentru filtrele selectate.</div>)}
          </CardContent>
        </Card>
      </div>

      <Dialog open={studentModalOpen} onOpenChange={setStudentModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{studentForm.id ? 'Modifica elev' : 'Adauga elev'}</DialogTitle>
            <DialogDescription>Completeaza datele elevului. Clasa poate fi una existenta sau noua.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 md:col-span-2">
              <Label>Nume complet *</Label>
              <Input value={studentForm.full_name} onChange={(event) => setStudentForm((prev) => ({ ...prev, full_name: event.target.value }))} placeholder="Ex: Popescu Ion" />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Email</Label>
              <Input type="email" value={studentForm.email} onChange={(event) => setStudentForm((prev) => ({ ...prev, email: event.target.value }))} placeholder="exemplu@scoala.ro" />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Telefon</Label>
              <Input value={studentForm.phoneNumber} onChange={(event) => setStudentForm((prev) => ({ ...prev, phoneNumber: event.target.value }))} placeholder="Ex: +40744111222" />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label>Push token</Label>
              <Input value={studentForm.pushToken} onChange={(event) => setStudentForm((prev) => ({ ...prev, pushToken: event.target.value }))} placeholder="Token dispozitiv (optional)" />
            </div>

            <div className="space-y-2">
              <Label>Clasa</Label>
              <Input value={studentForm.className} onChange={(event) => setStudentForm((prev) => ({ ...prev, className: event.target.value }))} placeholder="Ex: 10A" />
            </div>

            <div className="space-y-2">
              <Label>Specializare</Label>
              <Input value={studentForm.specialization} onChange={(event) => setStudentForm((prev) => ({ ...prev, specialization: event.target.value }))} placeholder="Ex: Informatica" />
            </div>
            <div className="space-y-2">
              <Label>Operator</Label>
              <Select value={studentForm.operatorId || UNASSIGNED_OPERATOR} onValueChange={(value) => setStudentForm((prev) => ({ ...prev, operatorId: value }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED_OPERATOR}>Nealocat</SelectItem>
                  {operators.filter((operator) => operator.isActive !== false).map((operator) => (
                    <SelectItem key={operator.id} value={operator.id}>{operator.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status activ</Label>
              <div className="h-10 px-3 border rounded-md flex items-center">
                <Switch checked={studentForm.isActive} onCheckedChange={(checked) => setStudentForm((prev) => ({ ...prev, isActive: checked }))} />
                <span className="ml-3 text-sm text-gray-600">{studentForm.isActive ? 'Activ' : 'Inactiv'}</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setStudentModalOpen(false)}>Renunta</Button>
            <Button onClick={() => saveStudentMutation.mutate(studentForm)} disabled={saveStudentMutation.isPending || !studentForm.full_name.trim()} className="bg-blue-600 hover:bg-blue-700">
              {saveStudentMutation.isPending ? 'Se salveaza...' : studentForm.id ? 'Salveaza' : 'Creeaza elev'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importModalOpen} onOpenChange={setImportModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import elevi din fisier</DialogTitle>
            <DialogDescription>Formate acceptate: .xlsx, .xls, .csv, .txt, .docx, .pdf.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Fisier lista elevi</Label>
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={handleDownloadImportTemplate}>
                <Download className="h-4 w-4 mr-2" />
                Descarca template .xlsx
              </Button>
              <Input type="file" accept=".xlsx,.xls,.csv,.txt,.doc,.docx,.pdf" onChange={handleImportFileChange} />
              {isParsingFile && (<p className="text-sm text-gray-600">Se proceseaza fisierul...</p>)}
            </div>

            {importPreview.fileName && (
              <Card className="border-dashed">
                <CardContent className="pt-6 space-y-3">
                  <p className="text-sm"><strong>Fisier:</strong> {importPreview.fileName}</p>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                    <p><strong>Total:</strong> {importAnalysis.summary.totalRows}</p>
                    <p><strong>Creeaza:</strong> {importAnalysis.summary.create}</p>
                    <p><strong>Actualizeaza:</strong> {importAnalysis.summary.update}</p>
                    <p><strong>Sarite:</strong> {importAnalysis.summary.skip}</p>
                    <p><strong>Invalide:</strong> {importAnalysis.summary.invalid}</p>
                  </div>
                  {importAnalysis.summary.actionable === 0 && (
                    <p className="text-sm text-red-700">
                      Nu exista randuri procesabile. Modifica optiunile de import sau fisierul.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Clasa implicita (optional)</Label>
                <Input value={importOptions.defaultClassName} onChange={(event) => setImportOptions((prev) => ({ ...prev, defaultClassName: event.target.value }))} placeholder="Ex: 11B" />
              </div>
              <div className="space-y-2">
                <Label>Specializare implicita (optional)</Label>
                <Input value={importOptions.defaultSpecialization} onChange={(event) => setImportOptions((prev) => ({ ...prev, defaultSpecialization: event.target.value }))} placeholder="Ex: Turism" />
              </div>
              <div className="space-y-2">
                <Label>Operator implicit</Label>
                <Select value={importOptions.defaultOperatorId} onValueChange={(value) => setImportOptions((prev) => ({ ...prev, defaultOperatorId: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNASSIGNED_OPERATOR}>Nealocat</SelectItem>
                    {operators.map((operator) => (<SelectItem key={operator.id} value={operator.id}>{operator.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Status implicit</Label>
                <div className="h-10 px-3 border rounded-md flex items-center">
                  <Switch checked={importOptions.defaultIsActive} onCheckedChange={(checked) => setImportOptions((prev) => ({ ...prev, defaultIsActive: checked }))} />
                  <span className="ml-3 text-sm text-gray-600">{importOptions.defaultIsActive ? 'Activ' : 'Inactiv'}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-md border p-3">
              <Checkbox id="update-existing" checked={importOptions.updateExisting} onCheckedChange={(value) => setImportOptions((prev) => ({ ...prev, updateExisting: value === true }))} />
              <Label htmlFor="update-existing" className="cursor-pointer">Actualizeaza elevii existenti daca emailul este deja in sistem</Label>
            </div>
            <div className="flex items-center gap-3 rounded-md border p-3">
              <Checkbox id="generate-credentials" checked={importOptions.generateCredentials} onCheckedChange={(value) => setImportOptions((prev) => ({ ...prev, generateCredentials: value === true }))} />
              <Label htmlFor="generate-credentials" className="cursor-pointer">
                Genereaza automat username si parola pentru elevii fara email (`username@practica.local`)
              </Label>
            </div>

            {importPreview.students.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Preview primele 20 randuri analizate</p>
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nume</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Telefon</TableHead>
                        <TableHead>Push Token</TableHead>
                        <TableHead>Clasa</TableHead>
                        <TableHead>Specializare</TableHead>
                        <TableHead>Actiune</TableHead>
                        <TableHead>Observatii</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importAnalysis.rows.slice(0, 20).map((row) => {
                        const source = row.source || {};
                        return (
                        <TableRow key={row.id}>
                          <TableCell>{source.full_name || '-'}</TableCell>
                          <TableCell>{source.email || '-'}</TableCell>
                          <TableCell>{source.phoneNumber || source.phone || '-'}</TableCell>
                          <TableCell className="max-w-[180px] truncate">{source.pushToken || source.deviceToken || '-'}</TableCell>
                          <TableCell>{source.className || importOptions.defaultClassName || '-'}</TableCell>
                          <TableCell>{source.specialization || importOptions.defaultSpecialization || '-'}</TableCell>
                          <TableCell>
                            <Badge variant={getImportActionBadgeVariant(row.action)}>
                              {getImportActionLabel(row.action)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-gray-600">{row.issue || '-'}</TableCell>
                        </TableRow>
                      )})}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {importAnalysis.summary.invalid > 0 && (
              <Card>
                <CardContent className="pt-6 space-y-2">
                  <p className="text-sm font-medium text-red-700">Randuri invalide (primele 8)</p>
                  {importAnalysis.rows
                    .filter((row) => row.action === IMPORT_ACTIONS.INVALID)
                    .slice(0, 8)
                    .map((row) => (
                      <p key={row.id} className="text-xs text-gray-700">
                        {row.line ? `Linia ${row.line}: ` : ''}
                        {row.issue}
                      </p>
                    ))}
                </CardContent>
              </Card>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportModalOpen(false)}>Inchide</Button>
            <Button
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending || importAnalysis.summary.actionable === 0}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              {importMutation.isPending ? 'Se importa...' : `Importa ${importAnalysis.summary.actionable} randuri`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={credentialsManagerOpen}
        onOpenChange={(open) => {
          setCredentialsManagerOpen(open);
          if (!open) {
            setCredentialsManagerStudent(null);
            setCredentialsActionLoading('');
          }
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Gestionare credentiale elev</DialogTitle>
            <DialogDescription>
              Resetare parola, retrimitere invitatie si regenerare username pentru elevul selectat.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Card className="border-dashed">
              <CardContent className="pt-6 space-y-1">
                <p className="text-sm"><strong>Nume:</strong> {credentialsManagerStudent?.full_name || '-'}</p>
                <p className="text-sm"><strong>Clasa:</strong> {credentialsManagerStudent?.className || '-'}</p>
                <p className="text-sm"><strong>Email curent:</strong> {credentialsManagerStudent?.email || '-'}</p>
                <p className="text-sm"><strong>Telefon:</strong> {credentialsManagerStudent?.phoneNumber || credentialsManagerStudent?.phone || '-'}</p>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-2">
              <Button
                variant="outline"
                onClick={() => handleSendResetPassword(credentialsManagerStudent)}
                disabled={credentialsActionLoading !== ''}
              >
                <Mail className="h-4 w-4 mr-2" />
                {credentialsActionLoading === 'reset' ? 'Se trimite resetarea...' : 'Trimite reset parola pe email'}
              </Button>

              <Button
                variant="outline"
                onClick={() => handleResendInvite(credentialsManagerStudent)}
                disabled={credentialsActionLoading !== ''}
              >
                <Mail className="h-4 w-4 mr-2" />
                {credentialsActionLoading === 'invite' ? 'Se retrimite invitatia...' : 'Retrimite invitatie'}
              </Button>

              <Button
                onClick={() => handleRegenerateUsername(credentialsManagerStudent)}
                disabled={credentialsActionLoading !== ''}
                className="bg-blue-600 hover:bg-blue-700"
              >
                <KeyRound className="h-4 w-4 mr-2" />
                {credentialsActionLoading === 'regenerate' ? 'Se regenereaza...' : 'Regenerare username local'}
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCredentialsManagerOpen(false)}>
              Inchide</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CredentialsModal
        isOpen={credentialsModalOpen}
        setIsOpen={setCredentialsModalOpen}
        generatedCredentials={generatedCredentials}
        handleExportCredentials={handleExportCredentials}
      />
    </div>
  );
}

