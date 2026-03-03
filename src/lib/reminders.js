import { base44 } from '@/api/base44Client';

export const REMINDER_CHANNELS = {
    EMAIL: 'email',
    SMS: 'sms',
    PUSH: 'push',
};

const CHANNEL_LIST = [REMINDER_CHANNELS.EMAIL, REMINDER_CHANNELS.SMS, REMINDER_CHANNELS.PUSH];
const SMS_FUNCTION_CANDIDATES = ['send_sms_reminder', 'send_sms', 'sendSmsReminder', 'sendSms'];
const PUSH_FUNCTION_CANDIDATES = ['send_push_reminder', 'send_push', 'sendPushReminder', 'sendPush'];

function getCoreIntegration() {
    return base44?.integrations?.Core;
}

function getFunctionsApi() {
    return base44?.functions;
}

function findCoreMethod(methodCandidates = []) {
    const core = getCoreIntegration();
    if (!core) return null;

    for (const methodName of methodCandidates) {
        if (typeof core[methodName] === 'function') {
            return core[methodName].bind(core);
        }
    }

    return null;
}

function normalizePhone(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    return raw.replace(/[\s-]/g, '');
}

export function getReminderCapabilities() {
    const sendEmailMethod = findCoreMethod(['SendEmail']);
    const sendSmsMethod = findCoreMethod(['SendSMS', 'SendSms', 'SendTextMessage']);
    const sendPushMethod = findCoreMethod(['SendPushNotification', 'SendPush', 'PushNotification']);
    const hasFunctionsInvoke = typeof getFunctionsApi()?.invoke === 'function';

    return {
        email: Boolean(sendEmailMethod),
        sms: Boolean(sendSmsMethod) || hasFunctionsInvoke,
        push: Boolean(sendPushMethod) || hasFunctionsInvoke,
        sources: {
            email: sendEmailMethod ? 'core' : 'none',
            sms: sendSmsMethod ? 'core' : (hasFunctionsInvoke ? 'functions' : 'none'),
            push: sendPushMethod ? 'core' : (hasFunctionsInvoke ? 'functions' : 'none'),
        },
    };
}

function createInitialResult(channel, enabled) {
    if (!enabled) {
        return {
            channel,
            status: 'disabled',
            message: 'Canal dezactivat in configuratie.',
        };
    }

    return {
        channel,
        status: 'pending',
        message: '',
    };
}

async function sendEmail({ student, subject, body }) {
    const sendEmailMethod = findCoreMethod(['SendEmail']);
    if (!sendEmailMethod) {
        return { status: 'not_configured', message: 'Provider email indisponibil.' };
    }
    if (!student?.email) {
        return { status: 'missing_contact', message: 'Elev fara email.' };
    }

    try {
        await sendEmailMethod({
            to: student.email,
            subject,
            body,
        });
        return { status: 'sent', message: 'Email trimis.' };
    } catch (error) {
        return { status: 'error', message: error?.message || 'Eroare trimitere email.' };
    }
}

async function sendSms({ student, body }) {
    const sendSmsMethod = findCoreMethod(['SendSMS', 'SendSms', 'SendTextMessage']);
    const phone = normalizePhone(student?.phone || student?.phoneNumber);
    if (!phone) {
        return { status: 'missing_contact', message: 'Elev fara numar de telefon.' };
    }

    if (sendSmsMethod) {
        try {
            await sendSmsMethod({
                to: phone,
                body,
            });
            return { status: 'sent', message: 'SMS trimis prin Core integration.' };
        } catch (error) {
            return { status: 'error', message: error?.message || 'Eroare trimitere SMS.' };
        }
    }

    const functionsApi = getFunctionsApi();
    if (typeof functionsApi?.invoke !== 'function') {
        return { status: 'not_configured', message: 'Provider SMS indisponibil.' };
    }

    let lastError = null;
    for (const functionName of SMS_FUNCTION_CANDIDATES) {
        try {
            await functionsApi.invoke(functionName, {
                to: phone,
                body,
                studentId: student?.id,
                studentName: student?.full_name,
                channel: 'sms',
            });
            return { status: 'sent', message: `SMS trimis prin function ${functionName}.` };
        } catch (error) {
            lastError = error;
        }
    }

    const statusCode = lastError?.response?.status || lastError?.status;
    if (statusCode === 404) {
        return { status: 'not_configured', message: 'Function de SMS neconfigurata.' };
    }
    return { status: 'error', message: lastError?.message || 'Eroare trimitere SMS prin function.' };
}

