export const VALIDATION_REASON_LABELS = {
    OK: 'Validare automata reusita',
    FARA_PONTAJ: 'Nu exista pontaj pentru data selectata',
    IN_AFARA_RAZEI: 'In afara razei permise',
    IN_AFARA_INTERVALULUI: 'In afara intervalului de pontaj',
    GPS_SLAB: 'Semnal GPS slab',
    DUPLICAT_ZI: 'Pontaj duplicat in aceeasi zi',
    ELEV_INACTIV: 'Cont elev inactiv',
    FARA_OPERATOR: 'Elev fara operator alocat',
    APROBAT_ADMIN: 'Aprobat manual de administrator',
    RESPINS_ADMIN: 'Respins manual de administrator',
    INAFARA_PERIOADEI: 'Perioada de practica nu este activa in aceasta zi',
    DATA_IN_VIITOR: 'Data selectata este in viitor',
    IN_ASTEPTARE_PONTAJ: 'Asteptare pontaj in intervalul permis',
    IN_ASTEPTARE: 'Pontaj in asteptare',
    RESPINS: 'Pontaj respins',
};

export function getValidationReasonLabel(reasonCode) {
    if (!reasonCode) return '-';
    return VALIDATION_REASON_LABELS[reasonCode] || reasonCode;
}