async function sendPush({ student, title, body }) {
    const sendPushMethod = findCoreMethod(['SendPushNotification', 'SendPush', 'PushNotification']);
    const targetToken = student?.pushToken || student?.deviceToken || '';
    if (!targetToken && !student?.id) {
        return { status: 'missing_contact', message: 'Elev fara identificator push.' };
    }

    if (sendPushMethod) {
        try {
            await sendPushMethod({
                userId: student?.id,
                token: targetToken || undefined,
                title,
                body,
            });
            return { status: 'sent', message: 'Push trimis prin Core integration.' };
        } catch (error) {
            return { status: 'error', message: error?.message || 'Eroare trimitere push.' };
        }
    }

    const functionsApi = getFunctionsApi();
    if (typeof functionsApi?.invoke !== 'function') {
        return { status: 'not_configured', message: 'Provider push indisponibil.' };
    }

    let lastError = null;
    for (const functionName of PUSH_FUNCTION_CANDIDATES) {
        try {
            await functionsApi.invoke(functionName, {
                userId: student?.id,
                token: targetToken || undefined,
                title,
                body,
                studentName: student?.full_name,
                channel: 'push',
            });
            return { status: 'sent', message: `Push trimis prin function ${functionName}.` };
        } catch (error) {
            lastError = error;
        }
    }

    const statusCode = lastError?.response?.status || lastError?.status;
    if (statusCode === 404) {
        return { status: 'not_configured', message: 'Function de push neconfigurata.' };
    }
    return { status: 'error', message: lastError?.message || 'Eroare trimitere push prin function.' };
}

export async function sendReminderToStudent({
    student,
    channels = { email: true, sms: false, push: false },
    subject = 'Reminder prezenta practica',
    title = 'Reminder prezenta practica',
    body = '',
}) {
    const results = {
        email: createInitialResult(REMINDER_CHANNELS.EMAIL, Boolean(channels.email)),
        sms: createInitialResult(REMINDER_CHANNELS.SMS, Boolean(channels.sms)),
        push: createInitialResult(REMINDER_CHANNELS.PUSH, Boolean(channels.push)),
    };

    if (channels.email) {
        results.email = {
            channel: REMINDER_CHANNELS.EMAIL,
            ...(await sendEmail({ student, subject, body })),
        };
    }

    if (channels.sms) {
        results.sms = {
            channel: REMINDER_CHANNELS.SMS,
            ...(await sendSms({ student, body })),
        };
    }

    if (channels.push) {
        results.push = {
            channel: REMINDER_CHANNELS.PUSH,
            ...(await sendPush({ student, title, body })),
        };
    }

    const notified = CHANNEL_LIST.some((channelName) => results[channelName]?.status === 'sent');

    return {
        studentId: student?.id,
        studentName: student?.full_name || '',
        notified,
        channels: results,
    };
}

export function createEmptyDeliveryStats() {
    return {
        recipients: {
            total: 0,
            notified: 0,
        },
        channels: {
            email: { sent: 0, error: 0, missing_contact: 0, not_configured: 0, disabled: 0 },
            sms: { sent: 0, error: 0, missing_contact: 0, not_configured: 0, disabled: 0 },
            push: { sent: 0, error: 0, missing_contact: 0, not_configured: 0, disabled: 0 },
        },
    };
}

export function mergeDeliveryResult(stats, deliveryResult) {
    const next = stats;
    next.recipients.total += 1;
    if (deliveryResult.notified) {
        next.recipients.notified += 1;
    }

    CHANNEL_LIST.forEach((channelName) => {
        const statusValue = deliveryResult.channels?.[channelName]?.status || 'error';
        if (next.channels[channelName][statusValue] === undefined) {
            next.channels[channelName][statusValue] = 0;
        }
        next.channels[channelName][statusValue] += 1;
    });

    return next;
}
